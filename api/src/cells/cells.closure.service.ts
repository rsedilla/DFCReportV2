import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { AuditService } from '../audit/audit.service';
import {
  AuthorizationService,
  type Actor,
  type ActorAuthority,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  CapabilityDeniedError,
  InvariantViolationError,
  NotFoundError,
  ResourceBusyError,
  ScopeDeniedError,
  ValidationFailedError,
  type ApiError,
} from '../common/errors/api-error';
import { sameId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { manilaDayAfter, manilaDayOf, startOfManilaDay } from '../common/time/manila';
import { CellLock, lockCellsWithin, type CellLockRequest } from '../database/cell-lock';
import { DATABASE, type Db } from '../database/database.module';
import { boundLockWaitsWithin, lockPersonsWithin } from '../database/person-lock';
import { NetworksService } from '../networks/networks.service';

import { CellsReadService } from './cells.read.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { CellClosureReason, Database } from '../database/schema';
import type { Transaction } from 'kysely';

/** One member of the closing Cell, and what the closer decided about them. */
export interface MemberDecision {
  readonly personId: string;
  /** The Cell to move them to, or null to leave them in none (section 10). */
  readonly destinationCellId: string | null;
}

export interface CloseCellInput {
  readonly reason: CellClosureReason;
  readonly note?: string;
  readonly effectiveDate?: string;
  readonly members: readonly MemberDecision[];
}

/**
 * Closing a Cell (SKILL.md section 10, *What closing does*; section 11).
 *
 * Five writes in one transaction: the Cell's state becomes `CLOSED`, its leadership
 * assignment ends, its active memberships end, its open category row ends and its
 * open schedule row ends — all on the effective date. The last two joined that list
 * on 2026-08-29, and migration 0010 is the constraint they earned.
 *
 * **Two things section 10 records as unsettled are settled by this file, and both
 * are settled by execution rather than by argument.** Each had been written three
 * times in prose and refuted three times, the last by reproducing a deadlock, so the
 * standing instruction was to build the mechanism and let the specification record
 * what survived. `api/test/database/closure-locking.spec.ts` measures the ordering and
 * `api/test/api/cell-closure.e2e.spec.ts` the floor; the comments below say what those
 * found, and are not an argument for it.
 *
 * **The member decisions come from the request, and that is what makes the lock
 * ordering possible at all.** Section 10 requires the members to be presented and an
 * explicit decision recorded for each, so the client sends the list — which means
 * the people to lock are known before anything is read. Every previous formulation
 * foundered on the opposite assumption: locking the Cell first and reaching back for
 * people cycles against the membership writer, and reading the member list first to
 * decide whom to lock reads something another transaction can invalidate. Neither
 * arises when the list is an input. What the operation still owes is a check that
 * the list it was given is the Cell's *actual* membership, made after the locks —
 * section 14's version check, in the shape the closure needs it.
 */
@Injectable()
export class CellsClosureService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly cells: CellsReadService,
    private readonly networks: NetworksService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async close(
    cellId: string,
    input: CloseCellInput,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // On the pool, before the transaction opens (section 24): `authorityFor` reads
    // `account_roles` and `capability_grants`, and asking a bounded pool for a second
    // connection while holding one is the liveness hazard that section names.
    const authority = await this.authorization.authorityFor(actor.accountId);

    this.assertDecisionsAreWellFormed(cellId, input.members);

    return this.db.transaction().execute(async (trx) => {
      // ------------------------------------------------------------------
      // The locks, in the order this operation had to establish (section 5).
      // ------------------------------------------------------------------

      // **The bound first, and this operation is the case section 5 names.**
      // `lockPersonsWithin` sets `lock_timeout` and returns early on an empty list,
      // so a Cell with nobody to disperse would reach its row locks unbounded — "a
      // Cell closure with no members to disperse is exactly it". `SET LOCAL` takes
      // no locks and no snapshot, so this cannot itself be what waits.
      await boundLockWaitsWithin(trx);

      // **People before Cells.** A membership write takes an advisory lock on the
      // person and then, at commit, a row lock on the Cell, so the order between the
      // two classes is fixed by an existing writer. The harness stages the reverse —
      // Cells first, then reaching back for a person — and PostgreSQL answers
      // `40P01`. Ascending lock key is the helper's, not this call site's.
      await lockPersonsWithin(
        trx,
        input.members.map((member) => member.personId),
      );

      // Every `cells` row this transaction will touch, sorted, each at the strength
      // it will need and taken once. `lockCellsWithin` carries what that means and
      // why the fold to the strongest matters.
      await lockCellsWithin(trx, this.cellLocksFor(cellId, input.members));

      // ------------------------------------------------------------------
      // What the locks make it safe to read.
      // ------------------------------------------------------------------

      const cell = await trx
        .selectFrom('cells')
        .select(['id', 'cell_id', 'state'])
        .where('id', '=', cellId)
        .executeTakeFirst();

      if (!cell) {
        // Reached only by an actor whose scope would have covered the Cell: the
        // guard refuses everyone else with `SCOPE_DENIED` before this runs and
        // cannot tell an absent Cell from one out of scope. Section 22 carries the
        // reasoning and names a Cell as its second worked case.
        throw new NotFoundError('No such Cell.');
      }

      if (cell.state === 'CLOSED') {
        throw new InvariantViolationError(
          'That Cell is already closed, and a closure is never reversed or repeated ' +
            '(SKILL.md section 10, Reopening). Where a ministry restarts, create a new Cell.',
          { cell_id: cell.cell_id },
        );
      }

      // Section 10: scope over the Cell is re-decided inside the transaction, after
      // the locks. The guard answered on the pool before the request queued, and a
      // handover committing in between leaves that answer describing authority the
      // actor no longer holds.
      await this.assertStillInScopeWithin(
        trx,
        actor,
        authority,
        cellId,
        Capability.CellManageLifecycle,
        'That Cell moved outside your authorized scope while this closure was being made.',
      );

      const members = await this.assertDecisionsMatchMembershipWithin(trx, cellId, input.members);

      // ------------------------------------------------------------------
      // The effective instant, read after the locks, then bounded by the floor.
      // ------------------------------------------------------------------

      const recordedAt = await this.nowWithin(trx);
      const effectiveAt =
        input.effectiveDate === undefined ? recordedAt : startOfManilaDay(input.effectiveDate);

      // **Decided here, after the locks, against the instant the write actually
      // applies** — and an earlier version decided it at handler entry against
      // `new Date()` on this host. Section 10 asks whether the effective date is
      // earlier than *the current day*, and both halves of that comparison moved:
      // a request arriving at 23:59:59.7 and waiting out part of the three-second
      // `lock_timeout` crosses Manila midnight, so a date that was today when the
      // request arrived is yesterday's by the time the closure ends rows at it —
      // backdated by up to a day, with no capability asked, no note required and no
      // `effective_date.backdated` entry written. Host-to-server clock skew does the
      // same with no wait at all, and section 24 bounds no skew.
      //
      // This is section 5's rule about the effective instant applied to the decision
      // that reads it: an operation reads what it will rely on after the lock. Issue
      // #16 is the same fault one field over.
      const backdated =
        input.effectiveDate !== undefined && input.effectiveDate < manilaDayOf(recordedAt);

      if (backdated) {
        await this.assertMayBackdateWithin(trx, actor, authority);

        if (input.note === undefined) {
          // Section 7: backdating a closure "is Admin-only and always requires a
          // reason". The closure reason cannot be that reason — every closure carries
          // one from the fixed list, so reading it that way makes the requirement
          // vacuous and backdating adds nothing to what an ordinary closure records.
          // What is owed is an explanation of the *backdating*, which is what section
          // 5 requires of a backdated reassignment and for the reason section 10
          // gives: a backdated closure erases the scheduled-meeting count a coverage
          // line is read against, so the entry that records it has to say why.
          throw new ValidationFailedError(
            'Backdating a closure requires a note explaining it (SKILL.md section 7).',
            { field: 'note' },
          );
        }
      }

      if (effectiveAt.getTime() > recordedAt.getTime()) {
        throw new ValidationFailedError(
          'A closure takes effect now or in the past. It cannot be forward-dated.',
          { field: 'effective_date', value: input.effectiveDate },
        );
      }

      const floor = await this.closureFloorWithin(trx, cellId);

      if (effectiveAt.getTime() < floor.getTime()) {
        throw this.closureTooEarly(cell.cell_id, floor, input.effectiveDate !== undefined);
      }

      // Destinations are validated after the floor rather than before it, so a
      // request that cannot succeed at any destination is refused on the reason that
      // applies to the whole request rather than on the first member in the list.
      const destinations = await this.resolveDestinationsWithin(
        trx,
        actor,
        authority,
        members,
        effectiveAt,
      );

      // ------------------------------------------------------------------
      // The writes.
      // ------------------------------------------------------------------

      for (const member of members) {
        await trx
          .updateTable('cell_memberships')
          .set({ ended_at: effectiveAt })
          .where('id', '=', member.membershipId)
          .execute();

        const destination = destinations.get(member.personId);

        if (destination) {
          await trx
            .insertInto('cell_memberships')
            .values({
              person_id: member.personId,
              cell_id: destination.id,
              started_at: effectiveAt,
            })
            .execute();
        }
      }

      const outgoingLeader = await this.cells.leaderAsOfWithin(trx, cellId, effectiveAt);

      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: effectiveAt })
        .where('cell_id', '=', cellId)
        .where('ended_at', 'is', null)
        .execute();

      await this.endConfigurationWithin(trx, 'cell_categories', cellId, effectiveAt);
      await this.endConfigurationWithin(trx, 'cell_schedules', cellId, effectiveAt);

      await trx
        .updateTable('cells')
        .set({
          state: 'CLOSED',
          closed_at: effectiveAt,
          closure_reason: input.reason,
          closure_note: input.note ?? null,
        })
        .where('id', '=', cellId)
        .execute();

      // ------------------------------------------------------------------
      // The record (section 21).
      // ------------------------------------------------------------------

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell.closed',
        targetType: 'cell',
        targetId: cellId,
        before: { state: 'ACTIVE' },
        after: {
          state: 'CLOSED',
          closure_reason: input.reason,
          closure_note: input.note ?? null,
          effective_at: effectiveAt.toISOString(),
          effective_date: manilaDayOf(effectiveAt),
        },
        reason: input.note ?? null,
      });

      // **Section 21 lists "Cell leadership opened, ended, or changed" as an action in
      // its own right**, and the first version of this operation wrote none — on the
      // reasoning that the ending is not a separate decision and its date is the
      // closure's. That is the same reasoning the paragraph below rejects for a
      // membership, twelve lines away: section 21 asks for one entry per action
      // performed, and a reader asking who led a Cell before it closed must find it
      // whichever operation ended the assignment.
      if (outgoingLeader !== null) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'cell_leadership.ended',
          targetType: 'cell',
          targetId: cellId,
          // Section 21: "carrying the outgoing and the incoming leader where each
          // exists". A closure has no incoming leader, which is what distinguishes it
          // from a handover in the log.
          before: { cell_leader_id: outgoingLeader },
          after: { cell_leader_id: null, ended_at: effectiveAt.toISOString() },
          reason: 'Cell closed',
        });
      }

      // **One entry per member, and the same two action names an ordinary membership
      // change writes.** Section 21 names "Cell membership added, moved, or ended"
      // and asks for one entry per action performed; a dispersal *is* a move and
      // leaving somebody unassigned *is* an ending, so a reader searching for either
      // must find these. Recording them only inside the closure entry would make a
      // member's history depend on which operation happened to move them.
      for (const member of members) {
        const destination = destinations.get(member.personId);

        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: destination ? 'cell_membership.moved' : 'cell_membership.ended',
          targetType: 'person',
          targetId: member.personId,
          before: { cell_uuid: cellId, cell_id: cell.cell_id },
          after: destination
            ? {
                cell_uuid: destination.id,
                cell_id: destination.cell_id,
                started_at: effectiveAt.toISOString(),
              }
            : { ended_at: effectiveAt.toISOString() },
          reason: 'Cell closed',
        });
      }

      if (backdated) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'effective_date.backdated',
          targetType: 'cell',
          targetId: cellId,
          after: {
            operation: 'cell.closed',
            recorded_at: recordedAt.toISOString(),
            effective_at: effectiveAt.toISOString(),
            effective_date: manilaDayOf(effectiveAt),
          },
          reason: input.note ?? null,
        });
      }

      const response = {
        cell_id: cell.cell_id,
        cell_uuid: cell.id,
        state: 'CLOSED',
        closure_reason: input.reason,
        closure_note: input.note ?? null,
        // Both renderings, for the reason the configuration responses give: a
        // date-only field sent as a timestamp is where months silently shift
        // (section 22).
        effective_at: effectiveAt.toISOString(),
        effective_date: manilaDayOf(effectiveAt),
        members_moved: members.flatMap((member) => {
          const destination = destinations.get(member.personId);

          return destination
            ? [
                {
                  person_id: member.personId,
                  cell_id: destination.cell_id,
                  cell_uuid: destination.id,
                },
              ]
            : [];
        }),
        members_left_unassigned: members
          .filter((member) => !destinations.has(member.personId))
          .map((member) => member.personId),
      };

      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });

      return response;
    });
  }

  /**
   * Every `cells` row this closure will touch, with the strength it needs for each.
   *
   * The closing Cell is written, so it is taken at the strength its own `UPDATE`
   * takes. Each destination is only depended upon — it must not close underneath the
   * memberships being written into it — so it is taken shared, which lets two
   * closures disperse into one Cell without waiting for each other, and lets an
   * ordinary add into a destination proceed alongside.
   *
   * A destination named twice folds to one lock inside the helper. A destination
   * that *is* the closing Cell would fold to the stronger of the two, which is
   * correct in itself and is refused earlier for a different reason.
   */
  private cellLocksFor(
    cellId: string,
    members: readonly MemberDecision[],
  ): readonly CellLockRequest[] {
    const locks: CellLockRequest[] = [{ cellId, strength: CellLock.WritesTheRow }];

    for (const member of members) {
      if (member.destinationCellId !== null) {
        locks.push({ cellId: member.destinationCellId, strength: CellLock.ReadsTheState });
      }
    }

    return locks;
  }

  /**
   * What can be decided about the request before anything is locked or read.
   *
   * Kept out of the transaction deliberately: each of these is a property of the
   * payload alone, and refusing them early means a malformed request never takes a
   * lock, never waits behind another closure, and cannot be answered
   * `RESOURCE_BUSY` for a defect in itself.
   */
  private assertDecisionsAreWellFormed(cellId: string, members: readonly MemberDecision[]): void {
    const seen = new Set<string>();

    for (const member of members) {
      if (seen.has(member.personId)) {
        throw new ValidationFailedError(
          'A member appears twice in the closure decisions. Each member is decided once.',
          { field: 'members', value: member.personId },
        );
      }

      seen.add(member.personId);

      // `sameId` rather than `===`. This comparison fails **open**: mis-cased, the
      // Cell would be named as its own dispersal destination, the fold in
      // `lockCellsWithin` would take one lock for both roles, and the write would
      // close a membership and reopen it in the Cell being closed — refused at
      // commit by a deferred trigger as a raw `check_violation`, which renders
      // `INTERNAL_ERROR`. Section 7 requires a check that fails open to normalize
      // again rather than rely on the boundary pipe having been wired.
      if (member.destinationCellId !== null && sameId(member.destinationCellId, cellId)) {
        throw new ValidationFailedError(
          'A member cannot be dispersed into the Cell being closed. Name another Cell, ' +
            'or leave them unassigned (SKILL.md section 10, What closing does).',
          { field: 'members', value: member.personId },
        );
      }
    }
  }

  /**
   * The request's decisions are exactly the Cell's current members — no more, no
   * fewer — and this is checked after the locks rather than before them.
   *
   * **Section 10 requires the decision rather than the outcome**: closure "must not
   * complete without the decision being made and recorded", and a decision made
   * about a membership list that has since changed is a decision about somebody
   * else. So a member added or removed between the client reading the list and the
   * request arriving refuses the closure and asks for it to be re-read, which is
   * section 14's rule that a conflict is resolved by a person rather than by
   * last-write-wins.
   *
   * **It is also what makes the ordering sound.** The people locked come from the
   * request, so a member the request does not name is not locked — and this is what
   * catches that, rather than a lock. The read is stable because the closing Cell is
   * held at `FOR NO KEY UPDATE`: an add committing after that lock was taken waits
   * for it and is then refused against the closed state, and one that committed
   * before it is visible to this read under `READ COMMITTED`.
   */
  private async assertDecisionsMatchMembershipWithin(
    trx: Transaction<Database>,
    cellId: string,
    decisions: readonly MemberDecision[],
  ): Promise<
    readonly { membershipId: string; personId: string; destinationCellId: string | null }[]
  > {
    const open = await trx
      .selectFrom('cell_memberships')
      .select(['id', 'person_id'])
      .where('cell_id', '=', cellId)
      .where('ended_at', 'is', null)
      .execute();

    const decided = new Map(decisions.map((member) => [member.personId, member]));
    const missing = open.filter((row) => !decided.has(row.person_id)).map((row) => row.person_id);
    const surplus = decisions
      .filter((member) => !open.some((row) => row.person_id === member.personId))
      .map((member) => member.personId);

    if (missing.length > 0 || surplus.length > 0) {
      throw new InvariantViolationError(
        'The members named in this closure are not the Cell’s current members. ' +
          'Re-read the Cell’s membership and submit the closure again: section 10 ' +
          'requires an explicit decision about every member, and this one was made ' +
          'about a different list.',
        { undecided_person_ids: missing, unknown_person_ids: surplus },
      );
    }

    return open.map((row) => ({
      membershipId: row.id,
      personId: row.person_id,
      destinationCellId: decided.get(row.person_id)?.destinationCellId ?? null,
    }));
  }

  /**
   * Each dispersal destination, checked on the three things that would otherwise
   * fail at commit as a constraint violation or silently place somebody wrongly.
   *
   * **Scope, on the same rule as an ordinary move.** Section 10: "A destination Cell
   * must be within the actor's authorized scope, exactly as an ordinary move
   * requires… they may not put people into a Cell belonging to a branch they have
   * nothing to do with." The capability is `cell.manage_membership`, because that is
   * what the write is, and `cell.manage_lifecycle` over the closing Cell says nothing
   * about the destination.
   *
   * **ACTIVE**, because a membership open in a closed Cell is a person who can join
   * no other, and **same Network as the destination's leader**, because
   * `cell_memberships_same_network` is deferred and would raise at COMMIT as a raw
   * `check_violation` — the 500-instead-of-an-answer failure the membership service
   * records for the identical rule. The constraints stay the enforcement; these give
   * the caller an answer.
   */
  private async resolveDestinationsWithin(
    trx: Transaction<Database>,
    actor: Actor,
    authority: ActorAuthority,
    members: readonly { personId: string; destinationCellId: string | null }[],
    effectiveAt: Date,
  ): Promise<Map<string, { id: string; cell_id: string }>> {
    const resolved = new Map<string, { id: string; cell_id: string }>();
    const checked = new Map<string, { id: string; cell_id: string; network: string | null }>();

    for (const member of members) {
      if (member.destinationCellId === null) {
        continue;
      }

      let destination = checked.get(member.destinationCellId);

      if (destination === undefined) {
        const row = await trx
          .selectFrom('cells')
          .select(['id', 'cell_id', 'state'])
          .where('id', '=', member.destinationCellId)
          .executeTakeFirst();

        if (!row) {
          throw new NotFoundError('No such destination Cell.', {
            person_id: member.personId,
          });
        }

        if (row.state === 'CLOSED') {
          throw new InvariantViolationError(
            'A destination Cell is closed, so nobody joins it (SKILL.md section 10). ' +
              'Name another Cell, or leave that member unassigned.',
            { person_id: member.personId, cell_id: row.cell_id },
          );
        }

        await this.assertStillInScopeWithin(
          trx,
          actor,
          authority,
          row.id,
          Capability.CellManageMembership,
          'You do not have authority over that destination Cell. A closure places members ' +
            'into Cells you hold scope over and leaves the rest unassigned (SKILL.md ' +
            'section 10, What closing does).',
        );

        // **As of the effective instant, and the scope check above is deliberately not.**
        // Section 7 as amended settles the pair for a backdated write: authority is
        // decided as of now, because the actor acts now and a leader whose Cell was
        // handed away must not reclaim it by dating the action back; the relationship
        // being recorded is decided as of its own effective date, because that is the
        // period it describes. The same-Network comparison is the second of those, and
        // must use the predicate its trigger uses — the assignment row covering the
        // membership's `started_at`. The two agree for
        // every membership written at `clock_timestamp()` and part company the moment
        // a closure is backdated — a closure dated to February dispersing into a Cell
        // created in August has a destination with no leader then, and the scope rule
        // cheerfully answers with its current one. Left that way the deferred trigger
        // raises `check_violation` at COMMIT and the caller gets `INTERNAL_ERROR`,
        // which is the failure this whole method exists to prevent.
        const leaderId = await this.cells.leaderAsOfWithin(trx, row.id, effectiveAt);

        if (leaderId === null) {
          throw new InvariantViolationError(
            'A destination Cell had no leader on the closure date, so a membership ' +
              'starting then has no Network to be checked against (SKILL.md section 11). ' +
              'A Cell created after that date cannot receive a member dated before it.',
            { person_id: member.personId, cell_id: row.cell_id },
          );
        }

        destination = {
          id: row.id,
          cell_id: row.cell_id,
          network: await this.networks.networkAsOf(trx, leaderId, effectiveAt),
        };

        checked.set(member.destinationCellId, destination);
      }

      const memberNetwork = await this.networks.networkAsOf(trx, member.personId, effectiveAt);

      if (
        destination.network === null ||
        memberNetwork === null ||
        memberNetwork !== destination.network
      ) {
        throw new InvariantViolationError(
          'A Cell member and the Cell leader belong to the same Network (SKILL.md ' +
            'section 10, Managing Cell membership).',
          {
            person_id: member.personId,
            cell_id: destination.cell_id,
            member_network: memberNetwork,
            cell_network: destination.network,
          },
        );
      }

      resolved.set(member.personId, { id: destination.id, cell_id: destination.cell_id });
    }

    return resolved;
  }

  /**
   * The earliest instant this Cell can legally be closed at.
   *
   * **Two terms, over two tables, and the omissions are the part worth reading.**
   *
   * (a) The `started_at` of every **open** leadership and membership row. The closure
   *     ends each at the effective date, and `period_ordered` on both tables refuses
   *     a period ending before it starts.
   *
   * (b) The `ended_at` of every **already-closed** leadership and membership row —
   *     from an earlier handover, or a member who left. Migration 0009 forbids a row
   *     of a CLOSED Cell ending after the Cell did, and that rule reaches rows this
   *     operation does not write.
   *
   * **Category and schedule rows contribute no term, and that is the difference
   * migration 0010 exists to make.** They are ended at `GREATEST(effective date, own
   * start)`, which is satisfiable for any date whatever — so they bound nothing. A
   * floor that included them would sit in the **future** for any Cell with a pending
   * schedule change, since such a change carries next month's timestamps, and that
   * Cell would then be closable by nobody. Two of the three withdrawn formulations
   * died there. Adding a term that can never bind reads as though it were doing work
   * (the 2026-08-22 lesson), and adding this one would have done worse than that.
   *
   * **`cells.created_at` contributes no term either**, for the honest reason rather
   * than by oversight: an ACTIVE Cell always holds exactly one open leadership row
   * (section 11), the first one starts at the Cell's creation, and a handover leaves
   * a closed row whose `ended_at` is the handover instant. So term (a) or term (b)
   * already dominates it in every state the schema permits, and the floor is never
   * empty.
   *
   * **The bound is inclusive**, unlike section 4's, which is strict. There the
   * strictness comes from a zero-length row going inert and silently removing the
   * period it recorded; here a closure dated at exactly an open membership's
   * `started_at` closes it zero-length, and that membership genuinely had no
   * duration. Inclusive is what the schema refuses and refuses nothing more, which is
   * what a floor is for.
   */
  private async closureFloorWithin(trx: Transaction<Database>, cellId: string): Promise<Date> {
    const bounds = await Promise.all([
      this.latestWithin(trx, 'cell_leaderships', cellId),
      this.latestWithin(trx, 'cell_memberships', cellId),
    ]);

    const instants = bounds.flat();

    if (instants.length === 0) {
      // Unreachable while section 11 holds: an ACTIVE Cell has exactly one open
      // leadership row, enforced by a constraint trigger. Reached only if that rule
      // has been circumvented — a restore with triggers disabled is the case section
      // 11 names — where refusing beats closing a Cell whose own history says it
      // never had a leader.
      throw new InvariantViolationError(
        'That Cell has no leadership history, so there is no earliest date it could ' +
          'legally be closed on (SKILL.md section 11).',
      );
    }

    return instants.reduce((latest, at) => (at.getTime() > latest.getTime() ? at : latest));
  }

  /**
   * The two bounding instants one relationship table contributes: the latest start
   * among its open rows, and the latest end among its closed ones.
   *
   * One statement per table rather than one per term, and typed over the two tables
   * that share this shape — `cell_leaderships` and `cell_memberships` carry the same
   * three columns and the same `period_ordered` rule.
   */
  private async latestWithin(
    trx: Transaction<Database>,
    table: 'cell_leaderships' | 'cell_memberships',
    cellId: string,
  ): Promise<Date[]> {
    const row = await trx
      .selectFrom(table)
      .select((eb) => [
        eb.fn.max<Date | null>('started_at').filterWhere('ended_at', 'is', null).as('open_start'),
        eb.fn.max<Date | null>('ended_at').as('closed_end'),
      ])
      .where('cell_id', '=', cellId)
      .executeTakeFirst();

    return [row?.open_start, row?.closed_end].filter((at): at is Date => at instanceof Date);
  }

  /**
   * End this Cell's category or schedule rows so that none is in force at or after
   * the closure (migration 0010).
   *
   * `GREATEST(effective date, started_at)` is the whole of it, and each half is
   * load-bearing. A row already running ends at the closure. A row that had not
   * started yet — the incoming half of a schedule change queued for next month —
   * ends at its own start, which makes it zero-length and therefore inert to every
   * as-of read: a change that was decided and will now never take effect.
   *
   * Ending it at the closure instead is what `period_ordered` refuses, and refusing
   * the closure instead is what leaves a rescheduled Cell closable by nobody.
   *
   * The predicate matches exactly the rows migration 0010 forbids, deliberately
   * written the same way round: open rows, and closed rows reaching past the closure.
   * A row that already ended before the closure is left alone.
   */
  private async endConfigurationWithin(
    trx: Transaction<Database>,
    table: 'cell_categories' | 'cell_schedules',
    cellId: string,
    effectiveAt: Date,
  ): Promise<void> {
    // Written as SQL rather than through the builder: `GREATEST` appears three
    // times over two columns of the same row, and expressing that as builder terms
    // was harder to read than the rule it implements. `sql.table` takes the two
    // literal names the signature admits and nothing from a request.
    await sql`
      UPDATE ${sql.table(table)}
         SET ended_at = GREATEST(${effectiveAt}::timestamptz, started_at)
       WHERE cell_id = ${cellId}::uuid
         AND (ended_at IS NULL
              OR ended_at > GREATEST(${effectiveAt}::timestamptz, started_at))
    `.execute(trx);
  }

  /**
   * `records.backdate_effective_date`, asked inside the transaction.
   *
   * **It is asked here rather than on the pool because *whether to ask* depends on an
   * instant only the transaction has.** Section 10 makes the test "earlier than the
   * current day", and the current day is the one in force when the write applies, not
   * when the request arrived — so the decision cannot precede the locks, and the check
   * has to follow it.
   *
   * `coversWith` rather than `authorize`, which reads the account's grants on the pool
   * and would be the liveness hazard section 24 names if called while holding a
   * connection. `authority` was read on the pool before the transaction opened, which
   * is safe for the reason `PeopleReassignmentService` gives: an account's grants are
   * facts about the account, and nothing inside this transaction can change them.
   *
   * **The two codes are chosen here because `coversWith` collapses them**, and section
   * 7 requires the code to name the half that failed: an administrator told
   * `CAPABILITY_DENIED` grants the capability, and one told `SCOPE_DENIED` widens a
   * grant they already made. `records.backdate_effective_date` is Whole Church only
   * (section 7), so a grant issued narrower names the capability and covers nothing —
   * which is the scope half.
   */
  private async assertMayBackdateWithin(
    trx: Transaction<Database>,
    actor: Actor,
    authority: ActorAuthority,
  ): Promise<void> {
    if (
      await this.authorization.coversWith(
        trx,
        actor,
        authority,
        Capability.RecordsBackdateEffectiveDate,
        // The church, and `PeopleReassignmentService` naming a person for this same
        // capability is not a precedent to copy (section 25 rule 19). It names one
        // because it has one in hand and the operation is about that person; a Cell is
        // not a Person, and resolving it to its leader would claim that the authority
        // to backdate is authority over that leader.
        { kind: 'church' },
      )
    ) {
      return;
    }

    const held = authority.grants.some(
      (grant) => grant.capability === Capability.RecordsBackdateEffectiveDate,
    );

    if (!held) {
      throw new CapabilityDeniedError(
        `You do not hold ${Capability.RecordsBackdateEffectiveDate}.`,
        { capability: Capability.RecordsBackdateEffectiveDate },
      );
    }

    throw new ScopeDeniedError(
      'Backdating a closure requires records.backdate_effective_date at Whole Church ' +
        'scope (SKILL.md section 7).',
      { capability: Capability.RecordsBackdateEffectiveDate },
    );
  }

  /**
   * Re-decide scope inside the transaction, once the row is held.
   *
   * Takes the capability, because this operation asks it about two different things:
   * `cell.manage_lifecycle` over the Cell being closed, and `cell.manage_membership`
   * over each dispersal destination. Section 10 gives them as separate rules and they
   * can be held over different branches, so one parameterized check is the same
   * question asked twice rather than two rules merged into one.
   */
  private async assertStillInScopeWithin(
    trx: Transaction<Database>,
    actor: Actor,
    authority: ActorAuthority,
    cellId: string,
    capability: Capability,
    refusal: string,
  ): Promise<void> {
    const leaderId = await this.cells.leaderForScopeWithin(trx, cellId);

    if (leaderId === null) {
      throw new InvariantViolationError(
        'That Cell cannot be resolved to a leader, so there is no authority to check ' +
          'against (SKILL.md section 11).',
      );
    }

    if (
      !(await this.authorization.coversWith(trx, actor, authority, capability, {
        kind: 'person',
        personId: leaderId,
      }))
    ) {
      throw new ScopeDeniedError(refusal, { capability });
    }
  }

  /**
   * The refusal for a date below the floor, which names the earliest legal one where
   * there is one to name.
   *
   * The three branches are section 4's and section 5's, re-derived for an inclusive
   * floor rather than copied from their strict one — which is where the arithmetic
   * differs. There, no date can equal the floor, so the earliest legal day is always
   * the day *after* it. Here a floor landing exactly on a Manila midnight is itself
   * legal, and only a floor inside a day pushes to the next one.
   */
  private closureTooEarly(cellId: string, floor: Date, dated: boolean): ApiError {
    if (!dated) {
      // **Unreachable through any operation this system defines, and kept as a
      // fail-safe rather than as a live branch.** The instant is `clock_timestamp()`
      // read after the locks, and both floor terms come from rows stamped the same
      // way, so the floor is always in the past and an undated closure always clears
      // it. Reaching this needs a leadership or membership row carrying a future
      // timestamp, which nothing writes.
      //
      // *A first version of this comment claimed it was reached "where a row carries
      // the very instant this closure is taking", which the strict `<` above excludes
      // — a row at exactly the floor is legal.* The branch was copied from
      // `PeopleReassignmentService`, where the identical shape **is** reachable
      // because section 5 lets Admin backdate a pastoral row and a concurrent
      // reassignment can therefore leave a row ahead of the clock. Cell leadership and
      // membership rows cannot be backdated, so the reason does not carry (section 25,
      // rule 19) — which is the fault this branch's own slice was written to observe.
      //
      // It stays because the floor is read from rows rather than guaranteed by a
      // constraint, and answering a transient-looking condition is better than a 500.
      // `RESOURCE_BUSY` rather than a 409: contention reaches no decision, and section
      // 22 stores a 4xx against the idempotency key while releasing a 5xx.
      return new ResourceBusyError({ cell_id: cellId });
    }

    const floorDay = manilaDayOf(floor);
    const earliest =
      startOfManilaDay(floorDay).getTime() === floor.getTime() ? floorDay : manilaDayAfter(floor);

    if (startOfManilaDay(earliest).getTime() > Date.now()) {
      return new InvariantViolationError(
        'This closure cannot be backdated: the Cell’s own leadership and membership ' +
          'records reach past every date earlier than today. Submit it without an ' +
          'effective date, and it will take effect now.',
        { cell_id: cellId },
      );
    }

    return new InvariantViolationError(
      `This closure cannot be dated before ${earliest}: the Cell’s leadership and ` +
        'membership records would end before they began (SKILL.md section 10, What ' +
        'closing does).',
      { cell_id: cellId, earliest_effective_date: earliest },
    );
  }

  /**
   * The instant to stamp, read from the database server after the locks.
   *
   * `clock_timestamp()` rather than `now()`, which is transaction start and therefore
   * precedes the wait: a request that queued behind another writer would stamp its
   * rows with the instant it arrived, and could be refused against a floor computed
   * from a row that committed while it waited. Section 5 states the rule and issue
   * #16 is the defect that produced it.
   */
  private async nowWithin(trx: Transaction<Database>): Promise<Date> {
    const row = await trx
      .selectNoFrom((eb) => eb.fn<Date>('clock_timestamp', []).as('at'))
      .executeTakeFirstOrThrow();

    return row.at;
  }
}
