import { Inject, Injectable } from '@nestjs/common';
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
import { isUniqueViolation } from '../common/errors/postgres-errors';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { decodeRosterCursor, encodeRosterCursor, type RosterCursor } from '../common/roster-cursor';
import { endOfManilaDay, startOfManilaDay } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';

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
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const conflict = await this.conflictAfterLostRace(eventId, records, actor);

      // No conflict to report means the violation came from somewhere this does not
      // understand, and hiding it behind a 409 would report contention where there is
      // a defect.
      throw conflict ?? error;
    }
  }

  private async writeWithin(
    eventId: string,
    records: readonly SubmittedRecord[],
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.db.transaction().execute(async (trx) => {
      const event = await this.eventForRecording(trx, eventId);

      if (event.notRecordable !== null) {
        throw refusalFor(event);
      }

      assertNamesEachPersonOnce(records);

      const authority = await this.authorization.authorityFor(actor.accountId);
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
        const stored = live.get(personId) ?? null;
        const outcome = outcomeFor(stored, record.present);

        this.assertRecordable(personId, identities.get(personId), assignments.get(personId));

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
      for (const { record } of planned) {
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
    const dayEnd = endOfManilaDay(eventDate);

    // Section 9: the direct pastoral leader in force at the latest instant of the
    // event's Manila day that has already passed. Clamped to now rather than fixed
    // at the day's end, so a record written during the service resolves against an
    // instant that has happened; taken from the day's end rather than its start, so
    // the VIP added at the service has the leader they were just placed under.
    const at = now.getTime() < dayEnd.getTime() ? now : dayEnd;

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
   * `hierarchy` may not join to (section 2). The cost is one round trip per level of
   * account-less chain, normally one. The cycle safety a recursive query would take
   * from `CYCLE` is the visited set below, which is not optional: section 5 requires
   * every walk to detect a cycle rather than trust the data, and an undetected one
   * here is a request that never returns.
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
          throw new InvariantViolationError(
            'The pastoral tree contains a cycle and cannot be resolved. This is a data defect: ' +
              'report it rather than retrying.',
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
    const names = await this.people.namesOf(recordable);

    const lines: RosterLine[] = recordable.map((personId) => {
      const identity = identities.get(personId);

      return {
        personId,
        memberId: names.get(personId)?.memberId ?? '',
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

  private assertRecordable(
    personId: string,
    identity: { isArchived: boolean; mergedIntoId: string | null } | undefined,
    assignment: { leaderId: string | null } | undefined,
  ): void {
    if (identity === undefined) {
      throw new NotFoundError('No such person.', { person_id: personId });
    }

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

    // An unchanged line writes nothing, so it is governed by the capability that
    // would have written it in the first place rather than by the correction one: a
    // leader resubmitting an identical checklist is submitting, not correcting.
    const recording =
      params.outcome === 'CORRECT' ? Capability.DccCorrectSubtree : Capability.DccTakeAttendance;

    if (!(await this.authorization.coversWith(executor, actor, authority, recording, target))) {
      throw new ScopeDeniedError(
        params.outcome === 'CORRECT'
          ? 'Correcting this person’s DCC record is outside your scope.'
          : 'Recording this person’s DCC attendance is outside your scope.',
        { capability: recording, person_id: personId },
      );
    }

    if (params.onChecklist) {
      return;
    }

    if (
      !(await this.authorization.coversWith(
        executor,
        actor,
        authority,
        Capability.DccSubmitOnBehalf,
        target,
      ))
    ) {
      throw new ScopeDeniedError(
        'This person is recorded by another leader, and submitting on their behalf is outside ' +
          'your scope.',
        { capability: Capability.DccSubmitOnBehalf, person_id: personId },
      );
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

      if (stored !== null) {
        // Supersede first, on a predicate that also serializes. Two concurrent
        // corrections of one record both read version N; the second matches no row
        // here, because the first has already closed it. That is the conflict
        // section 14 requires, caught without a lock of its own — and it is the one
        // ordering the deferred `superseded_by` foreign key permits, since the
        // successor does not exist yet.
        await trx
          .updateTable('dcc_attendance')
          .set({ superseded_at: new Date(), superseded_by: successorId })
          .where('id', '=', stored.id)
          .where('superseded_at', 'is', null)
          .execute();

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

      await trx
        .insertInto('dcc_attendance')
        .values({
          id: successorId,
          dcc_event_id: params.event.id,
          person_id: personId,
          present: record.present,
          // Frozen on the first row and carried by every successor. Section 9 fixes
          // it as of the event and section 14 lists it among what a correction
          // preserves — re-resolving it would move a recorded attendance between
          // leaders' totals inside a period that may have closed.
          responsible_leader_id:
            stored === null
              ? (params.assignments.get(personId)?.leaderId ?? null)
              : stored.responsibleLeaderId,
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
        responsibleLeaderId: params.assignments.get(personId)?.leaderId ?? null,
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
        },
        reason: params.reason,
      });

      return;
    }

    // On behalf, in section 14's sense: the record belongs to somebody else's
    // obligation. Measured against the **responsible leader** rather than against
    // the checklist, because the checklist already includes the people a covering
    // upline submits for — and section 9 says a covering submission is on behalf.
    const onBehalf =
      params.responsibleLeaderId !== null &&
      !sameId(params.responsibleLeaderId, params.actor.personId);

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

    for (const record of records) {
      const stored = live.get(record.person_id) ?? null;
      const current = stored === null ? null : stored.version;

      if (record.version !== current) {
        return this.conflictFor(this.db, actor, record, stored, identities.get(record.person_id));
      }
    }

    return null;
  }

  private async actorNameFor(
    executor: Db,
    accountId: string,
  ): Promise<{ id: string; name: string }> {
    const account = await this.accounts.findById(accountId);

    if (account === null) {
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
