import { sql } from 'kysely';

import { ValidationFailedError } from '../errors/api-error';

import { isCalendarDate, manilaDayOf, startOfManilaDay } from './manila';

import type { Db } from '../../database/database.module';
import type { Database } from '../../database/schema';
import type { Transaction } from 'kysely';

/**
 * The monthly submission window (SKILL.md sections 9, 13 and 20).
 *
 * "Attendance for a calendar month may be recorded or corrected until the **end of
 * the 7th** of the following month, Asia/Manila. The first instant the month is shut
 * is 00:00 on the 8th." One rule, three sites in the specification, and it governs
 * both attendance domains identically.
 *
 * **Every instant here comes from the database, never from this process**, which is
 * the commitment decision 0160 made when it recorded that the deployment runs one
 * API instance. The instance count is what makes an account-wide revocation
 * comparison exact today; a month boundary is a comparison of the same kind, and
 * the ruling says in terms that Stage 4 is written so a second instance never has
 * to revisit it. Both ends of the comparison read from one clock every instance
 * shares.
 *
 * That is why the predicates take an executor rather than a `now`. A caller that
 * could pass its own instant is a caller that will, and the host clock is exactly
 * the wrong one.
 */

/**
 * The first day of the Manila calendar month a date-only day falls in.
 *
 * **`isCalendarDate` rather than a shape check**, so a day that does not exist is
 * refused here rather than turned into a plausible month. The shape check this
 * replaced accepted `2026-13-05` and answered `2026-13-01`, which `windowClosesAt`
 * then rolled through `Date.UTC` into a real instant — so an impossible month
 * reported an open window instead of refusing, and every caller downstream believed
 * it. Refusing at the first function that reads the value keeps the error where a
 * reader can attribute it.
 */
export function reportingMonthOf(day: string): string {
  if (!isCalendarDate(day)) {
    // **`ValidationFailedError`, not `Error`, and the first version threw the latter.**
    // Every value reaching here comes from a client or from the database, and the
    // exception filter renders an unrecognised `Error` as `INTERNAL_ERROR` — so a
    // refusal thrown as a plain error turns a client's bad date into a 500. It did:
    // the listing route validated only the shape, so `2026-02-30` reached this and
    // answered 500 where it had previously answered 200.
    //
    // The edge is where such a value should be refused, and both DTOs and the guard now
    // do it. This is the backstop for the next caller that forgets, and a backstop that
    // answers 500 is not one.
    throw new ValidationFailedError(`"${day}" is not a date that exists.`, { field: 'date' });
  }

  return `${day.slice(0, 7)}-01`;
}

/**
 * The instant a reporting month's window shuts.
 *
 * **The end of the 7th** (sections 9, 13 and 20, and the ruling of 2026-08-31). The
 * first instant a month is shut is 00:00 on the 8th, Asia/Manila.
 *
 * Section 13 said "at 23:59" until that ruling, which read to the letter left the
 * last sixty seconds of the 7th closed — a gap nobody wrote and no leader could
 * discover, since being refused at 23:59:30 contradicts every published statement
 * of the deadline. The specification now says "the end of the 7th" at all three
 * sites, so this is no longer an implementer's choice and the flag that stood here
 * naming this line as the one to change is gone with it.
 */
