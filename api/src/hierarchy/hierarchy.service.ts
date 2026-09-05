import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { Capability } from '../auth/authorization/capabilities';
import { InvariantViolationError, ScopeDeniedError } from '../common/errors/api-error';
import { sameId } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';

import type { AccountRole, Database, NetworkName } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * An assignment row to open: an ordinary edge, or a Network root.
 *
 * **Discriminated rather than `leaderId: string | null`**, for the reason
 * `PersonPlacement` gives at greater length. Section 5 settled that a root is a
 * row carrying a null `leader_id`, and that a Person with no row is unassigned
 * rather than a root — a nullable identifier cannot say which was meant, and the
 * version of this signature that took one silently offered a third outcome that
 * was neither.
 *
 * The union also carries the root seat where, and only where, there is a seat to
 * take, so a root cannot be written without one. Migration 0008 refuses the row
 * otherwise; this refuses it a compile step earlier, where the message names the
 * rule rather than a constraint.
 */
export type OpenAssignment = { personId: string; startedAt: Date } & (
  { root?: false; leaderId: string } | { root: true; rootNetwork: NetworkName }
);

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
  async ancestorsOf(executor: Db, personId: string): Promise<string[]> {
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
    `.execute(executor);

    this.rejectCycle(result.rows, personId);

    return result.rows
      .map((row) => row.leader_id)
      .filter((leaderId): leaderId is string => leaderId !== null);
  }

  /**
   * The person's pastoral path, root first, ending with the person themselves
   * (section 8: "when an authorized user opens a person, show their pastoral
   * path").
   *
   * **Identifiers only, and that is a module rule rather than a style.** Section 2
   * lets one module read another's table in exactly one shape -- a read joined
   * onto a query rooted in a table the reading module owns -- and names the two
   * queries in this file that qualify, closing the list. Resolving names here
   * would be a third: a bare lookup in `persons`, rooted in nothing this module
   * owns, answering a question `people` answers already. The caller composes the
   * names through `PeopleReadService`.
   *
   * **`topIsRoot` is the distinction section 5 requires be surfaced.** A Network
   * root holds an open assignment row carrying a null `leader_id`; a Person with
   * no row at all is unassigned and "is therefore never a root -- surface them as
   * such rather than silently rendering them as a second root of the tree". Both
   * produce a one-element path, so without this the two are the same payload and
   * a client draws an unassigned Person as the top of a tree.
   *
   * `ancestorsOf` discards it -- a root's row is selected and then dropped, since
   * its `leader_id` is null -- so it is read back here rather than inferred.
   */
  async pastoralPathOf(personId: string): Promise<{ ids: string[]; topIsRoot: boolean }> {
    // The ancestors, nearest first, by the same walk every other upline question
    // uses -- so a cycle is refused here exactly as it is there rather than
    // hanging this endpoint.
    const ancestors = await this.ancestorsOf(this.db, personId);

    // Root first, then down to the person. `ancestorsOf` returns nearest first.
    const ids = [...ancestors].reverse();
    ids.push(personId);

    const top = await this.openAssignmentOf(this.db, ids[0]);

    // A row whose `leader_id` is null is what makes someone a root (section 5).
    // The walk stops at the same place either way, so the row has to be asked
    // for; its absence is what "unassigned" means.
    return { ids, topIsRoot: top !== null && top.leaderId === null };
  }

  /**
   * Everyone recursively below the person, the person included at depth 0.
   *
   * Direct leaders and descendants are different things and are never conflated
   * (section 5, Direct leaders vs descendants); this is the second of the two.
   */
  async subtreeOf(executor: Db, personId: string): Promise<string[]> {
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
    `.execute(executor);

    this.rejectCycle(result.rows, personId);

    return result.rows.map((row) => row.person_id);
  }

  /**
   * The pastoral subtree in force at an instant, including the person themselves.
   *
   * **The dated counterpart of `subtreeOf`, and reporting owes its existence**
   * (decision 0206). Section 18 requires a historical report to respect historical
   * pastoral assignments and Section 20 resolves the tree as of the end of the
   * period reported, so every reporting read walks the tree at an instant.
   * `subtreeOf` filters `ended_at IS NULL` and answers only about now, which makes
   * it the wrong method for all of them: a reassignment in November would silently
   * rewrite October.
   *
   * **`[started_at, ended_at)`, the same half-open period `directChildrenAsOf`
   * uses**, and for the reason stated there: a row ending exactly at `at` is not in
   * force at `at`, so a close-and-open pair sharing one instant resolves to the
   * successor rather than to both. That property is what stops a reassignment
   * duplicating a person into two subtrees for the instant it happens.
   *
   * **Which instant a report passes is not decided here**, and deliberately:
   * Section 20 fixes the *period*, and the instant within its last day is recorded
   * as open in `CLAUDE.md`. This method answers about whatever instant it is given,
   * which is the same contract `directChildrenAsOf` and `assignmentsAsOf` already
   * have.
   *
   * **Cycle-safe, and that is not decoration here.** Section 5 requires it of any
   * recursive walk, and a dated walk can meet a cycle the *active* tree never had:
   * the rows in force at a past instant are a different edge set, and invariant 2
   * was evaluated against the tree as it stood at each write rather than against
   * this projection of it. Section 20's fallback for an unassigned person names the
   * same hazard on a **different** graph -- its own is "last open assignment held at
   * any instant within the period", which collapses rows from several instants into
   * one edge set, where this walks one instant and collapses nothing.
   *
   * **That difference is why this method is not, by itself, Section 20's person
   * key.** A person with no open assignment at the instant asked about is absent
   * from this result and must be placed by that fallback; one who held none at any
   * instant of the period belongs in the Whole Church total alone. Neither is this
   * method's to do, and a caller that treats `subtreeAsOf(root, periodEnd)` as a
   * Network total will be short by exactly those people. *A first version said
   * "the same graph", which invited precisely that reading.*
   */
  async subtreeAsOf(executor: Db, personId: string, at: Date): Promise<string[]> {
    const result = await sql<{ person_id: string; depth: number; is_cycle: boolean }>`
      WITH RECURSIVE subtree AS (
        SELECT ${personId}::uuid AS person_id, 0 AS depth
        UNION ALL
        SELECT pa.person_id, s.depth + 1
          FROM pastoral_assignments pa
          JOIN subtree s ON pa.leader_id = s.person_id
         WHERE pa.started_at <= ${at}
           AND (pa.ended_at IS NULL OR pa.ended_at > ${at})
      ) CYCLE person_id SET is_cycle USING path
      SELECT person_id, depth, is_cycle FROM subtree ORDER BY depth
    `.execute(executor);

    this.rejectCycle(result.rows, personId);

    return result.rows.map((row) => row.person_id);
  }

  /**
   * The people a leader's report covers, placed on section 20's reporting graph.
   *
   * **Not the tree, and not `subtreeAsOf` either** (decision 0206). Section 20 places a
   * person by their open assignment at the period's end, and where they have none by the
   * last one they held at any instant *within* the period. So this walks a map that
   * collapses rows from several instants, where `subtreeAsOf` reads one instant and
   * collapses nothing. Both exist, and using the wrong one is a silent wrong total rather
   * than an error: `subtreeAsOf` loses everybody archived mid-period, who section 3 forbids
   * filtering out of a period-based report.
   *
   * **The fallback applies up the chain**, which is what makes a drill-down sum rather than
   * sum one level at a time: a leader who is themselves unassigned at the period's end
   * resolves the same way, so their subtree does not detach from the level above.
   *
   * **Cycle-safe, and here that is not a formality.** Section 5 invariant 2 constrains the
   * *active* tree at each write, and this map is not it — two people can each end a period
   * unassigned having each been under the other within it, from writes that were legal when
   * made. Section 20 says a detected cycle refuses the figure rather than truncating the
   * chain, which is what `rejectCycle` does.
   *
   * The period is half-open at its start and inclusive at its end, matching the instants
   * decision 0208 fixes: `periodEnd` is the last millisecond of the period's final day.
   */
  async reportingSubtree(
    executor: Db,
    leaderId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<string[]> {
    const result = await sql<{ person_id: string; depth: number; is_cycle: boolean }>`
      WITH RECURSIVE in_force AS (
        SELECT person_id, leader_id
          FROM pastoral_assignments
         WHERE started_at <= ${periodEnd}
           AND (ended_at IS NULL OR ended_at > ${periodEnd})
      ),
      fallback AS (
        SELECT DISTINCT ON (pa.person_id) pa.person_id, pa.leader_id
          FROM pastoral_assignments pa
         WHERE pa.started_at <= ${periodEnd}
           AND (pa.ended_at IS NULL OR pa.ended_at > ${periodStart})
           AND NOT EXISTS (
             SELECT 1 FROM in_force f WHERE f.person_id = pa.person_id
           )
         ORDER BY pa.person_id, pa.started_at DESC, pa.ended_at DESC NULLS FIRST, pa.id DESC
      ),
      edges AS (
        SELECT person_id, leader_id FROM in_force
        UNION ALL
        SELECT person_id, leader_id FROM fallback
      ),
      subtree AS (
        SELECT ${leaderId}::uuid AS person_id, 0 AS depth
        UNION ALL
        SELECT e.person_id, s.depth + 1
          FROM edges e
          JOIN subtree s ON e.leader_id = s.person_id
      ) CYCLE person_id SET is_cycle USING path
      SELECT person_id, depth, is_cycle FROM subtree ORDER BY depth
    `.execute(executor);

    this.rejectCycle(result.rows, leaderId);

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
    assignment: OpenAssignment,
  ): Promise<void> {
    // The leader's Network governs whether this edge is legal, and the deferred
    // trigger cannot see a correction to it committing alongside (section 5,
    // Database enforcement). Taken here rather than left to callers because this
    // module is the only writer of the table, which is what section 2 says makes
    // the section 5 invariants checkable in one place — an obligation held only by
    // callers is one the next caller can omit with nothing failing.
    //
    // **A root locks the person instead of the leader it has none of.** Section 5
    // states the rule for an edge — lock the leader you are attaching to — and a
    // root is not an edge, so an earlier version of this took no lock at all and
    // said there was "nothing to lock against and nothing to check".
    //
    // That stopped being true when the row gained a seat. The write now depends on
    // the person's own Network: the database refuses the row unless `root_network`
    // agrees with `network_as_of(person, started_at)`, and a concurrent Network
    // change is exactly what the person lock exists to serialize. Taking the lock
    // on the subject is the same rule applied to the fact this write actually
    // reads, rather than an exception to it.
    await lockPersonsWithin(transaction, [
      assignment.root ? assignment.personId : assignment.leaderId,
    ]);

    await transaction
      .insertInto('pastoral_assignments')
      .values({
        person_id: assignment.personId,
        leader_id: assignment.root ? null : assignment.leaderId,
        // Section 5's one-root-per-Network seat (migration 0008). The database
        // refuses a value that disagrees with the person's own Network as of
        // `started_at`, so this cannot claim the other Network's seat.
        root_network: assignment.root ? assignment.rootNetwork : null,
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
    // Re-acquiring here is free, because a session is always granted a lock it
    // already holds. Not because transaction-level advisory locks are
    // reference-counted: session-level ones are, and these are released only when
    // the transaction ends.
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
   * SKILL.md section 5 invariant 1: a reassignment has a source and a destination
   * and the actor must be authorized for **both**.
   *
   * Validating only the destination lets an actor pull people in from a branch
   * they do not oversee; validating only the source lets them push people out of
   * their scope and lose them. The guard evaluates the person being reassigned and
   * neither of these, which is why the rule is here: section 7 says a capability
   * and a scope carry one target, and the conditions concerning other objects are
   * enforced in the owning module's domain layer.
   *
   * A null source is a Person with no current assignment. There is no second
   * endpoint to authorize, and section 5 permits an unassigned Person.
   *
   * **`covers` is a parameter rather than a dependency, and that is the whole
   * design of this method.** Deciding whether an actor's scope reaches a person is
   * `auth`'s job, and `auth` answers it by asking *this* module about the tree
   * (`isWithinSubtree`). Injecting `AuthorizationService` here would therefore
   * close a loop between the two modules that decide authorization, and would need
   * a `forwardRef` this codebase has never used. Splitting it the other way costs
   * nothing and is the same seam section 7 already draws: this module owns **which
   * endpoints must be covered** and what the refusal says; `auth` owns **what
   * covered means**. The caller passes the second in.
   *
   * The caller is also what makes the executor honest. A coverage test built over
   * a transaction sees that transaction; one built over the pool does not, and
   * this method cannot tell the difference — which is why the reassignment path
   * builds it from `coversWith` inside its own transaction, after taking the lock.
   */
  async assertBothEndpointsInScope(
    sourceLeaderId: string | null,
    destinationLeaderId: string,
    covers: (personId: string) => Promise<boolean>,
  ): Promise<void> {
    const endpoints: { label: string; personId: string }[] = [
      { label: 'pastoral_leader_id', personId: destinationLeaderId },
      ...(sourceLeaderId === null ? [] : [{ label: 'current_leader', personId: sourceLeaderId }]),
    ];

    for (const endpoint of endpoints) {
      if (!(await covers(endpoint.personId))) {
        throw new ScopeDeniedError(
          'A reassignment must stay within your authorized scope at both ends: the leader the person is moving from, and the leader they are moving to.',
          { capability: Capability.PeopleManagePastoralAssignment, field: endpoint.label },
        );
      }
    }
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
    executor: Db,
    actor: { personId: string; roles: readonly AccountRole[] },
    personId: string,
  ): Promise<void> {
    if (actor.roles.includes('ADMIN') || actor.roles.includes('SENIOR_PASTOR')) {
      return;
    }

    // Compared canonically, and not because a pipe might be missing upstream: a
    // check that fails **open** must not depend on one. An identifier spelled in
    // uppercase is the same record to every `uuid` comparison in the database and
    // a different string to this one, so a raw `===` here answers "this is not
    // you" to somebody correcting their own record.
    if (sameId(personId, actor.personId)) {
      throw new ScopeDeniedError(
        'You may not change your own pastoral assignment. Only an Admin or a Senior Pastor may.',
        { person_id: personId },
      );
    }

    // Whether the target is upline of the **actor**, which is the direction the
    // rule is written in. Their own subtree is not the question.
    const ancestors = await this.ancestorsOf(executor, actor.personId);

    if (ancestors.some((ancestorId) => sameId(ancestorId, personId))) {
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
      fullName: composeName(row),
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
   * `leader_id`. **What the second term ranges over depends on the mode** — see
   * `closedRows` below, which is the whole of the difference between the two
   * callers; do not read either shape as the method's. Open edges where the person
   * is the *leader* need no term in either, because section 4 refuses a Network
   * change outright while any exists and a reassignment cannot strand one.
   *
   * `GREATEST` ignores nulls in PostgreSQL and is null only when every argument
   * is, which is exactly section 4's "each term is a maximum over rows that may be
   * empty, and an empty term contributes nothing".
   */
  async backdateFloorFor(
    executor: Db,
    personId: string,
    /**
     * Which closed rows term (b) ranges over, and the two callers need different
     * answers because they fire different triggers.
     *
     * `either-direction` is section 4's, for a **Network change**:
     * `assert_network_change_keeps_edges` selects edges where the person is the
     * subordinate *or* the leader, so a correction can strand either — "the limit
     * covers both directions because the check does". Restricted to rows with a
     * leader, because a null-`leader_id` row is passed without comparison and can
     * never be a stranded edge.
     *
     * `as-subordinate` is section 5's, for a **reassignment**:
     * `assert_assignment_same_network` reads only the row being written, so a
     * former disciple's closed edge cannot be stranded by it and has no business
     * bounding this. What the term prevents here is different — an effective date
     * inside a period already recorded *for this person*, which would leave two
     * rows valid at one instant. That concern does not care whether the closed row
     * carried a leader, so this one does not exclude a root row.
     *
     * Borrowing section 4's shape wholesale over-refused: any leader who had ever
     * had a disciple moved carried that disciple's `ended_at` as their own floor,
     * for no invariant's sake.
     */
    closedRows: 'either-direction' | 'as-subordinate',
  ): Promise<Date | null> {
    const eitherDirection = closedRows === 'either-direction';

    const result = await sql<{ floor: Date | null }>`
      SELECT GREATEST(
        (SELECT max(pa.started_at)
           FROM pastoral_assignments pa
          WHERE pa.person_id = ${personId}::uuid
            AND pa.ended_at IS NULL),
        (SELECT max(pa.ended_at)
           FROM pastoral_assignments pa
          WHERE pa.ended_at IS NOT NULL
            AND (${eitherDirection}::boolean IS FALSE OR pa.leader_id IS NOT NULL)
            AND (pa.person_id = ${personId}::uuid
                 OR (${eitherDirection}::boolean AND pa.leader_id = ${personId}::uuid)))
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

  /**
   * The immediate children of a leader **as of an instant**, whether or not they
   * qualify as leaders.
   *
   * The dated counterpart of `directChildrenOf`, and it exists because attendance
   * is the first domain to ask a tree question about the past. Section 9 fixes a
   * person's responsible leader "as of the event date" and a DCC checklist is the
   * inverse of that relation, so reading the currently open row would move a
   * historical roster every time somebody is reassigned.
   *
   * `[started_at, ended_at)` — the half-open period every effective-dated table in
   * this schema uses. A row ending exactly at `at` is not in force at `at`, which
   * is what makes a close-and-open pair sharing one instant resolve to the
   * successor rather than to both.
   */
  async directChildrenAsOf(executor: Db, personId: string, at: Date): Promise<string[]> {
    const rows = await executor
      .selectFrom('pastoral_assignments')
      .select('person_id')
      .where('leader_id', '=', personId)
      .where('started_at', '<=', at)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', at)]))
      .execute();

    return rows.map((row) => row.person_id);
  }

  /**
   * The assignment row in force for a person at an instant, or null where they had
   * none.
   *
   * **The three states section 9 insists are different.** `null` is a Person with
   * no assignment row at that instant, whose DCC attendance cannot be recorded
   * because there is no responsible leader to record it against. A row with
   * `leaderId: null` is a Network root, which is the intended state rather than
   * missing data. Anything else is an ordinary edge. Returning `string | null`
   * would collapse the first two, which is the mistake `OpenAssignment` above
   * exists to prevent on the write side.
   */
  async assignmentAsOf(
    executor: Db,
    personId: string,
    at: Date,
  ): Promise<{ leaderId: string | null } | null> {
    const row = await executor
      .selectFrom('pastoral_assignments')
      .select('leader_id')
      .where('person_id', '=', personId)
      .where('started_at', '<=', at)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', at)]))
      .executeTakeFirst();

    return row === undefined ? null : { leaderId: row.leader_id };
  }

  /**
   * The same read for many people at once, as a map missing the ones who had no
   * row.
   *
   * A roster resolves a responsible leader per person, and a submission carries
   * many people at once (section 14), so the per-person form would issue one query
   * per name on the checklist.
   */
  async assignmentsAsOf(
    executor: Db,
    personIds: readonly string[],
    at: Date,
  ): Promise<Map<string, { leaderId: string | null }>> {
    if (personIds.length === 0) {
      return new Map();
    }

    const rows = await executor
      .selectFrom('pastoral_assignments')
      .select(['person_id', 'leader_id'])
      .where('person_id', 'in', [...personIds])
      .where('started_at', '<=', at)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', at)]))
      .execute();

    return new Map(rows.map((row) => [row.person_id, { leaderId: row.leader_id }]));
  }

  /**
   * The Network roots as of an instant — the people holding a row with no leader
   * above them (section 5, Network roots).
   *
   * They have no responsible leader and appear on no leader's checklist, so
   * section 9 puts them on the checklist of a Whole Church holder instead. This is
   * how that list is found.
   */
  async rootsAsOf(executor: Db, at: Date): Promise<string[]> {
    const rows = await executor
      .selectFrom('pastoral_assignments')
      .select('person_id')
      .where('leader_id', 'is', null)
      .where('started_at', '<=', at)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', at)]))
      .execute();

    return rows.map((row) => row.person_id);
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
    executor: Db,
    rootPersonId: string,
    personId: string,
    options: { includeSelf: boolean },
  ): Promise<boolean> {
    if (sameId(rootPersonId, personId)) {
      return options.includeSelf;
    }

    const ancestors = await this.ancestorsOf(executor, personId);
    return ancestors.some((ancestorId) => sameId(ancestorId, rootPersonId));
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

/**
 * A person's full name, from the columns this module reads on its joins.
 *
 * Local rather than imported from `people.shared.ts`, which composes the same
 * string: `people` depends on this module, and pointing an import back the other
 * way for one pure function is how a cycle starts. It applies the same rule as
 * that one and as `fullNameOf` in the matcher -- a whitespace-only middle name
 * counts as absent -- and the three are kept in step by review rather than by the
 * compiler, which is the accepted cost of not creating that edge.
 */
function composeName(row: {
  first_name: string;
  middle_name: string | null;
  last_name: string;
}): string {
  return [row.first_name, row.middle_name, row.last_name]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
}
