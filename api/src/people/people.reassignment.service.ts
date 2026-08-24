import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  AuthorizationService,
  type Actor,
  type ActorAuthority,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import {
  ApiError,
  InvariantViolationError,
  NotFoundError,
  ResourceBusyError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { sameId } from '../common/identifiers';
import { manilaDayAfter, manilaDayOf, startOfManilaDay } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';

import { assertLeaderIsAssignable } from './leader-assignability';
import { fullProfile } from './people.shared';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';

/**
 * Reassigning a person's pastoral leader (SKILL.md section 5).
 *
 * Its own service for the reason the sex correction has one: it is a single
 * section-numbered operation carrying five invariants, a lock, a backdate floor
 * and an audit trail, and the eleven authorization cases are written against it.
 *
 * Invariant 1 and invariant 4 both live in `hierarchy`, which owns
 * `pastoral_assignments` and therefore owns section 5. What is here is the
 * ordering — lock, then decide, then write, then record the completion last —
 * which section 24 makes load-bearing and which nothing detects.
 */
@Injectable()
export class PeopleReassignmentService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
    private readonly idempotency: IdempotencyService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Reassigns a person to a different pastoral leader (SKILL.md section 5).
   *
   * **Only the reassigned person's own row changes.** Their subtree moves with
   * them because it resolves through the tree, and rewriting a descendant's row to
   * reflect a leader's move destroys assignment history — a partial rewrite
   * silently detaches a branch, so the descendants disappear from the moved
   * leader's totals while appearing under nobody.
   *
   * The five invariants divide by what they are about, which is why they are not
   * all in one place. Invariant 4 is about the actor's position and lives in
   * `hierarchy`, where the second caller of it already is. Invariant 1 is about the
   * actor's scope over two objects the guard does not evaluate. Invariants 2 and 5
   * are about the resulting record and are checked here against the transaction
   * that will write it, with the database as the backstop for both.
   *
   * **Every decision that depends on the tree is taken inside the transaction,
   * after the lock**, because the lock is precisely when two reassignments of one
   * person overlap: a decision taken beforehand is made against a tree the winner
   * has since changed. That includes the guard's own conclusion about the person,
   * which a concurrent move can invalidate between the guard and the write.
   *
   * What is read *before* it is what cannot change under a tree write — the
   * actor's roles and grants, which are facts about their account. Reading those
   * inside would ask a bounded pool for a second connection while holding one,
   * which section 24 names as a liveness hazard.
   *
   * This rests on READ COMMITTED, which is the default and is not set anywhere: a
   * statement after the lock takes a fresh snapshot and therefore sees the winner's
   * commit. Under REPEATABLE READ the snapshot would be taken by the first
   * statement of the transaction — the key hashing inside `lockPersonsWithin`,
   * before the lock is held — and every read after it would be stale again.
   */
  async reassignPastoralLeader(
    personId: string,
    input: { leaderId: string; reason?: string; effectiveDate?: string },
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Read here, on the pool, and deliberately: these are facts about the actor's
    // account rather than about the tree, so nothing a concurrent reassignment does
    // can change them — and reading them inside the transaction would be the
    // pooled-read-while-holding-one that section 24 forbids.
    const authority = await this.authorization.authorityFor(actor.accountId);
    const backdated = input.effectiveDate !== undefined;

    if (backdated) {
      // The second capability, which the guard does not check (section 5). Asked
      // before the transaction because it is a fact about the actor's grants and
      // nothing in the tree can change the answer.
      await this.authorization.authorize(actor, Capability.RecordsBackdateEffectiveDate, {
        kind: 'person',
        personId,
      });

      if (input.reason === undefined) {
        // Section 5: backdating "always requires a reason". Not required otherwise.
        throw new ValidationFailedError('Backdating an effective date requires a reason.', {
          field: 'reason',
        });
      }
    }

    return this.db.transaction().execute(async (trx) => {
      // Both persons whose Networks decide the edge's legality, in one call so the
      // ordering is the helper's rather than the order that reads best here.
      // Locking the **person** as well as the leader is what makes concurrent
      // reassignments of one person serialize rather than collide on the partial
      // unique index (section 5, Database enforcement).
      await lockPersonsWithin(trx, [personId, input.leaderId]);

      // **Re-made here, after the lock, against this transaction.** The guard
      // reached this same conclusion before the request queued; a concurrent move
      // can have carried the person out of the actor's subtree since. Both walks
      // read the tree, which is why the predicates take an executor — the choice
      // was never "pool or transaction", it was "stale or transaction-capable".
      //
      // The lock covers the person and the destination leader, not the actor's
      // upline, so these narrow the window rather than closing it. Closing it
      // entirely would mean locking every row a scope decision reads, which is the
      // whole tree above the actor.
      await this.hierarchy.assertMayReparent(
        trx,
        { personId: actor.personId, roles: authority.roles },
        personId,
      );

      if (!(await this.isWithinManageScope(trx, actor, authority, personId))) {
        throw new ScopeDeniedError(
          'You hold people.manage_pastoral_assignment, but not over this person.',
          { capability: Capability.PeopleManagePastoralAssignment },
        );
      }

      const recordedAt = new Date();
      // Read after the lock, deliberately. Stamped before it, a request that waited
      // carries an instant earlier than the winner's `started_at` and is refused as
      // too early — a refusal caused purely by contention, and one section 22 would
      // store against the idempotency key and replay for the whole retention.
      const effectiveAt =
        input.effectiveDate === undefined ? recordedAt : startOfManilaDay(input.effectiveDate);

      if (effectiveAt.getTime() > recordedAt.getTime()) {
        throw new ValidationFailedError(
          'An effective date is a correction to the past. It cannot be in the future.',
          { field: 'effective_date', value: input.effectiveDate },
        );
      }

      const person = await trx
        .selectFrom('persons')
        .select([
          'id',
          'member_id',
          'first_name',
          'middle_name',
          'last_name',
          'birth_date',
          'sex',
          'civil_status',
          'mobile_number',
          'merged_into_id',
        ])
        .where('id', '=', personId)
        .executeTakeFirst();

      if (person === undefined) {
        throw new NotFoundError('No such person.');
      }

      if (person.merged_into_id !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Reassign the surviving Person instead.',
          { person_id: personId, merged_into_id: person.merged_into_id },
        );
      }

      const current = await this.hierarchy.openAssignmentOf(trx, personId);

      // Invariant 1, against the state this transaction will actually write over.
      await this.hierarchy.assertBothEndpointsInScope(
        current?.leaderId ?? null,
        input.leaderId,
        (personId) => this.isWithinManageScope(trx, actor, authority, personId),
      );

      if (current !== null && current.leaderId === null) {
        // Section 5, Network roots: a root cannot be reassigned by anyone, Admin
        // included, because there is no valid leader above them. Changing who holds
        // a root position is a Network-level decision, not a pastoral one.
        throw new InvariantViolationError(
          'That person is a Network root and has no leader above them. Changing who holds a root position is a Network-level decision, not a reassignment.',
          { person_id: personId },
        );
      }

      const lifecycle = await trx
        .selectFrom('person_lifecycle')
        .select('state')
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();

      if (lifecycle?.state === 'ARCHIVED') {
        // Section 5, Lifecycle state. Restore them first, which is an explicit and
        // separately audited decision — keeping the two apart is what stops an
        // archived record re-entering a leader's current totals through a side door.
        throw new InvariantViolationError(
          'That person is archived. Restore them to current first, then reassign them.',
          { person_id: personId },
        );
      }

      if (sameId(input.leaderId, personId)) {
        throw new InvariantViolationError('A person cannot be their own pastoral leader.', {
          field: 'pastoral_leader_id',
        });
      }

      if (
        current !== null &&
        current.leaderId !== null &&
        sameId(current.leaderId, input.leaderId)
      ) {
        // Section 4 refuses the exact analogue for a sex correction, on reasoning
        // that applies unchanged: this operation is audited, and a transfer whose
        // before and after name the same leader misleads whoever reads the log.
        // It would also put a boundary in the assignment history where nothing
        // happened, so "how long has this person been under this leader" answers
        // wrongly ever after. A client that lost the response retries with the
        // same `Idempotency-Key`, which is what that header is for.
        throw new ValidationFailedError('That person is already under that leader.', {
          field: 'pastoral_leader_id',
          value: input.leaderId,
        });
      }

      // Invariant 2. Rejected before writing, and the recursive queries carry their
      // own cycle detection as the backstop for a cycle arriving by any other route.
      const subtree = await this.hierarchy.subtreeOf(trx, personId);
      if (subtree.some((descendantId) => sameId(descendantId, input.leaderId))) {
        throw new InvariantViolationError(
          'That leader is below this person in the tree, so the assignment would create a cycle.',
          { person_id: personId, pastoral_leader_id: input.leaderId },
        );
      }

      // Invariant 5, **as of the effective date**, which is the instant the
      // constraint trigger compares. Validating against today would let this answer
      // that a backdated edge is legal and then fail on it at commit.
      const personNetwork = await this.networks.networkAsOf(trx, personId, effectiveAt);
      if (personNetwork === null) {
        throw new InvariantViolationError(
          'That person had no Network on record at that date, so no assignment can be recorded then.',
          { person_id: personId },
        );
      }

      await assertLeaderIsAssignable(
        trx,
        input.leaderId,
        personNetwork,
        effectiveAt,
        this.networks,
      );

      // **The same method as the Network correction, and deliberately not the same
      // term.** Term (a) is the current assignment's `started_at`: at that instant
      // the close is zero-length and therefore inert, so the leader this person
      // actually had for the whole period disappears from every as-of query, and
      // below it the row cannot be closed at all.
      //
      // Term (b) here ranges over closed rows where **this person is the
      // subordinate**, and bounds the case term (a) leaves unbounded — a person
      // with no open assignment, for whom an effective date inside an
      // already-closed period would leave two rows valid at one instant and give
      // "who led them on date D" two answers. Section 4's version reaches the other
      // direction as well, because the trigger *it* guards selects edges both ways;
      // this one does not fire that trigger, and borrowing the wider term refused
      // legitimate corrections for every leader who had ever had a disciple moved.
      const floor = await this.hierarchy.backdateFloorFor(trx, personId, 'as-subordinate');

      if (floor !== null && effectiveAt.getTime() <= floor.getTime()) {
        throw this.reassignmentTooEarly(personId, floor, backdated);
      }

      const { previousLeaderId } = await this.hierarchy.reassignWithin(trx, {
        personId,
        leaderId: input.leaderId,
        effectiveAt,
      });

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'pastoral_assignment.transferred',
        targetType: 'person',
        targetId: personId,
        // Section 5: actor, target, previous leader, new leader, and timestamp.
        before: { leader_id: previousLeaderId },
        after: { leader_id: input.leaderId, effective_at: effectiveAt.toISOString() },
        reason: input.reason ?? null,
      });

      if (backdated) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'effective_date.backdated',
          targetType: 'person',
          targetId: personId,
          after: {
            operation: 'pastoral_assignment.transferred',
            recorded_at: recordedAt.toISOString(),
            effective_at: effectiveAt.toISOString(),
            effective_date: manilaDayOf(effectiveAt),
          },
          reason: input.reason ?? null,
        });
      }

      const response = {
        ...fullProfile(person),
        pastoral_leader_id: input.leaderId,
        previous_pastoral_leader_id: previousLeaderId,
        effective_at: effectiveAt.toISOString(),
        effective_date: manilaDayOf(effectiveAt),
      };

      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 200,
        body: response,
      });

      return response;
    });
  }

  /**
   * Whether the actor holds `people.manage_pastoral_assignment` over this person.
   *
   * This is the coverage test section 5 invariant 1 is evaluated with, and it is
   * supplied to `hierarchy.assertBothEndpointsInScope` rather than reimplemented
   * there. `auth` decides what covered means and answers by asking `hierarchy`
   * about the tree, so `hierarchy` asking `auth` back would close a loop between
   * the two modules that decide authorization.
   *
   * It takes an executor because the reassignment path builds it inside its own
   * transaction, after the lock: a coverage test over the pool would answer from
   * the state the request arrived with, which is the staleness the lock exists to
   * remove (section 24, Transaction isolation).
   */
  private async isWithinManageScope(
    executor: Db,
    actor: Actor,
    authority: ActorAuthority,
    personId: string,
  ): Promise<boolean> {
    return this.authorization.coversWith(
      executor,
      actor,
      authority,
      Capability.PeopleManagePastoralAssignment,
      { kind: 'person', personId },
    );
  }

  /**
   * The refusal for an effective date at or before the current assignment's start.
   *
   * Names a date only where a date can legally be submitted, for the reason
   * `networks.floorBreach` gives: an effective date is a day resolved to its start
   * in Asia/Manila, so where the bound falls on the current day the day after it is
   * tomorrow, which no reassignment may take.
   */
  private reassignmentTooEarly(personId: string, floor: Date, backdated: boolean): ApiError {
    if (!backdated) {
      // Reached only where a record for this person carries the very instant this
      // reassignment is taking — the clock is read after the lock, so a request
      // that merely waited is not refused here. `RESOURCE_BUSY` rather than a 409:
      // contention reaches no decision, and section 22 stores a 4xx against the
      // idempotency key while releasing a 5xx, so a 409 here would replay this
      // transient failure for the whole retention and the advice to retry would be
      // advice to do the one thing that cannot work.
      return new ResourceBusyError({ person_id: personId });
    }

    const earliest = manilaDayAfter(floor);

    if (startOfManilaDay(earliest).getTime() > Date.now()) {
      return new InvariantViolationError(
        'This reassignment cannot be backdated: the records it would have to reach past were written today. Submit it without an effective date, and it will take effect now.',
        { person_id: personId },
      );
    }

    return new InvariantViolationError(
      'That effective date is too early: it would erase or overlap a period already recorded for this person. Use the earliest date given here or later.',
      { person_id: personId, earliest_effective_date: earliest },
    );
  }
}
