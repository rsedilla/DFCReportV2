import { ValidateBy, buildMessage, isEmail, type ValidationOptions } from 'class-validator';

import { isStorableText } from './storable-text';

/**
 * An email address, checked in an order that cannot throw (SKILL.md section 22).
 *
 * **`@IsEmail` answers 500 on an unpaired surrogate, and not because of the database.**
 * `validator`'s `isEmail` calls `encodeURI` inside its own length check, and `encodeURI`
 * throws `URIError: URI malformed` on a lone surrogate. The throw escapes the validator and
 * leaves through the `ValidationPipe` as `INTERNAL_ERROR` — section 22's named failure mode,
 * arriving before any decorator ordering could matter, because class-validator runs every
 * validator on a property and collects their answers rather than stopping at the first.
 *
 * Two of the three routes carrying this field are unauthenticated — signing in and asking
 * for a password reset — which made it the one defect of this class reachable by somebody
 * with no account.
 *
 * **Storability first, and that ordering is the whole decorator.** `isStorableText` refuses
 * exactly the values `isEmail` cannot survive, and refuses them without calling anything
 * that can throw; `&&` then never evaluates `isEmail` on one. The result is a single answer
 * for both — `VALIDATION_FAILED` naming the field, which is what a client can act on.
 *
 * **This is section 22's storability rule reaching a field that does not accept arbitrary
 * text**, which is why decision 0198's coverage check cannot see it: `email` refuses a
 * harmless string and is classified as format-constrained, so the check skips it by design.
 * A format validator is not thereby excused — it stores a `text` column like any other, and
 * a format that cannot be *evaluated* on a value is a worse failure than one that rejects
 * it. Decision 0200 states that.
 */
export const IS_EMAIL_ADDRESS = 'isEmailAddress';

export function IsEmailAddress(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_EMAIL_ADDRESS,
      validator: {
        validate: (value: unknown): boolean => isStorableText(value) && isEmail(value),
        defaultMessage: buildMessage((prefix) => `${prefix}must be an email address`, options),
      },
    },
    options,
  );
}
