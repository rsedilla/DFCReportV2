import { ValidateBy, buildMessage, type ValidationOptions } from 'class-validator';

/**
 * Free text a client sends that PostgreSQL can actually store (SKILL.md section 22).
 *
 * **A `text` column refuses two things a JSON string may legally contain**, and both reach
 * the database as a well-formed request that answers `INTERNAL_ERROR` — section 22's named
 * failure mode, and the shape this route has now produced six times:
 *
 * - **U+0000.** PostgreSQL rejects a null byte in `text` outright. `"venue \u0000 closed"`
 *   is a valid JSON string, passes `@IsString()` and `@MaxLength()`, and 500s on the way in.
 * - **A lone surrogate.** `"\uD800"` is a valid JavaScript string and is not well-formed
 *   Unicode, so it has no UTF-8 encoding for the wire.
 *
 * **A validator rather than a service guard, and rather than normalisation.** This is a
 * property of the *string* rather than of the domain: no section of `SKILL.md` gives a null
 * byte a meaning, so there is nothing for a domain layer to decide and nothing a leader
 * meant by it. Refusing it at the edge answers `VALIDATION_FAILED` with the field named,
 * which is what a client needs to fix it. Stripping the character instead would store text
 * nobody wrote, silently.
 *
 * **Applied to every free-text field on a route rather than to the one that broke**, on the
 * evidence of this file's neighbours: the null class in `cell-meetings.service.ts` took four
 * fixes because each closed one read and left the next open, and the reschedule note reached
 * this rule only because a fix made a previously-discarded field reach a column. A field
 * bounded by `@IsString()` and a length is bounded against neither of these.
 *
 * Every value a person can type passes. What it refuses is a value no keyboard produces.
 */
/**
 * A high surrogate with no low one after it, or a low surrogate with no high one before it.
 *
 * `String.prototype.isWellFormed` says this in one call and needs `lib: es2024`; this file is
 * not the place to move the whole project's target, so the pair is matched directly.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const IS_STORABLE_TEXT = 'isStorableText';

export function IsStorableText(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_STORABLE_TEXT,
      validator: {
        // `typeof` first: a client can send a number, an object or an array under any field
        // name, and a validator that throws is a 500 on a value this exists to refuse.
        validate: (value: unknown): boolean =>
          typeof value === 'string' && !value.includes('\u0000') && !LONE_SURROGATE.test(value),
        defaultMessage: buildMessage(
          (prefix) =>
            `${prefix}must not contain a null byte or an unpaired surrogate ` +
            '(SKILL.md section 22)',
          options,
        ),
      },
    },
    options,
  );
}
