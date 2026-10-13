import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { NotFoundError, ValidationFailedError } from '../common/errors/api-error';
import { isUniqueViolation } from '../common/errors/postgres-errors';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { PeopleReadService } from '../people/people.read.service';

import { AccountTokensService } from './account-tokens.service';
import {
  USERNAME_PATTERN,
  canonicalUsername,
  nextFreeUsername,
  usernameBase,
  usernameTaken,
} from './usernames';

import type { Actor } from './authorization/authorization.service';
import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/** The one refusal for a link that cannot be used, as activation gives it (section 6). */
const LINK_NO_LONGER_VALID = 'That link is no longer valid. Ask for a new one.';

/**
 * Usernames (SKILL.md section 6, decision 0337): the suggestion, and setting one.
 *
 * **Only the holder sets their own**: on activation, where the activation token is the
 * credential, and on their Account page, where their session is. Nothing here takes an
 * account identifier from a request, so no route can set somebody else's.
 */
@Injectable()
export class UsernamesService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly accountTokens: AccountTokensService,
    private readonly people: PeopleReadService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * The suggestion for the account an activation token belongs to, without redeeming the
   * token. A token that could not activate is answered as activation answers it, so this
   * says nothing activation would not.
   */
  async suggestionForActivation(token: string): Promise<Suggestion> {
    return this.db.transaction().execute(async (trx) => {
      const accountId = await this.accountTokens.accountForLiveTokenWithin(
        trx,
        token,
        'ACTIVATION',
      );
      const account =
        accountId === null
          ? undefined
          : await trx
              .selectFrom('accounts')
              .select(['id', 'person_id', 'status'])
              .where('id', '=', accountId)
              .executeTakeFirst();

      if (!account || account.status === 'DISABLED') {
        throw new ValidationFailedError(LINK_NO_LONGER_VALID, { field: 'token' });
      }

      return this.suggestWithin(trx, account.id, account.person_id);
    });
  }

  /** The suggestion for the caller's own account. */
  async suggestionFor(actor: Actor): Promise<Suggestion> {
    return this.db
      .transaction()
      .execute((trx) => this.suggestWithin(trx, actor.accountId, actor.personId));
  }

  /**
   * Sets or changes the caller's own username, audited, the old name free at once. The same
   * name again writes nothing and is not audited.
   */
  async setOwn(actor: Actor, raw: string, claim: CurrentClaim): Promise<{ username: string }> {
    const username = assertUsernameShape(raw);

    return this.db.transaction().execute(async (trx) => {
      await this.setWithin(trx, actor.accountId, username);

      const body = { username };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }

  /**
   * Writes the name on the account, in the caller's transaction, refusing one another
   * account holds. The holder is the actor, on both paths that reach this.
   */
  async setWithin(trx: Transaction<Database>, accountId: string, username: string): Promise<void> {
    const account = await trx
      .selectFrom('accounts')
      .select(['id', 'username'])
      .where('id', '=', accountId)
      .forNoKeyUpdate()
      .executeTakeFirst();

    if (!account) {
      throw new NotFoundError('No such account.');
    }

    if (account.username === username) {
      return;
    }

    if (await usernameTaken(trx, username, accountId)) {
      throw takenError();
    }

    try {
      await trx
        .updateTable('accounts')
        .set({ username, updated_at: new Date() })
        .where('id', '=', accountId)
        .execute();
    } catch (error) {
      // Two people choosing one name at once: the unique index decides, and the loser is
      // answered as if it had been taken when they asked.
      if (isUniqueViolation(error)) {
        throw takenError();
      }
      throw error;
    }

    await this.audit.writeWithin(trx, {
      actorId: accountId,
      action: 'account.username_set',
      targetType: 'account',
      targetId: accountId,
      before: { username: account.username },
      after: { username },
    });
  }

  private async suggestWithin(
    trx: Transaction<Database>,
    accountId: string,
    personId: string,
  ): Promise<Suggestion> {
    const person = await this.people.forDecisionWithin(trx, personId);
    const base = usernameBase({
      firstName: person?.firstName ?? '',
      middleName: person?.middleName ?? null,
      lastName: person?.lastName ?? '',
    });
    const username = await nextFreeUsername(trx, base, accountId);

    // The screen says when the plain name was taken (decision 0337, point 4).
    return { username, taken: base.length >= 3 && username !== base ? base : null };
  }
}

/** A suggested username, and the plain one it moved from where that was taken. */
export type Suggestion = { username: string; taken: string | null };

/** The name, lowercased, or a refusal naming the field (decision 0337). */
export function assertUsernameShape(raw: string): string {
  const username = canonicalUsername(raw);

  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationFailedError(
      'A username is 3 to 30 letters and numbers, starting with a letter.',
      { field: 'username' },
    );
  }

  return username;
}

function takenError(): ValidationFailedError {
  return new ValidationFailedError('That username is taken. Try another.', { field: 'username' });
}
