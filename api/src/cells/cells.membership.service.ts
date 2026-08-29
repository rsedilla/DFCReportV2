import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  AuthorizationService,
  type Actor,
  type ActorAuthority,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
} from '../common/errors/api-error';
import { sameId } from '../common/identifiers';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';
import { NetworksService } from '../networks/networks.service';
import { PeopleReadService } from '../people/people.read.service';

import { CellsReadService } from './cells.read.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * Cell membership (SKILL.md section 10, Cell Membership and Managing Cell
 * membership).
 *
 * **A move is an add.** Section 10 gives a person at most one active membership, so
 * adding somebody who already belongs somewhere *is* the move it describes: "closes
 * the current membership and opens the new one within a single transaction. It must
 * never leave two open memberships, and never silently drop a person out of every
 * Cell." One operation rather than two, because two would let a client perform half
 * of it.
 *
 * **What the database refuses, and what this service refuses as well.** Migration
 * 0009 carries four constraints: a second open membership for one person
 * (`cell_memberships_one_open`), a member whose Network is not the Cell leader's, an
 * open membership on a CLOSED Cell, and a membership outliving its Cell.
 *
 * Two of those are re-checked here, and an earlier version of this paragraph said
 * they were not — while the two methods seventy lines below said, correctly, that
 * they are. Both of those constraints are **deferred**, so they raise at COMMIT as a
 * raw `check_violation`, which `ApiExceptionFilter` does not recognise and renders
 * `INTERNAL_ERROR`. The check turns each into the answer section 22 defines for it;
 * the constraint stays the enforcement, because it holds under a concurrent write
 * this check would be stale for. The other two are left to the database, which
 * answers them the same way whoever writes.
 *
 * This service owns the authorization, the refusals that need a message rather than a
 * constraint violation, and the audit entries section 10 requires.
 */
