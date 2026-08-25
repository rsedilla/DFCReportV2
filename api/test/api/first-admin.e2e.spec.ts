import type { INestApplication } from '@nestjs/common';

import {
  AlreadyBootstrappedError,
  bootstrapFirstAdmin,
} from '../../src/admin/bootstrap/first-admin';
import { AuditService } from '../../src/audit/audit.service';
import { AccountTokensService } from '../../src/auth/account-tokens.service';
import { createTestDb, truncateAll } from '../setup/database';
import { createPerson, createTestApp } from '../setup/fixtures';

import type { Kysely } from 'kysely';
import type { BootstrapInput } from '../../src/admin/bootstrap/first-admin';
import type { Database } from '../../src/database/schema';

/**
 * The first Admin account (SKILL.md section 6, The first Admin account).
 *
 * **These exist because the rules would otherwise be prose with nothing able to
 * fail on them.** Section 6 states four things about this path — it refuses while
 * any account exists, its writes are a system action, the person it creates need
 * not be in the pastoral tree, and it hands back the activation token — and a
 * script cannot be tested, which is why the writing lives in a module.
 *
 * Fixture names and addresses are invented (CLAUDE.md, Secrets).
 */
describe('the first Admin account (SKILL.md section 6)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  const input: BootstrapInput = {
    email: 'first.admin@example.test',
    firstName: 'Bene',
    middleName: null,
    lastName: 'Testfixture',
    sex: 'MALE',
    civilStatus: 'SINGLE',
    pastoralLeaderId: null,
  };

  function run(overrides: Partial<BootstrapInput> = {}) {
    return bootstrapFirstAdmin(
      db,
      { tokens: app.get(AccountTokensService), audit: app.get(AuditService) },
      { ...input, ...overrides },
      overrides.sex === 'FEMALE' ? 'WOMENS' : 'MENS',
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  it('creates the Person, the Account and the ADMIN role together', async () => {
    const result = await run();

    const account = await db
      .selectFrom('accounts')
      .select(['person_id', 'status', 'password_hash'])
      .where('id', '=', result.accountId)
      .executeTakeFirstOrThrow();

    expect(account.person_id).toBe(result.personId);
    // Section 6: the holder sets their own password, so there is none yet.
    expect(account.status).toBe('PENDING_ACTIVATION');
    expect(account.password_hash).toBeNull();

    const role = await db
      .selectFrom('account_roles')
      .select(['role', 'granted_by', 'senior_pastor_slot'])
      .where('account_id', '=', result.accountId)
      .executeTakeFirstOrThrow();

    expect(role.role).toBe('ADMIN');
    // Section 7 permits null only for the first Admin, granted by a system action.
    expect(role.granted_by).toBeNull();
    expect(role.senior_pastor_slot).toBeNull();
  });

  it('refuses while any account exists, which is what makes it one-time', async () => {
    await run();

    await expect(run({ email: 'second@example.test' })).rejects.toBeInstanceOf(
      AlreadyBootstrappedError,
    );

    const accounts = await db.selectFrom('accounts').select('id').execute();
    expect(accounts).toHaveLength(1);
  });

  it('refuses even where the existing account is not an Admin', async () => {
    // The check is "any account", not "any Admin". A system already in use by
    // somebody is not a fresh installation, whatever roles it holds, and a
    // narrower check would let this mint an Admin into a live church's records.
    const person = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await db
      .insertInto('accounts')
      .values({
        person_id: person.id,
        email: 'leader@example.test',
        email_normalized: 'leader@example.test',
        password_hash: 'argon2-placeholder-not-a-valid-hash',
        status: 'ACTIVE',
      })
      .execute();

    await expect(run()).rejects.toBeInstanceOf(AlreadyBootstrappedError);
  });

  it('leaves the administrator out of the pastoral tree when no leader is named', async () => {
    // Section 5 invariant 3's third case, added for this: zero open assignments is
    // correct and permanent for somebody who administers the system without being
    // anybody's disciple. **Not** "not yet assigned" — nothing is coming.
    const result = await run();

    const assignments = await db
      .selectFrom('pastoral_assignments')
      .select('id')
      .where('person_id', '=', result.personId)
      .execute();

    expect(assignments).toEqual([]);
  });

  it('opens an ordinary edge where the administrator is discipled', async () => {
    // The other half of the same rule: neither placement is preferred, and an
    // administrator who *is* part of the church is an ordinary Person under their
    // own leader. Pinned so the no-assignment path cannot quietly become the only
    // one.
    const leader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const result = await run({ pastoralLeaderId: leader.id });

    const assignment = await db
      .selectFrom('pastoral_assignments')
      .select(['leader_id', 'root_network', 'ended_at'])
      .where('person_id', '=', result.personId)
      .executeTakeFirstOrThrow();

    expect(assignment.leader_id).toBe(leader.id);
    // Not a root: section 5 gives the seat only to a null-leader row, and the
    // check constraint refuses a seat on an ordinary edge.
    expect(assignment.root_network).toBeNull();
    expect(assignment.ended_at).toBeNull();
  });

  it('records three audit entries, every one of them a system action', async () => {
    // Section 21 lists person creation, account creation and role changes
    // separately, so one entry describing everything would hide two of them from
    // a reader searching for either. A null actor is what section 21 allows for a
    // system action and for nothing else.
    const result = await run();

    const entries = await db
      .selectFrom('audit_log')
      .select(['action', 'actor_id', 'target_id'])
      .orderBy('occurred_at')
      .execute();

    expect(entries.map((e) => e.action)).toEqual([
      'person.created',
      'account.created',
      'role.granted',
    ]);
    expect(entries.every((e) => e.actor_id === null)).toBe(true);
    expect(entries[0].target_id).toBe(result.personId);
    expect(entries[1].target_id).toBe(result.accountId);
  });

  it('hands back an activation token that is stored only as a hash', async () => {
    // Section 6 keeps the token out of the database in usable form. Returning it
    // is the departure this path makes deliberately — there is no Admin to re-send
    // from, so a lost token would leave the installation unrecoverable.
    const result = await run();

    expect(result.activationToken).toHaveLength(43);
    expect(result.activationExpiresAt.getTime()).toBeGreaterThan(Date.now());

    const stored = await db
      .selectFrom('account_tokens')
      .select(['purpose', 'token_hash', 'used_at'])
      .where('account_id', '=', result.accountId)
      .executeTakeFirstOrThrow();

    expect(stored.purpose).toBe('ACTIVATION');
    expect(stored.used_at).toBeNull();
    expect(stored.token_hash).not.toBe(result.activationToken);
  });

  it('gives the administrator the Network their sex implies', async () => {
    // Section 4: the mapping is total and assigned rather than proposed, and it
    // applies to an administrator exactly as to anybody else — being outside the
    // pastoral tree does not put them outside a Network.
    const result = await run({ sex: 'FEMALE', email: 'her@example.test' });

    const network = await db
      .selectFrom('network_assignments')
      .select(['network', 'ended_at'])
      .where('person_id', '=', result.personId)
      .executeTakeFirstOrThrow();

    expect(network.network).toBe('WOMENS');
    expect(network.ended_at).toBeNull();
  });

  it('writes nothing at all when it refuses', async () => {
    // One transaction. A refusal that had already created the Person would leave a
    // record nobody asked for and no way to see it had happened.
    await run();
    const before = await db.selectFrom('persons').select('id').execute();

    await expect(run({ email: 'second@example.test' })).rejects.toThrow();

    const after = await db.selectFrom('persons').select('id').execute();
    expect(after).toHaveLength(before.length);
  });
});
