import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { type CellScopePort } from '../auth/authorization/cell-scope.port';
import { DATABASE, type Db } from '../database/database.module';
import { type CellRelationshipsPort, type NamedCell } from '../networks/cell-relationships.port';

import { CURSOR_INSTANT_FORMAT } from './leadership-request-cursor';

import type { LeadershipRequestCursor, LeadershipRequestRow } from './leadership-request-cursor';
import type { RosterCursor } from '../common/roster-cursor';
import type { CellCategory, Database } from '../database/schema';
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
   * `leaderForScope`'s dated case: the leader in force at `at`, falling back to the
   * Cell's last leader where nobody held it then (decision 0220).
   *
   * **Two reads rather than one query with an `OR`, and deliberately.** The fallback is
   * a *different question* — "who led this Cell last" rather than "who led it at this
   * instant" — and the two answered in one statement would need a synthetic ordering key
   * that makes the in-force row win, which is a third rule nobody stated. Written as a
   * coalesce, each half is the method that already answers its own question and the
   * ordering between them is the ruling rather than a `CASE` expression.
   *
   * **The fallback is not reached by a handover**, which is the property worth stating
   * because it is what makes the ruling narrow: at any instant while the Cell was
   * running, `leaderAsOfWithin` finds somebody, so each past period resolves to whoever
   * held it then and the second read never runs.
   *
   * On the pool, for the reason `leaderForScope` gives: the guard runs outside any
   * transaction.
   */
  async leaderForScopeAsOf(cellId: string, at: Date): Promise<string | null> {
    const inForce = await this.leaderAsOfWithin(this.db, cellId, at);

    return inForce ?? (await this.leaderForScopeWithin(this.db, cellId));
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
   * The dates one Cell is scheduled to meet in one reporting month.
   *
   * **Here because Section 2 puts it here, by name.** That section assigns "`cells` the
   * Cell coverage denominator, whose every input (`cell_schedules`, `cells`,
   * `cell_leaderships`) it owns", and records that an earlier version of itself had
   * directed `attendance` at those same three tables — "the rule this paragraph exists to
   * uphold, broken inside it". This query was the code's instance of that: it ran in
   * `attendance`, joining `cell_schedules` from a statement rooted in `generate_series`,
   * so it qualified for neither Section 2's ownership rule nor its single exemption, which
   * covers "a read joined onto a query rooted in a table the reading module owns" and says
   * "nothing else qualifies today". Its own file's docblock said the module read `cells`'
   * tables "through `CellsReadService` and never directly", which the query refuted.
   *
   * **The scheduled set is derived and never stored** (Section 13, decision 0162): a
   * meeting has no row until it is reported, so the count a coverage line is read against
   * has to come from the schedule run against the calendar. That is what makes
   * `recorded out of scheduled` two figures arrived at two ways rather than one figure
   * compared with itself.
   *
   * **Both ends of the in-force comparison are Manila dates** (ruling of 2026-09-01), which
   * Section 13 requires at the closing edge — a meeting compared as an instant falls
   * outside every row, finds an empty roster and becomes unrecordable though the Cell held
   * it — and which the opening edge takes too, because a bound granular one way at one end
   * and the other way at the other is two rules wearing one name.
   *
   * **Section 10 stores `day_of_week` as an ISO day number** "because every use of it is
   * arithmetic against a calendar", and this is that use: `EXTRACT(ISODOW ...)` against the
   * generated series is the comparison Section 10 names. Section 20 names the zone for every
   * period boundary, and `date_trunc('week')` is ISO and therefore Monday-based, which is the
   * same authority.
   *
   * **Within a month the in-force comparison decides nothing**, because Section 10 makes a
   * schedule change take effect at the start of a month. The cases it does decide are the
   * partial months Section 12 names, where the row opens at approval or ends at a closure
   * part-way through.
   *
   * At the closing edge that is Section 13's rule rather than a convenience: a closure ends
   * the schedule row *on* the closure date, and a meeting dated that day "reads the Cell as it
   * stood that day", so an instant comparison would drop a meeting the Cell actually held. At
   * the opening edge the same comparison admits a meeting on the approval date itself, which
   * Section 10 does not address. *That edge is recorded as a question rather than defended: it
   * is the reading that loses no meeting a leader believes they held, and the opposite reading
   * would refuse a record for a meeting that happened.*
   *
   * **This derivation gates three Stage 4 surfaces**, so a change to it re-values what is
   * already recorded: the meetings listing, the meeting roster and the submit transaction
   * each refuse a date this does not derive. A `cell_meetings` row written on a boundary
   * day the old derivation produced and this one does not becomes unreachable — invisible
   * in the listing and `404` on the roster — while `recordedCountsIn` counts rows by
   * `reporting_month` and would then publish `recorded` above `scheduled`. Not reachable
   * on a fresh database, and named because section 20 asks that a total for a reported
   * period not move and nothing in the gate set would see this one.
   *
   * **Exactly one schedule row governs a day, and the weekday is tested against that
   * one.** Section 10: a schedule change takes effect at the start of the following month,
   * so "a month therefore has exactly one schedule throughout". Testing the weekday inside
   * the join instead let *any* covering row match, and a schedule change writes
   * `old.ended_at = effectiveFrom` and `new.started_at = effectiveFrom` while both date
   * comparisons here are inclusive — so both rows cover the boundary day and the month
   * derived meetings from two schedules at once.
   *
   * *Two shapes of that, and the first fix closed only one.* A **time-only** change put
   * the same day in twice, which a `DISTINCT ON (day)` removed. A **day-of-week** change
   * put in two different days — the outgoing row's weekday on the boundary day plus every
   * day of the incoming row's — which no deduplication reaches: Thursday to Friday
   * effective on a Thursday derived six meetings in a month holding five Fridays.
   * `architecture-guardian` reproduced both, the second against the docblock that had just
   * claimed the class was closed.
   *
   * **A zero-length row is excluded rather than preferred against.** Section 5 makes such
   * a row inert — no instant resolves to one — and both `changeSchedule` and a closure
   * write them deliberately: a second schedule change inside one month closes the pending
   * row at its own `started_at`, and `endConfigurationWithin` does the same with
   * `GREATEST`. Because the comparisons are on dates, such a row still *covered its own
   * day*, so a Cell closed in September derived a scheduled meeting in October and read
   * `0 of 1` for a month it could not have met in — the artefact Section 13 exists to keep
   * honest, arriving from the other side.
   *
   * **The closure boundary is untouched, with one case named rather than glossed.**
   * Section 13 needs a meeting dated on the closure date to be derivable, and at a closure
   * the surviving row is the one that ended that day, so it is the governing row and its
   * weekday decides; the `>=` delivers that and is unchanged. The exception is a closure
   * effective at exactly the instant the Cell's only schedule row started —
   * `endConfigurationWithin` writes `GREATEST`, so that row is zero-length and the inert
   * filter drops it, losing the closure-date meeting. It needs a Cell created at exactly
   * 00:00 Manila, because the closure floor is the latest leadership start and an
   * effective date is a Manila midnight. Reproduced by `architecture-guardian` and left
   * standing: excluding inert rows is what section 5 says an inert row means, and the
   * alternative is a carve-out for one instant.
   *
   * **A Cell with no schedule row in force over any day of the month yields no rows.** What a
   * coverage line then reads is **not decided here and is recorded as open in `CLAUDE.md`**.
   * *An earlier version of this docblock said "and therefore no coverage denominator for that
   * month (Section 12)", which Section 12 does not state and comes close to contradicting: it
   * requires "the coverage line alone and no buckets" where N is zero, and Section 5 names
   * `0 of 0` as a real state whose loss it treats as harm. A rule about a zero denominator
   * living in a docblock is the shape `CLAUDE.md` records against this project.*
   */
  async scheduledMeetingsIn(
    executor: Db | Transaction<Database>,
    cellId: string,
    reportingMonth: string,
  ): Promise<{ scheduledDate: string; scheduledTime: string; weekStarting: string }[]> {
    const result = await sql<{
      scheduled_date: string;
      scheduled_time: string;
      week_starting: string;
    }>`
      SELECT to_char(day, 'YYYY-MM-DD')                        AS scheduled_date,
             to_char(governing.time_of_day, 'HH24:MI')         AS scheduled_time,
             -- Section 20: a calendar week begins on Monday. date_trunc('week') is
             -- ISO and therefore Monday-based, which is the same authority
             -- day_of_week is stored under.
             to_char(date_trunc('week', day), 'YYYY-MM-DD')    AS week_starting
        FROM generate_series(
               ${reportingMonth}::date,
               (${reportingMonth}::date + interval '1 month' - interval '1 day')::date,
               interval '1 day'
             ) AS day
        -- **One schedule governs a day, and the weekday is tested against that one.**
        -- Section 10: "A month therefore has exactly one schedule throughout." Testing
        -- the weekday inside the join instead let *any* covering row match, so a
        -- Thursday-to-Friday change effective on a Thursday derived that Thursday from
        -- the outgoing row and every Friday from the incoming one.
        CROSS JOIN LATERAL (
          SELECT schedule.day_of_week, schedule.time_of_day
            FROM cell_schedules AS schedule
           WHERE schedule.cell_id = ${cellId}::uuid
             -- A zero-length row is inert: Section 5 says no instant resolves to one,
             -- and both changeSchedule and a closure write them deliberately.
             AND schedule.ended_at IS DISTINCT FROM schedule.started_at
             AND (schedule.started_at AT TIME ZONE 'Asia/Manila')::date <= day
             AND (schedule.ended_at IS NULL
                  OR (schedule.ended_at AT TIME ZONE 'Asia/Manila')::date >= day)
           -- The three keys leaderForScope uses, for the reason it gives: the
           -- latest-starting row is the one in force, ended_at DESC NULLS FIRST decides
           -- a shared start in favour of the row still open, and the id makes the
           -- answer total.
           ORDER BY schedule.started_at DESC,
                    schedule.ended_at DESC NULLS FIRST,
                    schedule.id DESC
           LIMIT 1
        ) AS governing
       WHERE EXTRACT(ISODOW FROM day) = governing.day_of_week
       ORDER BY day
    `.execute(executor);

    return result.rows.map((row) => ({
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      weekStarting: row.week_starting,
    }));
  }

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
   * **Where two leadership rows both cover the date, this answers with the earliest-
   * starting one** (section 13, decision 0187). That is a handover landing on a meeting's
   * own day, which the date comparison cannot otherwise decide, and which fixes both the
   * meeting's scope and the `responsible_leader_id` its first submission freezes.
   *
   * *"Earliest-starting covering row", not "in force when the day began", and the ruling's
   * first version used the second as a gloss. A row is in force over `[started_at,
   * ended_at)`, so a handover at exactly 00:00 leaves the outgoing row covering none of
   * the day while its `ended_at` still falls on that date — and this gives that meeting to
   * the outgoing leader where the gloss would not. Unreachable: a handover takes the
   * instant it is approved, and the only midnight boundary anything writes is a backdated
   * closure, which opens no successor. Section 13 names it for whoever builds a backdated
   * handover.*
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
      // {@link leaderForScopeWithin}** (decision 0187). That method asks who leads the
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
      // **The closure boundary is not a second argument, though the ruling's first
      // version offered it as one.** A closure ends a leadership row with no successor,
      // so the outgoing arrangement governs that day because nothing else could — which
      // decides nothing about a boundary that has two candidates. Section 13 states that
      // rule as "the leader is the one who was leading when the Cell met", which is the
      // sentence a reader would reach for to refute this one.
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

  /**
   * One page of the `ACTIVE` Cells whose current leader is one of these people
   * (SKILL.md sections 10 and 22; decision 0226).
   *
   * **The leader set is the caller's, and this method authorizes nothing.** Section 7
   * decides who is in scope and `AuthorizationService.scopeMembership` enumerates them;
   * a read service answers questions. `null` means no narrowing at all, which is what a
   * Whole Church grant reaches — and it is a distinct argument from an empty array,
   * which is a caller in scope for nobody and must list nothing. Collapsing the two is
   * the one mistake here that publishes the church.
   *
   * **`ACTIVE` only, and decision 0226 says in terms that it does not settle this.**
   * Section 7's base bullet keeps a closed Cell visible to the leader who led it, while
   * its closed-Cell clause says every write against one resolves through nobody; that
   * tension is recorded as open in `CLAUDE.md` and predates this route. `ACTIVE` is the
   * conservative arm: Section 10 says "every other count of Cells means active Cells",
   * so a listing that means the other thing is the one that would need the ruling. What
   * this costs is named rather than hidden — a Cell closed mid-month holds real recorded
   * attendance for that month and does not appear here, so the index is not the surface
   * that reaches it.
   *
   * **A row that is in force is not the same as a row that is open**, and the leadership join
   * uses the second. **Decision 0231 reverses that**: under section 7 this join resolves at
   * the period's instant like the other two, and it has not been changed yet. Migration 0009 gives an `ACTIVE` Cell exactly one
   * open leadership row, and both leadership writers open at or before now — a handover
   * takes the instant it is approved — so open and current coincide there.
   *
   * **A schedule does not, and a category is joined on the instant for a different
   * reason.** `changeSchedule` writes the replacement open with a **future** start,
   * because section 10 makes a schedule change take effect at the start of the following
   * month; that is the state where the open row is the pending one. `changeCategory` opens
   * at the instant it is made, so its open row *is* in force — it is joined the same way
   * for consistency and because nothing guarantees a future-dated category can never be
   * written. *A first version of this paragraph named the two together and gave the
   * schedule's mechanism for both, in the sentence that decides which join may keep
   * `ended_at is null`.*
   * That is why this needs none of `leaderForScope`'s ordering — the fallback that
   * method implements exists for a closed Cell, and there are none here.
   *
   * **Keyset on `cell_id`, which is total, immutable and meaningless.** Section 10 makes
   * a Cell ID encode nothing, so ordering by it ranks nobody — and Section 13 forbids
   * ordering this list by coverage, which is the ordering a reader would otherwise
   * reach for. It is a single-column key because `cell_id` is unique, so the cursor
   * needs no tie-break and the comparison is one predicate rather than three.
   *
   * *Not ordered by leader name, which would read better and cannot be paged safely
   * here: a rename moves the key, and a keyset over a moving key skips or repeats rows.
   * `roster-cursor.ts` records that failure. A client sorting a page for display is
   * permitted (Section 13, sorting within an authorized scope); ordering the collection
   * itself is what has to be stable.*
   */
  async cellsInScope(
    executor: Db | Transaction<Database>,
    leaderIds: readonly string[] | null,
    /**
     * The instant the category and schedule are read at — the caller's `now`, taken once
     * so that a page describes one state rather than one per join.
     */
    at: Date,
    page: { limit: number; after?: string | null },
  ): Promise<
    {
      id: string;
      cellId: string;
      leaderId: string;
      category: CellCategory;
      dayOfWeek: number;
      timeOfDay: string;
    }[]
  > {
    const after = page.after ?? null;

    const rows = await executor
      .selectFrom('cells')
      .innerJoin('cell_leaderships', (join) =>
        join
          .onRef('cell_leaderships.cell_id', '=', 'cells.id')
          .on('cell_leaderships.ended_at', 'is', null),
      )
      // **The category and schedule in force *now*, which is not the open row.** A
      // schedule change closes the row in force at a future instant and inserts the
      // replacement already open with a future `started_at` — so between the change and
      // the month it takes effect, the single open row is the **pending** one, and joining
      // on `ended_at is null` reported next month's day and time as the Cell's schedule
      // while the coverage line beside it was derived from the row actually in force.
      // Reproduced by `architecture-guardian`; the comment that stood here said "in force
      // now" and the join did not deliver it.
      .innerJoin('cell_categories', (join) =>
        join
          .onRef('cell_categories.cell_id', '=', 'cells.id')
          .on('cell_categories.started_at', '<=', at)
          .on((eb) =>
            eb.or([
              eb('cell_categories.ended_at', 'is', null),
              eb('cell_categories.ended_at', '>', at),
            ]),
          ),
      )
      .innerJoin('cell_schedules', (join) =>
        join
          .onRef('cell_schedules.cell_id', '=', 'cells.id')
          .on('cell_schedules.started_at', '<=', at)
          .on((eb) =>
            eb.or([
              eb('cell_schedules.ended_at', 'is', null),
              eb('cell_schedules.ended_at', '>', at),
            ]),
          ),
      )
      .select([
        'cells.id as id',
        'cells.cell_id as cell_id',
        'cell_leaderships.person_id as leader_id',
        'cell_categories.category as category',
        'cell_schedules.day_of_week as day_of_week',
        'cell_schedules.time_of_day as time_of_day',
      ])
      .where('cells.state', '=', 'ACTIVE')
      .$if(leaderIds !== null, (query) =>
        query.where('cell_leaderships.person_id', 'in', leaderIds as readonly string[]),
      )
      .$if(after !== null, (query) => query.where('cells.cell_id', '>', after as string))
      .orderBy('cells.cell_id')
      .limit(page.limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      cellId: row.cell_id,
      leaderId: row.leader_id,
      category: row.category,
      dayOfWeek: Number(row.day_of_week),
      timeOfDay: String(row.time_of_day).slice(0, 5),
    }));
  }

  /**
   * Every meeting the month has scheduled, church-wide, each with the leader who led its
   * Cell on that date — the **denominator** of an aggregate coverage figure (SKILL.md
   * sections 12, 13 and 20; decisions 0221 and 0225).
   *
   * **The unit is a (Cell, scheduled date) pair rather than a Cell**, because that is what
   * Section 20 attributes: the denominator is "the Cell's scheduled meetings, **each
   * appearing for the leader who led the Cell on the scheduled date**". A Cell handed over
   * mid-month therefore splits its meetings between two leaders, and a per-Cell count
   * could not express that. {@link scheduledCountsIn} answers the per-Cell question the
   * index asks and is not this one.
   *
   * **Two derivations are duplicated here and both are named rather than discovered.** The
   * schedule half is the day-by-day series {@link scheduledMeetingsIn} and
   * {@link scheduledCountsIn} both perform; the leader half is
   * {@link leaderOnDateWithin}'s three ordering keys, `started_at` **ascending** first —
   * decision 0187, so a handover on the meeting's own day leaves the meeting with the
   * **outgoing** leader, which is the only answer that does not depend on when the record
   * was entered. A set-returning query cannot call a row-at-a-time method without one
   * round trip per pair, which is why they are restated; a change to either rule is a
   * change here too.
   *
   * **`test/database/cell-coverage-leader.spec.ts` pins two of the five things that could
   * drift, and the other three are named rather than implied.** It compares this query's
   * leader against {@link leaderOnDateWithin} for the same date, so it catches the
   * `started_at` **direction** — decision 0187, which decides who a handover-day meeting
   * belongs to — and the closing date bound. It does **not** catch the
   * `ended_at DESC NULLS FIRST` tiebreak, the `id DESC` tiebreak, or any drift in the
   * *schedule* half: the guard asks the canonical method about whatever dates this query
   * returns, so a schedule that produced the wrong dates would be agreed with rather than
   * caught. *Measured by mutation rather than reasoned: five of seven single-key
   * mutations leave it green. An earlier version of this sentence said "the pair cannot
   * drift silently", which is three keys and a whole derivation wider than the file.*
   *
   * **The leader is `LEFT JOIN`ed and may come back null.** It should not: a Cell's
   * schedule and its leadership are opened together at creation and closed together at
   * closure, so a day with a schedule in force has a leadership in force. An inner join
   * would be shorter and would make a data defect *shrink the denominator*, which is
   * exactly the direction Section 12 says a coverage figure must never move — recording
   * less must never look better. So the row survives with no leader, and the caller counts
   * it at Cell and Whole Church scope and in no leader's. *Section 12 is the whole of the
   * ground: an earlier version also cited a Section 20 residual, which that section
   * declines to lend — it says of its own generalised fallbacks that "coverage is not
   * settled by that generalisation".*
   *
   * A closed Cell needs no filter: it has no schedule row in force after its closure, so
   * it produces no pairs (decision 0225).
   */
  async scheduledMeetingsWithLeaderIn(
    executor: Db | Transaction<Database>,
    reportingMonth: string,
  ): Promise<{ cellId: string; scheduledDate: string; leaderId: string | null }[]> {
    const result = await sql<{
      cell_id: string;
      scheduled_date: string;
      leader_id: string | null;
    }>`
      SELECT cell.id AS cell_id,
             day::date AS scheduled_date,
             leader.person_id AS leader_id
        FROM cells AS cell
        CROSS JOIN generate_series(
               ${reportingMonth}::date,
               (${reportingMonth}::date + interval '1 month' - interval '1 day')::date,
               interval '1 day'
             ) AS day
        -- The identical derivation scheduledCountsIn performs: one governing schedule per
        -- day, inert rows excluded, the weekday tested against the governing row alone.
        CROSS JOIN LATERAL (
          SELECT schedule.day_of_week
            FROM cell_schedules AS schedule
           WHERE schedule.cell_id = cell.id
             AND schedule.ended_at IS DISTINCT FROM schedule.started_at
             AND (schedule.started_at AT TIME ZONE 'Asia/Manila')::date <= day
             AND (schedule.ended_at IS NULL
                  OR (schedule.ended_at AT TIME ZONE 'Asia/Manila')::date >= day)
           ORDER BY schedule.started_at DESC,
                    schedule.ended_at DESC NULLS FIRST,
                    schedule.id DESC
           LIMIT 1
        ) AS governing
        -- leaderOnDateWithin's keys, and started_at ASC is decision 0187 rather than a
        -- copy of the method above it: on a handover day the date comparison matches both
        -- rows, and the outgoing leader is the answer that does not move with the clerk.
        LEFT JOIN LATERAL (
          SELECT held.person_id
            FROM cell_leaderships AS held
           WHERE held.cell_id = cell.id
             AND (held.started_at AT TIME ZONE 'Asia/Manila')::date <= day
             AND (held.ended_at IS NULL
                  OR (held.ended_at AT TIME ZONE 'Asia/Manila')::date >= day)
           ORDER BY held.started_at ASC,
                    held.ended_at DESC NULLS FIRST,
                    held.id DESC
           LIMIT 1
        ) AS leader ON true
       WHERE EXTRACT(ISODOW FROM day) = governing.day_of_week
       ORDER BY cell.id, day
    `.execute(executor);

    return result.rows.map((row) => ({
      cellId: row.cell_id,
      scheduledDate: String(row.scheduled_date),
      leaderId: row.leader_id,
    }));
  }

  /**
   * How many meetings each of these Cells has scheduled in the month — the
   * **denominator** of Section 12's coverage line, for a page of Cells at once.
   *
   * **The same derivation as {@link scheduledMeetingsIn}, counted rather than listed**,
   * and that is a duplication worth naming: two statements now derive one rule, which is
   * the shape this repository records against itself. They are adjacent, in the module
   * Section 2 assigns the denominator to, and both express the derivation the same way —
   * a day-by-day series against the schedule rows in force, comparing `EXTRACT(ISODOW)`
   * with `day_of_week`, with the in-force comparison made on Manila **dates** at both
   * edges for the reason that method gives. A change to one is a change to both.
   *
   * *Reusing that method per Cell was the alternative, and it is a round trip per row:
   * up to 200 on one page, for 200 integers. The listing form is kept for the single-Cell
   * route because it needs the dates themselves, which the caller there joins recorded
   * rows onto.*
   *
   * **A Cell with no schedule row in force over any day of the month is absent from the
   * map, and the caller reads that as zero** (decision 0225): the line reads `0 of 0`,
   * it is shown, and the Cell stays in any aggregate denominator contributing zero to
   * both terms. Reachable without backdating, since a month after a Cell's closure has
   * no schedule row — though this listing shows `ACTIVE` Cells, so the case it reaches
   * here is a month before the Cell existed.
   */
  async scheduledCountsIn(
    executor: Db | Transaction<Database>,
    cellIds: readonly string[],
    reportingMonth: string,
  ): Promise<Map<string, number>> {
    if (cellIds.length === 0) {
      return new Map();
    }

    const result = await sql<{ cell_id: string; scheduled: string }>`
      SELECT asked.cell_id AS cell_id, count(*) AS scheduled
        -- DISTINCT on the input, because unnest multiplies where = ANY(...) did not: a
        -- repeated identifier doubled that Cell's denominator. The caller passes a page's
        -- ids, which are unique while the listing cannot duplicate a Cell, and this does
        -- not depend on that holding.
        FROM (SELECT DISTINCT unnest(${sql.val(cellIds)}::uuid[]) AS cell_id) AS asked
        CROSS JOIN generate_series(
               ${reportingMonth}::date,
               (${reportingMonth}::date + interval '1 month' - interval '1 day')::date,
               interval '1 day'
             ) AS day
        -- The identical derivation scheduledMeetingsIn performs, counted rather than
        -- listed: one governing schedule per day, inert rows excluded, the weekday
        -- tested against the governing row alone. A change to one is a change to both.
        CROSS JOIN LATERAL (
          SELECT schedule.day_of_week
            FROM cell_schedules AS schedule
           WHERE schedule.cell_id = asked.cell_id
             AND schedule.ended_at IS DISTINCT FROM schedule.started_at
             AND (schedule.started_at AT TIME ZONE 'Asia/Manila')::date <= day
             AND (schedule.ended_at IS NULL
                  OR (schedule.ended_at AT TIME ZONE 'Asia/Manila')::date >= day)
           ORDER BY schedule.started_at DESC,
                    schedule.ended_at DESC NULLS FIRST,
                    schedule.id DESC
           LIMIT 1
        ) AS governing
       WHERE EXTRACT(ISODOW FROM day) = governing.day_of_week
       GROUP BY asked.cell_id
    `.execute(executor);

    return new Map(result.rows.map((row) => [row.cell_id, Number(row.scheduled)]));
  }
}
