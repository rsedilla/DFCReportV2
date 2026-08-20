import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { UnauthenticatedError } from '../../common/errors/api-error';
import { AccountsRepository } from '../accounts.repository';
import { TokensService } from '../tokens.service';

import { PUBLIC_METADATA } from './authorization.decorators';

import type { Actor } from './authorization.service';

export interface AuthenticatedRequest extends Request {
  actor?: Actor;
}

/**
 * Authenticates. It does not authorize: that is `CapabilityGuard`, which runs
 * after it.
 *
 * The API stays stateless in the sense section 2 requires, holding no server-side
 * session and no per-request state, and any instance can serve any request. What
 * it does not do is trust a signature unconditionally: every request also checks
 * the account's `sessions_revoked_at` against the token's issued-at, because an
 * access token has no row of its own to revoke and section 6 requires revocation
 * to take effect immediately, on all devices.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly accounts: AccountsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return false;
    }

    const isPublic = this.reflector.getAllAndOverride<string | undefined>(PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic !== undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (token === null) {
      throw new UnauthenticatedError();
    }

    const claims = this.tokens.verifyAccessToken(token);
    const account = await this.accounts.findById(claims.sub);

    if (account === null || account.status !== 'ACTIVE') {
      // Disabling account access takes effect immediately rather than only
      // blocking future sign-ins (section 6, Account access at archive).
      throw new UnauthenticatedError('Your session has ended. Sign in again.');
    }

    if (isRevoked(account.sessions_revoked_at, claims.iat)) {
      throw new UnauthenticatedError('Your session has ended. Sign in again.');
    }

    request.actor = { accountId: account.id, personId: account.person_id };
    return true;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return null;
  }

  return value;
}

/**
 * `iat` is whole seconds, while `sessions_revoked_at` has sub-second precision,
 * so a token minted in the same second as a revocation cannot be ordered against
 * it. The comparison is inclusive, which rejects that token: erring towards
 * ending a session the holder can restart by signing in, rather than towards
 * honouring one an administrator has just revoked.
 */
function isRevoked(revokedAt: Date | null, issuedAtSeconds: number): boolean {
  if (revokedAt === null) {
    return false;
  }

  return issuedAtSeconds * 1000 <= revokedAt.getTime();
}
