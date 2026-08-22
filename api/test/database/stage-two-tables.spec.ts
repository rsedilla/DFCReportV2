import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { createPerson } from '../setup/fixtures';

import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';

/**
 * The three tables migration 0002 creates, exercised against the database.
 *
 * A rule this repository states in prose and leaves to an application that does
 * not exist yet is the failure it keeps repeating, so every constraint below is
 * checked by writing through it rather than by reading the migration.
 */
describe('audit_log is append-only (SKILL.md section 21)', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('accepts an entry with no actor, which is a system action', async () => {
    const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await expect(
      db
        .insertInto('audit_log')
        .values({
          actor_id: null,
          action: 'person.created',
          target_type: 'person',
          target_id: person.id,
          after: { first_name: 'Mark' },
        })
        .execute(),
    ).resolves.toBeDefined();
  });

  it('refuses an UPDATE', async () => {
    await db
      .insertInto('audit_log')
      .values({
        actor_id: null,
        action: 'person.created',
        target_type: 'person',
        target_id: 'a-target',
      })
      .execute();

    await expect(
      db.updateTable('audit_log').set({ reason: 'rewritten' }).execute(),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses a DELETE', async () => {
    await db
      .insertInto('audit_log')
      .values({
        actor_id: null,
        action: 'person.created',
        target_type: 'person',
        target_id: 'a-target',
      })
      .execute();

    await expect(db.deleteFrom('audit_log').execute()).rejects.toThrow(/append-only/);
  });

  it('leaves the entry intact after a refused change', async () => {
    // A trigger that raises and still lets the row change would pass both cases
    // above while protecting nothing.
    await db
      .insertInto('audit_log')
      .values({
        actor_id: null,
        action: 'person.created',
        target_type: 'person',
        target_id: 'a-target',
        reason: 'original',
      })
      .execute();

    await expect(
      db.updateTable('audit_log').set({ reason: 'rewritten' }).execute(),
    ).rejects.toThrow();

    const rows = await db.selectFrom('audit_log').select('reason').execute();
    expect(rows).toEqual([{ reason: 'original' }]);
  });

  it('refuses a blank target, which NOT NULL alone would admit', async () => {
    // `target_id` is text rather than uuid, so the type no longer refuses a blank
    // implicitly. An entry naming nothing is what section 21's "Record actor,
    // target, action, timestamp" exists to prevent.
    const client = await openClient();
    try {
      await expect(
        client.query('INSERT INTO audit_log (action, target_type, target_id) VALUES ($1, $2, $3)', [
          'person.created',
          'person',
          '   ',
        ]),
      ).rejects.toThrow(/audit_log_target_id_not_blank/);
    } finally {
      await client.end();
    }
  });

  it('refuses an action that is not a dotted identifier', async () => {
    const client = await openClient();
    try {
      await expect(
        // `target_id` is supplied because it is NOT NULL: without it the insert
        // fails on the null before it reaches the constraint under test, and the
        // case would pass for the wrong reason.
        client.query('INSERT INTO audit_log (action, target_type, target_id) VALUES ($1, $2, $3)', [
          'Person Created',
          'person',
          'a-target',
        ]),
      ).rejects.toThrow(/audit_log_action_shape/);
    } finally {
      await client.end();
    }
  });
});

