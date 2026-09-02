import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { type CellScopePort } from '../auth/authorization/cell-scope.port';
import { DATABASE, type Db } from '../database/database.module';
import { isMonthOpen, reportingMonthOf } from '../common/time/submission-window';
import { type CellRelationshipsPort, type NamedCell } from '../networks/cell-relationships.port';

import { CURSOR_INSTANT_FORMAT } from './leadership-request-cursor';

import type { LeadershipRequestCursor, LeadershipRequestRow } from './leadership-request-cursor';
import type { RosterCursor } from '../common/roster-cursor';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The reads other modules need of `cells`, and nothing wider.
 *
 * **It exists because `auth` needs one question answered, not a table.** Section 6
 * provisions a `LEADER` account together with the Cell leadership that qualifies
 * it, and section 11 defines that qualification exactly: "a person is a current
 * Cell Leader when they have at least one active Cell leadership assignment on an
 * `ACTIVE` Cell". Section 2 gives `cell_leaderships` and `cells` to this module, so
 * `auth` asks rather than joins.
 *
 * The seam is `AuthorizationModule`'s, re-derived rather than copied: what `auth`
 * needs is a question, and importing a module of creation and closure operations to
 * ask it would put the whole of `cells` into `auth`'s surface. The graph runs
 * `auth -> cells -> {people, networks, hierarchy, authorization, admin/settings,
 * audit}` (the same set `cells.module.ts` enumerates) with
 * nothing pointing back, because this module never imports `auth`.
 */
