import { ValidateBy, type ValidationArguments, type ValidationOptions } from 'class-validator';

import { birthdayOutOfRange, isCalendarDate, manilaDayOf } from './manila';

export const IS_BIRTHDAY_IN_RANGE = 'isBirthdayInRange';

/**
 * A birthday is a day from 1 January 1900 to today in Manila (SKILL.md section 3, decision
 * 0487), refused at the edge as `VALIDATION_FAILED` on `birth_date`.
 *
 * It judges only a value that is already a calendar date: anything else is
 * `IsManilaCalendarDate`'s to refuse, and answering it twice would put two messages on one
 * mistake. `typeof` first, so a value of any type is refused rather than thrown on (decision
 * 0200).
 */
export function IsBirthdayInRange(options?: ValidationOptions): PropertyDecorator {
  const reason = (value: unknown): string | null =>
    typeof value === 'string' && isCalendarDate(value)
      ? birthdayOutOfRange(value, manilaDayOf(new Date()))
      : null;

  return ValidateBy(
    {
      name: IS_BIRTHDAY_IN_RANGE,
      validator: {
        validate: (value: unknown): boolean => reason(value) === null,
        defaultMessage: (args?: ValidationArguments): string =>
          reason(args?.value) ?? 'A birthday must be a day from 1900 to today.',
      },
    },
    options,
  );
}