describe('idempotency_keys (SKILL.md section 22)', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('scopes a key to its account, so one account cannot claim another key', async () => {
    // Section 22 lists account_id as a column and does not say which of the two
    // identifies a row. A global key would let a client that reused a key it had
    // observed receive a stored response belonging to somebody else, or deny that
    // person their own retry.
    const [first, second] = await Promise.all([account(db, 'Mark'), account(db, 'Manuel')]);
    const key = '6f2b1c94-8b6a-4a1e-9a1e-2c9f4d5b7e01';

    for (const accountId of [first, second]) {
      await expect(
        db
          .insertInto('idempotency_keys')
          .values({
            key,
            account_id: accountId,
            request_fingerprint: 'PUT /api/v1/people/x/pastoral-leader',
            state: 'IN_FLIGHT',
            expires_at: hoursFromNow(24),
          })
          .execute(),
      ).resolves.toBeDefined();
    }
  });

  it('refuses the same key twice for one account', async () => {
    const accountId = await account(db, 'Mark');
    const key = '6f2b1c94-8b6a-4a1e-9a1e-2c9f4d5b7e02';

    const row = {
      key,
      account_id: accountId,
      request_fingerprint: 'PUT /api/v1/people/x/pastoral-leader',
      state: 'IN_FLIGHT' as const,
      expires_at: hoursFromNow(24),
    };

    await db.insertInto('idempotency_keys').values(row).execute();
    await expect(db.insertInto('idempotency_keys').values(row).execute()).rejects.toThrow(
      /idempotency_keys_pkey/,
    );
  });

  it('refuses an in-flight key carrying a response', async () => {
    const accountId = await account(db, 'Mark');

    await expect(
      db
        .insertInto('idempotency_keys')
        .values({
          key: '6f2b1c94-8b6a-4a1e-9a1e-2c9f4d5b7e03',
          account_id: accountId,
          request_fingerprint: 'PUT /api/v1/people/x/pastoral-leader',
          state: 'IN_FLIGHT',
          response_status: 200,
          expires_at: hoursFromNow(24),
        })
        .execute(),
    ).rejects.toThrow(/idempotency_keys_response_matches_state/);
  });

  it('refuses a completed key carrying no response status', async () => {
    const accountId = await account(db, 'Mark');

    await expect(
      db
        .insertInto('idempotency_keys')
        .values({
          key: '6f2b1c94-8b6a-4a1e-9a1e-2c9f4d5b7e04',
          account_id: accountId,
          request_fingerprint: 'PUT /api/v1/people/x/pastoral-leader',
          state: 'COMPLETED',
          expires_at: hoursFromNow(24),
        })
        .execute(),
    ).rejects.toThrow(/idempotency_keys_response_matches_state/);
  });
});

describe('settings (SKILL.md section 7)', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('holds the defaults the specification names, at the start of every test', async () => {
    // The application therefore never invents a default, which is what would put
    // the value in two places and let them disagree.
    //
    // **This does not prove the migration seeds them, and is not written as
    // though it did.** `settings.updated_by` references `accounts`, so the
    // TRUNCATE ... CASCADE in `truncateAll` empties this table before every test
    // and the helper re-seeds it; an assertion made after that hook cannot tell
    // the migration's INSERT from the helper's. What it does hold is the property
    // every other test depends on -- that a test starts from the specified
    // defaults -- and it would catch the helper drifting from section 15 or
    // section 2.
    //
    // Verifying the migration's own seed needs a database no test has touched.
    // That gap is real and is recorded in the pull request rather than papered
    // over here.
    const rows = await db
      .selectFrom('settings')
      .select(['key', 'value', 'updated_by'])
      .orderBy('key')
      .execute();

    expect(rows).toEqual([
      // Three months, one church-wide value, never per leader (section 15).
      { key: 'cell_attention_months', value: 3, updated_by: null },
      // The phase is open, and is closed once by an audited Admin action
      // (section 2).
      { key: 'initial_encoding_open', value: true, updated_by: null },
    ]);
  });

  it('refuses a key the specification does not name', async () => {
    const client = await openClient();
    try {
      await expect(
        client.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [
          'cell_attention_weeks',
          '3',
        ]),
      ).rejects.toThrow(/settings_key_is_known/);
    } finally {
      await client.end();
    }
  });

  it('refuses a DELETE', async () => {
    // A delete has no new value to log, and returns a church-wide control to a
    // default nobody chose.
    await expect(
      db.deleteFrom('settings').where('key', '=', 'cell_attention_months').execute(),
    ).rejects.toThrow(/change the value instead/);

    const rows = await db.selectFrom('settings').select('key').execute();
    expect(rows).toHaveLength(2);
  });
});

