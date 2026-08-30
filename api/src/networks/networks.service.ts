import { Inject, Injectable, Optional } from '@nestjs/common';

import { InvariantViolationError } from '../common/errors/api-error';
import { manilaDayAfter, startOfManilaDay } from '../common/time/manila';
import { type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';
import { HierarchyService } from '../hierarchy/hierarchy.service';

import { CELL_RELATIONSHIPS_PORT, type CellRelationshipsPort } from './cell-relationships.port';

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
    private readonly hierarchy: HierarchyService,
    /**
     * **Optional in the injector and required in effect** (`cell-relationships.port.ts`).
     * What makes that safe is the refusal below: an unbound port closes the Network
     * change rather than waving it through, which is the reading `CELL_SCOPE_PORT`
     * already gives for the same situation.
     *
     * *An earlier version said the parameter could not be mandatory, because only
     * `AppModule` could bind an implementation. That was wrong; so was the first
     * correction, which said a `@Global()` binding puts the token in every context. It
     * reaches every module of a graph that *includes* it, and a mandatory injection
     * works today only because the one test graph omitting it constructs no
     * `NetworksService`.* Whether it should be mandatory is
     * recorded as open in `CLAUDE.md` — it would move a wiring fault to startup,
     * where the module-graph gate already lives, at the cost of a deployment failing
     * to boot rather than losing one operation.
     */
    @Optional()
    @Inject(CELL_RELATIONSHIPS_PORT)
    private readonly cells?: CellRelationshipsPort,
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
   * **Section 4's preconditions are enforced here**, and section 4
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
   * **Section 4's Cell obligation is enforced here**, in
   * `assertHoldsNoCellRelationshipWithin` below: a Network change is refused while the
   * person holds an open Cell leadership assignment, and refused while they hold an
   * open Cell membership. Leadership is refused first, so somebody holding both is
   * told about the obligation that takes weeks rather than the one that takes minutes.
   *
   * *This block has now been wrong in both directions.* It first said the obligation
   * was unenforced because neither table existed, which stopped being true at
   * migration 0009; it was corrected to say the rules were settled and unbuilt, which
   * stopped being true in the commit that built them. Both were accurate when written
   * and neither was revisited by the change that falsified it.
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
    // **Before anything is read.** Every precondition below was a statement about
    // pastoral edges when this was written, and two of them are now about Cell
    // relationships. There are five writers of those two tables, and the lock covers
    // them unevenly — an earlier version of this comment said four and omitted
    // closure, which is the one that is neither covered nor uncovered:
    //
    //   - a leadership request's approval locks the prospective leader;
    //   - both membership writes lock the person;
    //   - a **closure** locks only the members it disperses, so it ends the outgoing
    //     leader's row while holding no lock on that leader;
    //   - **direct Cell creation** during initial encoding (section 2) takes none.
    //
    // What survives is narrower than "covered": the only uncovered *opener* is direct
    // creation, because a closure merely ends a leadership and a relationship that is
    // genuinely gone cannot strand anyone. And a Cell created during initial encoding
    // holds no members yet, and that path closes with the phase. Named rather than
    // left to be discovered, and stated as a list because the count is what went
    // wrong.
    //
    // The deferred triggers cannot see an edge opened
    // concurrently and committed just after this transaction's own comparison. The
    // lock is what makes the refusals mean something under concurrency; see
    // `lockPersonsWithin`.
    await lockPersonsWithin(transaction, [change.personId]);

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
    // **This is the answer to "is this person a root"**, settled by section 5 on
    // 2026-08-23: a root is an open assignment row whose `leader_id` is null, and a
    // Person with no open row at all is unassigned rather than a second root.
    // Needing to tell those two apart here is one of the two reasons that reading
    // was chosen — the correction is refused for the first and must not be for the
    // second.
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

    // **Then the Cell relationships, and leadership before membership** (section 4).
    // The order is the section's: somebody holding both is told about the obligation
    // that takes weeks rather than the one that takes minutes, which is the same
    // reason the root refusal fires before the disciple refusal above.
    //
    // **Before the floor, like the disciple refusal.** Resolving either relationship
    // writes a `cell_leaderships` or `cell_memberships` row and neither is a term in
    // the floor, so this ordering is about the *message* rather than about the
    // arithmetic: reporting a floor to somebody who is going to be refused anyway
    // tells them to solve the wrong problem first.
    //
    // Whether Cell relationships *should* contribute a floor term is a real gap and
    // is recorded as open in `CLAUDE.md`: the refusal reaches only open rows, so a
    // correction backdated into a stint since handed over still strands the
    // memberships opened during it.
    await this.assertHoldsNoCellRelationshipWithin(transaction, change.personId);

    const floor = await this.hierarchy.backdateFloorFor(
      transaction,
      change.personId,
      // Section 4: the same-Network trigger on a Network change selects edges in
      // both directions, so the limit covers both.
      'either-direction',
    );

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
      //
      // **This is a 409 and should very likely be a 503, and that is deliberately not
      // changed here.** Section 22 stores a 4xx against the idempotency key and
      // replays it for the whole retention, so a 409 pins a transient failure to the
      // key for a day while this message tells the caller to retry — the status and
      // the advice on opposite sides of that split. `reassignmentTooEarly` answers
      // `RESOURCE_BUSY` for the same case on the sibling path, since `216be37`.
      //
      // It is left alone because changing it is a ruling rather than a fix, and needs
      // two amendments neither of which is derivable. Section 4 says an undated
      // correction "always succeeds" and has no floor to clear, which **this branch of
      // this method** contradicts — the contradiction is long-standing rather than
      // introduced by any recent change, and issue #16 records it as pre-existing on
      // `main`. And section 22 defines `RESOURCE_BUSY` as a wait that timed out or a
      // deadlock victim, which this is neither: the lock was acquired cleanly and the
      // collision is with a committed row.
      //
      // Recorded as open in `CLAUDE.md` rather than settled in a fix batch.
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
  async currentNetwork(executor: Db, personId: string): Promise<NetworkName | null> {
    return this.networkAsOf(executor, personId, new Date());
  }

  /**
   * Section 4: a Network change is refused while the person holds either Cell
   * relationship.
   *
   * **Both halves, and they are separate rules rather than one.** Leadership is
   * refused because a Cell takes its Network from its leader, so the change would
   * carry the Cell across and strand every member. Membership is refused because the
   * person's own membership becomes a cross-Network relationship. Neither is reached
   * by the disciple refusal above: membership does not mirror pastoral assignment, so
   * a member need not lead anything and need not sit under the Cell's leader.
   *
   * **What makes this a domain check rather than a constraint** is that it is a
   * precondition on the state the request *arrives* in. A deferred trigger sees only
   * commit-time state, so a transaction that resolved the Cell and performed the
   * correction together would pass it; an immediate one would enforce statement
   * ordering instead, which an implementer clears by resolving the Cell first.
   * Section 4 says this, and migration 0009 records the same trap for a sibling
   * trigger.
   *
   * **Naming the Cells is a disclosure, and it is safe here for the reason the
   * disciple refusal gives for naming people**: section 8 protects Cell membership
   * and Cell IDs for somebody outside the reader's scope, and every capability
   * reaching this path is held at Whole Church only (section 7). A narrower grant
   * would make this the disclosure of a branch the actor does not oversee.
   */
  private async assertHoldsNoCellRelationshipWithin(
    transaction: Transaction<Database>,
    personId: string,
  ): Promise<void> {
    if (!this.cells) {
      // **A wiring fault, refused rather than skipped** — unbound, this check cannot
      // run, and section 4 states the rule absolutely. `CELL_SCOPE_PORT` sets that
      // precedent: a missing binding closes the operation rather than opening it.
      //
      // **A plain `Error`, so the filter renders 500 and section 22 releases the
      // idempotency key.** The first version threw `InvariantViolationError`, and a
      // 409 is *stored* against the key and replayed for the whole retention — so a
      // client retrying the unchanged body after the deployment was fixed would be
      // served the refusal for ever. Section 22 is explicit that a transient condition
      // reaching no decision must be a 5xx, and an unbound port reaches none: the
      // record is not one "the rules reject however it was submitted", it is one
      // nothing could evaluate.
      //
      // *The `CELL_SCOPE_PORT` precedent does not carry to the status, only to the
      // refusal.* That one is thrown by a **guard**, and Nest runs every guard before
      // any interceptor, so no idempotency key exists when it fires and the
      // store/release split never applies to it. Reusing its 4xx here was section 25
      // rule 19 — the shape without its reason.
      //
      // *An earlier version credited `AppModule`'s provider order for that, which is
      // not what produces it: the ordering of `APP_GUARD` against `APP_INTERCEPTOR`
      // decides nothing, and only the two guards' order relative to each other. The
      // conclusion held and the mechanism was wrong, which is the fault this whole
      // paragraph is about.*
      throw new Error(
        `Cannot check Cell relationships for person ${personId}: CELL_RELATIONSHIPS_PORT ` +
          'is not bound, so the SKILL.md section 4 precondition on a Network change ' +
          'cannot be evaluated. This is a deployment fault.',
      );
    }

    const leaderships = await this.cells.openLeadershipsOf(transaction, personId);

    if (leaderships.length > 0) {
      throw new InvariantViolationError(
        'That person still leads a Cell. Hand each Cell to a new leader, or close it, then ' +
          'make this change.',
        {
          person_id: personId,
          cells: leaderships.map((cell) => ({ id: cell.id, cell_id: cell.cellId })),
        },
      );
    }

    const membership = await this.cells.openMembershipOf(transaction, personId);

    if (membership !== null) {
      throw new InvariantViolationError(
        'That person still belongs to a Cell. End that membership first, then make this ' +
          'change; they can join a Cell in their new Network afterwards.',
        {
          person_id: personId,
          cell: { id: membership.id, cell_id: membership.cellId },
        },
      );
    }
  }
}
