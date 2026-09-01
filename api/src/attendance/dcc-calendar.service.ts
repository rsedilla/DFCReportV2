import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { manilaDayOf, startOfManilaDay } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import type { Json } from '../database/schema';

import { databaseNow, isMonthOpen, reportingMonthOf } from '../common/time/submission-window';

/**
 * How far ahead a run generates, and the floor it is kept clear of.
 *
 * Section 9 requires "at least twelve months ahead" and the generation target is
 * thirteen, because a top-up *to* the floor satisfies it at the instant it runs and
 * at no instant afterwards. The command is scheduled monthly, so an ordinary run
 * never approaches twelve.
 */
const HORIZON_MONTHS = 13;
const FLOOR_MONTHS = 12;

export interface CalendarRun {
  /** The Sundays created, in order. Empty on a run that had nothing to do. */
  readonly created: readonly string[];
  /** How far the calendar now reaches, printed on every run (section 9). */
  readonly horizon: string | null;
  /** Set on the run that first establishes it, null on every run after. */
  readonly calendarStart: string | null;
  /**
   * Months whose window has shut and which are short a Sunday.
   *
   * Reported and never repaired. Section 9: adding a Sunday to a month whose window
   * has shut creates an event no leader was ever able to submit against, so every
   * leader reads as having failed to record for it — the failure section 13 exists
   * to prevent, reached through a remedy rather than through a status.
   */
  readonly closedMonthsShort: readonly string[];
  /** True where the horizon is inside section 9's twelve-month floor. */
  readonly belowFloor: boolean;
}

/**
 * The DCC calendar (SKILL.md section 9, Generating the DCC calendar).
 *
 * **Its own service rather than a script**, because section 2 requires imports and
 * bulk writes to execute through the domain layer, and because a script cannot be
 * tested. `scripts/generate-dcc.ts` parses arguments and prints; every rule is here.
 */
@Injectable()
export class DccCalendarService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * Top the calendar up, and report what it found.
   *
   * Idempotent: it inserts the Sundays that have no row, and `dcc_events.event_date`
   * is unique, so a second run — or two racing — changes nothing the second time.
   * That is a property of the table rather than of this method, deliberately, so it
   * holds for anything else that ever writes the calendar.
   */
  async generate(): Promise<CalendarRun> {
    return this.db.transaction().execute(async (trx) => {
      const now = await databaseNow(trx);
      const today = manilaDayOf(now);

      // The floor. Set once, by this run if nobody has set it, and never moved
      // afterwards (ruling of 2026-08-31). It records when this church's calendar
      // began, so a report over an earlier range says "before we started" rather
      // than "no service".
      const existingStart = await this.readCalendarStart(trx);
      const calendarStart = existingStart ?? sundayOnOrBefore(today);

      if (existingStart === null) {
        await trx
          .updateTable('settings')
          // `settings.value` is `jsonb`, so a date goes in as a JSON string rather
          // than as bare text — `to_jsonb` rather than a cast, which would refuse
          // `2026-08-30` as invalid JSON. The read below unwraps it the same way.
          .set({ value: sql<Json>`to_jsonb(${calendarStart}::text)`, updated_at: now })
          .where('key', '=', 'dcc_calendar_start')
          .execute();
      }

      const sundays = sundaysBetween(calendarStart, addMonths(today, HORIZON_MONTHS));

      // Every Sunday already carrying a row, removed or not. A removed Sunday keeps
      // its row (section 9), so it is not missing and is never revived.
      const present = new Set(
        (
          await trx
            .selectFrom('dcc_events')
            .select('event_date')
            .where('event_date', '>=', calendarStart)
            .execute()
        ).map((row) => row.event_date),
      );

      const missing = sundays.filter((day) => !present.has(day));

      // Split by whether the month is still open. Only the open ones are filled.
      const creatable: string[] = [];
      const closedShort = new Set<string>();

      for (const day of missing) {
        const month = reportingMonthOf(day);

        if (await isMonthOpen(trx, month)) {
          creatable.push(day);
        } else {
          closedShort.add(month);
        }
      }

      if (creatable.length > 0) {
        await trx
          .insertInto('dcc_events')
          .values(creatable.map((event_date) => ({ event_date })))
          .execute();

        // One entry per event created, because section 21 requires a target and one
        // entry per action performed. A run that creates none writes none.
        for (const day of creatable) {
          await this.audit.writeWithin(trx, {
            // A system action: the command is invoked by a schedule and has no
            // interactive actor, which section 6 now names as one of two things
            // permitted to write this null.
            actorId: null,
            action: 'dcc_event.created',
            targetType: 'dcc_event',
            targetId: day,
            after: { event_date: day },
          });
        }
      }

      const horizon = await this.horizonWithin(trx);

      return {
        created: creatable,
        horizon,
        calendarStart: existingStart === null ? calendarStart : null,
        closedMonthsShort: [...closedShort].sort(),
        belowFloor: horizon === null || horizon < addMonths(today, FLOOR_MONTHS),
      };
    });
  }

  /**
   * How far the calendar reaches, which section 9 requires be surfaced.
   *
   * The latest event date, removed or not: a removed Sunday still says the calendar
   * was generated that far. This is what the command prints on every run and what
   * the Admin dashboard carries once there is one.
   */
  async horizon(): Promise<string | null> {
    return this.horizonWithin(this.db);
  }

  private async horizonWithin(
    executor: Db | Parameters<typeof databaseNow>[0],
  ): Promise<string | null> {
    const row = await (executor as Db)
      .selectFrom('dcc_events')
      .select('event_date')
      .orderBy('event_date', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row?.event_date ?? null;
  }

  private async readCalendarStart(executor: Db): Promise<string | null> {
    const row = await executor
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'dcc_calendar_start')
      .executeTakeFirstOrThrow();

    return typeof row.value === 'string' ? row.value : null;
  }
}

