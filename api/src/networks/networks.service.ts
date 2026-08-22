import { Inject, Injectable } from '@nestjs/common';

import { InvariantViolationError } from '../common/errors/api-error';
import { manilaDayAfter } from '../common/time/manila';
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
   */
  async networkAsOf(personId: string, at: Date): Promise<NetworkName | null> {
    const row = await this.db
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

    // **Checked whether or not the caller backdated.** Section 4 states the floor
    // for a backdated correction, and a correction taking effect now clears it in
    // every ordinary case — but not in every case: a Person encoded and corrected
    // within the same millisecond has a current assignment whose `started_at`
    // equals the effective instant, which is the first term exactly. Checking only
    // when backdating would leave that one to surface as a constraint violation.
    if (floor !== null && change.effectiveAt.getTime() <= floor.getTime()) {
      throw new InvariantViolationError(
        change.backdated
          ? 'That effective date is too early: it would strand a pastoral assignment that cannot be corrected. Use the earliest date given here or later.'
          : 'This change cannot take effect at this instant, because a pastoral record for this person was written at it. Retry in a moment.',
        {
          person_id: change.personId,
          ...(change.backdated
            ? // A date rather than the floor itself. The floor is an instant, an
              // effective date is a day, and the day containing the floor is the
              // one day that would be refused again (section 4, section 20).
              { earliest_effective_date: manilaDayAfter(floor) }
            : {}),
        },
      );
    }

    if (change.effectiveAt.getTime() < open.started_at.getTime()) {
      // `CHECK (ended_at >= started_at)` would refuse this close. Section 4's floor
      // does not bound it, because it is reachable only where an assignment was
      // opened before the person had a Network at all — which the same-Network
      // trigger refuses for any edge with a leader, leaving only a null-leader root
      // row written by an import. Translated into an answer rather than left to
      // surface as a constraint violation the administrator cannot act on.
      throw new InvariantViolationError(
        'That effective date is before the Network being corrected took effect, so there is no period for the correction to cover.',
        {
          person_id: change.personId,
          earliest_effective_date: manilaDayAfter(open.started_at),
        },
      );
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
    return this.networkAsOf(personId, new Date());
  }
}
