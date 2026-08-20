import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthService, type SessionTokens } from './auth.service';
import { AuthenticatedOnly, Public } from './authorization/authorization.decorators';
import { CurrentActor } from './current-actor.decorator';
import { LoginDto, LogoutDto, RefreshDto } from './dto/auth.dto';

import type { Actor } from './authorization/authorization.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
