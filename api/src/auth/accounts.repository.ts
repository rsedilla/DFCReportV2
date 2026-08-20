import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type Db } from '../database/database.module';

import type { AccountStatus } from '../database/schema';

export interface AccountRecord {
  id: string;
  person_id: string;
  email: string;
  password_hash: string | null;
  status: AccountStatus;
  sessions_revoked_at: Date | null;
}

/** The `auth` module owns `accounts`, `account_tokens` and `refresh_tokens`. */
@Injectable()
export class AccountsRepository {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async findById(id: string): Promise<AccountRecord | null> {
    const row = await this.db
      .selectFrom('accounts')
      .select(['id', 'person_id', 'email', 'password_hash', 'status', 'sessions_revoked_at'])
      .where('id', '=', id)
      .executeTakeFirst();

    return row ?? null;
  }

  async findByEmail(email: string): Promise<AccountRecord | null> {
    const row = await this.db
      .selectFrom('accounts')
      .select(['id', 'person_id', 'email', 'password_hash', 'status', 'sessions_revoked_at'])
      .where('email_normalized', '=', normalizeEmail(email))
      .executeTakeFirst();

    return row ?? null;
  }

  async recordLogin(id: string): Promise<void> {
    await this.db
      .updateTable('accounts')
      .set({ last_login_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
}

/**
 * Email is unique after normalization (SKILL.md section 6). Case and surrounding
 * whitespace are the whole of it: anything cleverer, such as stripping dots or
 * plus-addressing, would treat two addresses the church considers different as
 * one.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
