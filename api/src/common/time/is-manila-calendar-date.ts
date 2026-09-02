import { ValidateBy, buildMessage, type ValidationOptions } from 'class-validator';

import { isCalendarDate } from './manila';

/**
 * A date-only field is a `YYYY-MM-DD` Asia/Manila day that **exists** (SKILL.md
 * section 22, ruling of 2026-09-02).
 *
 * **One decorator over one predicate, and that is the whole point of it.** Section
 * 22 fixes the format and now fixes the refusal, and it requires both to be decided
 * by a single predicate so a field added later cannot get a different answer by
 * copying a different neighbour. Before this there were three conventions for one
 * rule in this codebase: `@Matches` alone on `CloseCellDto.effective_date`, `@Matches`
 * plus `@IsDateString({ strict: true })` on every date `people.dto.ts` takes, and
 * `isCalendarDate` in the capability guard — and the field carrying the loosest of the
 * three wrote a Cell closure effective on a day nobody named.
 *
 * **It replaces the pair rather than joining it**, because it does both halves of what
 * the pair did. `@IsDateString({ strict: true })` refuses a date that does not exist
 * and accepts a full ISO timestamp, which section 22 forbids — "never send a date-only
 * field as a timestamp; the conversion is where months silently shift" — so `@Matches`
 * was there for the shape. `isCalendarDate` anchors the shape itself, so one decorator
 * says what two said.
 *
 * **The pair and this predicate agree on every well-shaped value, and the replacement
 * is therefore a consolidation rather than a fix.** That was checked rather than
 * assumed: 7,854 candidates over seventeen years, months 00 to 13 and days 00 to 32,
 * with no divergence — including years 1 to 99, where `isCalendarDate` diverges from
 * PostgreSQL's `::date` and `@IsDateString({ strict: true })` turns out to refuse the
 * same values it does. A first draft of this paragraph claimed that case as a
 * behavioural difference, and a mutation restoring the pair caught it by surviving.
 *
 * What the consolidation buys is not a stricter answer on these fields. It is that
 * `CloseCellDto.effective_date` cannot be written again — a field acquiring the
 * *loosest* of several conventions because that is what its nearest neighbour carried.
 *
 * A refusal leaves through the global `ValidationPipe`'s exception factory, so it is
 * `VALIDATION_FAILED` with the field named — which is what section 22 asks for and is
 * the difference between a client being told and a route answering `INTERNAL_ERROR`.
 */
export const IS_MANILA_CALENDAR_DATE = 'isManilaCalendarDate';

export function IsManilaCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_MANILA_CALENDAR_DATE,
      validator: {
        // `typeof` first: `isCalendarDate` takes a string, and a client can send a
        // number, an object or an array under any field name. A validator that throws
        // is a 500 on a value this exists to refuse.
        validate: (value: unknown): boolean => typeof value === 'string' && isCalendarDate(value),
        defaultMessage: buildMessage(
          (prefix) =>
            `${prefix}must be a plain YYYY-MM-DD Asia/Manila date that exists ` +
            '(SKILL.md section 22)',
          options,
        ),
      },
    },
    options,
  );
}
