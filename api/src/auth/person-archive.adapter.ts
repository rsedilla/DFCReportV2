import { Injectable } from '@nestjs/common';

import { AccountAccessService } from './account-access.service';
import { TokensService } from './tokens.service';

import type { Db } from '../database/database.module';
import type { Database } from '../database/schema';
import type { ArchiveAccountsPort } from '../people/person-archive.ports';
import type { Transaction } from 'kysely';

/**
 * `auth`'s half of archiving a Person (SKILL.md section 6, decision 0397), behind `people`'s
 * `ARCHIVE_ACCOUNTS_PORT`: which account the Person holds, and disabling it in the archive's
 * own transaction when the archiver chose *Disable account access*.
 */
@Injectable()
export class PersonArchiveAccountsAdapter implements ArchiveAccountsPort {
  constructor(
    private readonly access: AccountAccessService,
    private readonly sessions: TokensService,
  ) {}

  async accountOfWithin(
    executor: Transaction<Database>,
    personId: string,
  ): Promise<{ id: string; status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED' } | null> {
    // Locked, so a re-enable racing an archive or a merge waits for it and then sees the
    // Person it belongs to as that left it (decision 0408): a re-enable locks this same row
    // before checking the Person, so whichever comes second decides on what the first wrote.
    const account = await executor
      .selectFrom('accounts')
      .select(['id', 'status'])
      .where('person_id', '=', personId)
      .forNoKeyUpdate()
      .executeTakeFirst();

    return account ?? null;
  }

  async disableWithin(
    executor: Transaction<Database>,
    accountId: string,
    actorAccountId: string,
  ): Promise<void> {
    await this.access.disableWithin(executor, accountId, actorAccountId);
  }

  async endNetworkAdminSessionsWithin(
    executor: Transaction<Database>,
    personId: string,
  ): Promise<void> {
    const holder = await executor
      .selectFrom('accounts')
      .innerJoin('account_roles', 'account_roles.account_id', 'accounts.id')
      .select('accounts.id')
      .where('accounts.person_id', '=', personId)
      .where('account_roles.role', '=', 'NETWORK_ADMIN')
      .where('account_roles.revoked_at', 'is', null)
      .executeTakeFirst();

    if (holder) {
      await this.sessions.revokeAllSessionsWithin(executor, holder.id);
    }
  }

  async personOfAccountWithin(
    executor: Db | Transaction<Database>,
    accountId: string,
  ): Promise<string | null> {
    const account = await executor
      .selectFrom('accounts')
      .select('person_id')
      .where('id', '=', accountId)
      .executeTakeFirst();

    return account?.person_id ?? null;
  }
}
