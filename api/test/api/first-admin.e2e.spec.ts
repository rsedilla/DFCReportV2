import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';

import {
  AlreadyBootstrappedError,
  bootstrapFirstAdmin,
} from '../../src/admin/bootstrap/first-admin';
import { AuditService } from '../../src/audit/audit.service';
import { AccountProvisioningService } from '../../src/auth/account-provisioning.service';
import { PeopleService } from '../../src/people/people.service';
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
  };

  function run(overrides: Partial<BootstrapInput> = {}) {
    return bootstrapFirstAdmin(
      db,
      {
        // Through the modules that own the tables (section 2). The real mapping
        // too: an earlier version took the Network as an argument, so replacing
        // `networkForSex` with a hardcoded 'MENS' kept every case green while
        // putting a woman in the Men's Network.
        people: app.get(PeopleService),
        accounts: app.get(AccountProvisioningService),
        audit: app.get(AuditService),
      },
      { ...input, ...overrides },
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

  it('leaves the administrator out of the pastoral tree', async () => {
    // Section 5 invariant 3's third case, added for this: zero open assignments is
    // correct and permanent for somebody who administers the system without being
    // anybody's disciple. **Not** "not yet assigned" — nothing is coming.
    //
    // **One case, not two.** A second was written beside this one, titled "never
    // opens a pastoral edge, whatever it is given" and claiming to pin the removed
    // `--pastoral-leader` option as a property of the module rather than of its
    // arguments. It did not: it called `run()` with the same default input and
    // asserted the same emptiness, so both died to one mutation and neither
    // touched an argument. Re-adding the option would have left both green.
    //
    // What actually forecloses the option is the type: `BootstrapInput` has no
    // field for a leader, so restoring one is a compile-time change a reviewer
    // sees. A test cannot pin the absence of an argument it cannot pass.
    const result = await run();

    const forThisPerson = await db
      .selectFrom('pastoral_assignments')
      .select('id')
      .where('person_id', '=', result.personId)
      .execute();

    const anyAtAll = await db.selectFrom('pastoral_assignments').select('id').execute();

    expect(forThisPerson).toEqual([]);
    expect(anyAtAll).toEqual([]);
  });

  describe('each guard refuses on its own account', () => {
    /**
     * **Three layers, and until now the suite pinned the disjunction and no member
     * of it.** Every case above goes through `bootstrapFirstAdmin`, so deleting any
     * one of the three checks left all of them green — the bootstrap's own, the one
     * in `auth`, and the one in `people`. That is the finding CLAUDE.md already
     * records for the identifier work on 2026-08-23, where the remedy was to call
     * each check directly, and it is the remedy here.
     *
     * The whole argument for adding the two service guards was that a convention
     * held at a call site is only as reliable as the next caller. A test that can
     * only reach them through the one caller does not test that argument.
     */
    it('auth refuses to create a second first Admin, called directly', async () => {
      await run();

      await expect(
        db
          .transaction()
          .execute((trx) =>
            app
              .get(AccountProvisioningService)
              .createFirstAdminWithin(trx, { personId: randomUUID(), email: 'x@example.test' }),
          ),
      ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION', details: { refused_by: 'accounts' } });
    });

    it('people refuses to create a second unassigned administrator, called directly', async () => {
      // Any Person at all is enough, which is the point: `people` cannot ask `auth`
      // whether an account exists without restoring the module cycle, so it asks
      // its own table. Section 6 states both conditions and that they differ.
      await createPerson(db, { firstName: 'Manuel', network: 'MENS' });

      await expect(
        db.transaction().execute((trx) =>
          app.get(PeopleService).createSystemAdministratorWithin(trx, {
            firstName: 'Bene',
            middleName: null,
            lastName: 'Testfixture',
            sex: 'MALE',
            civilStatus: 'SINGLE',
            encodedAt: new Date(),
          }),
        ),
      ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION', details: { refused_by: 'people' } });
    });

    it('refuses with an answer rather than a 500, whoever calls it', async () => {
      // The reason both guards exist is that these are public on services the API
      // uses — so the caller they anticipate is an endpoint, and a bare `Error`
      // would reach `ApiExceptionFilter` unrecognised and render `INTERNAL_ERROR`.
      // Section 22's `INVARIANT_VIOLATION` already means what this refusal means.
      await run();

      await expect(run({ email: 'second@example.test' })).rejects.toMatchObject({
        code: 'INVARIANT_VIOLATION',
        details: { refused_by: 'bootstrap' },
      });
    });
  });

  it('records three audit entries, every one of them a system action', async () => {
    // Section 21 lists person creation, account creation and role changes
    // separately, so one entry describing everything would hide two of them from
    // a reader searching for either. A null actor is what section 21 allows for a
    // system action and for nothing else.
    const result = await run();

    // **Not ordered by `occurred_at`.** It defaults to `now()`, which is
    // `transaction_timestamp()` — identical for all three rows — so ordering by it
    // imposes nothing and the assertion passed only because a sequential scan
    // happens to return insertion order. The set is what the rule is about.
    const entries = await db
      .selectFrom('audit_log')
      .select(['action', 'actor_id', 'target_id'])
      .execute();

    expect(entries.map((e) => e.action).sort()).toEqual(
      ['account.created', 'person.created', 'role.granted'].sort(),
    );
    expect(entries.every((e) => e.actor_id === null)).toBe(true);
    expect(entries.find((e) => e.action === 'person.created')?.target_id).toBe(result.personId);
    expect(entries.find((e) => e.action === 'role.granted')?.target_id).toBe(result.accountId);
  });

  it('records the lifecycle and Network rows as a system action too', async () => {
    // Sections 3 and 4 leave `actor_id` unmarked on both shapes, which this
    // repository reads as required (2026-08-20, on `capability_grants.reason`).
    // They now carry a system-action allowance, and this is what holds it: four
    // columns are written null here and the first version of section 6 accounted
    // for two.
    const result = await run();

    const lifecycle = await db
      .selectFrom('person_lifecycle')
      .select('actor_id')
      .where('person_id', '=', result.personId)
      .executeTakeFirstOrThrow();

    const network = await db
      .selectFrom('network_assignments')
      .select('actor_id')
      .where('person_id', '=', result.personId)
      .executeTakeFirstOrThrow();

    expect(lifecycle.actor_id).toBeNull();
    expect(network.actor_id).toBeNull();
  });

  it('normalizes the stored email the way sign-in looks it up', async () => {
    // A second implementation here dropped the trim, which would store a value no
    // sign-in and no password reset could match — and this command refuses to run
    // twice, so the installation would be unrecoverable with no way to see why.
    const result = await run({ email: '  Mixed.Case@Example.Test  ' });

    const account = await db
      .selectFrom('accounts')
      .select(['email', 'email_normalized'])
      .where('id', '=', result.accountId)
      .executeTakeFirstOrThrow();

    expect(account.email_normalized).toBe('mixed.case@example.test');
    // The display column too. It was selected and not asserted, so it drifted from
    // `provision` — which trims — and stored the surrounding spaces.
    expect(account.email).toBe('Mixed.Case@Example.Test');
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

  it('serializes two concurrent runs, so only one Admin is ever created', async () => {
    // **The case the emptiness check cannot cover on its own**, and the reason the
    // lock is taken *before* the read. Without it both runs take a snapshot of an
    // empty `accounts` table and both commit — the same failure CLAUDE.md records
    // for the SENIOR_PASTOR counting trigger on 2026-08-21.
    //
    // Written as a genuine race rather than sequentially: a sequential pair passes
    // against no lock at all, which is CLAUDE.md's authorization-case-7 lesson and
    // the one the root-seat work re-learned two commits ago.
    const services = {
      people: app.get(PeopleService),
      accounts: app.get(AccountProvisioningService),
      audit: app.get(AuditService),
    };

    const results = await Promise.allSettled([
      bootstrapFirstAdmin(db, services, input),
      bootstrapFirstAdmin(db, services, { ...input, email: 'other@example.test' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(AlreadyBootstrappedError);

    const accounts = await db.selectFrom('accounts').select('id').execute();
    expect(accounts).toHaveLength(1);
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
