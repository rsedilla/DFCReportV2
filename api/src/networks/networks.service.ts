import { Inject, Injectable } from '@nestjs/common';

import { InvariantViolationError } from '../common/errors/api-error';
import { manilaDayAfter, startOfManilaDay } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';

import type { Database, NetworkName, Sex } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The `networks` module: Network assignment and its history.
 *
 * Network is effective-dated rather than a column on the Person, because a column
 * cannot answer which Network someone belonged to during a past month, and every
 * Network-scoped report for a closed period depends on that answer (SKILL.md
 * section 4).
 */
@Injectable()
export class NetworksService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
  ) {}

  /**
   * The person's Network as it stood at `at`, or null where none was recorded
   * then. Null is a real answer: the system is authoritative for Network history
   * only from a person's encoding date forward.
   *
   * The executor is required rather than defaulted, because the one caller that
   * asks this from inside a transaction is the one that must not get it wrong.
   * Reading it on the pooled connection while holding a transaction is also a
   * liveness bug in its own right: a request holding one connection and waiting
   * for a second from the same bounded pool starves once enough of them run at
   * once (section 24 bounds the pool).
   */
  async networkAsOf(executor: Db, personId: string, at: Date): Promise<NetworkName | null> {
    const row = await executor
      .selectFrom('network_assignments')
      .select('network')
      .where('person_id', '=', personId)
      .where('started_at', '<=', at)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', at)]))
      .orderBy('started_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row?.network ?? null;
  }

  /**
   * Opens a Network assignment inside a caller's transaction.
   *
   * Here rather than in `people` because `networks` owns this table (section 2,
   * Modules) and because the same-Network rules in sections 4 and 5 are checked
   * against it. One writer is what keeps that checkable.
   *
   * Section 4: a person's initial Network takes effect on the date they are
   * encoded. Nothing is backdated and no legacy history is invented.
   */
  async assignWithin(
    transaction: Transaction<Database>,
    assignment: {
      personId: string;
      network: NetworkName;
      actorId: string | null;
      startedAt: Date;
      reason?: string | null;
    },
  ): Promise<void> {
    await transaction
      .insertInto('network_assignments')
      .values({
        person_id: assignment.personId,
        network: assignment.network,
        actor_id: assignment.actorId,
        reason: assignment.reason ?? null,
        started_at: assignment.startedAt,
      })
      .execute();
  }

  /**
   * Changes a person's Network inside a caller's transaction: the open row is
   * closed and the new one opened, both at `effectiveAt` (SKILL.md section 4).
   *
   * **The two preconditions section 4 states are enforced here**, and section 4
   * says so by name — not because this is a convenient place, but because neither
   * is a constraint the database can hold. The same-Network trigger is
   * `DEFERRABLE INITIALLY DEFERRED` and sees only the state at commit, so a
   * transaction that moved a disciple out of the way and then performed the
   * correction commits legally: the schema permits exactly the combined operation
   * the first rule forbids. Nobody may read the passing constraint as agreement.
   *
   * This never touches `pastoral_assignments` and never reads it: `hierarchy` owns
   * that table (section 2, Modules) and is asked for both facts. The reassignment
   * the change forces is the caller's, performed in this same transaction at this
   * same instant.
   *
   * Section 4's last paragraph puts the same obligation on Cell membership and Cell
   * leadership, and it is **not** enforced here because neither table exists yet.
   * That is Stage 3, where `docs/ROADMAP.md` names it as work rather than leaving
   * it as a comment nobody is accountable for.
   */
  async changeWithin(
    transaction: Transaction<Database>,
    change: {
      personId: string;
      toNetwork: NetworkName;
      effectiveAt: Date;
      /** Whether the caller named the effective date, which decides how a floor breach is explained. */
      backdated: boolean;
      actorId: string;
      /** Required. Section 4: a Network change is a correction, and a correction explains itself. */
      reason: string;
    },
  ): Promise<{ from: NetworkName }> {
    const open = await transaction
      .selectFrom('network_assignments')
      .select(['network', 'started_at'])
      .where('person_id', '=', change.personId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

    if (open === undefined) {
      // Section 4: the system is authoritative for Network history from a
      // person's encoding date forward, so a Person with no open row is a data
      // defect rather than a Person whose Network may simply be opened here.
      throw new InvariantViolationError(
        'That person has no Network on record, so there is nothing to change. This is a data defect: report it rather than retrying.',
        { person_id: change.personId },
      );
    }

    if (open.network === change.toNetwork) {
      throw new InvariantViolationError('That person is already in that Network.', {
        person_id: change.personId,
        network: change.toNetwork,
      });
    }

    // **A Network root is not moved between Networks by a data correction.**
    // Section 5: each Network has exactly one root, a root cannot be reassigned by
    // anyone, Admin included, and changing who holds a root position is a
    // deliberate Network-level decision rather than a pastoral one. Moving one
    // here would leave one Network rootless and the other with two.
    //
    // Before the disciple refusal, because a root leads people and would otherwise
    // always be refused with the wrong reason.
    //
    // **This detects the representation the schema actually carries** — an open
    // row with a null `leader_id`. Section 5 also describes a root as having no
    // active assignment at all, and the two readings disagree; that ambiguity is
    // recorded as open in CLAUDE.md, and under the other reading this check does
    // not fire. It is a fail-closed guard on the representation in use, not an
    // answer to "is this person a root".
    const assignment = await this.hierarchy.openAssignmentOf(transaction, change.personId);

    if (assignment !== null && assignment.leaderId === null) {
      throw new InvariantViolationError(
        'That person is a Network root. Changing who holds a root position is a Network-level decision, not a data correction.',
        { person_id: change.personId },
      );
    }

    // **First, and before the floor.** Section 4 refuses the change while the
    // person leads anyone, and moving a disciple closes their edge — which
    // immediately becomes a term in the floor below. Reporting a floor while open
    // downline edges remain would report one that is about to change.
    const disciples = await this.hierarchy.openDisciplesOf(transaction, change.personId);
    if (disciples.length > 0) {
      throw new InvariantViolationError(
        'That person still leads other people. Reassign each of them to another leader first, then make this change.',
        {
          person_id: change.personId,
          // Naming them is what makes the refusal actionable (section 4). It
          // discloses people, and it is safe only because every capability
          // reaching this path is Whole Church (section 7) — a narrower one would
          // make this a disclosure of a branch the actor does not oversee.
          disciples: disciples.map((disciple) => ({
            id: disciple.personId,
            member_id: disciple.memberId,
            full_name: disciple.fullName,
          })),
        },
      );
    }

    const floor = await this.hierarchy.backdateFloorFor(transaction, change.personId);

    // **Two bounds, resolved to whichever binds, and refused once.**
    //
    // Section 4's floor bounds the pastoral edges the correction would strand. The
    // second bound is the Network row's own `started_at`: at or before it the
    // `UPDATE` below would close the live row at its own start, and section 5
    // makes such a row inert, so the period the person spent in their former
    // Network would vanish from every as-of query.
    //
    // They are taken together rather than in sequence because section 4 requires
    // the refusal to name "the earliest date it can legally take". Refusing on the
    // floor first and naming the day after *it* hands back a date the second bound
    // then refuses, naming a later one — two round trips, and the second answer
    // contradicting the first, which is the failure that sentence exists to
    // prevent. It is reachable: a Person whose closed edge ended before their
    // current Network row began has a floor below that row's start.
    //
    // **Checked whether or not the caller backdated.** A correction taking effect
    // now clears both bounds in every ordinary case, but not in every case: a
    // Person encoded and corrected within the same millisecond has a current
    // assignment, and a Network row, whose timestamps equal the effective instant.
    // Checking only when backdating would leave that to surface as a constraint
    // violation.
    const bound =
      floor !== null && floor.getTime() >= open.started_at.getTime()
        ? ({ at: floor, kind: 'edges' } as const)
        : ({ at: open.started_at, kind: 'network-row' } as const);

    if (change.effectiveAt.getTime() <= bound.at.getTime()) {
      throw this.floorBreach(change, bound.at, bound.kind);
    }

    // The close before the open: `network_assignments_one_open` is a partial
    // unique index over `ended_at IS NULL` and refuses the other order.
    await transaction
      .updateTable('network_assignments')
      .set({ ended_at: change.effectiveAt })
      .where('person_id', '=', change.personId)
      .where('ended_at', 'is', null)
      .execute();

    await transaction
      .insertInto('network_assignments')
      .values({
        person_id: change.personId,
        network: change.toNetwork,
        actor_id: change.actorId,
        reason: change.reason,
        started_at: change.effectiveAt,
      })
      .execute();

    return { from: open.network };
  }

  /**
   * The refusal for an effective instant that is at or before a bound.
   *
   * **It names a date only where a date can legally be submitted**, and that is
   * the whole reason this is a method rather than an inline throw. An effective
   * date is a day resolved to its start in Asia/Manila (section 20), so where the
   * bound falls on the current Manila day the day after it is *tomorrow* — and a
   * correction cannot be dated in the future (section 5 knows "now" and "in the
   * past", and nothing else). Naming it would hand the administrator the one
   * answer guaranteed to be refused again, which is exactly what section 4
   * requires the system not to do.
   *
   * In that case no date clears the bound and the correction can only take effect
   * now, which always does: every bound is read from a row already written, so it
   * lies in the past. So the refusal says that instead of naming a date.
   */
  private floorBreach(
    change: { personId: string; backdated: boolean },
    bound: Date,
    /**
     * What the bound is, which decides only the wording. The two are different
     * facts — a pastoral edge that could not be corrected, and the Network row's
     * own start — and one message covering both would tell an administrator with
     * no pastoral assignment that they had stranded one.
     */
    kind: 'edges' | 'network-row',
  ): InvariantViolationError {
    const earliest = manilaDayAfter(bound);
    const submittable = startOfManilaDay(earliest).getTime() <= Date.now();

    if (!change.backdated) {
      // Reached only where a record for this person was written at the same
      // instant this correction is taking — a Person encoded and corrected within
      // the same millisecond. There is no date to offer and none was asked for.
      return new InvariantViolationError(
        'This change cannot take effect at this instant, because a record for this person was written at it. Retry in a moment.',
        { person_id: change.personId },
      );
    }

    if (!submittable) {
      return new InvariantViolationError(
        'This correction cannot be backdated: the records it would have to reach past were written today. Submit it without an effective date, and it will take effect now.',
        { person_id: change.personId },
      );
    }

    return new InvariantViolationError(
      kind === 'edges'
        ? 'That effective date is too early: it would strand a pastoral assignment that cannot be corrected. Use the earliest date given here or later.'
        : 'That effective date is at or before the moment the Network being corrected took effect, so the correction would erase that period rather than end it. Use the earliest date given here or later.',
      { person_id: change.personId, earliest_effective_date: earliest },
    );
  }

  /**
   * Network follows from sex under the homogeneous-network rule (section 4).
   *
   * Assigned rather than proposed: the mapping is total, so a confirmation step
   * asks the encoder to approve a tautology, and confirmations of tautologies are
   * clicked without being read. The field that can genuinely be wrong is sex.
   */
  networkForSex(sex: Sex): NetworkName {
    return sex === 'MALE' ? 'MENS' : 'WOMENS';
  }

  /** The person's Network as it stands now. */
  async currentNetwork(personId: string): Promise<NetworkName | null> {
    return this.networkAsOf(this.db, personId, new Date());
  }
}
