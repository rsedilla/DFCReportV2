import { IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../credentials.service';

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
 * **The length bounds are declared here as well as in the service**, and that is
 * not belt-and-braces for its own sake: the DTO is what a client can read off a
 * 422, and the service is what holds the rule for any caller that does not arrive
 * through this controller. Both cite section 6 and both take the same constants,
 * so they cannot drift.
 */
export class SetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
