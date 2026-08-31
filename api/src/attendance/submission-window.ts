import { sql } from 'kysely';

import { manilaDayOf, startOfManilaDay } from '../common/time/manila';

import type { Db } from '../database/database.module';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The monthly submission window (SKILL.md sections 9, 13 and 20).
 *
 * "Attendance for a calendar month may be recorded or corrected until the 7th of
 * the following month, at 23:59 Asia/Manila. After that the month is closed." One
 * rule, three sites, and it governs both attendance domains identically.
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

/** The first day of the Manila calendar month a date-only day falls in. */
export function reportingMonthOf(day: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(day);
  if (match === null) {
    throw new Error(`"${day}" is not a YYYY-MM-DD date.`);
  }

  return `${match[1]}-${match[2]}-01`;
}

/**
 * The instant a reporting month's window shuts.
 *
 * **The end of the 7th, not 23:59:00 on it.** The specification says "until the 7th
 * of the following month, at 23:59", and read to the letter that leaves the last
 * sixty seconds of the 7th closed — a dead minute nobody states, nobody intends,
 * and no leader could discover except by being refused inside it. The reading
 * implemented is "through the end of the 7th", which is what "until the 7th, at
 * 23:59" says in ordinary use.
 *
 * Written down because it is a boundary an implementer has to pick and the
 * specification does not pick it. If the literal reading is wanted, this is the one
 * line to change.
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
