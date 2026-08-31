import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { AccountsRepository } from '../auth/accounts.repository';
import {
  AuthorizationService,
  type Actor,
  type ActorAuthority,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { ScopeType } from '../auth/authorization/scopes';
import {
  ApiError,
  ApiErrorCode,
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
} from '../common/errors/api-error';
import { VersionConflictError } from '../common/errors/version-conflict';
import { sameId } from '../common/identifiers';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { decodeRosterCursor, encodeRosterCursor, type RosterCursor } from '../common/roster-cursor';
import { startOfManilaDay } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';

import { recordingInstant } from './recording-instant';
import { databaseNow, reportingMonthOf, windowClosesAt } from './submission-window';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/** One submitted line, as the DTO delivers it. */
export interface SubmittedRecord {
  person_id: string;
  present: boolean;
  version: number | null;
  correction_reason?: string;
}

/** One person's line on the checklist, and the record standing against it. */
interface RosterLine {
  personId: string;
  memberId: string;
  fullName: string;
  lastName: string;
  firstName: string;
  /** Null for a Network root, who has no pastoral leader (section 9). */
  responsibleLeaderId: string | null;
  record: LiveRecord | null;
}

/** The live `dcc_attendance` row for one person at one event, where there is one. */
interface LiveRecord {
  id: string;
  present: boolean;
  version: number;
  recordedAt: Date;
  recordedBy: string;
  /** Frozen when the first row was written, and carried by every successor. */
  responsibleLeaderId: string | null;
}

/** Why an event takes no record. Null where it takes one. */
type NotRecordable = 'REMOVED' | 'NOT_YET_HELD' | 'MONTH_CLOSED';

interface EventForRecording {
  id: string;
  eventDate: string;
  removedAt: Date | null;
  removalReason: string | null;
  /**
   * The instant every dated lookup about this event is made at (section 9).
   *
   * The responsible leader, the checklist walk and the roster all read it, which is
   * the point: section 13 states the same requirement for a Cell meeting — "the
   * leader and the people are read at one instant rather than two".
   */
  at: Date;
  notRecordable: NotRecordable | null;
}

/** What one submitted line turned out to be, once compared with what is stored. */
type LineOutcome = 'CREATE' | 'CORRECT' | 'UNCHANGED';

/**
 * DCC recording (SKILL.md section 9; section 14).
 *
 * Two operations, and they share every rule deciding *who* and *when*: the
 * checklist a leader is answerable for, the instant the pastoral tree is read at,
 * and the submission window. They are one service because the roster exists to be
 * submitted — a roster resolved by one set of rules and a submission checked by
 * another would disagree, and a leader would meet the disagreement as a refusal of
 * a name the application had just shown them.
 *
 * **What this service does not own.** The calendar is `DccCalendarService`'s
 * (section 9, *Generating the DCC calendar*); the window is `submission-window.ts`,
 * shared with Cell attendance; and every read outside `dcc_events` and
 * `dcc_attendance` goes through the module owning that table (section 2) —
 * `hierarchy` for pastoral assignments, `people` for identity and lifecycle, `auth`
 * for whether a Person holds an account, `authorization` for scope, `audit` for its
 * entries.
 */
@Injectable()
export class DccAttendanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly people: PeopleReadService,
    private readonly accounts: AccountsRepository,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * `GET /api/v1/dcc/events/{id}/roster` — who there is to record (section 9).
   *
   * **It answers for an event that takes no record rather than refusing one.**
   * Section 9 requires a removed Sunday to be "visible on any report covering that
   * month, so that a month showing four events where the calendar shows five is
   * explained rather than merely odd" — so the read succeeds, says whether the event
   * is recordable and why not, and carries the checklist either way. A 409 on a GET
   * would leave a client with nothing to render, and a client cannot mistake the
   * answer: `recordable` is false and the write refuses on the same grounds.
   */
  async roster(
    eventId: string,
    actor: Actor,
    page: { limit?: number; cursor?: string } = {},
  ): Promise<Record<string, unknown>> {
    const event = await this.eventForRecording(this.db, eventId);
    const authority = await this.authorization.authorityFor(actor.accountId);
    const lines = await this.rosterLines(this.db, event, actor, authority);

    // Section 22: cursor-based pagination on **every** collection endpoint. A first
    // version returned the whole checklist under `next_cursor: null`, on the argument
    // that a page boundary "would let a leader submit a checklist they had seen half
    // of" — which is the argument `GET /cells/{id}/members` was corrected for, and it
    // fails the same way: it bounds the request rather than the data. Section 9 puts
    // no bound on a checklist at all, and says the covering arrangement that grows one
    // can persist (decision 0174).
    const after = decodeRosterCursor(page.cursor);
    const limit = page.limit ?? DEFAULT_PAGE;

    const beyond =
      after === null ? 0 : lines.findIndex((line) => compareKeys(keyOf(line), after) > 0);
    // `-1` means the cursor is past every line, which is the last page rather than the
    // first: slicing from it would restart the collection, which is the silent
    // behaviour section 22 refuses a cursor over.
    const start = beyond === -1 ? lines.length : beyond;

    const window = lines.slice(start, start + limit);
    const more = start + limit < lines.length;

    return {
      event: this.renderEvent(event),
      // `data`, which is the envelope every other collection in this API answers in.
      // This route answered `people` until decision 0174; one shape, or a client
      // writes a special case for one route.
      data: window.map(renderLine),
      next_cursor: more ? encodeRosterCursor(keyOf(window[window.length - 1])) : null,
    };
  }

  /**
   * `POST /api/v1/dcc/events/{id}/submit` (sections 9, 14 and 22).
   *
   * **All or nothing.** Section 14: a submission carrying several people "can
   * conflict on several at once. It applies none of them and names the first",
   * because "a partial result is a third outcome, and a leader reading the response
   * could not tell what had been recorded without fetching the roster again".
   */
  async submit(
    eventId: string,
    records: readonly SubmittedRecord[],
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.writeWithin(eventId, records, actor, claim);
    } catch (error) {
      // **A lost race on `dcc_attendance_one_live`.** Two writers can reach one
      // person's first record at once — their own submitter, and an upline recording
      // on behalf — and neither holds a version to be stale, so the loser meets the
      // index rather than the version check (section 22, *Write conflicts*; decision
      // 0171). Section 22 names this case precisely because "a uniqueness violation
      // left to surface on its own is an `INTERNAL_ERROR` on an ordinary race".
      //
      // The transaction has rolled back, so nothing was written and the state is now
      // whoever won. Re-reading it here rather than inside the aborted transaction is
      // not a choice: a failed statement aborts the transaction, and every query after
      // it is refused.
      // **Named, not merely typed.** Only `dcc_attendance_one_live` means a lost race;
      // a violation of any other index on this path is a defect and must keep failing
      // loudly rather than being reported as contention.
      //
      // **No test fails on the narrowing**, and that is said rather than left to be
      // discovered: nothing this path writes can violate another unique index today —
      // `audit_log` keys on a generated UUID and the idempotency completion is an
      // UPDATE — so the second clause is unreachable. It is kept, unlike the row-count
      // check deleted below, because the two differ in kind: that one duplicated an
      // enforcement one statement away, while this one *narrows* a handler, and
      // removing it would turn a future defect into a 503 telling the client to retry
      // something that cannot succeed.
      if (!isUniqueViolation(error) || violatedConstraint(error) !== ONE_LIVE_INDEX) {
        throw error;
      }

      const conflict = await this.conflictAfterLostRace(eventId, records, actor);

      if (conflict !== null) {
        throw conflict;
      }

      // **The race was lost and nothing now disagrees**, which happens when the winner
      // recorded the value this submission was carrying: the line is unchanged against
      // the committed state, so it takes no part in the version check and there is no
      // conflict to present.
      //
      // Decision 0158 places the refusal by one question — could this same body,
      // resubmitted unchanged, succeed? Here it plainly could: the retry finds the line
      // unchanged, writes nothing, and answers 201. So this reached no decision about
      // the body, which is what `RESOURCE_BUSY` means, and section 22's third condition
      // names it exactly — "a premise read before a lock no longer held under it".
      //
      // A 5xx also releases the idempotency key, which is what the retry needs.
      throw new ApiError(
        ApiErrorCode.RESOURCE_BUSY,
        'Another submission recorded this event while yours was being applied. Retry shortly, ' +
          'with the same key.',
        { event_id: eventId },
      );
    }
  }

  private async writeWithin(
    eventId: string,
    records: readonly SubmittedRecord[],
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // **On the pool, before the transaction opens** (section 24), which is what every
    // other write service in this repository does and says why: `authorityFor` reads
    // `account_roles` and `capability_grants` on `this.db`, and a transaction holding
    // a connection while asking the pool for another is the liveness hazard section 24
    // names. The `coversWith` calls below take the transaction, which is the whole
    // reason `authorityFor` and `coversWith` are separate methods.
    const authority = await this.authorization.authorityFor(actor.accountId);

    return this.db.transaction().execute(async (trx) => {
      const event = await this.eventForRecording(trx, eventId);

      if (event.notRecordable !== null) {
        throw refusalFor(event);
      }

      assertNamesEachPersonOnce(records);

      const personIds = records.map((record) => record.person_id);

      const checklist = await this.checklist(trx, event, actor, authority);
      const assignments = await this.hierarchy.assignmentsAsOf(trx, personIds, event.at);
      const identities = await this.people.forDecisionsWithin(trx, personIds);
      const live = await this.liveRecords(trx, event.id, personIds);

      // Everything is decided before anything is written. A rollback would give the
      // same all-or-nothing result; deciding first is what lets the response name
      // the **first** conflicting line rather than whichever one the database
      // happened to meet.
      const planned: { record: SubmittedRecord; outcome: LineOutcome }[] = [];

      for (const record of records) {
        const personId = record.person_id;
        const identity = identities.get(personId);

        // **Existence first, then scope, and only then anything read from the record
        // or the person's lifecycle.** Section 8 publishes minimal identity
        // church-wide, so "no such person" discloses nothing (section 22: "People are
        // not such a case"). Everything below this line does: whether somebody is
        // archived, whether their record was merged into another, whether they had a
        // pastoral leader on the date, and whether a DCC record exists at all are each
        // withheld outside the viewer's scope by section 8.
        if (identity === undefined) {
          throw new NotFoundError('No such person.', { person_id: personId });
        }

        await this.assertInScope(trx, actor, authority, personId);

        const stored = live.get(personId) ?? null;
        const outcome = outcomeFor(stored, record.present);

        this.assertRecordable(personId, identity, assignments.get(personId));

        if (outcome === 'CREATE' && record.correction_reason !== undefined) {
          throw new InvariantViolationError(
            'There is no record to correct for this person, so a correction reason has no ' +
              'subject. Remove it, or re-read the roster.',
            { person_id: personId },
          );
        }

        await this.assertMayRecord(trx, {
          actor,
          authority,
          personId,
          onChecklist: checklist.has(personId),
          outcome,
        });

        planned.push({ record, outcome });
      }

      // Section 14's version check, made over the whole submission before any of it
      // is applied. The first mismatch **in the order the client sent** is the one
      // named, because that is the line the client can find in its own request.
      //
      // **An unchanged line takes no part in it**, and section 22 is what settles that
      // rather than a preference. A covering upline holding a stale version for a
      // person their downline already recorded the same way would otherwise receive a
      // `VERSION_CONFLICT` whose two sides carry the identical value — and section 22
      // says a conflict must carry "both values… so that a person can choose between
      // them". Two identical values is not a choice, and section 14 resolves a
      // conflict by a person. The version guards against overwriting a change nobody
      // saw; a line that writes nothing overwrites nothing.
      for (const { record, outcome } of planned) {
        if (outcome === 'UNCHANGED') {
          continue;
        }

        const stored = live.get(record.person_id) ?? null;
        const current = stored === null ? null : stored.version;

        if (record.version !== current) {
          throw await this.conflictFor(
            trx,
            actor,
            record,
            stored,
            identities.get(record.person_id),
          );
        }
      }

      const written = await this.applyWithin(trx, { event, actor, planned, assignments, live });

      const response = {
        event_id: event.id,
        event_date: event.eventDate,
        created: written.created,
        corrected: written.corrected,
        unchanged: written.unchanged,
      };

      // Last statement in the transaction, and inside it (CLAUDE.md, *Write
      // endpoints*). It takes the key's row lock, so a concurrent retry waits on
      // that lock rather than being answered `REQUEST_IN_FLIGHT`; and a lost claim
      // throws here, uncaught, which rolls the write back.
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });

      return response;
    });
  }

  // ---------------------------------------------------------------------------
  // The event, and the instant everything about it is read at
  // ---------------------------------------------------------------------------

  private async eventForRecording(executor: Db, eventId: string): Promise<EventForRecording> {
    const row = await executor
      .selectFrom('dcc_events')
      .select(['id', 'event_date', 'removed_at', 'removal_reason'])
      .where('id', '=', eventId)
      .executeTakeFirst();

    if (row === undefined) {
      throw new NotFoundError('No such DCC event.', { event_id: eventId });
    }

    const eventDate = String(row.event_date);
    const now = await databaseNow(executor);

    // `recording-instant.ts` carries the rule and its reasoning. It is a pure function
    // in its own file so that both of its branches have a test that can fail on them,
    // which they did not while the arithmetic lived here.
    const at = recordingInstant(eventDate, now);

    return {
      id: row.id,
      eventDate,
      removedAt: row.removed_at,
      removalReason: row.removal_reason,
      at,
      notRecordable: this.recordability(row.removed_at, eventDate, now),
    };
  }

  private recordability(
    removedAt: Date | null,
    eventDate: string,
    now: Date,
  ): NotRecordable | null {
    // A removed Sunday carries no applicable event (section 9): the church held no
    // service, so there is nothing to record and no coverage it belongs to.
    if (removedAt !== null) {
      return 'REMOVED';
    }

    // The event's Manila day has not begun (ruling of 2026-08-31). The calendar runs
    // thirteen months ahead, and the window refuses none of those on its own: a
    // future month's window is open until the 7th of the month after it.
    if (now.getTime() < startOfManilaDay(eventDate).getTime()) {
      return 'NOT_YET_HELD';
    }

    // Compared against the `now` this request already read, rather than by calling
    // `isMonthOpen`, which would issue a second `clock_timestamp()`. One request, one
    // instant: two reads a few microseconds apart cannot disagree usefully, and a
    // rule decided on one clock reading and enforced on another is the shape this
    // project keeps finding defects in.
    if (now.getTime() >= windowClosesAt(reportingMonthOf(eventDate)).getTime()) {
      return 'MONTH_CLOSED';
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // The checklist (section 9; decision 0172)
  // ---------------------------------------------------------------------------

  /**
   * Every person this actor is the submitter for, as of the event's instant.
   *
   * A person's submitter is the nearest account holder starting at their direct
   * pastoral leader and walking up, so this is that relation inverted: descend from
   * the actor, take every child, and continue through the children holding no
   * account — their own children have the same submitter, because the walk up from
   * them passes straight through.
   *
   * **A descent rather than the recursive query the rest of `hierarchy` uses**,
   * because the stopping condition reads `accounts`, which `auth` owns and
   * `hierarchy` may not join to (section 2).
   *
   * **The cost is one round trip per account-less person in the covered branch**, not
   * per level: the loop awaits `directChildrenAsOf` once for each leader in the
   * frontier, sequentially. An earlier version of this sentence said "per level of
   * account-less chain, normally one", which discounts the width — and section 9 says
   * in the same breath that a checklist is unbounded and that the covering arrangement
   * can persist, so the width is exactly the thing not to discount. It is acceptable
   * because the frontier is only the people below this actor who hold no account, and
   * section 9 treats that set as temporary; it is not acceptable to describe it as
   * cheaper than it is.
   *
   * The visited set below is not optional: section 5 requires every walk to detect a
   * cycle rather than trust the data, and an undetected one here is a request that
   * never returns. **It is a termination guard rather than cycle detection proper**,
   * and the difference is reachable: `pastoral_assignments_one_active` is partial on
   * open rows, so two rows overlapping at a *historical* instant are not refused by
   * the schema, and a person reached twice through such a diamond is reported here as
   * a cycle. That needs corrupt history to reach, and the honest description is what
   * the guard does rather than what `CYCLE` would do.
   */
  private async checklist(
    executor: Db,
    event: EventForRecording,
    actor: Actor,
    authority: ActorAuthority,
  ): Promise<Set<string>> {
    const checklist = new Set<string>();
    const visited = new Set<string>([canonical(actor.personId)]);
    let frontier = [actor.personId];

    while (frontier.length > 0) {
      const children: string[] = [];
      for (const leaderId of frontier) {
        children.push(...(await this.hierarchy.directChildrenAsOf(executor, leaderId, event.at)));
      }

      const fresh: string[] = [];
      for (const childId of children) {
        const key = canonical(childId);
        if (visited.has(key)) {
          // Reached twice. A cycle is what this normally means and what section 5
          // forbids; a historical diamond would reach it too, and the message says
          // "cannot be resolved" rather than naming the shape, because this cannot
          // tell them apart.
          throw new InvariantViolationError(
            'The pastoral tree reaches this person twice and cannot be resolved. This is a data ' +
              'defect: report it rather than retrying.',
            { person_id: childId },
          );
        }
        visited.add(key);
        checklist.add(childId);
        fresh.push(childId);
      }

      // A child holding an account is their own submitter, and their children are
      // theirs rather than this actor's. Section 9: "where a leader with an account
      // sits between them and the leader without one, the obligation is the nearer
      // leader's, and showing it to both leaves each assuming the other will submit."
      const holders = await this.accounts.personsHoldingAccounts(executor, fresh);
      frontier = fresh.filter((childId) => !holders.has(childId));
    }

    // A root has no direct leader, so the walk above reaches none of them. Section 9
    // puts the two on the checklist of a Whole Church holder, resting on the grant
    // rather than on the `ADMIN` role (decision 0172): a Senior Pastor is a root, and
    // a role check would leave neither able to record their own attendance or the
    // other's.
    if (holdsWholeChurch(authority, Capability.DccTakeAttendance)) {
      for (const rootId of await this.hierarchy.rootsAsOf(executor, event.at)) {
        checklist.add(rootId);
      }
    }

    return checklist;
  }

  private async rosterLines(
    executor: Db,
    event: EventForRecording,
    actor: Actor,
    authority: ActorAuthority,
  ): Promise<RosterLine[]> {
    const checklist = [...(await this.checklist(executor, event, actor, authority))];
    const identities = await this.people.forDecisionsWithin(executor, checklist);

    // An archived Person has left (section 3) and a merged record has been absorbed
    // into another, so neither is somebody a leader is asked to mark present. Dropped
    // rather than shown as unrecordable: the roster's question is who there is to
    // record, and the write refuses both on the same grounds.
    const recordable = checklist.filter((personId) => {
      const identity = identities.get(personId);
      return identity !== undefined && !identity.isArchived && identity.mergedIntoId === null;
    });

    const assignments = await this.hierarchy.assignmentsAsOf(executor, recordable, event.at);
    const live = await this.liveRecords(executor, event.id, recordable);

    const lines: RosterLine[] = recordable.map((personId) => {
      const identity = identities.get(personId);

      return {
        personId,
        // From `forDecisionsWithin`, which honours the executor. `namesOf` reads the
        // pool whatever it is handed, and section 25 names that shape: passing an
        // executor down a call chain makes a read honour a caller's transaction "but
        // only for the reads that actually take it". Safe here today only because this
        // caller is outside a transaction, which is not a property to build on.
        memberId: identity?.memberId ?? '',
        fullName: identity?.fullName ?? '',
        lastName: identity?.lastName ?? '',
        firstName: identity?.firstName ?? '',
        responsibleLeaderId: assignments.get(personId)?.leaderId ?? null,
        record: live.get(personId) ?? null,
      };
    });

    // `(last_name, first_name, member_id)`, which is section 8's directory order and
    // the key `GET /cells/{id}/members` already pages by. Total: two people
    // legitimately share a name, so the Member ID breaks the tie (sections 3 and 22).
    lines.sort((left, right) => compareKeys(keyOf(left), keyOf(right)));

    return lines;
  }

  // ---------------------------------------------------------------------------
  // Per-person refusals
  // ---------------------------------------------------------------------------

  /**
   * The refusals that describe the Person rather than the actor.
   *
   * **Every one of them is a disclosure**, so this runs after `assertInScope` and
   * never before it: section 8 withholds a person's lifecycle state, their merge, and
   * their pastoral position from a viewer outside their scope.
   */
  private assertRecordable(
    personId: string,
    identity: { isArchived: boolean; mergedIntoId: string | null },
    assignment: { leaderId: string | null } | undefined,
  ): void {
    if (identity.isArchived) {
      throw new InvariantViolationError('An archived Person takes no attendance record.', {
        person_id: personId,
      });
    }

    if (identity.mergedIntoId !== null) {
      throw new InvariantViolationError(
        'This Person record was merged into another. Record against the surviving record.',
        { person_id: personId, merged_into_id: identity.mergedIntoId },
      );
    }

    // Section 9: "A Person with no open assignment row cannot have DCC attendance
    // recorded, because there is no responsible leader to record it against." A
    // Network root has a row and no leader above them, which is the intended state
    // rather than missing data — so this refusal is written over the row, not over
    // the leader.
    if (assignment === undefined) {
      throw new InvariantViolationError(
        'This Person had no pastoral leader on the event date, so there is no responsible ' +
          'leader to record their attendance against (SKILL.md section 9).',
        { person_id: personId },
      );
    }
  }

  /**
   * Whether this actor may write this person's record (section 7).
   *
   * Three capabilities, and they layer. `dcc.take_attendance` guards a first
   * submission and `dcc.correct_subtree` an amendment of an already-submitted
   * record, which section 7 keeps separate deliberately. `dcc.submit_on_behalf` is
   * additional, and is required exactly where the actor is not this person's own
   * submitter — which is what "on behalf of a downline leader within their pastoral
   * subtree" means once the submitter is a function (section 14; decision 0172).
   */
  /**
   * The scope check that runs **before anything about the record is read**.
   *
   * `dcc.take_attendance` is the capability that lets an actor reach this person at
   * all, and it is checked against the person alone — never against what is stored.
   *
   * **That ordering is the whole point, and getting it wrong was a disclosure.** An
   * earlier version chose the capability from the line's outcome, which is derived
   * from the stored `present` value, and then named that capability in the refusal.
   * Every leader holding `dcc.take_attendance` reaches this route — the guard's target
   * is the actor — and section 8 publishes every Person's identifier church-wide, so
   * two requests against anybody in the church read the stored record out of the
   * refusal: `dcc.correct_subtree` back meant a record exists and disagrees,
   * `dcc.take_attendance` meant there is none. Section 8 withholds "DCC attendance,
   * DCC history, or DCC classification" for a person outside the viewer's pastoral
   * scope, and there was a space to sweep.
   *
   * With this check first, an out-of-scope actor receives one refusal naming one
   * capability whatever is stored. The correction capability is checked below, only
   * once the actor is already in scope — for whom a record's existence is not withheld.
   */
  private async assertInScope(
    executor: Db,
    actor: Actor,
    authority: ActorAuthority,
    personId: string,
  ): Promise<void> {
    const covered = await this.authorization.coversWith(
      executor,
      actor,
      authority,
      Capability.DccTakeAttendance,
      { kind: 'person', personId },
    );

    if (!covered) {
      throw new ScopeDeniedError('This person is outside your scope.', {
        capability: Capability.DccTakeAttendance,
        person_id: personId,
      });
    }
  }

  private async assertMayRecord(
    executor: Db,
    params: {
      actor: Actor;
      authority: ActorAuthority;
      personId: string;
      onChecklist: boolean;
      outcome: LineOutcome;
    },
  ): Promise<void> {
    const { actor, authority, personId } = params;
    const target = { kind: 'person', personId } as const;

    // `dcc.take_attendance` was checked by `assertInScope` before anything about the
    // record was read. What is left is the amendment capability, and it is reached
    // only by an actor already in scope.
    //
    // **On behalf first, and the amendment capability last.** `dcc.submit_on_behalf`
    // depends on nothing stored — only on whether this actor is the person's submitter
    // — while the `dcc.correct_subtree` branch is reached exactly when a record exists
    // *and disagrees with the value sent*. Checked the other way round, two probes read
    // the stored value out of the refusal for anyone the actor may reach: this is the
    // oracle `assertInScope` closes one level up, left behind inside this method by the
    // batch that closed it.
    //
    // Under role defaults the residual is inside the actor's own pastoral scope, which
    // section 8 does not withhold. It becomes a section 8 disclosure under a grant
    // section 7 explicitly permits — `dcc.take_attendance` at Whole Church issued to a
    // Leader whose `dcc.view_subtree` stays at own/subtree — and the ordering costs
    // nothing, so it is not left resting on which grants happen to be issued.
    if (!params.onChecklist) {
      const mayActForAnother = await this.authorization.coversWith(
        executor,
        actor,
        authority,
        Capability.DccSubmitOnBehalf,
        target,
      );

      if (!mayActForAnother) {
        throw new ScopeDeniedError(
          'This person is recorded by another leader, and submitting on their behalf is outside ' +
            'your scope.',
          { capability: Capability.DccSubmitOnBehalf, person_id: personId },
        );
      }
    }

    // An unchanged line writes nothing, so it is not an amendment: a leader
    // resubmitting an identical checklist is submitting.
    if (
      params.outcome === 'CORRECT' &&
      !(await this.authorization.coversWith(
        executor,
        actor,
        authority,
        Capability.DccCorrectSubtree,
        target,
      ))
    ) {
      throw new ScopeDeniedError('Correcting this person’s DCC record is outside your scope.', {
        capability: Capability.DccCorrectSubtree,
        person_id: personId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------

  private async applyWithin(
    trx: Transaction<Database>,
    params: {
      event: EventForRecording;
      actor: Actor;
      planned: readonly { record: SubmittedRecord; outcome: LineOutcome }[];
      assignments: Map<string, { leaderId: string | null }>;
      live: Map<string, LiveRecord>;
    },
  ): Promise<{ created: number; corrected: number; unchanged: number }> {
    let created = 0;
    let corrected = 0;
    let unchanged = 0;

    for (const { record, outcome } of params.planned) {
      const personId = record.person_id;

      if (outcome === 'UNCHANGED') {
        // Superseding a row to write the same fact produces a history entry
        // recording that nothing happened, and bumps a version every other client
        // then has to resolve against. Principle 12 asks a record to carry its own
        // history, and a history is of changes.
        unchanged += 1;
        continue;
      }

      const stored = params.live.get(personId) ?? null;
      const successorId = randomUUID();
      let closedAt: Date | null = null;

      if (stored !== null) {
        // Supersede first, on a predicate that also serializes. Two concurrent
        // corrections of one record both read version N; the second matches no row
        // here, because the first has already closed it. That is the conflict
        // section 14 requires, caught without a lock of its own — and it is the one
        // ordering the deferred `superseded_by` foreign key permits, since the
        // successor does not exist yet.
        const closed = await trx
          .updateTable('dcc_attendance')
          // **`clock_timestamp()` in the database, and the same instant is handed to
          // the successor.** Three things have to agree here and two of them did not.
          //
          // Not a host `Date`: `recorded_at` comes from the database, so a host stamp
          // takes the two ends of one row's period from two clocks — the rule
          // `test/setup/fixtures.ts` states, whose stated reason this branch corrected
          // two commits before breaking the rule here.
          //
          // Not `now()`: that is the transaction's start, and this statement waits on
          // the predecessor's row lock, so a contended correction would stamp an instant
          // measurably before the close happened.
          //
          // And **returned**, because the successor must not begin before this row
          // ended. Left to the column default its `recorded_at` is `now()` — the
          // instant the transaction *began* — so every correction stamped its successor
          // as starting before its predecessor ended, by however long the transaction
          // had already run: the checklist descent, a scope check per line, and the wait
          // on this very row's lock. Two rows of one chain were then both live across
          // that interval. Migration 0012 states the model that breaks — "the two ends
          // of one period: the row is the live record from the first until the second" —
          // and constrains only *within* a row, so nothing refused it.
          //
          // The constraint is still what holds the within-row half: reverting this to a
          // host `Date` inverts a period only when the host clock happens to be behind,
          // which here is a fraction of a millisecond and on a CI runner is unbounded,
          // so no test can reliably fail on the choice. `dcc_attendance_period_ordered`
          // refuses the inverted row whoever writes it. Between rows there is no
          // constraint and this `RETURNING` is the whole of the enforcement.
          .set({ superseded_at: sql<Date>`clock_timestamp()`, superseded_by: successorId })
          .returning('superseded_at')
          .where('id', '=', stored.id)
          .where('superseded_at', 'is', null)
          .executeTakeFirst();

        closedAt = closed?.superseded_at ?? null;

        // **No check on the row count here, and that is deliberate.** A supersede that
        // matches nothing means somebody closed this row between the version check and
        // this statement — and the insert two statements below then meets
        // `dcc_attendance_one_live`, because the winner's successor is already the live
        // row. That violation is caught where every lost race on this index is caught,
        // above, and answered as the `VERSION_CONFLICT` section 22 requires.
        //
        // A check on the row count was written here first and removed: with the index
        // enforcing the same thing one statement later, no test could tell the two
        // apart, and this repository has enough rules written with nothing able to fail
        // on them.
        //
        // The `superseded_at IS NULL` predicate stays, and **its effect is
        // unobservable** — which is said plainly because the sentence replaced here
        // claimed otherwise. It claimed the predicate is what stops a lost race
        // rewriting the winner's `superseded_by`. It is not: without it the rewrite
        // would happen and then be rolled back by the violation two statements later,
        // so the outcome is identical. Run as a mutation, removing it changes no test.
        // It is kept because it says what the statement means — close the row I read —
        // and not because anything depends on it.
      }

      // **Resolved once and used by both the row and its audit entry.** Deriving it
      // twice is what let them disagree: the row took the frozen value and the entry
      // re-resolved the assignment, so a correction after any move within the event's
      // own day — or after an Admin backdated one (section 5) — wrote an entry naming a
      // leader the row does not name, and got `on_behalf` backwards in both directions.
      const responsibleLeaderId =
        stored === null
          ? (params.assignments.get(personId)?.leaderId ?? null)
          : stored.responsibleLeaderId;

      await trx
        .insertInto('dcc_attendance')
        .values({
          id: successorId,
          dcc_event_id: params.event.id,
          person_id: personId,
          present: record.present,
          // The predecessor's closing instant, so the chain is contiguous rather than
          // overlapping. A create has no predecessor and takes the column default.
          ...(closedAt === null ? {} : { recorded_at: closedAt }),
          // Frozen on the first row and carried by every successor. Section 9 fixes
          // it as of the event and section 14 lists it among what a correction
          // preserves — re-resolving it would move a recorded attendance between
          // leaders' totals inside a period that may have closed.
          responsible_leader_id: responsibleLeaderId,
          recorded_by: params.actor.accountId,
          correction_reason: record.correction_reason ?? null,
          version: stored === null ? 1 : stored.version + 1,
        })
        .execute();

      if (stored === null) {
        created += 1;
      } else {
        corrected += 1;
      }

      await this.auditWithin(trx, {
        actor: params.actor,
        personId,
        event: params.event,
        stored,
        present: record.present,
        reason: record.correction_reason ?? null,
        responsibleLeaderId,
      });
    }

    return { created, corrected, unchanged };
  }

  /**
   * Section 21 lists "Attendance submission on behalf" and "Attendance corrections",
   * and lists no ordinary first submission — so those two are what is written. A
   * leader filing their own checklist writes no entry: the record is the entry, and
   * `dcc_attendance` is append-only and carries its own actor.
   *
   * **The target is the Person**, on the reasoning decision 0157 settled one domain
   * over: section 7 resolves an audit entry through its target, a Person resolves
   * through their pastoral position, and a DCC event "resolves through nothing" — so
   * an entry targeting the event would be readable by nobody's scope.
   */
  private async auditWithin(
    trx: Transaction<Database>,
    params: {
      actor: Actor;
      personId: string;
      event: EventForRecording;
      stored: LiveRecord | null;
      present: boolean;
      reason: string | null;
      responsibleLeaderId: string | null;
    },
  ): Promise<void> {
    // On behalf, in section 14's sense: the record belongs to somebody else's
    // obligation. Measured against the **responsible leader** rather than against
    // the checklist, because the checklist already includes the people a covering
    // upline submits for — and section 9 says a covering submission is on behalf.
    const onBehalf =
      params.responsibleLeaderId !== null &&
      !sameId(params.responsibleLeaderId, params.actor.personId);

    if (params.stored !== null) {
      await this.audit.writeWithin(trx, {
        actorId: params.actor.accountId,
        action: 'dcc_attendance.corrected',
        targetType: 'person',
        targetId: params.personId,
        before: { present: params.stored.present, version: params.stored.version },
        after: {
          present: params.present,
          version: params.stored.version + 1,
          event_date: params.event.eventDate,
          // **Carried on the correction rather than written as a second entry.**
          // Section 21 asks for one entry per action performed, and an upline
          // correcting a downline's record performs one action: a correction. Whether
          // it was somebody else's record to correct is an attribute of it.
          //
          // It has to be here rather than nowhere: a reader filtering
          // `dcc_attendance.submitted_on_behalf` for what an upline did to other
          // people's records would otherwise miss every correction, which is the
          // question that list exists to answer.
          on_behalf: onBehalf,
          responsible_leader_id: params.responsibleLeaderId,
        },
        reason: params.reason,
      });

      return;
    }

    if (!onBehalf) {
      return;
    }

    await this.audit.writeWithin(trx, {
      actorId: params.actor.accountId,
      action: 'dcc_attendance.submitted_on_behalf',
      targetType: 'person',
      targetId: params.personId,
      after: {
        present: params.present,
        event_date: params.event.eventDate,
        responsible_leader_id: params.responsibleLeaderId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Reading what is stored, and the conflict
  // ---------------------------------------------------------------------------

  private async liveRecords(
    executor: Db,
    eventId: string,
    personIds: readonly string[],
  ): Promise<Map<string, LiveRecord>> {
    if (personIds.length === 0) {
      return new Map();
    }

    const rows = await executor
      .selectFrom('dcc_attendance')
      .select([
        'id',
        'person_id',
        'present',
        'version',
        'recorded_at',
        'recorded_by',
        'responsible_leader_id',
      ])
      .where('dcc_event_id', '=', eventId)
      .where('person_id', 'in', [...personIds])
      .where('superseded_at', 'is', null)
      .execute();

    return new Map(
      rows.map((row) => [
        row.person_id,
        {
          id: row.id,
          present: row.present,
          version: row.version,
          recordedAt: row.recorded_at,
          recordedBy: row.recorded_by,
          responsibleLeaderId: row.responsible_leader_id,
        },
      ]),
    );
  }

  /**
   * Section 14's conflict, carrying both values, both actors and both timestamps.
   *
   * Section 22: "A conflict response that omits any of them cannot satisfy Section
   * 14, because the person resolving it cannot tell which record to keep."
   */
  private async conflictFor(
    executor: Db,
    actor: Actor,
    record: SubmittedRecord,
    stored: LiveRecord | null,
    identity: { fullName: string } | undefined,
  ): Promise<ApiError> {
    const who = identity?.fullName ?? 'this person';

    if (stored === null) {
      // The client sent a version for a person with no live record. Nothing removes
      // a `dcc_attendance` row — the no-delete trigger refuses it, and a correction
      // supersedes and inserts, so a live row exists once one ever has — which makes
      // this unreachable by any state the client could have read. Section 22 is
      // explicit that a refusal with no second value to show is not a
      // `VERSION_CONFLICT`, whatever went stale, so it is not answered as one.
      return new InvariantViolationError(
        'You sent a version for a person who has no record for this event. Re-read the roster.',
        { person_id: record.person_id, submitted_version: record.version },
      );
    }

    return new VersionConflictError({
      submittedVersion: record.version,
      currentVersion: stored.version,
      submitted: {
        values: { present: record.present, person: who },
        recordedAt: new Date().toISOString(),
        actor: await this.personNameFor(executor, actor.personId, actor.personId),
      },
      current: {
        values: { present: stored.present, person: who },
        recordedAt: stored.recordedAt.toISOString(),
        actor: await this.actorNameFor(executor, stored.recordedBy),
      },
    });
  }

  /**
   * The conflict to answer with after a lost race rolled the transaction back.
   *
   * Re-runs the version check against the committed state and reports the first line
   * that now disagrees, which is the same rule the in-transaction check follows: the
   * first in the order the client sent, because that is the line it can find in its
   * own request.
   *
   * Null where every line still agrees — the violation was not this index, and the
   * caller rethrows rather than reporting contention where there is a defect.
   */
  private async conflictAfterLostRace(
    eventId: string,
    records: readonly SubmittedRecord[],
    actor: Actor,
  ): Promise<ApiError | null> {
    const personIds = records.map((record) => record.person_id);
    const live = await this.liveRecords(this.db, eventId, personIds);
    const identities = await this.people.forDecisionsWithin(this.db, personIds);

    const stale = firstStaleLine(records, live);

    if (stale === null) {
      return null;
    }

    return this.conflictFor(
      this.db,
      actor,
      stale.record,
      stale.stored,
      identities.get(stale.record.person_id),
    );
  }

  private async actorNameFor(
    executor: Db,
    accountId: string,
  ): Promise<{ id: string; name: string }> {
    // On the caller's executor, which for the in-transaction conflict is the
    // transaction. `findById` reads the pool, and section 14 makes a conflict an
    // ordinary outcome rather than a rare one — so reaching the pool here would ask
    // for a second connection while holding one, on a path taken every time two
    // leaders disagree.
    const account = await executor
      .selectFrom('accounts')
      .select('person_id')
      .where('id', '=', accountId)
      .executeTakeFirst();

    if (account === undefined) {
      // Unreachable while `recorded_by` carries a foreign key, and answered rather
      // than thrown: a conflict a person cannot read is worse than one naming an
      // account it cannot resolve.
      return { id: accountId, name: 'an account that no longer exists' };
    }

    return this.personNameFor(executor, account.person_id, accountId);
  }

  private async personNameFor(
    executor: Db,
    personId: string,
    renderedId: string,
  ): Promise<{ id: string; name: string }> {
    const person = await this.people.forDecisionWithin(executor, personId);

    return { id: renderedId, name: person?.fullName ?? 'somebody' };
  }

  private renderEvent(event: EventForRecording): Record<string, unknown> {
    return {
      id: event.id,
      event_date: event.eventDate,
      recordable: event.notRecordable === null,
      not_recordable_reason: event.notRecordable,
      removed: event.removedAt !== null,
      removal_reason: event.removalReason,
    };
  }
}

/** Section 22: `limit` defaults to 50. The DTO bounds it at 200. */
const DEFAULT_PAGE = 50;

/**
 * Section 9's partial unique index over the live row, named because a lost race on it
 * is a conflict and a violation of anything else is a defect (migration 0011).
 */
const ONE_LIVE_INDEX = 'dcc_attendance_one_live';

function keyOf(line: RosterLine): RosterCursor {
  return { lastName: line.lastName, firstName: line.firstName, memberId: line.memberId };
}

/**
 * Lexicographic over the three keys, in order.
 *
 * `localeCompare` deliberately, matching how the lines are sorted — a comparison that
 * ordered differently from the sort would put the page boundary somewhere the sort
 * never placed it, and rows either side of it would be skipped or repeated.
 */
function compareKeys(left: RosterCursor, right: RosterCursor): number {
  return (
    left.lastName.localeCompare(right.lastName) ||
    left.firstName.localeCompare(right.firstName) ||
    left.memberId.localeCompare(right.memberId)
  );
}

function renderLine(line: RosterLine): Record<string, unknown> {
  return {
    person_id: line.personId,
    member_id: line.memberId,
    full_name: line.fullName,
    responsible_leader_id: line.responsibleLeaderId,
    record:
      line.record === null
        ? null
        : {
            present: line.record.present,
            version: line.record.version,
            recorded_at: line.record.recordedAt.toISOString(),
          },
  };
}

/**
 * Section 14's version check, as one function because it is one rule.
 *
 * The first line whose submitted version disagrees with what is stored, **in the
 * order the client sent** — that is the line it can find in its own request.
 *
 * **A line that writes nothing takes no part in it** (section 9). A covering leader
 * on a stale roster, submitting a value that already agrees, would otherwise be
 * refused a `VERSION_CONFLICT` whose two sides carry the identical value, which
 * section 22 says cannot satisfy section 14 — and, because this reports the *first*
 * disagreement, such a line would also mask the honest conflict about whoever actually
 * lost a race further down the list.
 *
 * **One function because there are two callers and they were allowed to disagree.**
 * The in-transaction check and the re-read after a lost race are the same rule at two
 * moments, and the batch that added the unchanged-line exemption changed only one of
 * them: every conflict reported after a race reinstated the response the exemption
 * exists to prevent, on the path nobody had a case for.
 */
function firstStaleLine(
  records: readonly SubmittedRecord[],
  live: Map<string, LiveRecord>,
): { record: SubmittedRecord; stored: LiveRecord | null } | null {
  for (const record of records) {
    const stored = live.get(record.person_id) ?? null;

    if (outcomeFor(stored, record.present) === 'UNCHANGED') {
      continue;
    }

    if (record.version !== (stored === null ? null : stored.version)) {
      return { record, stored };
    }
  }

  return null;
}

function canonical(id: string): string {
  return id.toLowerCase();
}

function outcomeFor(stored: LiveRecord | null, present: boolean): LineOutcome {
  if (stored === null) {
    return 'CREATE';
  }

  return stored.present === present ? 'UNCHANGED' : 'CORRECT';
}

/** Whether the actor holds this capability at Whole Church (decision 0172). */
function holdsWholeChurch(authority: ActorAuthority, capability: Capability): boolean {
  return authority.grants.some(
    (grant) => grant.capability === capability && grant.scope.type === ScopeType.WholeChurch,
  );
}

/**
 * One name twice is two claims about one record, and the second would supersede the
 * first inside a single request — so one submission would carry its own history.
 * Refused rather than de-duplicated: which of the two the leader meant is not
 * something this can decide.
 */
function assertNamesEachPersonOnce(records: readonly SubmittedRecord[]): void {
  const seen = new Set<string>();

  for (const record of records) {
    const key = canonical(record.person_id);

    if (seen.has(key)) {
      throw new InvariantViolationError(
        'This submission names the same person twice. Send one line per person.',
        { person_id: record.person_id },
      );
    }

    seen.add(key);
  }
}

function refusalFor(event: EventForRecording): ApiError {
  switch (event.notRecordable) {
    case 'REMOVED':
      return new InvariantViolationError(
        'This Sunday carries no DCC service, so there is no attendance to record ' +
          '(SKILL.md section 9).',
        { event_id: event.id, event_date: event.eventDate, removal_reason: event.removalReason },
      );

    case 'NOT_YET_HELD':
      return new InvariantViolationError('This DCC service has not taken place yet.', {
        event_id: event.id,
        event_date: event.eventDate,
      });

    default:
      // Section 22 gives this month its own code rather than folding it into
      // `INVARIANT_VIOLATION`: the record is not wrong, the period is shut, and only
      // an Admin may amend it (sections 13 and 20).
      return new ApiError(
        ApiErrorCode.PERIOD_CLOSED,
        'This month is closed. Only an Admin may amend it, with a reason (SKILL.md sections 13 ' +
          'and 20).',
        { event_id: event.id, event_date: event.eventDate },
      );
  }
}
