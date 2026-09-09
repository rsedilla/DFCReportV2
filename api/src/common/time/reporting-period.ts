import { ValidationFailedError } from '../errors/api-error';
import { isCalendarDate, startOfManilaDay } from './manila';
import { databaseNow } from './submission-window';

import type { Db } from '../../database/database.module';
import type { Database } from '../../database/schema';
import type { Transaction } from 'kysely';

/**
 * The instants a reporting period spans, in Asia/Manila (SKILL.md section 20).
 *
 * **The end is the last millisecond of the period's final day** (decision 0208), which is
 * what `endOfManilaDay` computes for section 13's closure boundary. Not the next day's
 * midnight: assignment rows are in force over `[started_at, ended_at)`, so a row beginning
 * exactly at midnight belongs to the following day, and handing that instant back would
 * place a November edge in October's tree. A millisecond rather than a microsecond, because
 * that is the resolution a `timestamptz` and a JavaScript `Date` share.
 *
 * **Here in `common/time`, and it was in `reporting` until the guard needed it.** The
 * argument for keeping it beside the reports was that the arithmetic is generic and the
 * *rule* is not, so a reader looking for why it is 23:59:59.999 should meet the reasoning
 * rather than a bare helper. That reasoning is kept — it is the paragraph above — and what
 * moved it is decision 0214: the capability guard resolves a report's scope at the same
 * instant the figures use, and **the same** is a property of sharing one function rather
 * than of two derivations agreeing. `auth` importing from `reporting` would have been the
 * wrong direction, so the shared thing moved to where shared things live.
 *
 * *The paragraph this replaces argued against the move, in the commit that performed it.*
 */
export interface ReportingPeriod {
  /** Midnight on the first of the month, Asia/Manila. */
  start: Date;
  /** The last millisecond of the month's final day, Asia/Manila. */
  end: Date;
}

/**
 * `reportingMonth` is the first of a month, and is the caller's to validate — every caller
 * of this is downstream of `assertReportingMonth`, which refuses anything else and names
 * `period` as the field. Deriving bounds from an unvalidated month is what produced a
 * refusal quoting a month nobody sent (decision 0185's shape, one call earlier).
 *
 * **That includes December 9999**, which is a real month and a valid date and whose
 * successor is not writable as `YYYY-MM-DD`. `assertReportingMonth` refuses it for that
 * reason; without it the successor built below is `10000-01-01`, `startOfManilaDay` refuses
 * *that*, and the caller is told `date` about a month they never wrote. The bound belongs
 * to the validator rather than here, because here the field name is already lost.
 *
 * **The end is one millisecond before the next month begins**, which is exactly
 * `endOfManilaDay` of the final day without having to name that day. A first version did
 * name it — stepping back inside the previous Manila day and rendering it with a second
 * `toLocaleDateString`, beside the shared formatter `manila.ts` exports as `manilaDayOf`.
 * That produced two implementations of an instant-to-Manila-day rendering in a repository
 * that has one on purpose, and its docblock described a 24-hour step while the code took a
 * 12-hour one. The subtraction is the same arithmetic `endOfManilaDay` performs, with the
 * intermediate day removed.
 *
 * The month string is built from its parts rather than by adding milliseconds, so December
 * rolls the year over on its own and no month length is assumed.
 */
export function reportingPeriodBounds(reportingMonth: string): ReportingPeriod {
  const [year, month] = reportingMonth.split('-').map(Number);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const firstOfNext = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;

  return {
    start: startOfManilaDay(reportingMonth),
    end: new Date(startOfManilaDay(firstOfNext).getTime() - 1),
  };
}

/**
 * A reporting month is the first of a month, which is this repository's existing spelling
 * of one (`submission-window.ts`). Anything else is refused rather than answered.
 *
 * **The month comparison in the query is a string comparison and its correctness rests on
 * the shape.** `to_char` zero-pads, so a `YYYY-MM` prefix sorts lexicographically exactly
 * as it sorts chronologically — but only against a well-formed argument. A month written
 * `2027-1` matches nothing and sorts *before* `2027-10`, so a malformed value would yield a
 * plausible, understated report rather than an error. That is the shape decision 0185
 * refuses for a date-only field and decision 0200 for a format validator, and an
 * understated report is worse than a refused one because nobody can see it is wrong.
 *
 * **It composes `isCalendarDate` rather than writing a fifth regex**, which is section 22's
 * one-predicate rule: "One rather than several, because the alternative is what this system
 * actually had: three conventions for a single rule." A hand-written
 * `\d{4}-(0[1-9]|1[0-2])-01` admitted `0026-01-01`, which `isCalendarDate` refuses and
 * documents why — `Date.UTC(26, ...)` applies the legacy two-digit-year mapping, so that
 * month's window would have been computed from 1926. No wrong answer was producible, since
 * every such year is past and `open` is false either way; it is the class of divergence the
 * rule exists to stop.
 *
 * **The refusal names the field**, which section 22 requires because it is what a client
 * needs in order to fix it, and which every other `ValidationFailedError` in this
 * application does.
 *
 * `ValidationFailedError` rather than a plain `Error`: `reportingMonthOf` records why, in
 * this same domain. The exception filter renders an unrecognised `Error` as
 * `INTERNAL_ERROR`, so a refusal thrown as one turns a client's bad month into a 500.
 *
 * **Exported, because this is no longer the first thing to touch the value.** Leader scope
 * derives a period's bounds before any figure is read, and deriving them from an unvalidated
 * month produced a refusal naming `date` and quoting a month the caller never sent — decision
 * 0185's shape, one call earlier. Whoever touches a reporting month first calls this.
 */