export function windowClosesAt(reportingMonth: string): Date {
  const match = /^(\d{4})-(\d{2})-01$/.exec(reportingMonth);
  if (match === null) {
    throw new Error(`"${reportingMonth}" is not the first of a month.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  // The 8th of the following month at 00:00 Manila is the first instant the month
  // is shut, so the window is `instant < this`. Plain calendar arithmetic for the
  // rollover: `Date.UTC` is the vehicle for December, not a claim about the zone.
  const next = new Date(Date.UTC(year, month, 8));

  return startOfManilaDay(
    `${String(next.getUTCFullYear()).padStart(4, '0')}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
      next.getUTCDate(),
    ).padStart(2, '0')}`,
  );
}

/**
 * The Monday of the first week with a deadline (decision 0335). A record dated before it
 * keeps the monthly close and is never Late.
 *
 * **Movable in the test suite alone**, because no real clock reaches a closed week of the
 * new rule before 23 November 2026: `WEEKLY_DEADLINE_FROM` is read only where `NODE_ENV`
 * is `test`, and refused if it is not a Monday that exists.
 */
export function weeklyDeadlineFrom(): string {
  const override = process.env.WEEKLY_DEADLINE_FROM;
  if (process.env.NODE_ENV === 'test' && override !== undefined && override !== '') {
    if (!isCalendarDate(override) || weekStartOf(override) !== override) {
      throw new Error(`WEEKLY_DEADLINE_FROM "${override}" is not a Monday.`);
    }
    return override;
  }

  return '2026-10-26';
}

/** The Monday of the Monday-to-Sunday week a day falls in (decision 0054). */
export function weekStartOf(day: string): string {
  if (!isCalendarDate(day)) {
    throw new ValidationFailedError(`"${day}" is not a date that exists.`, { field: 'date' });
  }
  const [year, month, date] = day.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, date));
  // getUTCDay: Sunday 0 … Saturday 6, so Monday is six days back from a Sunday.
  const back = (probe.getUTCDay() + 6) % 7;

  return new Date(Date.UTC(year, month - 1, date - back)).toISOString().slice(0, 10);
}

function plusDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** 12:00 Asia/Manila on a day. The zone keeps no daylight saving (section 20). */
function noonOf(day: string): Date {
  return new Date(startOfManilaDay(day).getTime() + 12 * 60 * 60 * 1000);
}

/**
 * When the record dated `day` is due: 12 noon on the second Monday after its week, eight days
 * after its Sunday (decisions 0335 and 0387). Null for a week before
 * {@link weeklyDeadlineFrom}, which had no deadline.
 */
export function recordDueAt(day: string): Date | null {
  const week = weekStartOf(day);

  return week < weeklyDeadlineFrom() ? null : noonOf(plusDays(week, 14));
}

/**
 * The first instant no leader may record or correct the record dated `day`: two Mondays
 * after its deadline at 12 noon, or for a week before the weekly rule the end of the
 * 7th of the month after its own (decisions 0335 and 0387).
 */
export function recordClosesAt(day: string): Date {
  const week = weekStartOf(day);

  return week < weeklyDeadlineFrom()
    ? windowClosesAt(reportingMonthOf(day))
    : noonOf(plusDays(week, 28));
}

/**
 * The instant a month closes: when its last week closes, the week holding its last day,
 * which always closes last (decision 0335). Every "open" flag on a month reads this.
 */
export function monthClosesAt(reportingMonth: string): Date {
  const first = reportingMonthOf(reportingMonth);
  const [year, month] = first.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  return recordClosesAt(last);
}

/** Whether a leader may still record the record dated `day`, on the database's clock. */
export async function isRecordOpen(
  executor: Db | Transaction<Database>,
  day: string,
): Promise<boolean> {
  return (await databaseNow(executor)).getTime() < recordClosesAt(day).getTime();
}

/** The instant the database is at. Every window decision is made against this. */
export async function databaseNow(executor: Db | Transaction<Database>): Promise<Date> {
  const result = await sql<{ at: Date }>`SELECT clock_timestamp() AS at`.execute(executor);

  return result.rows[0].at;
}

/**
 * Whether a reporting month is still open, decided on the database's clock: until its
 * last week closes (decision 0335). This is the month as a figure; whether a record may
 * still be written is {@link isRecordOpen}, by the record's week.
 */
export async function isMonthOpen(
  executor: Db | Transaction<Database>,
  reportingMonth: string,
): Promise<boolean> {
  return (await databaseNow(executor)).getTime() < monthClosesAt(reportingMonth).getTime();
}

/** The reporting month of the day the database is currently in. */
export async function currentReportingMonth(executor: Db | Transaction<Database>): Promise<string> {
  return reportingMonthOf(manilaDayOf(await databaseNow(executor)));
}
