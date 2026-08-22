import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { InvariantViolationError, ScopeDeniedError } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';

import type { AccountRole, Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The `hierarchy` module: pastoral assignments, subtree resolution, and the
 * section 5 invariants. It is the only writer of `pastoral_assignments`, which is
 * what gives those invariants exactly one place to live (SKILL.md section 2,
 * Modules).
 *
 * Every query here walks the tree, and every one of them carries its own cycle
 * detection. Section 5 is explicit that this is a correctness requirement rather
 * than a performance preference: a cycle introduced by a migration, by direct SQL,
 * or by a defect must surface as an error rather than as a query that never
 * returns. PostgreSQL 16 is the minimum version precisely so the CYCLE clause is
 * available and the visited-path fallback is never written by hand.
 */
@Injectable()
export class HierarchyService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * The person's leaders, nearest first. A Network root returns an empty list:
   * they have no leader above them, and that is the intended state rather than
   * missing data (section 5, Network roots).
   */
  async ancestorsOf(personId: string): Promise<string[]> {
    const result = await sql<{ leader_id: string | null; depth: number; is_cycle: boolean }>`
      WITH RECURSIVE upline AS (
        SELECT pa.person_id, pa.leader_id, 1 AS depth
          FROM pastoral_assignments pa
         WHERE pa.person_id = ${personId}::uuid
           AND pa.ended_at IS NULL
        UNION ALL
        SELECT pa.person_id, pa.leader_id, u.depth + 1
          FROM pastoral_assignments pa
          JOIN upline u ON pa.person_id = u.leader_id
         WHERE pa.ended_at IS NULL
      ) CYCLE person_id SET is_cycle USING path
      SELECT leader_id, depth, is_cycle FROM upline ORDER BY depth
    `.execute(this.db);

    this.rejectCycle(result.rows, personId);

    return result.rows
      .map((row) => row.leader_id)
      .filter((leaderId): leaderId is string => leaderId !== null);
  }

  /**
   * Everyone recursively below the person, the person included at depth 0.
   *
   * Direct leaders and descendants are different things and are never conflated
   * (section 5, Direct leaders vs descendants); this is the second of the two.
   */
  async subtreeOf(personId: string): Promise<string[]> {
    const result = await sql<{ person_id: string; depth: number; is_cycle: boolean }>`
      WITH RECURSIVE subtree AS (
        SELECT ${personId}::uuid AS person_id, 0 AS depth
        UNION ALL
        SELECT pa.person_id, s.depth + 1
          FROM pastoral_assignments pa
          JOIN subtree s ON pa.leader_id = s.person_id
         WHERE pa.ended_at IS NULL
      ) CYCLE person_id SET is_cycle USING path
      SELECT person_id, depth, is_cycle FROM subtree ORDER BY depth
    `.execute(this.db);

    this.rejectCycle(result.rows, personId);

    return result.rows.map((row) => row.person_id);
  }

  /**
   * Opens a pastoral assignment inside a caller's transaction.
   *
   * Here rather than in the calling module because `hierarchy` is the only writer
   * of `pastoral_assignments`, and SKILL.md section 2 gives the reason: the five
   * section 5 invariants "have exactly one place to live" only while that stays
   * true. Where four modules write a table, an invariant needs checking in four
   * places and the fourth is the one somebody forgets.
   *
   * The transaction is the caller's because the assignment is part of a larger
   * atomic operation — creating a Person opens their Network, their lifecycle and
   * this row together, and none of it may commit without the rest.
   */
  async openAssignmentWithin(
    transaction: Transaction<Database>,
    assignment: { personId: string; leaderId: string | null; startedAt: Date },
  ): Promise<void> {
    // The leader's Network governs whether this edge is legal, and the deferred
    // trigger cannot see a correction to it committing alongside (section 5,
    // Database enforcement). Taken here rather than left to callers because this
    // module is the only writer of the table, which is what section 2 says makes
    // the section 5 invariants checkable in one place — an obligation held only by
    // callers is one the next caller can omit with nothing failing.
    await lockPersonsWithin(transaction, assignment.leaderId === null ? [] : [assignment.leaderId]);

    await transaction
      .insertInto('pastoral_assignments')
      .values({
        person_id: assignment.personId,
        leader_id: assignment.leaderId,
        started_at: assignment.startedAt,
      })
      .execute();
  }

  /**
   * Closes the person's open assignment and opens the new one, at one instant.
   *
   * Both halves and nothing between them: section 5 invariant 3 says a
   * reassignment "must never leave two open assignments, and must never leave a
   * person who had a leader without one", and the partial unique index refuses the
   * first of those outright. The order is forced by that index — the close has to
   * land before the open.
   *
   * **The single `effectiveAt` is not tidiness.** Where this is called as half of
   * a Network change, section 4 requires all four rows to carry one identical
   * timestamp, because that is the only moment at which the old edge can be closed
   * without ever having been invalid. Taking two timestamps a microsecond apart
   * leaves the old edge open at the effective date and the constraint trigger
   * rejects the whole operation.
   *
   * Returns the leader the person is being moved from, which section 5 requires
   * the audit entry to carry, and which only this method is in a position to read.
   * Null where they had no open assignment at all.
   *
   * The invariants this does **not** check are the ones that belong to the caller
   * rather than to the write: section 5's invariant 1 (both endpoints in the
   * actor's scope) and invariant 4 (never oneself, never an upline) are statements
   * about an actor, and this is called from paths with different actors and
   * different rules. Invariant 5 is enforced by the constraint trigger at commit,
   * and by the caller beforehand so that the refusal is an answer rather than a
   * constraint violation.
   */
  async reassignWithin(
    transaction: Transaction<Database>,
    reassignment: { personId: string; leaderId: string; effectiveAt: Date },
  ): Promise<{ previousLeaderId: string | null }> {
    // As above. A caller taking more than one of these — a reassignment alongside a
    // Network change is the case that exists — must still pre-acquire them together
    // in one `lockPersonsWithin` call, because the ordering guarantee is per call.
    // Re-acquiring here is free: advisory locks are reference-counted per session.
    await lockPersonsWithin(transaction, [reassignment.leaderId]);

    const closed = await transaction
      .updateTable('pastoral_assignments')
      .set({ ended_at: reassignment.effectiveAt })
      .where('person_id', '=', reassignment.personId)
      .where('ended_at', 'is', null)
      .returning('leader_id')
      .executeTakeFirst();

    await transaction
      .insertInto('pastoral_assignments')
      .values({
        person_id: reassignment.personId,
        leader_id: reassignment.leaderId,
        started_at: reassignment.effectiveAt,
      })
      .execute();

    return { previousLeaderId: closed?.leader_id ?? null };
  }

  /**
   * SKILL.md section 5 invariant 4: a leader may never change their own pastoral
   * assignment, nor the assignment of anyone upline of them.
   *
   * **This is the only authorization rule in the system decided by role rather
   * than by capability**, and section 5 states it that way on purpose: the point
   * is that Admin and the Senior Pastors sit outside the pastoral incentive the
   * rule guards against, not that they were granted something extra. Without it a
   * leader can detach themselves from their own leader or re-attach themselves
   * higher up — privilege escalation through the org chart, because authorized
   * scope is derived from tree position.
   *
   * `SCOPE_DENIED`, per the 2026-08-20 ruling in CLAUDE.md: it is a statement
   * about the actor's authority over a target, which is what that code means, even
   * though it runs in the domain layer rather than in the guard.
   *
   * It lives here rather than in the calling module because every reassignment
   * path owes it, and `PUT /people/{id}/pastoral-leader` is the second one.
   */
  async assertMayReparent(
    actor: { personId: string; roles: readonly AccountRole[] },
    personId: string,
  ): Promise<void> {
    if (actor.roles.includes('ADMIN') || actor.roles.includes('SENIOR_PASTOR')) {
      return;
    }

    if (personId === actor.personId) {
      throw new ScopeDeniedError(
        'You may not change your own pastoral assignment. Only an Admin or a Senior Pastor may.',
        { person_id: personId },
      );
    }

    // Whether the target is upline of the **actor**, which is the direction the
    // rule is written in. Their own subtree is not the question.
    const ancestors = await this.ancestorsOf(actor.personId);

    if (ancestors.includes(personId)) {
      throw new ScopeDeniedError(
        'You may not change the pastoral assignment of anyone upline of you. Only an Admin or a Senior Pastor may.',
        { person_id: personId },
      );
    }
  }

  /**
   * The people this person currently leads, with enough to name them.
   *
   * Section 4 refuses a Network change while the person leads anyone, and requires
   * the refusal to name the disciples that must be moved first. That refusal is
   * enforced in `networks`, which cannot read this table — so the evidence for it
   * is produced here.
   *
   * The join to `persons` mirrors `directLeaderNameOf` below: a name is what makes
   * the refusal actionable, and returning bare identifiers would push the same
   * join into a module that owns neither table.
   */
  async openDisciplesOf(
    executor: Db,
    personId: string,
  ): Promise<{ personId: string; memberId: string; fullName: string }[]> {
    const rows = await executor
      .selectFrom('pastoral_assignments as pa')
      .innerJoin('persons as disciple', 'disciple.id', 'pa.person_id')
      .select([
        'disciple.id as id',
        'disciple.member_id as member_id',
        'disciple.first_name as first_name',
        'disciple.middle_name as middle_name',
        'disciple.last_name as last_name',
      ])
      .where('pa.leader_id', '=', personId)
      .where('pa.ended_at', 'is', null)
      .orderBy('disciple.last_name')
      .orderBy('disciple.first_name')
      .execute();

    return rows.map((row) => ({
      personId: row.id,
      memberId: row.member_id,
      fullName: [row.first_name, row.middle_name, row.last_name]
        .filter((part): part is string => part !== null && part.trim() !== '')
        .join(' '),
    }));
  }

  /**
   * The instant a backdated Network change for this person must be **strictly
   * later** than, or null where nothing bounds it (SKILL.md section 4).
   *
   * Two terms, and they are written against the `WHERE` clause of
   * `assert_network_change_keeps_edges` rather than against what that trigger is
   * for. That distinction is the reason this method exists rather than a date
   * comparison at the call site: the trigger fires **twice** during a correction,
   * and the two terms come from different firings.
   *
   * The **first** firing is the `UPDATE` that closes the old Network row — first
   * because `network_assignments_one_open` forces the close to precede the open,
   * and a deferred constraint trigger's events fire at commit in the order they
   * were queued. Its bound is that row's own `started_at`, not the effective date,
   * so it selects nearly every edge the person has held and compares each at
   * `GREATEST(edge.started_at, old_row.started_at)` — passing only while that
   * instant is still covered by the old Network row, that is, while the edge began
   * strictly before the effective date.
   *
   * The **second** is the `INSERT` of the new Network row, whose bound is the
   * effective date itself.
   *
   *   - **Term (a), the person's current assignment: the `UPDATE` firing.** At an
   *     effective date equal to its `started_at`, the atomic pair closes it at its
   *     own start; the zero-length row is selected there and compared at that
   *     instant, where the person already resolves to the corrected Network and
   *     their old leader does not. There is no instant at which it can honestly be
   *     closed.
   *   - **Term (b), the `ended_at` of every already-closed edge touching them, in
   *     either direction: both firings, different cases.** The ordinary case — an
   *     effective date below the edge's `ended_at` — comes from the `INSERT`
   *     firing, which selects anything with `ended_at > eff`. At exact equality
   *     only a *zero-length* closed edge still fails, and it fails in the `UPDATE`
   *     firing, compared at its own timestamp. Being closed, it cannot be
   *     reassigned to resolve what it reports.
   *
   * The strict form is uniform, which is conservative by one instant for an
   * ordinary closed edge whose `ended_at` genuinely would pass. Section 4 fixes it
   * that way and it is followed rather than optimised: narrowing it to zero-length
   * rows alone would buy one instant at the cost of the implementation disagreeing
   * with the specification, on the mechanism this project has already misread four
   * times.
   *
   * The first term is over the person's current assignment whatever its
   * `leader_id`; the second is over **edges**, rows with a leader, which is what
   * keeps it independent of how a Network root is represented. Open edges where
   * the person is the *leader* need no term, because section 4 refuses the change
   * outright while any exists.
   *
   * `GREATEST` ignores nulls in PostgreSQL and is null only when every argument
   * is, which is exactly section 4's "each term is a maximum over rows that may be
   * empty, and an empty term contributes nothing".
   */
  async backdateFloorFor(executor: Db, personId: string): Promise<Date | null> {
    const result = await sql<{ floor: Date | null }>`
      SELECT GREATEST(
        (SELECT max(pa.started_at)
           FROM pastoral_assignments pa
          WHERE pa.person_id = ${personId}::uuid
            AND pa.ended_at IS NULL),
        (SELECT max(pa.ended_at)
           FROM pastoral_assignments pa
          WHERE pa.leader_id IS NOT NULL
            AND pa.ended_at IS NOT NULL
            AND (pa.person_id = ${personId}::uuid OR pa.leader_id = ${personId}::uuid))
      ) AS floor
    `.execute(executor);

    return result.rows[0]?.floor ?? null;
  }

  /**
   * The person's open assignment, or null. `leaderId` null means a Network root
   * (section 5, Network roots), which is a row with nothing to reassign.
   */
  async openAssignmentOf(
    executor: Db,
    personId: string,
  ): Promise<{ leaderId: string | null; startedAt: Date } | null> {
    const row = await executor
      .selectFrom('pastoral_assignments')
      .select(['leader_id', 'started_at'])
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

    return row === undefined ? null : { leaderId: row.leader_id, startedAt: row.started_at };
  }

  /**
   * The name of the person's current direct leader, or null.
   *
   * Section 8 permits this church-wide, for a person outside the viewer's own
   * scope, as one of the five fields that let an encoder recognise an existing
   * record.
   */
  async directLeaderNameOf(personId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('pastoral_assignments as pa')
      .innerJoin('persons as leader', 'leader.id', 'pa.leader_id')
      .select(['leader.first_name', 'leader.last_name'])
      .where('pa.person_id', '=', personId)
      .where('pa.ended_at', 'is', null)
      .executeTakeFirst();

    return row === undefined ? null : `${row.first_name} ${row.last_name}`;
  }

  /** The immediate children of a leader, whether or not they qualify as leaders. */
  async directChildrenOf(personId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('pastoral_assignments')
      .select('person_id')
      .where('leader_id', '=', personId)
      .where('ended_at', 'is', null)
      .execute();

    return rows.map((row) => row.person_id);
  }

  /**
   * Whether `personId` falls inside `rootPersonId`'s subtree.
   *
   * Walks up from the target rather than materializing the root's subtree: the
   * answer is the same, and the walk is bounded by the depth of the tree rather
   * than by the size of a branch.
   */
  async isWithinSubtree(
    rootPersonId: string,
    personId: string,
    options: { includeSelf: boolean },
  ): Promise<boolean> {
    if (rootPersonId === personId) {
      return options.includeSelf;
    }

    const ancestors = await this.ancestorsOf(personId);
    return ancestors.includes(rootPersonId);
  }

  private rejectCycle(rows: readonly { is_cycle: boolean }[], personId: string): void {
    if (rows.some((row) => row.is_cycle)) {
      throw new InvariantViolationError(
        'The pastoral tree contains a cycle and cannot be resolved. This is a data defect: report it rather than retrying.',
        { person_id: personId },
      );
    }
  }
}