@Injectable()
export class CellsMembershipService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
    private readonly cells: CellsReadService,
    private readonly networks: NetworksService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Add a person to a Cell, moving them out of any Cell they already belong to.
   *
   * The guard has already resolved `cell.manage_membership` against the destination
   * Cell, which section 7 places through its leader. What is left is the source.
   */
  async add(
    cellId: string,
    personId: string,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // **Before the transaction** (section 24). `authorityFor` reads `account_roles`
    // and `capability_grants` on the pool, and a request holding a pooled connection
    // for its transaction while asking for another is the liveness hazard that
    // section names. Read unconditionally rather than only where a source Cell turns
    // out to exist, because whether it does is not known until inside.
    const authority = await this.authorization.authorityFor(actor.accountId);

    return this.db.transaction().execute(async (trx) => {
      // **The person lock, taken first** (SKILL.md section 5; the 2026-08-23
      // ruling). Every writer of a person-scoped edge in `people`, `hierarchy` and
      // `networks` takes it, and this is one: a membership is an edge between a
      // Person and a Cell, and `cell_memberships_one_open` is over the person.
      //
      // Without it two ordinary races answer 500 rather than answering. Two
      // concurrent adds of the same person both read no open membership, both
      // insert, and the second violates the unique index with `23505` — which
      // `postgres-errors.ts` does not recognise, so it renders `INTERNAL_ERROR`. And
      // a Network change **on the member** committing between
      // `assertSameNetworkWithin` and COMMIT makes the deferred trigger raise a
      // `check_violation` at COMMIT, the same way.
      //
      // **The member's side only**, which an earlier version of this comment did not
      // say. `assertSameNetworkWithin` reads two Networks, the member's and the Cell
      // *leader's*; `NetworksService.changeNetworkWithin` locks the person whose
      // Network is changing, so locking the member here orders that half and nothing
      // orders the other. A Network change on the Cell's leader is uncovered by any
      // mechanism — migration 0009 names it as the widest of its three uncovered
      // paths, and CLAUDE.md carries it as open. Taking this lock does not close it.
      await lockPersonsWithin(trx, [personId]);

      const cell = await trx
        .selectFrom('cells')
        .select(['id', 'cell_id', 'state'])
        .where('id', '=', cellId)
        .executeTakeFirst();

      if (!cell) {
        throw new NotFoundError('No such Cell.');
      }

      if (cell.state === 'CLOSED') {
        // The database refuses it too, as a constraint. Refused here so the answer
        // is a sentence rather than a trigger message — the 500-instead-of-an-answer
        // failure this repository keeps recording.
        throw new InvariantViolationError(
          'That Cell is closed, so nobody joins it. A closure ends every membership on ' +
            'its effective date (SKILL.md section 10).',
          { cell_id: cell.cell_id },
        );
      }

      const person = await this.people.forDecisionWithin(trx, personId);

      if (!person) {
        throw new NotFoundError('No such person.');
      }

      if (person.mergedIntoId !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Name the surviving Person instead.',
          { person_id: personId },
        );
      }

      if (person.isArchived) {
        // Section 10: archiving ends a membership, and "restoring them does not
        // automatically restore the membership". An archived Person does not
        // acquire new live relationships (section 3, section 5).
        throw new InvariantViolationError(
          'That person is archived, so they cannot be added to a Cell. Restore them first, ' +
            'which is a separate and separately audited decision.',
          { person_id: personId },
        );
      }

      const current = await this.openMembershipWithin(trx, personId);

      // **`sameId`, not `===`.** This compares a client-supplied path value against
      // one out of a `uuid` column, and it fails **open**: a mis-cased identifier
      // would skip this refusal, fall through, and close and reopen the membership in
      // the same Cell — the spurious history boundary section 10 says must not
      // happen, with a `cell_membership.moved` entry naming one Cell twice. Section 7
      // requires a check that fails open to normalize again rather than rely on the
      // boundary pipe having been wired, which is exactly the standing the 2026-08-23
      // ruling rejected as sufficient. `remove`'s equivalent comparison fails closed
      // and is left alone.
      if (current !== undefined && sameId(current.cell_uuid, cellId)) {
        // Section 4 refuses a sex correction that changes nothing and section 5 a
        // reassignment to the leader a person already has, both because an audited
        // operation whose before and after are identical misleads whoever reads the
        // log — and because it would put a boundary in the membership history where
        // nothing happened, so "how long in this Cell" answers wrongly ever after.
        throw new InvariantViolationError('That person already belongs to this Cell.', {
          person_id: personId,
          cell_id: cell.cell_id,
        });
      }

      // **The destination, re-decided here rather than left to the guard's earlier
      // answer.** Section 10 requires scope over every Cell an operation touches to be
      // checked again inside the transaction: the guard resolves a Cell through its
      // leader on the pool, before the request queued, so a handover committing in
      // between leaves that answer describing authority the actor no longer holds.
      //
      // Section 10 named this half as owed and unbuilt until the closure endpoint
      // built the mechanism. This is that half; `CellsClosureService` makes the same
      // check about the Cell it is closing and about each dispersal destination.
      await this.assertActorMayChangeMembershipOf(trx, actor, authority, cellId);

      if (current) {
        await this.assertActorMayChangeMembershipOf(trx, actor, authority, current.cell_uuid);
      }

      const at = await this.nowWithin(trx);

      await this.assertSameNetworkWithin(trx, cellId, personId, at);

      if (current) {
        await trx
          .updateTable('cell_memberships')
          .set({ ended_at: at })
          .where('id', '=', current.id)
          .execute();
      }

      const opened = await trx
        .insertInto('cell_memberships')
        .values({ person_id: personId, cell_id: cellId, started_at: at })
        .returning(['id', 'started_at'])
        .executeTakeFirstOrThrow();

      // Section 21 names three membership actions — "added, moved, or ended" — and
      // asks for one entry per action performed. A move is one action, so it is one
      // entry carrying both Cells rather than an ending plus an opening: a reader
      // searching for moves has something to search on, and a reader asking who left
      // a Cell finds it in that entry's `before`.
      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: current ? 'cell_membership.moved' : 'cell_membership.added',
        targetType: 'person',
        targetId: personId,
        before: current ? { cell_uuid: current.cell_uuid, cell_id: current.cell_id } : null,
        after: {
          cell_uuid: cellId,
          cell_id: cell.cell_id,
          started_at: at.toISOString(),
        },
      });

      const response = {
        id: opened.id,
        person_id: personId,
        // The handle, not the UUID — section 22 gives one concept one field name,
        // and slice 2's creation response set it: `cell_id` is `CELL-000000` and the
        // Cell's UUID travels as `cell_uuid`. (`id` here is the membership row's own
        // identifier, which is the created resource; the Cell's is `cell_uuid`.)
        cell_id: cell.cell_id,
        cell_uuid: cell.id,
        started_at: at.toISOString(),
        moved_from_cell_id: current?.cell_id ?? null,
      };

      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });

      return response;
    });
  }

  /**
   * This Cell's current members, for the screen that decides a closure.
   *
   * **A read, so it takes no idempotency claim and opens no transaction.** It is here
   * rather than on `CellsReadService` because that service exists for the reads *other
   * modules* need — `auth` asking whether a Person is a current Cell Leader, the guard
   * resolving a Cell's leader — and this one is `cells` answering its own controller.
   * The query itself lives there, because `cells.read.service.ts` is where this
   * module's `SELECT`s are written.
   *
   * No refusal for a Cell that does not exist: an empty list is the honest answer for
   * a Cell with no members, and an actor whose scope would not cover the Cell was
   * already refused by the guard. Distinguishing the two here would reintroduce the
   * existence oracle section 22 settles for a Cell (2026-08-29).
   */
  async membersOf(cellId: string): Promise<Record<string, unknown>> {
    const members = await this.cells.membersOfWithin(this.db, cellId);

    return {
      cell_uuid: cellId,
      members: members.map((member) => ({
        person_id: member.person_id,
        member_id: member.member_id,
        full_name: member.full_name,
        started_at: member.started_at.toISOString(),
      })),
    };
  }

  /**
   * End a person's membership of a Cell, leaving them in none.
   *
   * Section 10 makes this an ordinary authorized action rather than an exception:
   * "a person who attends once and does not return remains a member until removed…
   * Removing them is an ordinary authorized action, so this is routine tidying
   * rather than a defect." People left without a Cell appear on section 15's
   * attention list, which is what stops removal being silent.
   */
  async remove(
    cellId: string,
    personId: string,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.db.transaction().execute(async (trx) => {
      // The same lock, for the same reason: this closes a row `cell_memberships_one_open`
      // governs, and a concurrent add of the same person must not interleave with it.
      await lockPersonsWithin(trx, [personId]);

      const current = await this.openMembershipWithin(trx, personId);

      // **`current.cell_uuid !== cellId` is the whole cross-Cell authorization of
      // this route**, not a tidiness check. The guard resolved scope against the
      // Cell in the path; without this, a leader scoped to their own Cell could end
      // a membership held in any other Cell in the church by naming their own in the
      // path and somebody else's member in it.
      if (!current || current.cell_uuid !== cellId) {
        throw new NotFoundError('That person holds no open membership of that Cell.');
      }

      const at = await this.nowWithin(trx);

      await trx
        .updateTable('cell_memberships')
        .set({ ended_at: at })
        .where('id', '=', current.id)
        .execute();

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_membership.ended',
        targetType: 'person',
        targetId: personId,
        before: { cell_uuid: cellId, cell_id: current.cell_id },
        after: { ended_at: at.toISOString() },
      });

      const response = {
        person_id: personId,
        cell_id: current.cell_id,
        cell_uuid: cellId,
        ended_at: at.toISOString(),
      };

      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });

      return response;
    });
  }

  /**
   * The member and the Cell's leader belong to the same Network (SKILL.md section
   * 10, Managing Cell membership; section 4).
   *
   * **The database refuses it too, and that is not enough.** Migration 0009 carries
   * `cell_memberships_same_network` as a *deferred* constraint trigger, so it raises
   * at COMMIT as a raw `check_violation` — which `ApiExceptionFilter` does not
   * recognise and renders `INTERNAL_ERROR`. That is the 500-instead-of-an-answer
   * failure this repository has recorded for the self-leader check and the duplicate
   * email, and it was reachable here until a test asked for the error code.
   *
   * The constraint is still the enforcement: it holds under a concurrent Network
   * change that commits between this read and the write, where this check would be
   * stale. What this adds is an answer the caller can act on for the ordinary case.
   *
   * Compared as of the membership's own `started_at`, which is the instant the
   * trigger uses.
   *
   * **The instant matches; the two are not the same rule, and an earlier version of
   * this sentence said they were.** This resolves the Cell's leader as "current,
   * falling back to last", which is section 7's rule for a *scope*; the trigger
   * resolves it as "the row covering `started_at`", which is section 10's rule for a
   * *membership*. They coincide in every state migration 0009 permits, and they are
   * different questions — so this check agreeing with the trigger is something to
   * keep true rather than something the code guarantees.
   */
  private async assertSameNetworkWithin(
    trx: Transaction<Database>,
    cellId: string,
    personId: string,
    at: Date,
  ): Promise<void> {
    const leaderId = await this.cells.leaderForScopeWithin(trx, cellId);

    if (leaderId === null) {
      throw new InvariantViolationError(
        'That Cell has no leader, so it has no Network to compare against (SKILL.md ' +
          'section 11).',
        { cell_uuid: cellId },
      );
    }

    const [member, leader] = await Promise.all([
      this.networks.networkAsOf(trx, personId, at),
      this.networks.networkAsOf(trx, leaderId, at),
    ]);

    if (member === null || leader === null || member !== leader) {
      throw new InvariantViolationError(
        'A Cell member and the Cell leader belong to the same Network (SKILL.md ' +
          'section 10, Managing Cell membership).',
        { person_id: personId, member_network: member, cell_network: leader },
      );
    }
  }

  /**
   * The person's open membership, if any, with the Cell's human handle beside its
   * UUID.
   *
   * Both, because the two are different things and section 22 gives them different
   * names: `cell_id` is `CELL-000000`, the handle a report and a conversation use,
   * and the UUID is what a relationship points at (section 10, Cell ID generation).
   * A response that returned one under the other's name is the defect this join
   * removes.
   */
  private async openMembershipWithin(
    trx: Transaction<Database>,
    personId: string,
  ): Promise<{ id: string; cell_uuid: string; cell_id: string } | undefined> {
    return trx
      .selectFrom('cell_memberships')
      .innerJoin('cells', 'cells.id', 'cell_memberships.cell_id')
      .select([
        'cell_memberships.id as id',
        'cell_memberships.cell_id as cell_uuid',
        'cells.cell_id as cell_id',
      ])
      .where('cell_memberships.person_id', '=', personId)
      .where('cell_memberships.ended_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * The instant both halves of a move share.
   *
   * **`clock_timestamp()`, not `now()`, and the difference is a defect the person
   * lock introduced.** `now()` is *transaction start*, which is before the lock was
   * waited for — so a request that queued behind another writer stamped its rows with
   * the instant it arrived rather than the instant it acquired the lock. Interleaved:
   * T2 begins at 99 and blocks; T1 begins at 100, opens a membership at 100, commits;
   * T2 wakes, reads T1's row as the current one, and closes it at 99. That violates
   * `cell_memberships_period_ordered`, which raises `check_violation` at the
   * statement and renders `INTERNAL_ERROR` — the lock turned one 500 into another.
   *
   * Also true with no race at all: a request that waits out part of the three-second
   * `lock_timeout` would record a `started_at` seconds before the change happened,
   * and `assertSameNetworkWithin` would compare Networks at that stale instant.
   *
   * *The docblock this replaces argued the reverse — that a JavaScript instant "can
   * land before a row it must not precede" and `now()` cannot. It is `now()` that
   * can: the row to be superseded committed before this transaction was allowed to
   * proceed, so any instant read after the wait is later than it.*
   * `PeopleReassignmentService` takes `new Date()` after its own lock for the same
   * reason. What `clock_timestamp()` adds is the **database server's** clock rather
   * than this host's, read after the wait; it adds no precision, and a previous
   * version of this sentence claiming it avoided a millisecond truncation was wrong —
   * node-postgres parses `timestamptz` into a JS `Date`, so the microseconds are gone
   * either way. Nothing turns on that: `cell_memberships_period_ordered` is `>=`, so a
   * move landing inside one millisecond is legal.
   *
   * Read once per transaction, so the close and the open still share one instant.
   */
  private async nowWithin(trx: Transaction<Database>): Promise<Date> {
    const row = await trx
      .selectNoFrom((eb) => eb.fn<Date>('clock_timestamp', []).as('now'))
      .executeTakeFirstOrThrow();

    return row.now;
  }

  /**
   * The **source** Cell of a move, which the guard has not checked.
   *
   * Section 10 gives `cell.manage_membership` per Cell — "the Cell's current leader,
   * over their own Cells; any leader upline of that Cell's leader, acting within
   * their own authorized pastoral subtree" — and a move is two membership changes,
   * one to each Cell. The guard resolves the destination, because that is the
   * request's primary target; section 7 settles that a rule about a second object is
   * a check in the owning module.
   *
   * **Without it a leader could pull anybody in the church into their own Cell**,
   * ending a membership in a Cell they have nothing to do with and moving that
   * person's attendance out of another leader's denominator, with no involvement
   * from the leader who holds them. That is the shape section 5 forbids for pastoral
   * assignment — authorization case 1, pulling a person from a sibling branch — and
   * the harm here is the same kind even though the relationship is a different one
   * (section 1, principle 3).
   *
   * **Section 10 does not spell out the move case**, and this is the reading rather
   * than a rule quoted: it is what "over their own Cells" means when an operation
   * touches two. Admin and the Senior Pastors hold Whole Church and are unaffected;
   * an upline leader is unaffected; only a peer taking from a peer is refused, which
   * is a pastoral conversation rather than a system action. Escalated in CLAUDE.md.
   */
  private async assertActorMayChangeMembershipOf(
    trx: Transaction<Database>,
    actor: Actor,
    authority: ActorAuthority,
    sourceCellId: string,
  ): Promise<void> {
    const leaderId = await this.cells.leaderForScopeWithin(trx, sourceCellId);

    if (leaderId === null) {
      // Section 8 again, and it took two attempts. The first stopped naming the Cell
      // and went on asserting that the person belongs to one; the second said "that
      // membership", which presupposes the same fact one word further in. It says
      // neither now.
      //
      // Unreachable in practice — a Cell with no leadership row at all can hold no
      // membership, because `assert_membership_same_network` refuses one — which is
      // why this was worth two corrections rather than none: an unreachable branch is
      // exactly where a wrong sentence survives.
      throw new InvariantViolationError(
        'That change cannot be resolved to a Cell leader, so there is no authority to ' +
          'check against (SKILL.md section 11).',
      );
    }

    // Evaluated through the transaction, so a concurrent handover of the source
    // Cell cannot leave this answering from the state the request arrived with.
    if (
      !(await this.authorization.coversWith(
        trx,
        actor,
        authority,
        Capability.CellManageMembership,
        {
          kind: 'person',
          personId: leaderId,
        },
      ))
    ) {
      // **It names no Cell, and does not say the person belongs to one.** Section 8
      // forbids exposing "Cell membership or Cell IDs" for a person outside the
      // searching leader's pastoral scope — and this refusal is reached precisely
      // for such a person, because the guard resolved scope against the destination
      // Cell rather than against the member (section 10: membership need not mirror
      // pastoral assignment). An earlier version returned the source Cell's
      // identifier in `details` and asserted the membership in its message, which
      // any Leader could have used as an oracle: names are church-wide, so pick a
      // UUID out of a search, submit it against your own Cell, and read back both
      // facts, writing nothing.
      //
      // The Network refusal beside this one may name Networks, because Network is
      // one of the five fields section 8 publishes church-wide.
      throw new ScopeDeniedError(
        'You do not have authority to make that membership change (SKILL.md section 10).',
      );
    }
  }
}
