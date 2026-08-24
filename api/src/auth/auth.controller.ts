import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthService, type SessionTokens } from './auth.service';
import { AuthenticatedOnly, Public } from './authorization/authorization.decorators';
import { CredentialsService } from './credentials.service';
import { CurrentActor } from './current-actor.decorator';
import { LoginDto, LogoutDto, RefreshDto } from './dto/auth.dto';
import { ForgotPasswordDto, SetPasswordDto } from './dto/credentials.dto';

import type { Actor } from './authorization/authorization.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: CredentialsService,
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
  async activate(@Body() body: SetPasswordDto): Promise<void> {
    await this.credentials.activate(body.token, body.password);
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

  /** Redeems a reset token and replaces the password (section 6). */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public('The reset token is the credential; the holder cannot sign in.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(@Body() body: SetPasswordDto): Promise<void> {
    await this.credentials.resetPassword(body.token, body.password);
  }

  /**
   * Rate limited more tightly than the rest of the API: sign-in is the endpoint
   * worth guessing against (SKILL.md section 24).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public('Sign-in is how a session begins; there is no token to present yet.')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: LoginDto): Promise<SessionTokens> {
    return this.auth.login(body.email, body.password, body.device_label ?? null);
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
