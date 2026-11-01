import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ValidationFailedError } from '../common/errors/api-error';

import { AuthService, type SessionTokens } from './auth.service';
import { AuthenticatedOnly, Public } from './authorization/authorization.decorators';
import { CredentialsService } from './credentials.service';
import { CurrentActor } from './current-actor.decorator';
import {
  LoginDto,
  LogoutDto,
  RefreshDto,
  SecondStepConfirmDto,
  SecondStepDto,
  SecondStepSetupDto,
} from './dto/auth.dto';
import {
  SecondStepService,
  type SecondStepChallenge,
  type SecondStepSetup,
} from './second-step.service';
import {
  ActivateDto,
  ActivationTokenDto,
  ChangeEmailDto,
  ChangePasswordDto,
  ConfirmEmailDto,
  ForgotPasswordDto,
  SetPasswordDto,
  SetUsernameDto,
} from './dto/credentials.dto';
import { UsernamesService, type Suggestion } from './usernames.service';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';

import type { Actor } from './authorization/authorization.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: CredentialsService,
    private readonly secondSteps: SecondStepService,
    private readonly usernames: UsernamesService,
  ) {}

  /**
   * Sets the first password on a provisioned account (SKILL.md section 6).
   *
   * On section 7's unauthenticated list: the holder has no session yet, and the
   * activation token *is* the credential. No `Idempotency-Key` for the same reason
   * — section 22 keys the store by account, and there is no authenticated account
   * here. The token's own single-use claim is what makes a replay safe.
   */
  @Post('activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public('The activation token is the credential; the holder has no session yet.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async activate(@Body() body: ActivateDto): Promise<void> {
    // A null username is an omitted one (decision 0199).
    await this.credentials.activate(body.token, body.password, body.username ?? undefined);
  }

  /**
   * The suggested username for an activation token, without using the token up (decision
   * 0337). Part of activation on section 7's unauthenticated list; the token is the credential,
   * and an unusable one is answered as activation answers it.
   */
  @Post('activate/username-suggestion')
  @HttpCode(HttpStatus.OK)
  @Public('Part of activation; the activation token is the credential.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async activationUsernameSuggestion(@Body() body: ActivationTokenDto): Promise<Suggestion> {
    return this.usernames.suggestionForActivation(body.token);
  }

  /** The caller's own suggested username (decision 0337). */
  @Get('username-suggestion')
  // Ten a minute per account (owner, Q7): each answer reads which names are held.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuthenticatedOnly('Suggests a username for the caller’s own account, from their own name.')
  async usernameSuggestion(@CurrentActor() actor: Actor): Promise<Suggestion> {
    return this.usernames.suggestionFor(actor);
  }

  /** Sets or changes the caller's own username (decision 0337). */
  @Post('username')
  @HttpCode(HttpStatus.OK)
  // Ten a minute per account (owner, Q7): a "taken" refusal shows an account exists.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuthenticatedOnly('Sets the username of the caller’s own account, not anything of the church.')
  async setUsername(
    @CurrentActor() actor: Actor,
    @Body() body: SetUsernameDto,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<{ username: string }> {
    return this.usernames.setOwn(actor, body.username, claim);
  }

  /**
   * Changes the caller's own password, asking the current one (section 6, decision 0351).
   * Every other session ends; this device's, named by its refresh token, is kept.
   */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Ten a minute per account: each wrong current password is a guess.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuthenticatedOnly(
    'Changes the password of the caller’s own account, not anything of the church.',
  )
  async changePassword(
    @CurrentActor() actor: Actor,
    @Body() body: ChangePasswordDto,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<void> {
    await this.credentials.changePassword(
      actor,
      body.current_password,
      body.new_password,
      body.refresh_token,
      claim,
    );
  }

  /**
   * Asks to change the caller's own email address, giving the current password (section 6,
   * decision 0415). A link goes to the new address; nothing changes until it is confirmed.
   */
  @Post('email')
  @HttpCode(HttpStatus.NO_CONTENT)
  // As `password`: each wrong current password is a guess, and each request sends an email.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuthenticatedOnly('Changes the email of the caller’s own account, not anything of the church.')
  async requestEmailChange(
    @CurrentActor() actor: Actor,
    @Body() body: ChangeEmailDto,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<void> {
    await this.credentials.requestEmailChange(actor, body.new_email, body.current_password, claim);
  }

  /**
   * Confirms a new email address from the link sent to it (section 6, decision 0415).
   *
   * On section 7's unauthenticated list: the link is the credential, opened wherever the
   * mail is read. No `Idempotency-Key`, as for activation; the token's single-use claim
   * makes a replay safe.
   */
  @Post('email/confirm')
  @HttpCode(HttpStatus.OK)
  @Public('The link sent to the new address is the credential.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async confirmEmailChange(@Body() body: ConfirmEmailDto): Promise<{ email: string }> {
    return this.credentials.confirmEmailChange(body.token);
  }

  /**
   * Begins a password reset, and answers identically whether or not the address
   * holds an account (section 6, Password reset security).
   *
   * 204 in both cases, and the service does comparable work in both, because a
   * measurable difference is the same disclosure the identical body exists to
   * prevent.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public('Somebody who cannot sign in is the only person who needs this.')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.credentials.requestPasswordReset(body.email);
  }

  /**
   * Redeems a reset token and replaces the password (section 6), answering with the proof
   * that signs this browser in through a pause for fifteen minutes (decision 0413).
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Public('The reset token is the credential; the holder cannot sign in.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(@Body() body: SetPasswordDto): Promise<{ sign_in_proof: string }> {
    return this.credentials.resetPassword(body.token, body.password);
  }

  /**
   * Rate limited more tightly than the rest of the API: sign-in is the endpoint
   * worth guessing against (SKILL.md section 24).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public('Sign-in is how a session begins; there is no token to present yet.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: LoginDto): Promise<SessionTokens | SecondStepChallenge> {
    // One or the other (decision 0337). An explicit null means what omitting the key
    // means (decision 0199): `@IsOptional()` lets null past every validator.
    const email = body.email ?? undefined;
    const username = body.username ?? undefined;
    if ((email === undefined) === (username === undefined)) {
      throw new ValidationFailedError('Send either an email address or a username.');
    }
    return this.auth.login(
      email !== undefined ? { email } : { username: username as string },
      body.password,
      body.device_label ?? null,
      body.reset_proof ?? null,
    );
  }

  /**
   * The second sign-in step of an `ADMIN` or `SENIOR_PASTOR` account (section 6,
   * decision 0302). Part of sign-in on section 7's unauthenticated list: the ticket
   * sign-in issued is the credential. Limited as tightly as sign-in, on top of the five
   * wrong codes a ticket allows.
   */
  @Post('second-step')
  @HttpCode(HttpStatus.OK)
  @Public('Part of sign-in; the ticket from the password step is the credential.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async secondStep(@Body() body: SecondStepDto): Promise<SessionTokens> {
    if ((body.code === undefined) === (body.recovery_code === undefined)) {
      throw new ValidationFailedError('Send either a code or a recovery code.');
    }
    return this.secondSteps.verify(
      body.challenge,
      { code: body.code, recoveryCode: body.recovery_code },
      body.device_label ?? null,
    );
  }

  /** Setup, first half: the secret to add to an authenticator app (section 6). */
  @Post('second-step/setup')
  @HttpCode(HttpStatus.OK)
  @Public('Part of sign-in; the ticket from the password step is the credential.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async startSetup(@Body() body: SecondStepSetupDto): Promise<SecondStepSetup> {
    return this.secondSteps.startSetup(body.challenge);
  }

  /**
   * Setup, second half: one code proves the app holds the secret, and the session and
   * the ten recovery codes are returned. The codes are shown once and never again.
   */
  @Post('second-step/setup/confirm')
  @HttpCode(HttpStatus.OK)
  @Public('Part of sign-in; the ticket from the password step is the credential.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async confirmSetup(
    @Body() body: SecondStepConfirmDto,
  ): Promise<SessionTokens & { recovery_codes: string[] }> {
    return this.secondSteps.confirmSetup(body.challenge, body.code, body.device_label ?? null);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Public('The refresh token is the credential; the access token it renews has expired by then.')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Body() body: RefreshDto): Promise<SessionTokens> {
    return this.auth.refresh(body.refresh_token, body.device_label ?? null);
  }

  /** Ends this device's session and no other. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthenticatedOnly('Acts on the session of the caller, not on church data.')
  async logout(@CurrentActor() actor: Actor, @Body() body: LogoutDto): Promise<void> {
    await this.auth.logout(actor, body.refresh_token);
  }

  /** Ends every session this account holds, on every device, immediately. */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthenticatedOnly('Ends the sessions of the caller, not anything belonging to the church.')
  async logoutAll(@CurrentActor() actor: Actor): Promise<void> {
    await this.auth.logoutEverywhere(actor);
  }

  @Get('me')
  @AuthenticatedOnly('Returns the session of the caller and its grants, and no church data.')
  async me(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    return this.auth.describe(actor);
  }
}