describe('the token retention floor (SKILL.md section 6, Retention)', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('refuses to delete a refresh token that is still presentable', async () => {
    // This is the query somebody actually writes -- DELETE ... WHERE expires_at <
    // now() -- and it takes exactly the rows that still carry the reuse signal.
    // A rotated row is revoked and carries replaced_by_id, and that pair is the
    // whole difference between a stolen token and one this system never issued.
    const accountId = await account(db, 'Mark');

    await db
      .insertInto('refresh_tokens')
      .values({
        account_id: accountId,
        token_hash: 'hash-of-a-token-that-expired-yesterday',
        issued_at: daysFromNow(-31),
        expires_at: daysFromNow(-1),
        revoked_at: daysFromNow(-2),
      })
      .execute();

    await expect(db.deleteFrom('refresh_tokens').execute()).rejects.toThrow(
      /retained until 30 days past expires_at/,
    );

    const rows = await db.selectFrom('refresh_tokens').select('id').execute();
    expect(rows).toHaveLength(1);
  });

  it('permits deleting a refresh token more than thirty days past expiry', async () => {
    const accountId = await account(db, 'Mark');

    await db
      .insertInto('refresh_tokens')
      .values({
        account_id: accountId,
        token_hash: 'hash-of-a-long-dead-token',
        issued_at: daysFromNow(-91),
        expires_at: daysFromNow(-31),
      })
      .execute();

    await expect(db.deleteFrom('refresh_tokens').execute()).resolves.toBeDefined();
    expect(await db.selectFrom('refresh_tokens').select('id').execute()).toHaveLength(0);
  });

  it('retains a row sitting exactly on the thirty-day boundary', async () => {
    // Section 6 permits a delete only once expires_at is *more than* 30 days
    // past, so the boundary instant itself is still retained, and the trigger
    // compares with `>=`.
    //
    // The boundary has to be hit exactly or the case proves nothing: a row a
    // minute inside the window is refused by `>` and `>=` alike, so the test
    // would pass against the very comparison it exists to reject. `now()` is
    // transaction-stable, so computing expires_at and attempting the delete in
    // one transaction lands on the boundary with no race.
    const accountId = await account(db, 'Mark');
    const client = await openClient();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO refresh_tokens (account_id, token_hash, issued_at, expires_at)
         VALUES ($1, $2, now() - interval '90 days', now() - interval '30 days')`,
        [accountId, 'hash-of-a-token-on-the-boundary'],
      );

      await expect(client.query('DELETE FROM refresh_tokens')).rejects.toThrow(
        /retained until 30 days past expires_at/,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });

  it('holds the same floor on account_tokens', async () => {
    // A much shorter clock -- a reset token lives 30 minutes -- and the same
    // retention, so a replay is refused as used rather than as unknown.
    const accountId = await account(db, 'Mark');

    await db
      .insertInto('account_tokens')
      .values({
        account_id: accountId,
        purpose: 'PASSWORD_RESET',
        token_hash: 'hash-of-a-spent-reset-token',
        // `created_at` defaults to now() and the row must satisfy
        // `expires_at > created_at`, so a row that expired in the past has to say
        // when it was made. A reset token lives 30 minutes (section 6).
        created_at: minutesBefore(daysFromNow(-1), 30),
        expires_at: daysFromNow(-1),
        used_at: daysFromNow(-1),
      })
      .execute();

    await expect(db.deleteFrom('account_tokens').execute()).rejects.toThrow(
      /retained until 30 days past expires_at/,
    );
  });
});

async function account(db: Kysely<Database>, firstName: string): Promise<string> {
  const person = await createPerson(db, { firstName, network: 'MENS' });
  const row = await db
    .insertInto('accounts')
    .values({
      person_id: person.id,
      email: `${firstName.toLowerCase()}@example.test`,
      email_normalized: `${firstName.toLowerCase()}@example.test`,
      password_hash: 'argon2-placeholder-not-a-valid-hash',
      status: 'ACTIVE',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function minutesBefore(at: Date, minutes: number): Date {
  return new Date(at.getTime() - minutes * 60 * 1000);
}

async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}
