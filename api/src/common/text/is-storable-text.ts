import { ValidateBy, buildMessage, type ValidationOptions } from 'class-validator';

import { isStorableText } from './storable-text';

/** Named here and used here, matching `IS_MANILA_CALENDAR_DATE`. */
export const IS_STORABLE_TEXT = 'isStorableText';

/**
 * The section 22 storability rule as a decorator (decision 0198).
 *
 * The rule and its scope are stated in section 22; the predicate is
 * `storable-text.ts`; and `test/unit/storable-text-coverage.spec.ts` derives which fields
 * must carry this and fails naming any that does not.
 *
 * **Nothing about the scope is restated here, deliberately.** Four versions of this
 * docblock described it, and all four were wrong — twice claiming fields it did not guard,
 * then denying one it did when a shared DTO class carried it into a second route. That is
 * the failure decision 0198 exists to end: the scope lived in a comment, so being wrong
 * about it was undetectable. It now lives in the specification, with a check that goes red.
 *
 * A refusal leaves through the global `ValidationPipe`, so it is `VALIDATION_FAILED` with
 * the field named — except inside a nested DTO, where the filter names the outer field
 * only, which is recorded as open in `CLAUDE.md`.
 */
export function IsStorableText(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_STORABLE_TEXT,
      validator: {
        // `typeof` first: a client can send a number, an object or an array under any field
        // name, and a validator that throws is a 500 on a value this exists to refuse.
        validate: (value: unknown): boolean => isStorableText(value),
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
