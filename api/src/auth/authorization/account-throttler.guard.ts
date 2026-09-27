import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { TokensService } from '../tokens.service';

import { bearerToken } from './access-token.guard';
import { PUBLIC_METADATA } from './authorization.decorators';

/**
 * The rate limit, counted per signed-in account rather than per address (SKILL.md
 * section 24).
 *
 * **Many phones can share one address**: a mobile carrier puts its customers behind a
 * few public addresses, and a church's wifi is one. Counted per address, a room of
 * leaders signed in at church shares one allowance and is refused together. A request
 * carrying a valid access token is counted against its account instead.
 *
 * **Only a token whose signature verifies is trusted for this**, so a client cannot
 * escape the limit by sending a made-up identity. A request with no token or an invalid
 * one, which includes every sign-in, is counted per address as before.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  @Inject(TokensService) private readonly tokens!: TokensService;

  protected override async getTracker(
    req: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<string> {
    // A route that needs no sign-in — sign-in itself, refresh, the password flows — is
    // always counted per address, whatever token it carries, so holding several
    // accounts buys no extra attempts at it.
    const isPublic =
      context !== undefined &&
      this.reflector.getAllAndOverride<string | undefined>(PUBLIC_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) !== undefined;
    const headers = req.headers as { authorization?: string } | undefined;
    const token = isPublic ? null : bearerToken(headers?.authorization);

    if (token !== null) {
      try {
        return `account:${this.tokens.verifyAccessToken(token).sub}`;
      } catch {
        // Not a token this API issued: counted per address below.
      }
    }

    return super.getTracker(req);
  }
}
