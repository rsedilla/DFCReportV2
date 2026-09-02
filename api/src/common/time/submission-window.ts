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

/** The instant the database is at. Every window decision is made against this. */
export async function databaseNow(executor: Db | Transaction<Database>): Promise<Date> {
  const result = await sql<{ at: Date }>`SELECT clock_timestamp() AS at`.execute(executor);

  return result.rows[0].at;
}

/**
 * Whether a reporting month is still open, decided on the database's clock.
 *
 * The month a record belongs to is the one whose window governs it — for a Cell
 * meeting that is `reporting_month`, which a reschedule never moves (section 13),
 * and for DCC it is the month of the event date.
 */
export async function isMonthOpen(
  executor: Db | Transaction<Database>,
  reportingMonth: string,
): Promise<boolean> {
  return (await databaseNow(executor)).getTime() < windowClosesAt(reportingMonth).getTime();
}

/** The reporting month of the day the database is currently in. */
export async function currentReportingMonth(executor: Db | Transaction<Database>): Promise<string> {
  return reportingMonthOf(manilaDayOf(await databaseNow(executor)));
}
