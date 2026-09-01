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

  /**
   * Which of these people hold an account, whatever state it is in.
   *
   * **Holding an account, not being able to sign in.** Section 9 routes a DCC
   * submission to "the nearest upline leader who does" hold one, and is explicit
   * that a pending account can persist and that the covering arrangement must
   * persist with it. So the question this answers is whether a row exists, and a
   * `PENDING` account stops the upward walk exactly as an `ACTIVE` one does.
   *
   * That is uncomfortable and is deliberate: a leader whose account was minted and
   * never activated becomes their own submitter and can file nothing. The remedy is
   * provisioning (section 6), not a walk that quietly steps over a state somebody is
   * supposed to fix — and a walk that skipped pending accounts would hide it.
   *
   * Here rather than in `attendance` because `auth` owns `accounts` (section 2), and
   * the query is rooted in this table rather than in the caller's.
   */
  async personsHoldingAccounts(executor: Db, personIds: readonly string[]): Promise<Set<string>> {
    if (personIds.length === 0) {
      return new Set();
    }

    const rows = await executor
      .selectFrom('accounts')
      .select('person_id')
      .where('person_id', 'in', [...personIds])
      .execute();

    return new Set(rows.map((row) => row.person_id));
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