export function assertReportingMonth(reportingMonth: string): void {
  if (!isCalendarDate(reportingMonth) || !reportingMonth.endsWith('-01')) {
    throw new ValidationFailedError('A reporting month is the first of a month, as YYYY-MM-01.', {
      field: 'period',
      value: reportingMonth,
    });
  }

  // **December 9999 is refused here, and it is the last month this format can express.**
  // Every date in this system is `YYYY-MM-DD` with a four-digit year, so `9999-12` is the
  // only month whose *successor* is not writable — and a period's end is derived from that
  // successor. Left to reach the derivation it threw naming `date` and quoting
  // `10000-01-01`, a month no caller sent: decision 0185's shape, and the identical
  // signature to the `2020-13-01` case this function was reordered to close. Refused where
  // the field is still `period`, rather than closed one call later where it is not.
  if (reportingMonth.startsWith('9999-12')) {
    throw new ValidationFailedError(
      'A reporting month must be before December 9999, which is the last month this date format can express.',
      { field: 'period', value: reportingMonth },
    );
  }
}

/**
 * The same rule as a predicate, for a caller that must refuse in its own words.
 *
 * The capability guard is the one: it names the request path it read the month from
 * (`query.period`), where this function's own refusal names `period`. Both are correct
 * for their caller and neither may drift from the other, so the predicate is derived from
 * the assertion rather than restating its two rules.
 */
export function isReportingMonth(value: string): boolean {
  try {
    assertReportingMonth(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A report may not name a period that has not begun (decision 0216, SKILL.md section 20).
 *
 * **Section 9 already refuses the write in these words** — "an event whose Manila day has
 * not begun takes no attendance record" — and a period that can hold no record is a period
 * there is nothing to report on. What makes the read worth refusing rather than answering
 * is that the answer is not blank: the DCC calendar runs thirteen months ahead, so a future
 * month carries a real `n` and a populated coverage denominator, and the report comes back
 * complete, well-formed, and saying that nobody in the church attended anything.
 * `assertReportingMonth` above makes the same argument about a malformed month — an
 * understated report is worse than a refused one, because nobody can see it is wrong.
 *
 * **The clock is the database's, never this process's.** A period's beginning is a month
 * boundary, and `databaseNow` carries the convention for every one of those: decision 0160
 * settled that a caller able to pass its own instant is a caller that will.
 *
 * **Separate from `assertReportingMonth` rather than folded into it**, because that
 * function is the capability guard's predicate through `isReportingMonth`, which runs
 * synchronously in `resolveReportScope` with no executor in reach. Folding this in would
 * mean either the host clock in the guard or an async validator in a synchronous path.
 * That function bounds the shape and the two bounds that need no clock; this one needs one.
 *
 * The comparison is against the period's **start**, which is the rule written out.
 * `currentReportingMonth` would give the exactly equivalent `period > currentMonth`; the
 * alternative is noted in decision 0216 so it is not read as an oversight.
 *
 * `reportingMonth` is the caller's to validate, as it is for every function in this file —
 * `startOfManilaDay` refuses a malformed value naming `date`, which is the wrong field.
 *
 * **The refusal names the caller's own field and quotes the caller's own value**, which
 * `named` supplies. It defaulted to `period` and to the normalised month, which is right
 * for `reporting` — its DTOs carry a field called `period` and hand this the value they
 * received — and became wrong the moment a second caller arrived: `GET /api/v1/cells`
 * carries `month` and normalises it first, so `?month=2026-11-15` was refused as
 * `{ field: 'period', value: '2026-11-01' }`, naming a field the request does not have
 * and quoting a month nobody sent. Section 22 asks a refusal to name the field "which is
 * what a client needs in order to fix it", and this file's own neighbour records the same
 * shape one call earlier.
 */
export async function assertReportingPeriodHasBegun(
  executor: Db | Transaction<Database>,
  reportingMonth: string,
  named: { field: string; value: string } = { field: 'period', value: reportingMonth },
): Promise<void> {
  const now = await databaseNow(executor);

  if (startOfManilaDay(reportingMonth).getTime() > now.getTime()) {
    throw new ValidationFailedError(
      'A report covers a period that has begun. This one has not started yet.',
      { field: named.field, value: named.value },
    );
  }
}