/** The Sunday on or before a Manila day. ISO day 7 is Sunday. */
export function sundayOnOrBefore(day: string): string {
  const at = startOfManilaDay(day);
  const isoDay = isoDayOf(day);

  return manilaDayOf(new Date(at.getTime() - (isoDay % 7) * 86_400_000));
}

/** Every Sunday from `from` to `to` inclusive, in order. */
export function sundaysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  let day = isoDayOf(from) === 7 ? from : nextSunday(from);

  while (day <= to) {
    days.push(day);
    day = manilaDayOf(new Date(startOfManilaDay(day).getTime() + 7 * 86_400_000));
  }

  return days;
}

function nextSunday(day: string): string {
  const forward = 7 - isoDayOf(day);
  return manilaDayOf(new Date(startOfManilaDay(day).getTime() + forward * 86_400_000));
}

/**
 * The ISO weekday of a Manila day, 1 (Monday) to 7 (Sunday).
 *
 * Computed from the calendar date rather than from a `Date`'s local weekday, which
 * would answer in whatever zone the process happens to run in — the mistake section
 * 20 spends a paragraph on.
 */
function isoDayOf(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) {
    throw new Error(`"${day}" is not a YYYY-MM-DD date.`);
  }

  const weekday = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();

  // `getUTCDay` is 0 for Sunday; ISO 8601 is 7.
  return weekday === 0 ? 7 : weekday;
}

/** The same day-of-month, `months` later, clamped to the month's length. */
function addMonths(day: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) {
    throw new Error(`"${day}" is not a YYYY-MM-DD date.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1 + months;
  const dayOfMonth = Number(match[3]);

  // Clamped rather than allowed to roll over: 31 January plus one month is 28
  // February, not 3 March. The horizon is a bound rather than a date anybody reads,
  // so rolling over would quietly extend it — which is the wrong direction for a
  // figure section 9 checks against a floor.
  const lastOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const at = new Date(Date.UTC(year, month, Math.min(dayOfMonth, lastOfTarget)));

  return `${String(at.getUTCFullYear()).padStart(4, '0')}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(
    at.getUTCDate(),
  ).padStart(2, '0')}`;
}
