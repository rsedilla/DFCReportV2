import { IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import type { AccountRole } from '../../database/schema';

/**
 * The roles a provisioning request may name today (SKILL.md section 6).
 *
 * `LEADER` is deliberately absent from the *service's* qualifying set and
 * deliberately **present** here. A DTO rejecting it would answer
 * `VALIDATION_FAILED` — "this is not a role" — when the truth is that it is a real
 * role whose qualification cannot be checked until Stage 3. The service refuses it
 * with `INVARIANT_VIOLATION` and says so, which is the answer an administrator can
 * act on.
 */
const ROLES: AccountRole[] = ['ADMIN', 'SENIOR_PASTOR', 'LEADER'];

export class ProvisionAccountDto {
  /** The Person the account belongs to. One Person has at most one Account. */
  @IsUUID()
  person_id!: string;

  /**
   * Required and unique after normalization (section 6).
   *
   * Section 3 keeps email off the Person deliberately — it exists solely as a
   * login credential, and making it a Person field would let a leader repoint a
   * downline leader's address and take the account through a password reset.
   */
  @IsEmail()
  @MaxLength(320)
  email!: string;

  /** The role that qualifies the account. Provisioned together, never after. */
  @IsIn(ROLES)
  role!: AccountRole;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

/**
 * Setting a password with a token, for activation and for reset alike.
 *
 * **The length is not checked here, and that is deliberate.** An earlier version
 * carried `@MinLength`/`@MaxLength` alongside the service's own check, on the
 * reasoning that both took the same constants and so could not drift. They shared
 * the constants and not the *counting rule*: `class-validator` counts UTF-16
 * units and section 6 counts characters, so a 128-code-point passphrase
 * containing astral characters is 256 units and was refused by the pipe — while
 * the unit tests asserted the service accepts exactly that input.
 *
 * One rule in one place, in `assertPasswordIsAcceptable`, which counts code
 * points and is reached by every caller including any that does not arrive
 * through this controller. `@IsString` stays, because a non-string is malformed
 * in a way length has nothing to say about.
 */
export class SetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  password!: string;
}
