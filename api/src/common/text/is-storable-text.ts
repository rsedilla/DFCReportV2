import { ValidateBy, buildMessage, type ValidationOptions } from 'class-validator';

/**
 * A high surrogate with no low one after it, or a low surrogate with no high one before it.
 *
 * `String.prototype.isWellFormed` says this in one call and needs `lib: es2024`; this file is
 * not the place to move the whole project's target, so the pair is matched directly. The two
 * agree on every input: checked against `isWellFormed` over every code unit and over every
 * two-unit combination across the surrogate range, with no divergence.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Named here and used here, matching `IS_MANILA_CALENDAR_DATE`. */
export const IS_STORABLE_TEXT = 'isStorableText';

/**
 * Free text a client sends that PostgreSQL can store as written (SKILL.md section 22).
 *
 * **Two things a JSON string may legally contain that a `text` column will not keep**, and
 * they fail differently — which matters, because the difference decides whether a field
 * without this decorator is merely unguarded or actively lossy:
 *
 * - **U+0000 is refused by the database.** `invalid byte sequence for encoding "UTF8": 0x00`,
 *   which surfaces as `INTERNAL_ERROR` on a well-formed request — section 22's named failure
 *   mode. Loud, and reachable on this route wherever the decorator is absent.
 * - **A lone surrogate is accepted and silently changed.** `node-postgres` substitutes
 *   U+FFFD, so `"a\uD800b"` is stored as three characters, the middle one a replacement mark,
 *   and the request answers 201. Quiet, and worse: the record then says a leader wrote
 *   something they did not write.
 *
 * *An earlier version of this file said the lone surrogate "has no UTF-8 encoding for the
 * wire" and answers `INTERNAL_ERROR`. It does not — inserted directly it returns 201 storing
 * U+FFFD, which was measured against the database only after a reviewer disputed it. The
 * wrong mechanism made every field lacking this decorator look safer than it is, by implying
 * the failure is one a client would be told about.*
 *
 * **Refused rather than stripped or substituted.** No section of `SKILL.md` gives either
 * character a meaning, so there is nothing for a domain layer to decide and nothing a leader
 * meant by it; refusing at the edge answers `VALIDATION_FAILED` with the field named, which
 * is what a client needs in order to fix it. The alternative is to accept the substitution,
 * and that stores text nobody typed.
 *
 * **A valid surrogate pair is unaffected**, which is the case that matters in practice: an
 * emoji is two code units and is well formed, so a note typed on a phone passes. Every value
 * a person can type passes; what this refuses is a value no keyboard produces.
 *
 * **Where it is applied is not derivable, because section 22 states no storability rule.**
 * It guards `correction_reason` and `not_held_note` on the Cell meeting submit route, and
 * `ClosedMonthAmendmentDto.reason` — which `dcc.dto.ts` also uses, so the DCC submit route's
 * amendment reason is guarded too. Free-text fields it does not reach are recorded as open
 * in `CLAUDE.md`.
 *
 * *Two versions of this paragraph have now described the wrong scope: the first claimed
 * every free-text field on a route while one field of that route's DTO was undecorated, and
 * the second called the rule route-scoped when a shared DTO class carries it across routes.
 * Check the imports of the classes this decorates before restating it.*
 */
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