@Injectable()
export class CellsReadService implements CellScopePort, CellRelationshipsPort {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * `CellScopePort`. The Person a Cell's scope resolves through (SKILL.md section
   * 7): its current leader, falling back to its last leader where the Cell is
   * closed.
   *
   * **The fallback is section 7's, with section 7's reason**: a closed Cell keeps
   * its history and its roster visible to the leader who led it (sections 10 and
   * 15), and resolving through a current leader it no longer has would take that
   * away exactly when the record becomes historical. Migration 0009 makes a CLOSED
   * Cell hold no open leadership, so the fallback is the only thing that answers
   * for one.
   *
   * **What implements the fallback is the absence of a filter, not the ordering** —
   * and two earlier versions of this sentence each credited a sort key. There is no
   * `ended_at IS NULL` here, which is why a closed Cell resolves at all; adding one
   * is the mutation that reddens the closed-Cell case.
   *
   * Of the three keys, `started_at DESC` does the work: leadership is contiguous
   * (migration 0009), so the latest-starting row is the open one on an `ACTIVE` Cell
   * and the last leader on a `CLOSED` one. `ended_at DESC NULLS FIRST` decides only
   * where two rows share a `started_at` — the pair a section 5 correction leaves,
   * closing a row at its own start and opening the right one at the same instant —
   * and picks the one still in force. `id DESC` decides only where both dates match.
   *
   * **The keys are in that order in the SQL, and for two versions they were not.**
   * The query read `ended_at DESC NULLS FIRST` first while this paragraph described
   * `started_at` as primary — no divergence in any state migration 0009 permits, but
   * a paragraph a future reader would reorder keys against, saying the reverse of the
   * query beneath it. Migration 0009's own predecessor query
   * (`assert_leadership_stays_in_network`) uses these three in this order, so the
   * two now agree in the code as well as in the reasoning.
   *
   * On the pool, because the guard runs outside any transaction. A domain check
   * inside one asks `leaderForScopeWithin` instead.
   */
  async leaderForScope(cellId: string): Promise<string | null> {
    return this.leaderForScopeWithin(this.db, cellId);
  }

  /**
   * `CellScopePort`. How a Cell **meeting** is placed in the tree, given its own date
   * (SKILL.md section 7, the closed-Cell exception).
   *
   * Three cases, and only the third differs from `leaderForScope`:
   *
   * - **An ACTIVE Cell** resolves through its current leader, which is section 7's
   *   rule for a write and is unchanged by this method existing. A Cell that has
   *   changed hands therefore refuses its former leader, who files nothing; an upline
   *   or the successor does, and the meeting still *belongs* to the former leader
   *   because section 13 freezes `responsible_leader_id` separately. Scope and
   *   ownership are different questions and section 7 says so in terms.
   * - **A CLOSED Cell whose month has shut** resolves through nobody. Section 7: "once
   *   the window shuts, that too resolves through nobody and only Admin can amend."
   * - **A CLOSED Cell whose month is still open** resolves through whoever led it on
   *   the meeting's date — the exception, and the only dated resolution in the system.
   *
   * **The window is read from the database's clock**, never this process's, which is
   * the commitment decision 0160 made and which `submission-window.ts` keeps for every
   * other boundary comparison. A guard deciding a month boundary from a host clock is
   * the defect that ruling exists to prevent, and it would be invisible on one host.
   *
   * *The window helper moved to `common/time/` for this.* It was in `attendance`, which
   * `cells` cannot import: `attendance` imports `CellsModule`, so the dependency the
   * other way is a cycle (section 2). The move is not a workaround for that — section
   * 20 is the authority for every period boundary in the system and the helper is
   * calendar arithmetic over its rule, so `common/time/` beside `manila.ts` is where it
   * belonged once a second module needed it.
   */
  async leaderForMeetingScope(cellId: string, on: string): Promise<string | null> {
    const cell = await this.cellById(this.db, cellId);
    if (cell === null) {
      return null;
    }

    if (cell.state !== 'CLOSED') {
      return this.leaderForScopeWithin(this.db, cellId);
    }

    if (!(await isMonthOpen(this.db, reportingMonthOf(on)))) {
      return null;
    }

    return this.leaderOnDateWithin(this.db, cellId, on);
  }

  /**
   * The people who were members of this Cell on a given Manila **date**.
   *
   * Section 12: "The roster for a meeting is exactly the people holding an active
   * membership of that Cell on the meeting date." Distinct from `membersOfWithin`
   * above, which answers who is a member *now* and is what a closure has to be decided
   * against; this answers who was one then, and a meeting recorded a week late must
   * get the same answer as one recorded on the night.
   *
   * **Compared as dates rather than as instants, and that is section 13's rule rather
   * than a convenience.** A membership row is in force over `[started_at, ended_at)`
   * and a closure ends every one of them *on* the closure date — so a meeting on that
   * date would fall outside every row and find an empty roster. Section 13: "For a
   * meeting's own lookups, and only those, the closure instant is read as the end of
   * that day", and it requires the leader lookup and this one to move together --
   * "both halves or neither", because extending one alone gives a meeting a
   * responsible leader and nobody to record present.
   *
   * The same comparison decides an ordinary membership that ends on the meeting day,
   * and it counts the person. That is the reading section 12 invites -- "the people
   * who could actually have been there" -- and it is the direction section 13 takes at
   * every other boundary: a person who was in the room is recordable. What it is not
   * is a rule anything states for an *ordinary* ending, so it travels with the
   * creation-day question `CLAUDE.md` records rather than being asserted here.
   */
  /**
   * Who led this Cell on a Manila **date**, or null where nobody did.
   *
   * The leadership half of the pair section 13 requires to move together with
   * `membersAsOfWithin`: "the leader is the one who was leading when the Cell met, and
   * the roster is the people who were members then... Both halves or neither."
   * Extending one alone gives a meeting a responsible leader and nobody to record
   * present, which is worse than refusing it.
   *
   * Distinct from `leaderAsOfWithin`, which takes an instant and is what a write inside
   * a transaction asks. This takes a date, because a meeting is dated rather than
   * timed for the purpose of these lookups, and because a closure ends the leadership
   * row *on* the closure date — so an instant comparison finds nobody for a meeting the
   * Cell held that day.
   *
   * Null is a real answer and section 13 makes it a refusal rather than a default: "a
   * meeting with no responsible leader is a record nothing rolls up." Refusing is this
   * method's caller's job; a read service answers questions.
   *
   * **Where two leadership rows both cover the date, this answers with the earlier-
   * starting one** — the leadership in force when the day began (section 13, decision
   * 0187). That is a handover landing on a meeting's own day, which the date comparison
   * cannot otherwise decide, and which fixes both the meeting's scope and the
   * `responsible_leader_id` its first submission freezes.
   */
  async leaderOnDateWithin(
    executor: Db | Transaction<Database>,
    cellId: string,
    on: string,
  ): Promise<string | null> {
    const row = await executor
      .selectFrom('cell_leaderships')
      .select('person_id')
      .where('cell_id', '=', cellId)
      .where(sql<boolean>`(started_at AT TIME ZONE 'Asia/Manila')::date <= ${on}::date`)
      .where(
        sql<boolean>`(ended_at IS NULL OR (ended_at AT TIME ZONE 'Asia/Manila')::date >= ${on}::date)`,
      )
      // **`started_at` ASC, and this is the one key that differs from
      // `leaderForScopeWithin` above** (decision 0187). That method asks who leads the
      // Cell *now*, so the latest-starting row is the answer. This one asks who was
      // leading when the Cell met, and on a handover day the date comparison matches
      // both the outgoing and the incoming row — so the direction decides which of two
      // people a meeting belongs to.
      //
      // **The outgoing one, because it is the only answer that does not depend on when
      // the record was entered.** Under DESC, a meeting filed before the handover was
      // approved found one row and answered with the outgoing leader, and the same
      // meeting filed an hour later found two and answered with the incoming one — so
      // the attribution was a function of the submission's timing rather than of the
      // meeting. Section 3 makes a past period reproducible and section 13 freezes this
      // value permanently; an answer that moves with the clerk satisfies neither.
      //
      // It is also section 13's own reading of the other boundary, generalised: a
      // closure ends a leadership row *on* the closure date and section 13 reads that
      // instant as the end of the day, which is the outgoing arrangement governing the
      // whole of its final day. A handover is that boundary with a successor.
      //
      // *It was `desc` here until this ruling, inherited from the method above, where
      // it is correct for a different question. An earlier version of this comment
      // stated the inherited choice as the rule: "the later-starting one is the leader
      // the meeting belongs to".*
      //
      // The other two keys are unchanged and carry the meanings `leaderForScopeWithin`
      // gives them: `ended_at DESC NULLS FIRST` decides the pair a section 5 correction
      // leaves — one row closed at its own start, the right one opened at the same
      // instant — and takes the one still in force, which is right under either
      // direction of the first key. `id DESC` decides only where both timestamps match
      // exactly, which is two rows nothing can tell apart, and its direction is
      // arbitrary; it is left as it is so the two methods' last key is the same.
      .orderBy('started_at', 'asc')
      .orderBy('ended_at', (ob) => ob.desc().nullsFirst())
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row?.person_id ?? null;
  }

  async membersAsOfWithin(
    executor: Db | Transaction<Database>,
    cellId: string,
    on: string,
  ): Promise<{ personId: string; memberId: string; firstName: string; lastName: string }[]> {
    const rows = await executor
      .selectFrom('cell_memberships')
      .innerJoin('persons', 'persons.id', 'cell_memberships.person_id')
      .select([
        'cell_memberships.person_id as person_id',
        'persons.member_id as member_id',
        'persons.first_name as first_name',
        'persons.last_name as last_name',
      ])
      .where('cell_memberships.cell_id', '=', cellId)
      .where(
        sql<boolean>`(cell_memberships.started_at AT TIME ZONE 'Asia/Manila')::date <= ${on}::date`,
      )
      .where(
        sql<boolean>`(cell_memberships.ended_at IS NULL
                      OR (cell_memberships.ended_at AT TIME ZONE 'Asia/Manila')::date >= ${on}::date)`,
      )
      // Section 22's roster order, the same key `GET /cells/{id}/members` pages by.
      .orderBy('persons.last_name')
      .orderBy('persons.first_name')
      .orderBy('persons.member_id')
      .execute();

    return rows.map((row) => ({
      personId: row.person_id,
      memberId: row.member_id,
      firstName: row.first_name,
      lastName: row.last_name,
    }));
  }

  /**
   * A Cell's identity and lifecycle, or null where no such Cell exists.
   *
   * **For a caller in another module** (SKILL.md section 2): `cells` owns the table,
   * so `attendance` asks this rather than selecting from `cells` itself. It returns
   * the handle a person recognises alongside the UUID, because a response naming a
   * Cell names it as `CELL-000000` (section 10) while every path and foreign key uses
   * the UUID.
   *
   * `state` and `closed_at` come with it because section 13's rules about recording
   * against a closed Cell are stated in terms of both: a closed Cell still takes a
   * record for a meeting it held until that month's window shuts, and a meeting dated
   * after the closure is refused. The caller that needs those is the one that records;
   * the listing uses the identity alone, and taking one query rather than two is why
   * they are returned together.
   *
   * No scope check. Section 7 resolves `cell.take_attendance` and the other
   * Cell-targeted capabilities against the Cell in the guard, so a caller reaching a
   * service method has already been placed; a second check here would be the guard's
   * decision made twice, in the layer decision 0062 assigns the rest of the work to.
   */
  async cellById(
    executor: Db | Transaction<Database>,
    cellId: string,
  ): Promise<{ id: string; cellId: string; state: string; closedAt: Date | null } | null> {
    const row = await executor
      .selectFrom('cells')
      .select(['id', 'cell_id', 'state', 'closed_at'])
      .where('id', '=', cellId)
      .executeTakeFirst();

    return row
      ? { id: row.id, cellId: row.cell_id, state: row.state, closedAt: row.closed_at }
      : null;
  }

  async leaderForScopeWithin(
    executor: Db | Transaction<Database>,
    cellId: string,
  ): Promise<string | null> {
    const row = await executor
      .selectFrom('cell_leaderships')
      .select('person_id')
      .where('cell_id', '=', cellId)
      .orderBy('started_at', 'desc')
      .orderBy('ended_at', (ob) => ob.desc().nullsFirst())
      .orderBy('id', 'desc')
      .executeTakeFirst();

    return row?.person_id ?? null;
  }

  /**
   * A Cell's current members, which is the list a closure has to be decided against
   * (SKILL.md section 10, *What closing does*).
   *
   * Section 10 requires the members to be "presented at the point of closure" and the
   * closure endpoint refuses any decision list that is not exactly this one, so
   * without a route serving it the closure is unusable by any client. That is why it
   * arrives here rather than with the rest of the read surface.
   *
   * **It discloses an association section 8 protects in a *search*, and section 8 now
   * says why that is right rather than an exception.** A first version of this
   * docblock argued that names and Member IDs are published church-wide "so nothing
   * here exceeds what a directory search already shows". That was false in the half
   * that mattered: the names are publishable and the *association* between them and
   * this Cell is on section 8's forbidden list. What reconciles them is direction — a
   * search starts from a person and this starts from a Cell, and everyone who can read
   * this roster is somebody section 10 authorizes to change it.
   *
   * The rest of section 8's list is not here: no birthday, no contact detail, no
   * attendance, no classification. Names because a closure screen listing UUIDs would
   * be asking a leader to make a pastoral decision about rows they cannot recognise.
   */
  async membersOfWithin(
    executor: Db | Transaction<Database>,
    cellId: string,
    page: { limit: number; after?: RosterCursor | null } = { limit: 50 },
  ): Promise<
    {
      person_id: string;
      member_id: string;
      full_name: string;
      // The other two ordering keys travel with the row so the caller can build the
      // next cursor from what it was given, rather than looking them up again — which
      // is the lookup that made the first version unrunnable (`roster-cursor.ts`).
      last_name: string;
      first_name: string;
      started_at: Date;
    }[]
  > {
    const after = page.after ?? null;

    const rows = await executor
      .selectFrom('cell_memberships')
      .innerJoin('persons', 'persons.id', 'cell_memberships.person_id')
      .select([
        'cell_memberships.person_id as person_id',
        'persons.member_id as member_id',
        'persons.first_name as first_name',
        'persons.middle_name as middle_name',
        'persons.last_name as last_name',
        'cell_memberships.started_at as started_at',
      ])
      .where('cell_memberships.cell_id', '=', cellId)
      .where('cell_memberships.ended_at', 'is', null)
      // Ordered so two identical requests answer identically. Member ID is total and
      // encodes nothing (section 3), which is what makes it a safe tie-break.
      //
      // **The keyset is spelled out rather than expressed as a row comparison against a
      // looked-up key.** The looked-up form is what a first version wrote, and it did
      // not run at all: a row constructor compared against a single-column subquery is
      // `subquery has too few columns`, refused at analysis before any row is read, so
      // every request following a cursor was a 500. `roster-cursor.ts` records why the
      // key travels in the cursor instead. A keyset rather than an offset, which
      // section 22 forbids for the reason it gives: a member added mid-paging would
      // shift every subsequent page by one.
      .$if(after !== null, (query) =>
        query.where((eb) => {
          const key = after as RosterCursor;

          return eb.or([
            eb('persons.last_name', '>', key.lastName),
            eb.and([
              eb('persons.last_name', '=', key.lastName),
              eb('persons.first_name', '>', key.firstName),
            ]),
            eb.and([
              eb('persons.last_name', '=', key.lastName),
              eb('persons.first_name', '=', key.firstName),
              eb('persons.member_id', '>', key.memberId),
            ]),
          ]);
        }),
      )
      .orderBy('persons.last_name')
      .orderBy('persons.first_name')
      .orderBy('persons.member_id')
      .limit(page.limit)
      .execute();

    return rows.map((row) => ({
      person_id: row.person_id,
      member_id: row.member_id,
      full_name: [row.first_name, row.middle_name, row.last_name]
        .filter((part): part is string => part !== null && part !== '')
        .join(' '),
      last_name: row.last_name,
      first_name: row.first_name,
      started_at: row.started_at,
    }));
  }

  /**
   * Pending Cell leadership requests, oldest first (SKILL.md section 19, *Admin
   * dashboard*; section 10).
   *
   * **Both kinds, on one queue**, which section 19 states and gives the reason for: "a
   * request nobody can see is a request nobody acts on, and a pending one changes
   * nothing until it is decided". A new Cell additionally holds up an account (section
   * 6), which a handover does only where the incoming leader does not already lead one
   * — a difference in urgency rather than in whether it belongs here.
   *
   * **`PENDING` only.** Section 19 asks for the queue, and a decided request is not on
   * it. The decided ones are the requester's own outstanding work in section 19's other
   * list, which is a different surface with a different reader and no capability that
   * can guard it today — recorded as open in `CLAUDE.md` rather than answered here.
   *
   * No scope filter, and that is the capability rather than an omission:
   * `cell.approve_leadership` is Admin's alone at Whole Church (section 7), so every
   * caller who reaches this sees the same queue.
   */
  async pendingLeadershipRequestsWithin(
    executor: Db | Transaction<Database>,
    page: { limit: number; after?: LeadershipRequestCursor | null } = { limit: 50 },
  ): Promise<LeadershipRequestRow[]> {
    const after = page.after ?? null;

    return (
      executor
        .selectFrom('cell_leadership_requests')
        .select([
          'id',
          'kind',
          'prospective_leader_id',
          'requested_by',
          'requested_at',
          'cell_id',
          // **The ordering key at the column's own precision**, which the `Date` beside
          // it is not: `timestamptz` holds microseconds and the driver parses it into a
          // JS `Date`, which holds milliseconds. A cursor built from
          // `requested_at.toISOString()` is therefore *earlier* than the row it came
          // from, so `requested_at > cursor` matches that row again and the page repeats
          // its last row instead of advancing. Found by the paging case rather than
          // reasoned about.
          //
          // **`to_char` with an explicit format rather than a cast to `text`**, because
          // a cast renders according to the session's `DateStyle`, which nothing in this
          // repository sets and which the deployment controls — this machine's server
          // already runs `ISO, DMY` rather than the default `ISO, MDY`. Under `SQL`,
          // `Postgres` or `German` every cursor the server emits fails the decoder's
          // format check on the way back in, so the client is silently served page one
          // for ever. `to_char` is `DateStyle`-independent, and ISO 8601 input parses
          // back the same way under any of them because it is unambiguous.
          sql<string>`to_char(requested_at at time zone 'UTC', ${sql.lit(CURSOR_INSTANT_FORMAT)})`.as(
            'requested_at_key',
          ),
        ])
        .where('state', '=', 'PENDING')
        // Spelled out rather than expressed as a row comparison against a looked-up key,
        // for the reason `leadership-request-cursor.ts` records: the looked-up form does
        // not compile to anything PostgreSQL can plan.
        .$if(after !== null, (query) =>
          query.where((eb) => {
            const key = after as LeadershipRequestCursor;

            // Cast on the parameter rather than converting in JavaScript, so the
            // comparison happens at the column's own precision.
            const at = sql<Date>`${key.requestedAt}::timestamptz`;

            return eb.or([
              eb('requested_at', '>', at),
              eb.and([eb('requested_at', '=', at), eb('id', '>', key.id)]),
            ]);
          }),
        )
        .orderBy('requested_at')
        .orderBy('id')
        .limit(page.limit)
        .execute()
    );
  }

  /**
   * The Cell's leader **as of an instant**, which is a different question from
   * `leaderForScopeWithin` above and must not be answered by it.
   *
   * That one answers *who may act on this Cell now* — the current leader, falling back
   * to the last where the Cell is closed. This answers *who led it then*: the
   * assignment row covering the instant, which is the predicate
   * `assert_membership_same_network` uses.
   *
   * **Section 7 says "as of the period being viewed", and an earlier version of this
   * paragraph paraphrased that as "ignoring dates entirely", which is the opposite.**
   * The fallback to the last leader is scoped to a *closed* Cell rather than being a
   * general licence. What settles which of the two a write uses is section 7 as
   * amended for a backdated write: authority is decided as of now, because the actor
   * is acting now — otherwise a leader whose Cell was handed away yesterday could
   * reclaim authority over it by dating the action far enough back. The relationship
   * being recorded is decided as of its own effective date, because that is the
   * period it describes.
   *
   * **The two coincide for every membership written at `clock_timestamp()` and part
   * company the moment one is backdated**, which is how a closure reached a raw
   * `check_violation`. A closure backdated to February that disperses a member into a
   * Cell created in August has a destination with no leader in February; the scope
   * rule answers with the current leader, the trigger finds no row, and the caller
   * gets `INTERNAL_ERROR` at COMMIT instead of an answer. `CellsMembershipService`
   * records that these two rules agree "in every state migration 0009 permits" and
   * that keeping them agreeing is something to watch rather than something the code
   * guarantees — a backdated closure is the state where they stop.
   *
   * Returns null where the Cell had no leader then, including where it did not exist.
   * A caller comparing Networks owes an answer for that rather than letting the
   * deferred trigger raise.
   *
   * **Only that null answer is observable today, and it is stated here rather than
   * left for somebody to find by deleting the date filter.** Which row is selected
   * cannot change a Network comparison, because `cell_leaderships_stay_in_network`
   * makes every leader a Cell ever has belong to one Network — so a case pinning the
   * *selection* would pass against a method that ignored dates, and one was written
   * before this was noticed. The filter is written correctly anyway, on the same
   * reasoning `isCurrentCellLeaderWithin` gives below: the rule that makes the two
   * agree is a constraint trigger, and `pg_restore --disable-triggers` skips one.
   *
   * The closure's audit entry for the ended leadership uses this too, and there the
   * answer is provably the open row: the floor's second term puts every *closed*
   * leadership `ended_at` at or below the effective date, so no earlier stint can be
   * covering it.
   */
  async leaderAsOfWithin(
    executor: Db | Transaction<Database>,
    cellId: string,
    at: Date,
  ): Promise<string | null> {
    const row = await executor
      .selectFrom('cell_leaderships')
      .select('person_id')
      .where('cell_id', '=', cellId)
      .where('started_at', '<=', at)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', at)]))
      // **Ordered, and with a real tie-break rather than the one word.** Leadership
      // periods are a contiguous non-overlapping chain, so at most one row covers any
      // instant — but contiguity is a **trigger**, and `pg_restore --disable-triggers`
      // skips a trigger. In exactly that state two rows can share a `started_at`: the
      // pair a section 5 correction leaves. So `started_at DESC` alone chooses
      // arbitrarily there, which a first version of this comment called a tie-break
      // while having none. These are the three keys `leaderForScopeWithin` above
      // documents at length and settles on; `assert_membership_same_network` carries
      // only the first, which is a narrower guarantee than this needs rather than a
      // reason to match it.
      .orderBy('started_at', 'desc')
      .orderBy('ended_at', (ob) => ob.desc().nullsFirst())
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row?.person_id ?? null;
  }

  /**
   * `CellRelationshipsPort`. Every Cell this person currently leads — every open
   * leadership row, whatever state its Cell is in
   * (SKILL.md section 4, section 11).
   *
   * **For the Network-change precondition in `networks`**, which refuses a change
   * while the person leads a Cell. `networks` cannot read these tables (section 2)
   * and cannot import this module without closing a cycle, so it declares a port and
   * this implements it.
   *
   * **No `ACTIVE` filter, and the first version had one on a reason that pointed the
   * wrong way.** It cited `isCurrentCellLeaderWithin`'s restore argument —
   * `pg_restore --disable-triggers` skips the trigger keeping `cells.state` and these
   * rows in step. There the join **withholds** a qualification and so fails closed: a
   * leader whose Cell is closed is refused an account. Here it would **remove a
   * blocker**: an open leadership on a CLOSED Cell would be filtered out and the
   * Network change would proceed. The same argument, the opposite consequence.
   *
   * So this asks only what section 4 needs — does an open leadership row exist —
   * and blocks on it whatever state the Cell is in. Unreachable through any operation,
   * because migration 0009 refuses that pair from both sides.
   *
   * **In the restore state where it is reachable, blocking is safe but not free**, and
   * saying only "safe" understates it. The refusal tells the administrator to hand the
   * Cell over or close it, and both refuse a CLOSED Cell — so that person's Network
   * change is performable by no route until the data is repaired. Fail-closed is still
   * right, because section 4 states the rule absolutely and a corrupted restore is a
   * repair situation rather than an operating one; what is not right is a paragraph
   * that implies the remedy still works.
   *
   * Ordered by Cell ID so a refusal naming several Cells names them the same way
   * twice, which a client rendering the list depends on.
   */
  async openLeadershipsOf(
    executor: Db | Transaction<Database>,
    personId: string,
  ): Promise<NamedCell[]> {
    const rows = await executor
      .selectFrom('cell_leaderships')
      .innerJoin('cells', 'cells.id', 'cell_leaderships.cell_id')
      .select(['cells.id as id', 'cells.cell_id as cell_id'])
      .where('cell_leaderships.person_id', '=', personId)
      .where('cell_leaderships.ended_at', 'is', null)
      .orderBy('cells.cell_id')
      .execute();

    return rows.map((row) => ({ id: row.id, cellId: row.cell_id }));
  }

  /**
   * `CellRelationshipsPort`. The Cell this person currently belongs to, or null.
   *
   * Section 10 gives a person at most one active membership, enforced by a partial
   * unique index over the person — so this returns one row rather than a list, and
   * the index is what makes that safe rather than an assumption.
   *
   * **No `ACTIVE` filter, matching the leaderships above, because the schema is
   * symmetric.** An earlier version of this said the asymmetry between the two
   * queries was the schema's; it was not, and there is no asymmetry now.
   * `assert_cell_memberships_match_state` refuses a CLOSED Cell holding an open
   * membership, fired from both tables, exactly as the leadership rule is — and
   * section 10's *What closing does* ends leadership and memberships in the same
   * list. The two facts are identical and neither query filters on them.
   *
   * The join is here for the Cell's handle rather than as a filter.
   */
  async openMembershipOf(
    executor: Db | Transaction<Database>,
    personId: string,
  ): Promise<NamedCell | null> {
    const row = await executor
      .selectFrom('cell_memberships')
      .innerJoin('cells', 'cells.id', 'cell_memberships.cell_id')
      .select(['cells.id as id', 'cells.cell_id as cell_id'])
      .where('cell_memberships.person_id', '=', personId)
      .where('cell_memberships.ended_at', 'is', null)
      .executeTakeFirst();

    return row ? { id: row.id, cellId: row.cell_id } : null;
  }

  /**
   * `CellRelationshipsPort`. How far back a Network correction for this person may be
   * dated, as far as their closed Cell relationships are concerned
   * (SKILL.md section 4, the floor's two Cell terms).
   *
   * The port's docblock carries why each half takes the shape it takes. What is worth
   * saying at the query is why the membership half is a join rather than a column.
   *
   * **A membership is compared at more than one instant, and the first version of this
   * method assumed it was compared at exactly one.** `assert_membership_same_network`
   * reads it at its own `started_at`; `assert_leadership_stays_in_network` reads the
   * member's Network again, at the *incoming leadership row's* `started_at`, for every
   * membership open at that instant. So a membership that spanned a handover was
   * compared at that handover too, and a correction dated after the join but before the
   * handover falsifies that comparison while clearing a `started_at` bound.
   *
   * That was reproduced against the schema before this shape was written: the four-row
   * correction commits, and at the handover instant the member resolves to one Network
   * while the leader resolves to the other — the state that trigger's own message exists
   * to refuse.
   *
   * So the term is the latest instant at which the membership was ever compared: its own
   * start, or the last leadership start it spans. The predicate is the member scan's own
   * selection read backwards — it takes `cm.started_at <= H` and `cm.ended_at > H`, so
   * this takes leadership starts in `[cm.started_at, cm.ended_at)`.
   *
   * **Every leadership row in that window ran the scan**, including ones since closed, so
   * the join is exact rather than conservative. What guarantees that is the trigger's
   * *state at commit* rather than the shape of the write, and saying it the other way
   * round is wrong in a way that matters:
   * `assert_leadership_stays_in_network` is deferred and returns early only where the row
   * stands closed at COMMIT.
   *
   * `cell_leadership_is_opened_open` is a narrower guarantee than it looks — it refuses an
   * INSERT carrying an `ended_at`, and a write that *changes* an already-set `ended_at`,
   * which leaves the ordinary null-to-value close permitted and does not refuse
   * insert-open-then-close inside one transaction. (`cell_leaderships_period_ordered`
   * being `>=` is what makes the *zero-length* variant of that representable; the
   * later-instant variant needs no help from it.) No operation this specification
   * defines writes one:
   * approval leaves the incoming row open, closure only closes, direct creation only
   * opens. If anything ever did, this term would over-refuse rather than under-refuse.
   *
   * **`GREATEST` ignores nulls in PostgreSQL and is null only when every argument is**,
   * which is section 4's "each term is a maximum over rows that may be empty, and an
   * empty term contributes nothing". It is what lets the inner subquery return null for a
   * membership that spanned no handover and still yield that membership's own start. Raw
   * SQL for that reason — the same null-handling `HierarchyService.backdateFloorFor` needs
   * — and the pastoral terms are combined by the caller rather than here, because
   * `pastoral_assignments` is not this module's to read.
   *
   * **The window's lower bound is inclusive and nothing can fail against it.** A
   * leadership starting at the exact instant a membership starts needs two identical
   * `clock_timestamp()` reads, which no operation produces — so `>=` against `>` is
   * green, and it is declared here rather than pinned by a fixture that could not arise.
   * Inclusive is still the correct reading of the member scan, which takes
   * `cm.started_at <= v_row.started_at`.
   *
   * **Both halves are restricted to closed rows, and the two filters are not alike.**
   * `cl.ended_at IS NOT NULL` on the leadership half is a no-op, since `max` ignores
   * nulls; it is written for the reader. `cm.ended_at IS NOT NULL` on the membership half
   * decides rows, and nothing can fail against it, because an open membership refuses the
   * correction outright upstream (section 4). Both are stated rather than left for
   * somebody to delete and find the suite still green.
   */
  async closedRelationshipFloorOf(
    executor: Transaction<Database>,
    personId: string,
  ): Promise<Date | null> {
    const result = await sql<{ floor: Date | null }>`
      SELECT GREATEST(
        (SELECT max(cl.ended_at)
           FROM cell_leaderships cl
          WHERE cl.person_id = ${personId}::uuid
            AND cl.ended_at IS NOT NULL),
        (SELECT max(GREATEST(
                  cm.started_at,
                  (SELECT max(spanned.started_at)
                     FROM cell_leaderships spanned
                    WHERE spanned.cell_id = cm.cell_id
                      AND spanned.started_at >= cm.started_at
                      AND spanned.started_at < cm.ended_at)))
           FROM cell_memberships cm
          WHERE cm.person_id = ${personId}::uuid
            AND cm.ended_at IS NOT NULL)
      ) AS floor
    `.execute(executor);

    return result.rows[0]?.floor ?? null;
  }

  /**
   * Whether this Person is a current Cell Leader (SKILL.md section 11).
   *
   * **Both halves, and the second cannot be shown to matter — which is stated here
   * rather than left for somebody to discover by deleting it.** Section 11 defines
   * the qualification as an active leadership assignment *on an `ACTIVE` Cell*, so
   * the join follows the section. But migration 0009 refuses a CLOSED Cell that
   * still holds an open assignment, so the state where the two disagree is
   * unreachable through any operation: no test can redden against dropping the
   * `cells.state` filter, and a first attempt at one pinned neither half, because
   * closing a Cell ends its leadership and either condition then sufficed alone.
   *
   * It is kept for a reason that survives being unfalsifiable. The rule making the
   * two agree is a **constraint trigger**, and `pg_restore --disable-triggers`
   * skips one — the argument this repository has already made twice, for the Senior
   * Pastor slot and the Network root seat. After a restore the two can disagree,
   * and this join is what would refuse an account for a leader whose Cell is
   * closed. Writing the conjunction section 11 states costs one line and does not
   * depend on a trigger having run.
   *
   * The open-assignment half **is** pinned, by a handover: the Cell stays `ACTIVE`
   * and the outgoing assignment closes, which is the state that separates them.
   *
   * Takes an executor rather than fixing one, the pattern `HierarchyService` and
   * `SettingsService` use: provisioning asks inside its own transaction, where a
   * pooled read would answer from the state the request arrived with and would ask
   * a bounded pool for a second connection (section 24).
   */
  async isCurrentCellLeaderWithin(
    executor: Db | Transaction<Database>,
    personId: string,
  ): Promise<boolean> {
    const row = await executor
      .selectFrom('cell_leaderships')
      .innerJoin('cells', 'cells.id', 'cell_leaderships.cell_id')
      .select('cell_leaderships.id')
      .where('cell_leaderships.person_id', '=', personId)
      .where('cell_leaderships.ended_at', 'is', null)
      .where('cells.state', '=', 'ACTIVE')
      .executeTakeFirst();

    return row !== undefined;
  }
}
