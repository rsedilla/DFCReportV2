import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { Client } from 'pg';
import request from 'supertest';

import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { PeopleService } from '../../src/people/people.service';
import { lastNameKey } from '../../src/people/duplicate-matching';
import {
  countAdvisoryHolders,
  countAdvisoryWaiters,
  countWhileInFlight,
  holdPersonLock,
  track,
} from '../setup/concurrency';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `/api/v1/people` — creation, search, and the basic edit.
 *
 * The two rules worth the most care here are section 3's duplicate handling and
 * section 8's field-level scoping, because both fail quietly: a matcher that
 * misses produces a second record for someone who already exists, and a redaction
 * that leaks shows a leader a birthday and a mobile number for somebody in a
 * branch they do not oversee.
 *
 * Fixture names, dates and numbers are invented (CLAUDE.md, Secrets).
 */
describe('people (SKILL.md sections 3, 7 and 8)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Men's: Oriel -> Raymond -> Manuel. A sibling branch Oriel -> Rico -> Juan
  // that Raymond does not oversee, which is what makes the section 8 cases mean
  // something.
  let oriel: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let rico: TestPerson;
  let juan: TestPerson;
  let geraldine: TestPerson;

  let raymondAccount: TestAccount;
  let adminAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    geraldine = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });

    await assignTo(db, oriel.id, null);
    await assignTo(db, geraldine.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, rico.id, oriel.id);
    await assignTo(db, juan.id, rico.id);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    adminAccount = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('creating a Person', () => {
    it('creates the Person and everything the specification says comes with one', async () => {
      const response = await create(raymondAccount, { pastoral_leader_id: manuel.id });

      expect(response.status).toBe(201);
      expect(response.body.member_id).toMatch(/^M-\d{6,}$/);

      const id = response.body.id as string;

      // Network is assigned from sex under the homogeneous-network rule, stored
      // explicitly and effective-dated (section 4).
      const network = await db
        .selectFrom('network_assignments')
        .select('network')
        .where('person_id', '=', id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(network.network).toBe('MENS');

      // Lifecycle is a row, not a column (section 3).
      const lifecycle = await db
        .selectFrom('person_lifecycle')
        .select('state')
        .where('person_id', '=', id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(lifecycle.state).toBe('CURRENT');

      const assignment = await db
        .selectFrom('pastoral_assignments')
        .select('leader_id')
        .where('person_id', '=', id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(assignment.leader_id).toBe(manuel.id);

      // Section 21 audits Person creation.
      const audit = await db
        .selectFrom('audit_log')
        .select(['action', 'target_id', 'actor_id'])
        .where('target_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(audit.action).toBe('person.created');
      expect(audit.actor_id).toBe(raymondAccount.id);
    });

    it('records its idempotency completion, and a retry creates nothing', async () => {
      // The first write endpoint, so the first to owe the four obligations in the
      // Definition of Done. A retry must never create a second record.
      const key = randomUUID();
      const body = personBody({ pastoral_leader_id: manuel.id });

      const first = await post(raymondAccount, key).send(body);
      expect(first.status).toBe(201);

      const stored = await db
        .selectFrom('idempotency_keys')
        .select(['state', 'response_status', 'response_body'])
        .where('key', '=', key)
        .executeTakeFirstOrThrow();

      expect(stored.state).toBe('COMPLETED');
      expect(stored.response_status).toBe(201);
      // What it recorded is what it returned.
      expect(stored.response_body).toEqual(first.body);

      const retry = await post(raymondAccount, key).send(body);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);

      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(8);
    });

    it('asks for an acknowledgement before passing over a Tier 1 candidate', async () => {
      // Section 3: never merges automatically, never blocks creation. It surfaces
      // candidates and a person decides.
      const body = personBody({
        pastoral_leader_id: manuel.id,
        first_name: 'Manuel',
        last_name: 'Testfixture',
        birth_date: '1985-06-15',
      });

      const refused = await post(raymondAccount, randomUUID()).send(body);

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
      expect(refused.body.error.details.candidates).toEqual([
        expect.objectContaining({ id: manuel.id, tier: 1 }),
      ]);

      // Nothing was created, and nothing was half-created.
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);
    });

    it('creates once the candidate is acknowledged', async () => {
      // Two people legitimately share a name and a birthday, which is why section
      // 3 refuses to enforce a unique constraint on them.
      const created = await post(raymondAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          first_name: 'Manuel',
          last_name: 'Testfixture',
          birth_date: '1985-06-15',
          acknowledged_duplicate_ids: [manuel.id],
        }),
      );

      expect(created.status).toBe(201);
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(8);
    });

    it('creates a Person with no birthday, which is the consolidation case', async () => {
      // Section 3: optional, because a mandatory field people cannot fill is
      // filled with fictions. A leader meeting somebody for the first time may
      // not have asked, and somebody may decline to give it.
      const created = await post(raymondAccount, randomUUID()).send(
        withoutBirthday({
          pastoral_leader_id: manuel.id,
          first_name: 'Ana',
          last_name: 'Delacruz',
        }),
      );

      expect(created.status).toBe(201);

      const stored = await db
        .selectFrom('persons')
        .select('birth_date')
        .where('id', '=', created.body.id)
        .executeTakeFirstOrThrow();

      // Null, never a placeholder. A fabricated date is indistinguishable from a
      // fact afterwards, which is the failure the rule exists to prevent.
      expect(stored.birth_date).toBeNull();
    });

    it('is not gated on a name match alone once the birthday is absent and a number is given', async () => {
      // Two of the Tier 1 rules read the birthday and one the mobile number. With
      // no birthday and a number nobody else holds, a name match reaches only Tier 2
      // and creation proceeds. Same name as an existing fixture, which with a
      // matching birthday is the Tier 1 refusal two cases above.
      const created = await post(raymondAccount, randomUUID()).send(
        withoutBirthday({
          pastoral_leader_id: manuel.id,
          first_name: 'Manuel',
          last_name: 'Testfixture',
          mobile_number: '09175550101',
        }),
      );

      expect(created.status).toBe(201);
    });

    it('asks first when the names are equal and neither birthday nor number is given (decision 0399)', async () => {
      // Nothing is left to tell the two apart, so the encoder is asked rather than
      // shown a possible match beside an Add that goes through.
      const body = withoutBirthday({
        pastoral_leader_id: manuel.id,
        first_name: 'Manuel',
        last_name: 'Testfixture',
      });

      const refused = await post(raymondAccount, randomUUID()).send(body);

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
      expect(refused.body.error.details.candidates).toEqual([
        expect.objectContaining({
          id: manuel.id,
          tier: 1,
          reasons: [
            'first and last names equal, and no birthday or mobile number to tell them apart',
          ],
        }),
      ]);
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);

      const created = await post(raymondAccount, randomUUID()).send({
        ...body,
        acknowledged_duplicate_ids: [manuel.id],
      });
      expect(created.status).toBe(201);
    });

    it('does not ask about a namesake the encoder may not see (decision 0399)', async () => {
      // Juan is in Rico's branch, outside Raymond's: the stop needs a candidate the
      // encoder can be shown, as every other Tier 1 stop does.
      const created = await post(raymondAccount, randomUUID()).send(
        withoutBirthday({
          pastoral_leader_id: manuel.id,
          first_name: 'Juan',
          last_name: 'Testfixture',
        }),
      );

      expect(created.status).toBe(201);
    });

    it('asks the second of two leaders adding one person at the same moment (decision 0401)', async () => {
      // Both adds are held behind the last-name lock and then released together, so
      // they meet it at once. The Admin's queues first and so goes first, and Raymond's
      // checks after it has committed and is asked. Without the lock nothing waits, the
      // probe below sees no waiter, and both adds would have checked an empty population.
      //
      // That order is the one that matters: Raymond's scope is read before his add's
      // transaction opens, when the Admin's Liza does not exist yet, so she is seen as
      // his only through her leader, Manuel, read inside it. Raymond going first
      // passed with that read missing; this order failed.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        const { rows } = await holder.query<{ key: string }>(
          `SELECT hashtextextended($1, 0) AS key`,
          [`person-name:${lastNameKey('Mendozafixture')}`],
        );
        const key = rows[0].key;

        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);

        const body = withoutBirthday({
          pastoral_leader_id: manuel.id,
          first_name: 'Liza',
          last_name: 'Mendozafixture',
        });
        const first = post(adminAccount, randomUUID()).send(body);
        expect(
          await countWhileInFlight(
            () => countAdvisoryWaiters(holder, key),
            track(first),
            'the Admin’s add to wait on the last-name lock',
          ),
        ).toBe(1);

        const second = post(raymondAccount, randomUUID()).send(body);
        const both = Promise.all([first, second]);
        const waiting = await countWhileInFlight(
          async () => {
            const n = await countAdvisoryWaiters(holder, key);
            return n >= 2 ? n : 0;
          },
          track(both),
          'both adds to wait on the last-name lock',
        );
        expect(waiting).toBe(2);

        await holder.query('COMMIT');

        expect((await first).status).toBe(201);
        const refused = await second;
        expect(refused.status).toBe(409);
        expect(refused.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
        expect(
          await db
            .selectFrom('persons')
            .where('last_name', '=', 'Mendozafixture')
            .select('id')
            .execute(),
        ).toHaveLength(1);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('takes the last-name lock before the person lock (section 5, decision 0401)', async () => {
      // The leader's person lock is held, so the add stops there. By then it must
      // already hold its last-name lock: taken the other way round, it would wait on
      // the person lock holding nothing, and the probe would find no holder.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        const { rows } = await holder.query<{ key: string }>(
          `SELECT hashtextextended($1, 0) AS key`,
          [`person-name:${lastNameKey('Ordenfixture')}`],
        );
        const nameKey = rows[0].key;

        await holder.query('BEGIN');
        const personKey = await holdPersonLock(holder, manuel.id);

        const attempt = post(raymondAccount, randomUUID()).send(
          withoutBirthday({
            pastoral_leader_id: manuel.id,
            first_name: 'Celia',
            last_name: 'Ordenfixture',
          }),
        );

        const waiting = await countWhileInFlight(
          () => countAdvisoryWaiters(holder, personKey),
          track(attempt),
          'the add to wait on the leader’s person lock',
        );
        expect(waiting).toBe(1);
        expect(await countAdvisoryHolders(holder, nameKey)).toBe(1);

        await holder.query('COMMIT');
        expect((await attempt).status).toBe(201);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('lets the leader add the birthday afterwards', async () => {
      // Section 3: added later by an ordinary edit under `people.edit_basic`. This
      // endpoint already accepted `birth_date` before the field became optional.
      const created = await post(raymondAccount, randomUUID()).send(
        withoutBirthday({
          pastoral_leader_id: manuel.id,
          first_name: 'Lita',
          last_name: 'Ramos',
        }),
      );
      expect(created.status).toBe(201);

      const edited = await request(app.getHttpServer())
        .patch(`/api/v1/people/${created.body.id}`)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ birth_date: '1992-03-08' });

      expect(edited.status).toBe(200);

      const stored = await db
        .selectFrom('persons')
        .select('birth_date')
        .where('id', '=', created.body.id)
        .executeTakeFirstOrThrow();

      expect(stored.birth_date).toBe('1992-03-08');
    });

    it('refuses an edit that would clear a recorded birthday', async () => {
      // Section 3 defines adding a birthday and does not define removing one.
      //
      // This is a live behaviour the migration would have introduced by accident:
      // `@IsOptional()` skips null as well as undefined, so `{"birth_date": null}`
      // reached the service and wrote NULL over a recorded date. Before the column
      // became nullable the database refused it. Relaxing a constraint must not
      // quietly become a new capability.
      const created = await post(raymondAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          first_name: 'Nena',
          last_name: 'Villar',
          birth_date: '1988-11-04',
        }),
      );
      expect(created.status).toBe(201);

      const cleared = await request(app.getHttpServer())
        .patch(`/api/v1/people/${created.body.id}`)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ birth_date: null });

      // 422, which is what section 22's VALIDATION_FAILED carries everywhere else
      // in this suite. Asserted alongside the code so a later change to one of the
      // two cannot pass by agreeing with itself.
      expect(cleared.status).toBe(422);
      expect(cleared.body.error.code).toBe('VALIDATION_FAILED');

      const stored = await db
        .selectFrom('persons')
        .select('birth_date')
        .where('id', '=', created.body.id)
        .executeTakeFirstOrThrow();

      expect(stored.birth_date).toBe('1988-11-04');
    });

    it('refuses a leader in the other Network', async () => {
      // A pastoral assignment never crosses Networks (section 5, invariant 5).
      //
      // Admin, deliberately. A Leader cannot reach a Women's Network root at all,
      // so the guard would answer SCOPE_DENIED first and the case would pass
      // without the invariant ever being consulted -- proving the guard works,
      // which another case already does, rather than the rule under test.
      const response = await post(adminAccount, randomUUID()).send(
        personBody({ pastoral_leader_id: geraldine.id }),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);
    });

    it('refuses to place a Person under a leader outside the actor subtree', async () => {
      // Juan sits under Rico, whom Raymond does not oversee. Without this a leader
      // could put people into a branch they have no authority over.
      const response = await post(raymondAccount, randomUUID()).send(
        personBody({ pastoral_leader_id: juan.id }),
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);
    });

    it('refuses an archived Person as the pastoral leader', async () => {
      // An archived Person acquiring a disciple leaves a live pastoral edge under
      // someone who is not a current Person -- the corruption section 3 refuses
      // when archiving a Person who leads a Cell.
      await db
        .updateTable('person_lifecycle')
        .set({ ended_at: new Date() })
        .where('person_id', '=', manuel.id)
        .where('ended_at', 'is', null)
        .execute();
      await db
        .insertInto('person_lifecycle')
        .values({
          person_id: manuel.id,
          state: 'ARCHIVED',
          reason: 'MOVED_AWAY',
          started_at: new Date(),
        })
        .execute();

      const response = await post(raymondAccount, randomUUID()).send(
        personBody({ pastoral_leader_id: manuel.id }),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);
    });

    it('refuses a birthday sent as a timestamp', async () => {
      // Section 22: never send a date-only field as a timestamp. One accepted here
      // would compare as a raw string against stored YYYY-MM-DD values and match
      // nothing, so every Tier 1 birthday rule would go quiet and creation would
      // proceed without the acknowledgement section 3 requires -- silently.
      const response = await post(raymondAccount, randomUUID()).send(
        personBody({ pastoral_leader_id: manuel.id, birth_date: '1994-03-02T00:00:00Z' }),
      );

      expect(response.status).toBe(422);
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);
    });

    it.each(['1994-02-30', '1994-13-05', '0026-01-01'])(
      'refuses %s as a birthday, which is well-shaped and is not a day this system takes',
      async (impossible) => {
        // Section 22, ruling of 2026-09-02: a date-only value that is not a day is
        // refused at the edge, by the one predicate every date-only field now carries.
        //
        // **All three were already refused here, and this case pins the rule rather
        // than the change.** This file carried the strictest of the three conventions
        // the ruling found -- `@Matches` plus `@IsDateString({ strict: true })` -- and
        // that pair agrees with `isCalendarDate` on every well-shaped value, years 1 to
        // 99 included, which is why `0026-01-01` is in this list rather than because it
        // is a divergence. A first version of this comment claimed it was one, and the
        // mutation restoring the pair caught that by surviving every case here.
        //
        // The mutation still survives, and that is correct: on this route the two are
        // equivalent, so there is no behaviour to catch. What these cases pin is
        // section 22's rule on the fields, so a later loosening of the predicate is a
        // decision somebody makes rather than a silent widening.
        const response = await post(raymondAccount, randomUUID()).send(
          personBody({ pastoral_leader_id: manuel.id, birth_date: impossible }),
        );

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);
      },
    );

    it('refuses a request with no idempotency key', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/people')
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .send(personBody({ pastoral_leader_id: manuel.id }));

      expect(response.status).toBe(422);
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);
    });
  });

  describe('a name with a middle name (SKILL.md section 3, decision 0375)', () => {
    it('reads with its initial in a list, and whole on the person’s own record', async () => {
      const lito = await createPerson(db, {
        firstName: 'Lito',
        middleName: 'Santos',
        lastName: 'Fixturo',
        network: 'MENS',
      });
      await assignTo(db, lito.id, manuel.id);

      const list = await request(app.getHttpServer())
        .get('/api/v1/people')
        .query({ q: 'Lito Fixturo' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
      expect(list.status).toBe(200);
      const row = (list.body.data as { id: string; full_name: string }[]).find(
        (candidate) => candidate.id === lito.id,
      );
      expect(row?.full_name).toBe('Lito S. Fixturo');

      const record = await request(app.getHttpServer())
        .get(`/api/v1/people/${lito.id}`)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
      expect(record.status).toBe(200);
      expect(record.body.full_name).toBe('Lito Santos Fixturo');
    });
  });
  describe('a title (SKILL.md section 3, decision 0271)', () => {
    it('is shown before the name and never matched as part of it', async () => {
      // Only the Admin gives one (decision 0374).
      const titled = await post(adminAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          title: 'Pastor',
          first_name: 'Lino',
          last_name: 'Ocampo',
          birth_date: '1970-02-02',
        }),
      );

      expect(titled.status).toBe(201);
      expect(titled.body.title).toBe('Pastor');
      expect(titled.body.full_name).toBe('Pastor Lino Ocampo');

      // The same person entered again without the title is a Tier 1 duplicate, which
      // it could not be if the title were compared as part of the name.
      const again = await post(raymondAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          first_name: 'Lino',
          last_name: 'Ocampo',
          birth_date: '1970-02-02',
        }),
      );

      expect(again.status).toBe(409);
      expect(again.body.error.details.candidates).toEqual([
        expect.objectContaining({ id: titled.body.id, tier: 1 }),
      ]);
    });

    it('stores a blank title as none, and an edit sets and clears one', async () => {
      // A blank box is no title, so a leader's form that sends one is not refused.
      const created = await post(raymondAccount, randomUUID()).send(
        personBody({ pastoral_leader_id: manuel.id, title: '   ', first_name: 'Ramon' }),
      );
      expect(created.status).toBe(201);
      expect(created.body.title).toBeNull();

      const edit = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .patch(`/api/v1/people/${created.body.id}`)
          .set('Authorization', `Bearer ${adminAccount.accessToken}`)
          .set('Idempotency-Key', randomUUID())
          .send(body);

      const titled = await edit({ title: 'Bishop' });
      expect(titled.status).toBe(200);
      expect(titled.body.full_name).toMatch(/^Bishop Ramon /);

      const cleared = await edit({ title: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.title).toBeNull();
      expect(cleared.body.full_name).toMatch(/^Ramon /);
    });

    describe('is given by the Admin alone (decision 0374)', () => {
      const editAs = (account: TestAccount, id: string, body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .patch(`/api/v1/people/${id}`)
          .set('Authorization', `Bearer ${account.accessToken}`)
          .set('Idempotency-Key', randomUUID())
          .send(body);

      it('refuses a leader adding a person with a title, and adds nobody', async () => {
        const refused = await post(raymondAccount, randomUUID()).send(
          personBody({ pastoral_leader_id: manuel.id, title: 'Pastor', first_name: 'Nilo' }),
        );

        expect(refused.status).toBe(403);
        expect(refused.body.error.code).toBe('CAPABILITY_DENIED');
        expect(refused.body.error.details.capability).toBe('people.set_title');
        const nilo = await db
          .selectFrom('persons')
          .select('id')
          .where('first_name', '=', 'Nilo')
          .execute();
        expect(nilo).toEqual([]);
      });

      it('refuses a leader setting, changing or clearing a title, and changes nothing', async () => {
        const created = await post(adminAccount, randomUUID()).send(
          personBody({ pastoral_leader_id: manuel.id, title: 'Pastor', first_name: 'Teofilo' }),
        );
        expect(created.status).toBe(201);

        for (const title of ['Bishop', null]) {
          const refused = await editAs(raymondAccount, created.body.id, {
            title,
            first_name: 'Teo',
          });
          expect(refused.status).toBe(403);
          expect(refused.body.error.code).toBe('CAPABILITY_DENIED');
        }

        const stored = await db
          .selectFrom('persons')
          .select(['title', 'first_name'])
          .where('id', '=', created.body.id)
          .executeTakeFirstOrThrow();
        expect(stored).toEqual({ title: 'Pastor', first_name: 'Teofilo' });
      });

      it('lets a leader edit the rest, keeping a title sent back unchanged or not sent', async () => {
        const created = await post(adminAccount, randomUUID()).send(
          personBody({ pastoral_leader_id: manuel.id, title: 'Pastor', first_name: 'Arnel' }),
        );
        expect(created.status).toBe(201);

        // A page opened before the change still sends the title it was given.
        const same = await editAs(raymondAccount, created.body.id, {
          title: ' Pastor ',
          first_name: 'Arnold',
        });
        expect(same.status).toBe(200);
        expect(same.body.title).toBe('Pastor');

        const without = await editAs(raymondAccount, created.body.id, { first_name: 'Arnie' });
        expect(without.status).toBe(200);
        expect(without.body.title).toBe('Pastor');
        expect(without.body.full_name).toBe('Pastor Arnie Newcomer');
      });
      it('cannot undo the Admin changing a title meanwhile, nor be recorded as having changed it', async () => {
        const created = await post(adminAccount, randomUUID()).send(
          personBody({ pastoral_leader_id: manuel.id, title: 'Pastor', first_name: 'Celso' }),
        );
        expect(created.status).toBe(201);

        // The Admin's change to the title, uncommitted, holds the row. The leader's edit, sending
        // back the title its page was given, waits on the row, then reads the Admin's title.
        let leaderEdit: Promise<request.Response> | undefined;
        await db.transaction().execute(async (trx) => {
          await trx
            .updateTable('persons')
            .set({ title: 'Bishop' })
            .where('id', '=', created.body.id)
            .execute();
          leaderEdit = editAs(raymondAccount, created.body.id, {
            title: 'Pastor',
            first_name: 'Celestino',
          }).then((response) => response);
          await new Promise((resolve) => setTimeout(resolve, 750));
        });

        // Its title now differs from the one recorded, which a leader may not set: refused, and
        // nothing written, rather than the Admin's title undone or the change put in its name.
        const answered = await leaderEdit!;
        expect(answered.status).toBe(403);
        expect(answered.body.error.code).toBe('CAPABILITY_DENIED');
        const stored = await db
          .selectFrom('persons')
          .select(['title', 'first_name'])
          .where('id', '=', created.body.id)
          .executeTakeFirstOrThrow();
        expect(stored).toEqual({ title: 'Bishop', first_name: 'Celso' });
        const leaderEntries = await db
          .selectFrom('audit_log')
          .select('id')
          .where('target_id', '=', created.body.id)
          .where('actor_id', '=', raymondAccount.id)
          .execute();
        expect(leaderEntries).toEqual([]);
      });
    });

    it('is refused blank by the database, not only by the service', async () => {
      await expect(
        db.updateTable('persons').set({ title: ' ' }).where('id', '=', juan.id).execute(),
      ).rejects.toThrow(/persons_title_not_blank/);
    });
  });

  // Decision 0405: a match outside the branch names nobody in the response, so a case learns
  // who was shown from the audit entry decision 0304 writes, in the order they were shown.
  async function shownOutside(account: TestAccount): Promise<string[]> {
    const entry = await db
      .selectFrom('audit_log')
      .select('after')
      .where('action', '=', 'directory.matched')
      .where('actor_id', '=', account.id)
      .orderBy('occurred_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return (entry?.after as { shown?: string[] } | undefined)?.shown ?? [];
  }

  // What the response carries for each match outside the branch.
  const withheldRows = (body: { data: Record<string, unknown>[] }) =>
    body.data.filter((candidate) => candidate.possible_match === true);

  describe('the pre-flight duplicate check (SKILL.md section 3)', () => {
    it('surfaces Tier 2 candidates, which creation alone never shows', async () => {
      // Creation can only refuse on Tier 1, so without this endpoint every Tier 2
      // match would be computed and discarded -- and section 3 says they are
      // "presented in a candidate list".
      //
      // As Admin, so every candidate is in scope and the tier travels for all of
      // them. Asked as a Leader, the out-of-scope ones would carry
      // `possible_match` and no tier, and the case would be asserting the
      // redaction rather than the tier.
      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Pedro', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${adminAccount.accessToken}`);

      expect(response.status).toBe(200);

      const candidates = response.body.data as { tier: number }[];
      expect(candidates.length).toBeGreaterThan(0);
      // Same birthday and last name, different first name: section 3's Tier 2.
      expect(candidates.every((candidate) => candidate.tier === 2)).toBe(true);
    });

    it('gives the reason the save will stop on when neither birthday nor number is given (decision 0399)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Manuel', last_name: 'Testfixture' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([
        expect.objectContaining({
          id: manuel.id,
          tier: 1,
          reasons: [
            'first and last names equal, and no birthday or mobile number to tell them apart',
          ],
        }),
      ]);
    });

    it('reaches a person whose first and last names were typed the wrong way round (decision 0401)', async () => {
      // The typed last name starts with M and Manuel's is Testfixture, and nobody's first
      // name is Testfixture, so only the swapped branch of the narrowing reaches him.
      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Testfixture', last_name: 'Manuel' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([
        expect.objectContaining({
          id: manuel.id,
          tier: 2,
          reasons: ['first and last names swapped'],
        }),
      ]);
    });

    it('reaches a swapped name whose stored last name is hyphenated (decision 0401)', async () => {
      const hyphenated = await createPerson(db, {
        firstName: 'Ana',
        lastName: 'Santos-Reyes',
        network: 'MENS',
      });
      await assignTo(db, hyphenated.id, manuel.id);

      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Santos Reyes', last_name: 'Ana' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([
        expect.objectContaining({ id: hyphenated.id, reasons: ['first and last names swapped'] }),
      ]);
    });

    it('shows an out-of-scope spelling match as a possible match only (decision 0401)', async () => {
      // Juan is in Rico's branch. A swapped name reaches him by the names alone, so he
      // appears, and without the tier or the reasons (section 3).
      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Testfixture', last_name: 'Juan' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);
      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);
      expect(withheldRows(response.body)).toEqual([{ possible_match: true }]);
    });

    it('surfaces an out-of-scope candidate whose names alone explain the match', async () => {
      // Juan matches on names and on birthday. Membership is decided by whether a
      // subject carrying nothing section 8 protects would still have matched him
      // -- and the names alone do -- so he appears, without the tier or the
      // reasons that would say the birthday matched too.
      //
      // An earlier attempt keyed this on which rule won, and hid him: the
      // strongest rule read the birthday. That hid people whose presence the names
      // already explained, which is backwards.
      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Juan', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);
      expect(withheldRows(response.body)).toEqual([{ possible_match: true }]);
    });

    it('names nobody outside the actor scope, and gives no reasons (decision 0405)', async () => {
      // A reason reading "same birthday" asserts that an out-of-scope person's
      // birthday equals the value just submitted, which section 8 forbids
      // disclosing. On a read endpoint that would be a silent oracle.
      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Juan', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);
      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);

      // Flagged as possible, which is what section 3 needs the encoder to know, and
      // nothing more: no name, Member ID or identifier (decision 0405), and neither the
      // tier nor the reasons, which name the field that matched.
      expect(withheldRows(response.body)).toEqual([{ possible_match: true }]);
    });

    it('does not surface an out-of-scope candidate whose match needs a protected field', async () => {
      // **Membership is the disclosure**, and this is the case the first two
      // attempts at this redaction missed. With a first name matching nothing, the
      // only rule that could fire is "same birthday and last name equal" -- so if
      // presence varied with the birthday, the response would be a yes/no oracle
      // over a value section 8 protects: one bit per request, 200 either way, and
      // nothing written.
      const hit = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Zzzznomatch', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      const miss = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Zzzznomatch', last_name: 'Testfixture', birth_date: '1970-01-01' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      const juanAppearances = (response: { body: { data: { id: string }[] } }) =>
        response.body.data.filter((candidate) => candidate.id === juan.id);

      expect(juanAppearances(hit)).toEqual([]);
      expect(juanAppearances(hit)).toEqual(juanAppearances(miss));
    });

    it('gives no tier that could be binary-searched for a birthday', async () => {
      // The disclosure this closes: with an equal first and last name, Tier 1
      // means the submitted birthday matched and Tier 2 means it did not. Two
      // probes differing only in the birthday must be indistinguishable for a
      // person the actor does not oversee.
      const withRightBirthday = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Juan', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
      // Asserted present first, so a regression that empties the list cannot pass by
      // comparing two empty answers, which is the channel the redaction does not cover.
      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);

      const withWrongBirthday = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Juan', last_name: 'Testfixture', birth_date: '1970-01-01' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);
      expect(withheldRows(withRightBirthday.body)).toEqual([{ possible_match: true }]);
      expect(withheldRows(withRightBirthday.body)).toEqual(withheldRows(withWrongBirthday.body));
    });

    it('does not gate creation on a duplicate the actor may not see', async () => {
      // Every Tier 1 rule rests on a birthday or a mobile number, so an
      // out-of-scope Tier 1 candidate is one section 8 does not permit surfacing.
      // Refusing on it anyway would answer "acknowledge this" with nothing to
      // acknowledge, and that Person could never be created at all — a permanent
      // block, which is worse than the duplicate it guards against.
      //
      // Juan is a Tier 1 match here and sits outside Raymond's subtree. The 201
      // is also what keeps the refusal from being an oracle: it does not vary
      // with a birthday the actor may not learn.
      const created = await post(raymondAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          first_name: 'Juan',
          last_name: 'Testfixture',
          birth_date: '1985-06-15',
        }),
      );

      expect(created.status).toBe(201);
    });

    it('still gates on a duplicate the actor does oversee', async () => {
      // The gate is not weakened for a candidate section 8 permits showing.
      const refused = await post(raymondAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          first_name: 'Manuel',
          last_name: 'Testfixture',
          birth_date: '1985-06-15',
        }),
      );

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');

      const candidates = refused.body.error.details.candidates as Record<string, unknown>[];
      expect(candidates).toEqual([expect.objectContaining({ id: manuel.id, tier: 1 })]);
    });

    it('keeps the reasons for a candidate the actor oversees', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Manuel', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      const inScope = (response.body.data as Record<string, unknown>[]).find(
        (candidate) => candidate.id === manuel.id,
      );

      expect(inScope).toHaveProperty('reasons');
      expect(inScope).toHaveProperty('tier');
    });

    it('names no out-of-scope candidate in a Tier 1 refusal, whatever their birthday', async () => {
      // **The fourth door into the same oracle, and the one three redaction
      // rulings left open.** The refusal narrows its payload to the candidates it
      // is refusing on, and that filter is itself a membership decision — so
      // running it against the *full* match decided whether a stranger appeared
      // from a tier the viewer is never told. Every Tier 1 rule reads a birthday
      // or a mobile number (section 3), so the stranger appeared exactly when
      // their birthday equalled the one submitted: one bit per request, on a path
      // that writes nothing.
      //
      // The two strangers below differ in nothing but the birthday, so the
      // property is proven inside a single response: if presence could vary with
      // a protected field, these two would not be treated alike.
      const ours = await createPerson(db, {
        firstName: 'Pedro',
        middleName: 'Zuniga',
        network: 'MENS',
      });
      await assignTo(db, ours.id, manuel.id);

      const strangerSameBirthday = await createPerson(db, {
        firstName: 'Pedro',
        middleName: 'Abad',
        birthDate: '1985-06-15',
        network: 'MENS',
      });
      const strangerOtherBirthday = await createPerson(db, {
        firstName: 'Pedro',
        middleName: 'Bayani',
        birthDate: '1970-01-01',
        network: 'MENS',
      });
      await assignTo(db, strangerSameBirthday.id, juan.id);
      await assignTo(db, strangerOtherBirthday.id, juan.id);

      const refused = await post(raymondAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          first_name: 'Pedro',
          last_name: 'Testfixture',
          birth_date: '1985-06-15',
        }),
      );

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');

      // Exact rather than two `not.toContain`s. Both strangers are publishable on
      // their names, so they survive the section 8 membership test and are held
      // out by this rule alone — and an assertion that only says who is *absent*
      // passes just as well against a regression that empties the payload, which
      // is the failure the neighbouring case above records.
      const candidates = refused.body.error.details.candidates as { id: string }[];
      expect(candidates.map((candidate) => candidate.id)).toEqual([ours.id]);
    });

    it('returns withheld candidates in name order, after the ones in scope', async () => {
      // **Order is the same disclosure as the tier, one step out.**
      // `findCandidates` returns strongest first, and a withheld candidate's tier
      // is withheld precisely because it is derived from which rule fired — so
      // sitting a withheld candidate above one whose tier *is* shown reads the
      // withheld tier back, and with an equal name that reads back the birthday.
      //
      // Zamora is Tier 1 on the full match and Abad is Tier 2, so tier order and
      // name order disagree here. That disagreement is what lets the case fail:
      // against tier order the withheld pair comes back Zamora first.
      const ours = await createPerson(db, {
        firstName: 'Pedro',
        middleName: 'Zuniga',
        network: 'MENS',
      });
      await assignTo(db, ours.id, manuel.id);

      const zamora = await createPerson(db, {
        firstName: 'Pedro',
        middleName: 'Zamora',
        birthDate: '1985-06-15',
        network: 'MENS',
      });
      const abad = await createPerson(db, {
        firstName: 'Pedro',
        middleName: 'Abad',
        birthDate: '1970-01-01',
        network: 'MENS',
      });
      await assignTo(db, zamora.id, juan.id);
      await assignTo(db, abad.id, juan.id);

      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Pedro', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);

      const candidates = response.body.data as { id?: string; possible_match?: boolean }[];

      // The response names neither (decision 0405), so the order is read from the
      // audit entry, which lists them as they were shown: by name, Abad first.
      expect(await shownOutside(raymondAccount)).toEqual([abad.id, zamora.id]);
      expect(withheldRows(response.body)).toHaveLength(2);

      // In scope first, which is what keeps the strongest match the viewer may
      // actually act on at the top of the list.
      const firstWithheld = candidates.findIndex((candidate) => candidate.possible_match === true);
      expect(
        candidates.slice(firstWithheld).every((candidate) => candidate.possible_match === true),
      ).toBe(true);
      // At the head, not merely somewhere in the prefix: "strongest match first"
      // is half the ordering rule, and `ours` is the only Tier 1 candidate in
      // scope here — Raymond and Manuel match at Tier 2 on the shared birthday.
      // Asserting mere membership of the prefix leaves the in-scope half of the
      // rule with nothing that can fail on it.
      expect(candidates[0]).toMatchObject({ id: ours.id, tier: 1 });
      expect(candidates.slice(0, firstWithheld)).toContainEqual(
        expect.objectContaining({ id: ours.id }),
      );
    });

    it('breaks a tie in the withheld order by Member ID, not by the withheld tier', async () => {
      // **The case the name sort alone does not cover, and it is the ordinary
      // one.** A withheld candidate is publishable, which needs an equal first
      // *and* last name — so every withheld candidate in a response already
      // shares a name with the others, and two carrying no middle name share the
      // whole of it. A comparator returning 0 there leaves the sort's stability
      // to decide, and what it preserves is tier order: position reads the
      // withheld tier straight back, which with an equal name reads back the
      // birthday.
      //
      // The two below are created in the order Tier 2 then Tier 1, so Member ID
      // order and tier order disagree. Section 3 makes the Member ID the
      // tie-break because section 8 already publishes it to a viewer outside the
      // scope, and because it is unique, which is what makes the key total.
      const secondByTier = await createPerson(db, {
        firstName: 'Pedro',
        birthDate: '1970-01-01',
        network: 'MENS',
      });
      const firstByTier = await createPerson(db, {
        firstName: 'Pedro',
        birthDate: '1985-06-15',
        network: 'MENS',
      });
      await assignTo(db, secondByTier.id, juan.id);
      await assignTo(db, firstByTier.id, juan.id);

      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Pedro', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);

      // Both are Pedro Testfixture, so the name half of the key ties and the order
      // below is the tie-break: the one created first has the lower Member ID.
      expect(withheldRows(response.body)).toHaveLength(2);
      expect(await shownOutside(raymondAccount)).toEqual([secondByTier.id, firstByTier.id]);
    });
  });

  // Decision 0405: a similar name is shown as well as an exact one, and a match outside the
  // branch names nobody.
  describe('a similar name (SKILL.md section 3, decision 0405)', () => {
    function lookup(query: Record<string, string>) {
      return request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query(query)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
    }

    it('shows a similar name in another branch, whatever birthday is typed', async () => {
      // Juan is in Rico's branch, born 1985-06-15. "Jaun" is his name with two letters
      // swapped: the names alone reach him, so the birthday typed changes nothing.
      const right = await lookup({
        first_name: 'Jaun',
        last_name: 'Testfixture',
        birth_date: '1985-06-15',
      });
      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);
      const wrong = await lookup({
        first_name: 'Jaun',
        last_name: 'Testfixture',
        birth_date: '1970-01-01',
      });
      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);

      expect(withheldRows(right.body)).toEqual([{ possible_match: true }]);
      expect(withheldRows(wrong.body)).toEqual(withheldRows(right.body));
    });

    it('shows a last name one letter off in another branch, by the first name', async () => {
      // "Juan Pestfixture": the surname's first letter differs, so only the equal first
      // name reaches Juan Testfixture in Rico's branch.
      const response = await lookup({ first_name: 'Juan', last_name: 'Pestfixture' });

      expect(response.status).toBe(200);
      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);
      expect(withheldRows(response.body)).toEqual([{ possible_match: true }]);
    });

    it('shows a similar name in the branch with its reason', async () => {
      const response = await lookup({ first_name: 'Manny', last_name: 'Testfixture' });

      expect(response.status).toBe(200);
      expect(response.body.data).toContainEqual(
        expect.objectContaining({
          id: manuel.id,
          tier: 2,
          reasons: ['last name equal, first name a known nickname variant'],
        }),
      );
    });

    it('never stops a save', async () => {
      const created = await post(raymondAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          first_name: 'Manny',
          last_name: 'Testfixture',
          birth_date: '1990-01-01',
        }),
      );

      expect(created.status).toBe(201);
    });
  });

  // Decision 0404: an archived candidate says so, in scope and out, so an encoder asks
  // for a restore rather than adding the person again.
  describe('an archived candidate is labelled (SKILL.md section 3, decision 0404)', () => {
    // Archiving ends the Person's pastoral assignment too, as the archive does (section 5).
    async function setState(personId: string, state: 'CURRENT' | 'ARCHIVED') {
      if (state === 'ARCHIVED') {
        await db
          .updateTable('pastoral_assignments')
          .set({ ended_at: new Date() })
          .where('person_id', '=', personId)
          .where('ended_at', 'is', null)
          .execute();
      }
      await db
        .updateTable('person_lifecycle')
        .set({ ended_at: new Date() })
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .execute();
      await db
        .insertInto('person_lifecycle')
        .values({
          person_id: personId,
          state,
          reason: state === 'ARCHIVED' ? 'MOVED_AWAY' : null,
          started_at: new Date(),
        })
        .execute();
    }

    function lookup(actor: TestAccount, query: Record<string, string>) {
      return request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query(query)
        .set('Authorization', `Bearer ${actor.accessToken}`);
    }

    it('carries the flag for an archived candidate outside the scope, and nothing more', async () => {
      // Juan was in Rico's branch. He still appears by the names alone, as before, and
      // what is added is that he is archived -- not the tier or the reasons.
      await setState(juan.id, 'ARCHIVED');

      const response = await lookup(raymondAccount, {
        first_name: 'Juan',
        last_name: 'Testfixture',
      });

      expect(response.status).toBe(200);
      expect(await shownOutside(raymondAccount)).toEqual([juan.id]);
      // Decision 0405: nothing that names him, only that he is archived.
      expect(withheldRows(response.body)).toEqual([{ possible_match: true, archived: true }]);
    });

    // In scope as an Admin: an archived Person's assignment has ended (section 5), so a leader's
    // own subtree no longer reaches them, and an Admin's whole-church scope is where they are seen.
    it('carries the flag beside the tier for an archived candidate in scope', async () => {
      await setState(manuel.id, 'ARCHIVED');

      const response = await lookup(adminAccount, {
        first_name: 'Manuel',
        last_name: 'Testfixture',
        birth_date: '1985-06-15',
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toContainEqual(
        expect.objectContaining({ id: manuel.id, tier: 1, archived: true }),
      );
    });

    it('carries no flag for a current candidate, nor for one archived and since restored', async () => {
      await setState(juan.id, 'ARCHIVED');
      await setState(juan.id, 'CURRENT');

      const response = await lookup(adminAccount, { first_name: 'Juan', last_name: 'Testfixture' });

      expect(response.status).toBe(200);
      const candidates = response.body.data as Record<string, unknown>[];
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        expect(candidate).not.toHaveProperty('archived');
      }
    });

    it('carries the flag on the refusal that asks for a Tier 1 acknowledgement', async () => {
      await setState(manuel.id, 'ARCHIVED');

      const refused = await post(adminAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: raymond.id,
          first_name: 'Manuel',
          last_name: 'Testfixture',
          birth_date: '1985-06-15',
        }),
      );

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
      expect(refused.body.error.details.candidates).toEqual([
        expect.objectContaining({ id: manuel.id, tier: 1, archived: true }),
      ]);
    });

    it('carries the flag on the refusal of an edit (decision 0396)', async () => {
      const created = await post(adminAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: raymond.id,
          first_name: 'Pablo',
          last_name: 'Testfixture',
          birth_date: '1990-01-01',
        }),
      );
      expect(created.status).toBe(201);
      await setState(manuel.id, 'ARCHIVED');

      const refused = await request(app.getHttpServer())
        .patch(`/api/v1/people/${created.body.id}`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ first_name: 'Manuel', birth_date: '1985-06-15' });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
      expect(refused.body.error.details.candidates).toEqual([
        expect.objectContaining({ id: manuel.id, tier: 1, archived: true }),
      ]);
    });

    it('does not change which candidates appear, or their order', async () => {
      // Three withheld namesakes in Rico's branch, so the order among them is the Member ID
      // tie-break, and archiving one of them must leave it where it was.
      const namesakes = [
        await createPerson(db, { firstName: 'Juan', network: 'MENS' }),
        await createPerson(db, { firstName: 'Juan', network: 'MENS' }),
      ];
      for (const namesake of namesakes) {
        await assignTo(db, namesake.id, rico.id);
      }
      const query = { first_name: 'Juan', last_name: 'Testfixture' };

      const before = await lookup(raymondAccount, query);
      const shownBefore = await shownOutside(raymondAccount);
      expect(shownBefore).toHaveLength(3);
      expect(before.body.data).toHaveLength(3);
      await setState(shownBefore[1], 'ARCHIVED');
      const after = await lookup(raymondAccount, query);

      expect(await shownOutside(raymondAccount)).toEqual(shownBefore);
      expect(after.body.data).toEqual([
        { possible_match: true },
        { possible_match: true, archived: true },
        { possible_match: true },
      ]);
    });
  });

  // Decision 0396: a changed name, birthday or mobile number is checked as creating a Person
  // is. Manuel Testfixture, born 1985-06-15, is the Tier 1 candidate throughout.
  describe('editing a Person checks for duplicates (SKILL.md section 3, decision 0396)', () => {
    const edit = (account: TestAccount, id: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .patch(`/api/v1/people/${id}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    const pablo = async (): Promise<string> => {
      const created = await post(raymondAccount, randomUUID()).send(
        personBody({
          pastoral_leader_id: manuel.id,
          first_name: 'Pablo',
          last_name: 'Testfixture',
          birth_date: '1990-01-01',
        }),
      );
      expect(created.status).toBe(201);
      return created.body.id as string;
    };

    it('asks before an edit makes somebody a Tier 1 match, then saves once acknowledged', async () => {
      const id = await pablo();

      const refused = await edit(raymondAccount, id, {
        first_name: 'Manuel',
        birth_date: '1985-06-15',
      });
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
      const candidates = refused.body.error.details.candidates as { id: string }[];
      expect(candidates.map((candidate) => candidate.id)).toEqual([manuel.id]);

      // Nothing was written by the refusal.
      const unchanged = await db
        .selectFrom('persons')
        .select(['first_name', 'birth_date'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(unchanged.first_name).toBe('Pablo');

      const saved = await edit(raymondAccount, id, {
        first_name: 'Manuel',
        birth_date: '1985-06-15',
        acknowledged_duplicate_ids: [manuel.id],
      });
      expect(saved.status).toBe(200);
      expect(saved.body.first_name).toBe('Manuel');

      const audit = await db
        .selectFrom('audit_log')
        .select('after')
        .where('action', '=', 'person.updated')
        .where('target_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(audit.after).toMatchObject({ acknowledged_duplicate_ids: [manuel.id] });
    });

    it('asks when an edit gives a person with neither birthday nor number a namesake (decision 0399)', async () => {
      const created = await post(raymondAccount, randomUUID()).send(
        withoutBirthday({
          pastoral_leader_id: manuel.id,
          first_name: 'Pablo',
          last_name: 'Testfixture',
        }),
      );
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const refused = await edit(raymondAccount, id, { first_name: 'Manuel' });
      expect(refused.status).toBe(409);
      expect(refused.body.error.details.candidates).toEqual([
        expect.objectContaining({ id: manuel.id, tier: 1 }),
      ]);

      // A birthday given in the same save leaves only the possible match.
      await edit(raymondAccount, id, { first_name: 'Manuel', birth_date: '1990-01-01' }).expect(
        200,
      );
    });

    it('checks a changed mobile number, and not the same number written differently', async () => {
      const id = await pablo();
      await edit(raymondAccount, id, {
        first_name: 'Manuel',
        birth_date: '1985-06-15',
        acknowledged_duplicate_ids: [manuel.id],
      }).expect(200);

      // A new mobile number is a change, so Manuel is asked about again.
      const asked = await edit(raymondAccount, id, { mobile_number: '09171234567' });
      expect(asked.status).toBe(409);
      expect(asked.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');
      await edit(raymondAccount, id, {
        mobile_number: '09171234567',
        acknowledged_duplicate_ids: [manuel.id],
      }).expect(200);

      // The same number with hyphens is no change.
      const reformatted = await edit(raymondAccount, id, { mobile_number: '0917-123-4567' });
      expect(reformatted.status).toBe(200);
    });

    it('accepts an acknowledgement in any letter case, and audits only real candidates', async () => {
      const id = await pablo();
      const saved = await edit(raymondAccount, id, {
        first_name: 'Manuel',
        birth_date: '1985-06-15',
        acknowledged_duplicate_ids: [manuel.id.toUpperCase(), juan.id],
      });
      expect(saved.status).toBe(200);

      // Juan was never a candidate Raymond could see, so he is not recorded as passed over.
      const audit = await db
        .selectFrom('audit_log')
        .select('after')
        .where('action', '=', 'person.updated')
        .where('target_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(
        (audit.after as { acknowledged_duplicate_ids: string[] }).acknowledged_duplicate_ids,
      ).toEqual([manuel.id]);
    });
    it('never counts the person being edited as their own match', async () => {
      // Manuel matches himself on every field; a changed middle name is still checked.
      const saved = await edit(raymondAccount, manuel.id, { middle_name: 'Quinto' });
      expect(saved.status).toBe(200);
    });

    it('checks nothing when no name, birthday or mobile number changes', async () => {
      const id = await pablo();
      await edit(raymondAccount, id, {
        first_name: 'Manuel',
        birth_date: '1985-06-15',
        acknowledged_duplicate_ids: [manuel.id],
      }).expect(200);

      // Still a Tier 1 match for Manuel, and only the civil status changes.
      const saved = await edit(raymondAccount, id, { civil_status: 'MARRIED' });
      expect(saved.status).toBe(200);

      // The same values sent back unchanged are not a change either.
      const resent = await edit(raymondAccount, id, {
        first_name: 'Manuel',
        last_name: 'Testfixture',
        birth_date: '1985-06-15',
      });
      expect(resent.status).toBe(200);
    });

    it('does not gate on a Tier 1 candidate the editor may not see, as creating does not', async () => {
      // Juan sits outside Raymond's subtree; gating on him would ask Raymond to acknowledge
      // somebody he may not be shown, and the answer would vary with Juan's birthday.
      const id = await pablo();
      const saved = await edit(raymondAccount, id, {
        first_name: 'Juan',
        birth_date: '1985-06-15',
      });
      expect(saved.status).toBe(200);
    });

    it('lists only the candidates still owed, never the person being edited', async () => {
      // Pablo becomes a second Manuel; then editing Manuel himself, who matches himself on
      // every field, is asked about Pablo and about nobody else.
      const id = await pablo();
      await edit(raymondAccount, id, {
        first_name: 'Manuel',
        birth_date: '1985-06-15',
        acknowledged_duplicate_ids: [manuel.id],
      }).expect(200);

      const refused = await edit(raymondAccount, manuel.id, { middle_name: 'Quinto' });
      expect(refused.status).toBe(409);
      const candidates = refused.body.error.details.candidates as { id: string }[];
      expect(candidates.map((candidate) => candidate.id)).toEqual([id]);
    });

    it('refuses to save past a check made on values a concurrent edit has since replaced', async () => {
      // The check runs before the write's lock. A holder renames Pablo to a Tier 1 match for
      // Manuel and holds the row; this edit is checked against "Pablo", then waits on the row,
      // and must not save over a name its check never saw.
      const id = await pablo();
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query(
          `UPDATE persons SET first_name = 'Manuel', birth_date = '1985-06-15' WHERE id = $1`,
          [id],
        );

        const attempt = edit(raymondAccount, id, { mobile_number: '09171234567' });
        const inFlight = track(attempt);

        await countWhileInFlight(
          async () => {
            const { rows } = await holder.query<{ count: string }>(
              `SELECT count(*) AS count FROM pg_locks
                WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
            );
            return Number(rows[0].count);
          },
          inFlight,
          'the edit to wait on the person row',
        );

        await holder.query('COMMIT');

        const response = await attempt;
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');

        const stored = await db
          .selectFrom('persons')
          .select('mobile_number')
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        expect(stored.mobile_number).toBeNull();
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });
  });
  describe('the pastoral path (SKILL.md section 8)', () => {
    it('returns the chain root first, ending with the person', async () => {
      // Section 8's own example is a chain from the top: Oriel -> Raymond ->
      // Manuel. Root first rather than nearest first, because that is the order
      // it is read in.
      //
      // **Four nodes rather than the fixture's three, and built deepest first.**
      // Not because insertion order defeats a mutation -- it does not: the walk
      // is a chain, so each iteration of the recursive query produces one row and
      // the output is depth-ordered whether or not `ORDER BY depth` is there.
      // What a longer chain buys is that reversing it is distinguishable from
      // leaving it alone, which for two nodes it is not, and a four-node chain
      // whose insertion order matches neither direction cannot be satisfied by
      // any accident of how the rows come back.
      const deep = await createPerson(db, { firstName: 'Delfin', network: 'MENS' });
      const middle = await createPerson(db, { firstName: 'Melchor', network: 'MENS' });
      const top = await createPerson(db, { firstName: 'Tomas', network: 'MENS' });
      await assignTo(db, top.id, oriel.id);
      await assignTo(db, middle.id, top.id);
      await assignTo(db, deep.id, middle.id);

      const response = await path(adminAccount, deep.id);

      expect(response.status).toBe(200);
      expect(response.body.data.map((node: { id: string }) => node.id)).toEqual([
        oriel.id,
        top.id,
        middle.id,
        deep.id,
      ]);
      expect(response.body.next_cursor).toBeNull();
      expect(response.body.data[0]).toMatchObject({
        member_id: expect.any(String),
        full_name: expect.stringContaining('Oriel'),
      });
    });

    it('carries four fields and no more, whoever is asking', async () => {
      // **Section 8's field rule, with something that can fail on it.** Every
      // other assertion here uses `objectContaining`, so a birthday or a mobile
      // number added to a node would leave them all green -- and a path names
      // people outside the viewer's own subtree, so a field added here is
      // disclosed church-wide. This is the instrument the church-wide search
      // already uses one describe below, for the same reason.
      //
      // Asked as a Leader rather than as Admin, because the Leader is the actor
      // the field rule exists for.
      const response = await path(raymondAccount, manuel.id);

      for (const node of response.body.data as Record<string, unknown>[]) {
        expect(Object.keys(node).sort()).toEqual(['full_name', 'id', 'member_id', 'network_root']);
      }
    });

    it('refuses a person the actor does not oversee', async () => {
      // **The check that makes returning the whole chain safe.** Section 8 holds
      // an out-of-scope person to five fields, of which the direct leader's name
      // is one -- so a chain of ancestors would exceed it, and the guard is what
      // stops that rather than a redaction inside the payload.
      //
      // Juan sits under Rico, a branch Raymond does not oversee.
      const response = await path(raymondAccount, juan.id);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('data');
    });

    it('marks a Network root as the top of the tree', async () => {
      // A root is **not** one of section 5 invariant 3's three zero-assignment
      // cases -- section 5 says so in terms. Their row exists and carries a null
      // `leader_id`, which is what makes "is this person a root" answerable at
      // all, and their path is themselves rather than empty.
      const response = await path(adminAccount, oriel.id);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([
        expect.objectContaining({ id: oriel.id, network_root: true }),
      ]);
    });

    it('does not render an unassigned Person as a second root', async () => {
      // Section 5: "A Person with no active assignment row at all is therefore
      // never a root; they are unassigned -- surface them as such rather than
      // silently rendering them as a second root of the tree."
      //
      // This is the case that forced `network_root` onto the node. Both produce a
      // one-element path, so without it the two payloads are byte-identical and a
      // client draws this person as the top of a tree they are not in.
      const unassigned = await createPerson(db, { firstName: 'Perla', network: 'WOMENS' });

      const response = await path(adminAccount, unassigned.id);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([
        expect.objectContaining({ id: unassigned.id, network_root: false }),
      ]);

      // Asserted against the root case rather than only in isolation: the rule is
      // that the two are distinguishable, and only comparing them says so.
      const root = await path(adminAccount, oriel.id);
      expect(response.body.data[0].network_root).not.toEqual(root.body.data[0].network_root);
    });

    it('marks no node but the first as a root', async () => {
      const response = await path(raymondAccount, manuel.id);

      expect(
        response.body.data.map((node: { network_root: boolean }) => node.network_root),
      ).toEqual([true, false, false]);
    });

    it('answers 404 for an identifier naming nobody', async () => {
      // The guard resolves scope against the identifier and does not establish
      // that a row is there, so without the read this would answer 200 with a
      // one-element path naming a person who does not exist.
      const response = await path(adminAccount, randomUUID());

      expect(response.status).toBe(404);
    });

    it('names the same record however the identifier is spelled', async () => {
      // Section 7's canonical-comparison rule, on a route that takes a path
      // parameter the guard does resolve against.
      const response = await path(raymondAccount, manuel.id.toUpperCase());

      expect(response.status).toBe(200);
      expect(response.body.data.map((node: { id: string }) => node.id)).toEqual([
        oriel.id,
        raymond.id,
        manuel.id,
      ]);
    });

    describe('why a person has no pastoral leader (decision 0270)', () => {
      it('says nothing for a person with a leader, or for a root', async () => {
        expect((await path(adminAccount, manuel.id)).body.no_leader_reason).toBeNull();
        expect((await path(adminAccount, oriel.id)).body.no_leader_reason).toBeNull();
      });

      it('reads an administrator who never held an assignment as outside the tree', async () => {
        const response = await path(adminAccount, adminAccount.personId);

        expect(response.status).toBe(200);
        expect(response.body.no_leader_reason).toBe('OUTSIDE_TREE');
      });

      it('reads an administrator whose own assignment ended as waiting, not outside', async () => {
        const leader = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
        await assignTo(db, leader.id, raymond.id);
        await createAccount(app, db, { person: leader, roles: ['ADMIN'] });
        await db
          .updateTable('pastoral_assignments')
          .set({ ended_at: new Date() })
          .where('person_id', '=', leader.id)
          .where('ended_at', 'is', null)
          .execute();

        expect((await path(adminAccount, leader.id)).body.no_leader_reason).toBeNull();
      });

      it('reads an archived person as archived, and one merely unassigned as nothing', async () => {
        const archived = await createPerson(db, {
          firstName: 'Tomas',
          network: 'MENS',
          archived: true,
        });
        const waiting = await createPerson(db, { firstName: 'Bituin', network: 'WOMENS' });

        expect((await path(adminAccount, archived.id)).body.no_leader_reason).toBe('ARCHIVED');
        expect((await path(adminAccount, waiting.id)).body.no_leader_reason).toBeNull();
      });
    });

    function path(actor: TestAccount, id: string) {
      return request(app.getHttpServer())
        .get(`/api/v1/people/${id}/pastoral-path`)
        .set('Authorization', `Bearer ${actor.accessToken}`);
    }
  });

  describe('the scope of the rows (SKILL.md section 8, decision 0244)', () => {
    it('returns only the searcher own scope when nothing asks for wider', async () => {
      // Raymond oversees Manuel. Rico and Juan are the sibling branch he does not,
      // which is the whole point of this fixture.
      const response = await search(raymondAccount, 'Testfixture');

      expect(response.status).toBe(200);
      const ids = (response.body.data as { id: string }[]).map((row) => row.id);

      expect(ids).toContain(manuel.id);
      expect(ids).toContain(raymond.id);
      expect(ids).not.toContain(juan.id);
      expect(ids).not.toContain(rico.id);
      expect(ids).not.toContain(geraldine.id);
    });

    it('lists the searcher own scope with no term, each row naming its leader (owner, 2026-09-19)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/people')
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);
      const rows = response.body.data as { id: string; direct_leader_name: string | null }[];
      const ids = rows.map((row) => row.id);

      expect(ids).toContain(manuel.id);
      expect(ids).not.toContain(juan.id);
      expect(ids).not.toContain(rico.id);
      expect(rows.find((row) => row.id === manuel.id)?.direct_leader_name).toContain('Raymond');
    });

    it('never lists the church-wide directory whole', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/people')
        .query({ church_wide: true })
        .set('Authorization', `Bearer ${adminAccount.accessToken}`);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('answers a Leader’s church-wide request with scope first, before the term (decision 0389)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/people')
        .query({ church_wide: true })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('finds a Member ID in the searcher own scope, and never church-wide', async () => {
      const ids = await sql<{ id: string; member_id: string }>`
        SELECT id, member_id FROM persons WHERE id IN (${manuel.id}::uuid, ${juan.id}::uuid)
      `.execute(db);
      const memberIdOf = (id: string) => ids.rows.find((row) => row.id === id)?.member_id ?? '';

      const own = await search(raymondAccount, memberIdOf(manuel.id));
      expect((own.body.data as { id: string }[]).map((row) => row.id)).toEqual([manuel.id]);

      // Church-wide is a Whole Church searcher's alone (decision 0389), and even there a
      // Member ID matches nobody, so a prefix cannot page the directory.
      const wide = await search(adminAccount, memberIdOf(juan.id), { churchWide: true });
      expect(wide.status).toBe(200);
      expect((wide.body.data as { id: string }[]).map((row) => row.id)).not.toContain(juan.id);

      const leader = await search(raymondAccount, memberIdOf(juan.id), { churchWide: true });
      expect(leader.status).toBe(403);
      expect(leader.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses a term under two characters in the searcher own scope too', async () => {
      for (const q of ['a-', 'Jr']) {
        const response = await search(raymondAccount, q);

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('matches a Member ID by prefix in the searcher own scope', async () => {
      const found = await sql<{ member_id: string }>`
        SELECT member_id FROM persons WHERE id = ${manuel.id}::uuid
      `.execute(db);
      const memberId = found.rows[0]?.member_id ?? '';

      const response = await search(raymondAccount, memberId.slice(0, memberId.length - 1));

      expect(response.status).toBe(200);
      expect((response.body.data as { id: string }[]).map((row) => row.id)).toContain(manuel.id);
    });

    it('refuses a Leader the church when asked, and names nobody (decision 0389)', async () => {
      // The pickers asked for this until decision 0389; no picker does now, and a Leader
      // sending it from outside the app is refused rather than answered.
      const response = await search(raymondAccount, 'Juan', { churchWide: true });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.data).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(juan.id);
    });

    it('returns the church to a Whole Church searcher who asks', async () => {
      const response = await search(adminAccount, 'Testfixture', { churchWide: true });

      expect(response.status).toBe(200);
      const ids = (response.body.data as { id: string }[]).map((row) => row.id);

      expect(ids).toContain(juan.id);
      expect(ids).toContain(rico.id);
    });

    it('widens the rows on the upline and never the fields', async () => {
      // The load-bearing case. If `upline` ever came to mean "and show more about
      // them", it would turn a picker's flag into a grant of authority. Section 8
      // permits five fields for somebody outside the actor scope, asserted here as the
      // whole key set rather than a spot check. Oriel is above Raymond (decision 0389).
      const response = await search(raymondAccount, 'Oriel', { upline: true });

      const found = (response.body.data as Record<string, unknown>[]).find(
        (row) => row.id === oriel.id,
      );

      expect(found).toBeDefined();
      expect(Object.keys(found as object).sort()).toEqual([
        'direct_leader_name',
        'full_name',
        'id',
        'member_id',
        'network',
        'scope',
        'sex',
      ]);
    });

    it('changes nothing for an actor whose scope is the whole church', async () => {
      // An administrator holds Whole Church, so narrow and wide are the same
      // question asked twice. A regression that narrowed them would show here.
      const narrow = await search(adminAccount, 'Testfixture');
      const wide = await search(adminAccount, 'Testfixture', { churchWide: true });

      const idsOf = (response: { body: { data: { id: string }[] } }) =>
        response.body.data.map((row) => row.id).sort();

      expect(idsOf(narrow)).toEqual(idsOf(wide));
      expect(idsOf(narrow)).toContain(juan.id);
    });

    it('spends the page limit on rows it returns, not on rows it discards', async () => {
      // The reason the restriction is applied in SQL rather than to the returned
      // page. Church-wide order here is Ester, Geraldine, Juan, Manuel, Oriel,
      // Raymond, Rico -- so a post-filter at `limit: 2` would take Ester and
      // Geraldine, discard both, and answer zero rows while two matches remained.
      //
      // **What it pins is the two rows, and not the cursor.** Raymond's scope is
      // exactly two people, so this asks for the whole of it and reaches no page
      // boundary inside it. The case below is the one that pages.
      const response = await search(raymondAccount, 'Testfixture', { limit: 2 });

      expect(response.status).toBe(200);
      expect((response.body.data as unknown[]).length).toBe(2);
    });

    it('pages within the restricted set, and never out of it', async () => {
      // The paging case in the `church-wide search` block below uses an
      // administrator, whose scope is the whole church -- so `restrictTo` is null
      // there and the cursor is never exercised against a restricted set. A
      // regression dropping the restriction whenever a cursor is present would stay
      // green on it. *This said "above this block", which is the wrong direction:
      // that case is below, in the next describe.*
      for (const firstName of ['Aaron', 'Abel', 'Abner']) {
        const extra = await createPerson(db, { firstName, network: 'MENS' });
        await assignTo(db, extra.id, manuel.id);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      // Counted, because every other assertion here passes on a single page. If
      // `limit` stopped being honoured and one request returned all five, `seen`
      // would still be five and the cursor still null -- and the cursor, which is
      // what this case exists for, would never be exercised.
      let requests = 0;

      for (let page = 0; page < 6; page += 1) {
        requests += 1;
        const response: request.Response = await request(app.getHttpServer())
          .get('/api/v1/people')
          .query(
            cursor === null
              ? { q: 'Testfixture', limit: 2 }
              : { q: 'Testfixture', limit: 2, cursor },
          )
          .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

        expect(response.status).toBe(200);
        seen.push(...(response.body.data as { id: string }[]).map((row) => row.id));

        cursor = response.body.next_cursor as string | null;
        if (cursor === null) {
          break;
        }
      }

      expect(cursor).toBeNull();
      // More than one request, or the cursor was never exercised and this case is
      // asserting a single page of five rather than paging through them.
      expect(requests).toBeGreaterThan(1);
      // Five in scope: Raymond, Manuel, and the three just placed under Manuel.
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      expect(seen).not.toContain(juan.id);
      expect(seen).not.toContain(rico.id);
      expect(seen).not.toContain(geraldine.id);
    });

    it('pages by first name, then last name, then id, each condition deciding a boundary (decision 0359)', async () => {
      // A page of one, so every pair of neighbours is a page boundary and the cursor's
      // three conditions each decide one: Bea Testfixturea to Bea Testfixturez by last
      // name, Bea to Luis by first name, the two Luis Testfixtures by id. Surname order
      // would put the four plain Testfixtures first, so it fails this.
      const placed: TestPerson[] = [];
      for (const [firstName, lastName] of [
        ['Luis', 'Testfixture'],
        ['Bea', 'Testfixturez'],
        ['Luis', 'Testfixture'],
        ['Bea', 'Testfixturea'],
      ] as const) {
        const extra = await createPerson(db, { firstName, lastName, network: 'MENS' });
        await assignTo(db, extra.id, manuel.id);
        placed.push(extra);
      }
      const [luisOne, beaZ, luisTwo, beaA] = placed;
      const [luisFirst, luisSecond] = [luisOne.id, luisTwo.id].sort();

      const seen: string[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 10; page += 1) {
        const response: request.Response = await request(app.getHttpServer())
          .get('/api/v1/people')
          .query(
            cursor === null
              ? { q: 'Testfixture', limit: 1 }
              : { q: 'Testfixture', limit: 1, cursor },
          )
          .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

        expect(response.status).toBe(200);
        seen.push(...(response.body.data as { id: string }[]).map((row) => row.id));
        cursor = response.body.next_cursor as string | null;
        if (cursor === null) {
          break;
        }
      }

      expect(seen).toEqual([
        beaA.id,
        beaZ.id,
        luisFirst,
        luisSecond,
        manuel.id,
        raymondAccount.personId,
      ]);
    });

    it('refuses a church_wide value it does not define', async () => {
      // Sections 22 and decisions 0185, 0199 and 0200: a value the API does not
      // define is refused at the edge rather than absorbed. `banana` answered 200
      // with the narrow result before this -- fail-closed, and still a value nobody
      // defined being accepted. Reproduced against the running API at 200.
      const response = await request(app.getHttpServer())
        .get('/api/v1/people')
        .query({ q: 'Testfixture', church_wide: 'banana' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('still accepts the two values it does define', async () => {
      // Accepted, which is not the same as answered: a Leader's `true` passes the edge
      // and is refused as out of scope (decision 0389), never as an undefined value.
      const answers: Record<string, number> = {};
      for (const value of ['true', 'false']) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/people')
          .query({ q: 'Testfixture', church_wide: value })
          .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

        answers[value] = response.status;
      }
      expect(answers).toEqual({ true: 403, false: 200 });

      const admin = await request(app.getHttpServer())
        .get('/api/v1/people')
        .query({ q: 'Testfixture', church_wide: 'true' })
        .set('Authorization', `Bearer ${adminAccount.accessToken}`);
      expect(admin.status).toBe(200);
    });

    it('refuses an upline value it does not define, and accepts the two it does', async () => {
      const refused = await request(app.getHttpServer())
        .get('/api/v1/people')
        .query({ q: 'Testfixture', upline: 'banana' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');

      for (const value of ['true', 'false']) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/people')
          .query({ q: 'Testfixture', upline: value })
          .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

        expect(response.status).toBe(200);
      }
    });
  });

  describe('the upline (decision 0389)', () => {
    let manuelAccount: TestAccount;

    beforeEach(async () => {
      manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    });

    const rowsOf = (response: request.Response) =>
      response.body.data as { id: string; scope: string }[];

    it('adds the leaders above the searcher, five fields each, and no sibling branch', async () => {
      const response = await search(manuelAccount, 'Testfixture', { upline: true });

      expect(response.status).toBe(200);
      const rows = rowsOf(response);
      expect(rows.map((row) => row.id).sort()).toEqual([oriel.id, raymond.id, manuel.id].sort());
      expect(rows.find((row) => row.id === manuel.id)?.scope).toBe('FULL');
      for (const above of [oriel.id, raymond.id]) {
        const row = rows.find((candidate) => candidate.id === above) as Record<string, unknown>;
        expect(row.scope).toBe('IDENTITY_ONLY');
        expect(row).not.toHaveProperty('birth_date');
        expect(row).not.toHaveProperty('mobile_number');
      }
      // Rico and Juan are a sibling branch, Geraldine the other Network: none is above him.
      expect(rows.map((row) => row.id)).not.toContain(rico.id);
      expect(rows.map((row) => row.id)).not.toContain(juan.id);
      expect(rows.map((row) => row.id)).not.toContain(geraldine.id);
    });

    it('adds nobody above the searcher unless asked', async () => {
      const response = await search(manuelAccount, 'Testfixture');

      expect(rowsOf(response).map((row) => row.id)).toEqual([manuel.id]);
    });

    it('records no church-wide search, and spends no church-wide count', async () => {
      for (let n = 0; n < 31; n += 1) {
        expect((await search(manuelAccount, 'Testfixture', { upline: true })).status).toBe(200);
      }

      const written = await db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'directory.searched')
        .execute();
      expect(written).toEqual([]);
    });

    it('changes nothing for a Whole Church searcher', async () => {
      const plain = await search(adminAccount, 'Testfixture');
      const withUpline = await search(adminAccount, 'Testfixture', { upline: true });

      expect(withUpline.status).toBe(200);
      expect(rowsOf(withUpline)).toEqual(rowsOf(plain));
      expect(rowsOf(withUpline).every((row) => row.scope === 'FULL')).toBe(true);
      expect(rowsOf(withUpline).map((row) => row.id)).toContain(juan.id);
    });

    it('does not open the church to a Leader who sends it beside church_wide', async () => {
      const response = await search(manuelAccount, 'Testfixture', {
        upline: true,
        churchWide: true,
      });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });
  });

  describe('church-wide search (SKILL.md section 8)', () => {
    it('returns the listed profile for someone in the searcher scope', async () => {
      const response = await search(raymondAccount, 'Manuel');

      expect(response.status).toBe(200);
      const found = (response.body.data as Record<string, unknown>[]).find(
        (row) => row.id === manuel.id,
      );

      // A list row carries no birthday, civil status or mobile number: those come only with
      // reading the one record, which is kept (decision 0414).
      expect(found).toMatchObject({ scope: 'FULL', member_id: expect.any(String) });
      expect(found).not.toHaveProperty('birth_date');
      expect(found).not.toHaveProperty('civil_status');
      expect(found).not.toHaveProperty('mobile_number');
    });

    it('returns only identifying fields for someone outside it', async () => {
      // Section 8 permits exactly Member ID, full name, sex, current Network and
      // the current direct leader's name. Everything else is withheld -- and the
      // assertion is on the whole key set, so a field added to the profile later
      // cannot leak here unnoticed. The upline (decision 0389) is how a Leader's search
      // reaches somebody outside it: Oriel, above Raymond.
      const response = await search(raymondAccount, 'Oriel', { upline: true });

      const found = (response.body.data as Record<string, unknown>[]).find(
        (row) => row.id === oriel.id,
      );

      expect(found).toBeDefined();
      expect(Object.keys(found as object).sort()).toEqual([
        'direct_leader_name',
        'full_name',
        'id',
        'member_id',
        'network',
        'scope',
        'sex',
      ]);
      // A Network root, so the leader's name is null rather than absent.
      expect(found).toMatchObject({
        scope: 'IDENTITY_ONLY',
        network: 'MENS',
        direct_leader_name: null,
      });
    });

    it('reaches a person outside a Leader scope only for a Whole Church searcher', async () => {
      // The pickers sent the wide mode until decision 0389, on the ground that a Cell
      // may hold members its leader does not pastor. Since that ruling a leader adds
      // only somebody they oversee, so no picker reaches past the scope, and the wide
      // mode is a Whole Church searcher's alone.
      //
      // *This case was once named "still finds people outside the scope, because that
      // is what prevents duplicates" -- the argument decision 0244 refutes.*
      const leader = await search(raymondAccount, 'Juan');
      expect(leader.status).toBe(200);
      expect(leader.body.data).toEqual([]);

      const admin = await search(adminAccount, 'Juan', { churchWide: true });
      expect((admin.body.data as { id: string }[]).map((row) => row.id)).toEqual([juan.id]);
    });

    it('refuses a church-wide term that normalizes to fewer than three characters, naming the field', async () => {
      // The two-character bound on the DTO reads the term as typed. `normalizeName` turns
      // a hyphen or an apostrophe into a separator and drops suffix tokens, so `a-`, `a'`
      // and ` a` passed it and searched the church for one letter, and `Jr` built an empty
      // term -- which the service answered with nothing rather than `%%`. The route now
      // counts the term as it is searched, church-wide mode included. Church-wide it
      // takes three (decision 0303), so a two-letter term is refused there too.
      // As an administrator, the one kind of searcher the wide mode answers (decision 0389).
      for (const q of ['a-', "a'", ' a', 'Jr', 'II', '  ', 'Ma', 'Ma-']) {
        const response = await search(adminAccount, q, { churchWide: true });

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.field).toBe('q');
        expect(response.body.error.message).toBe('Enter at least three letters of a name.');
      }
    });

    it('still searches a three-letter term church-wide, and names written with a hyphen or apostrophe', async () => {
      for (const q of ['Mar', "O'Ma", 'Dela-Cruz']) {
        const response = await search(adminAccount, q, { churchWide: true });

        expect(response.status).toBe(200);
      }
    });

    it('still searches a two-letter term in the searcher own scope', async () => {
      const response = await search(raymondAccount, 'Ma');

      expect(response.status).toBe(200);
    });

    it('pages with an opaque cursor and no total', async () => {
      const first = await search(adminAccount, 'Testfixture', { limit: 2 });

      expect(first.status).toBe(200);
      expect((first.body.data as unknown[]).length).toBe(2);
      expect(first.body.next_cursor).toEqual(expect.any(String));
      // Section 22: collection endpoints do not return totals.
      expect(first.body).not.toHaveProperty('total');

      const second = await request(app.getHttpServer())
        .get('/api/v1/people')
        .query({ q: 'Testfixture', limit: 2, cursor: first.body.next_cursor as string })
        .set('Authorization', `Bearer ${adminAccount.accessToken}`);

      expect(second.status).toBe(200);

      const firstIds = (first.body.data as { id: string }[]).map((row) => row.id);
      const secondIds = (second.body.data as { id: string }[]).map((row) => row.id);
      expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    });

    it('refuses a cursor it cannot resolve, and says which field', async () => {
      // **Section 22, since the ruling of 2026-08-31.** This route is where the old
      // "treat it as absent" behaviour was actually decided, and it is the one that
      // never pinned it: the Cell roster and the leadership queue each carried a case
      // asserting they matched *this* endpoint, and this endpoint had nothing. So the
      // behaviour two other files cited as settled precedent could have been changed
      // here with the whole suite green.
      //
      // Both shapes, because a decoder catching only the `JSON.parse` throw would still
      // return null for the second.
      for (const cursor of [
        'not-a-real-cursor',
        Buffer.from(JSON.stringify({ notAKey: 'x' }), 'utf8').toString('base64url'),
      ]) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/people')
          .query({ q: 'Testfixture', cursor })
          .set('Authorization', `Bearer ${adminAccount.accessToken}`);

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.field).toBe('cursor');
      }
    });
  });

  describe('editing basic details (SKILL.md section 7)', () => {
    it('applies a correction and audits it', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/people/${manuel.id}`)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ civil_status: 'MARRIED' });

      expect(response.status).toBe(200);
      expect(response.body.civil_status).toBe('MARRIED');

      const audit = await db
        .selectFrom('audit_log')
        .select(['action', 'before', 'after'])
        .where('target_id', '=', manuel.id)
        .executeTakeFirstOrThrow();

      expect(audit.action).toBe('person.updated');
      // Section 21 wants the before and after values, not merely that it changed.
      expect(audit.before).toMatchObject({ civil_status: 'SINGLE' });
      expect(audit.after).toMatchObject({ civil_status: 'MARRIED' });
    });

    it('records the body it returns, so a replay is the same answer', async () => {
      // The obligation this endpoint broke when it was first written: the service
      // recorded the raw record while the controller returned a composed profile,
      // so a retry answered without `full_name` or `scope` and two identical
      // requests got two different bodies (section 22).
      const key = randomUUID();

      const first = await request(app.getHttpServer())
        .patch(`/api/v1/people/${manuel.id}`)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .set('Idempotency-Key', key)
        .send({ civil_status: 'MARRIED' });

      expect(first.status).toBe(200);
      expect(first.body).toHaveProperty('full_name');

      const stored = await db
        .selectFrom('idempotency_keys')
        .select('response_body')
        .where('key', '=', key)
        .executeTakeFirstOrThrow();
      expect(stored.response_body).toEqual(first.body);

      const retry = await request(app.getHttpServer())
        .patch(`/api/v1/people/${manuel.id}`)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .set('Idempotency-Key', key)
        .send({ civil_status: 'MARRIED' });

      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);
    });

    it('refuses to change sex through the basic edit', async () => {
      // Sex determines Network, which determines which pastoral edges are legal.
      // If it were an ordinary field edit, an actor could flip someone's Network
      // and create a cross-Network edge without ever invoking
      // people.manage_pastoral_assignment (section 7).
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/people/${manuel.id}`)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ sex: 'FEMALE' });

      expect(response.status).toBe(422);

      const unchanged = await db
        .selectFrom('persons')
        .select('sex')
        .where('id', '=', manuel.id)
        .executeTakeFirstOrThrow();
      expect(unchanged.sex).toBe('MALE');
    });

    it('refuses an edit outside the actor scope', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/people/${juan.id}`)
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ civil_status: 'MARRIED' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });
  });

  describe('birthday and mobile number are asked for (decision 0328)', () => {
    // SKILL.md section 3, Required personal information: both are required when a
    // Person is added, unless *Not given yet* is ticked. Blank is an absent key, null,
    // or a string of nothing but spaces. A value beside its tick is refused, and
    // nothing about the tick is stored. Bodies are written out in full here rather
    // than through `personBody`, which adds the ticks for a case that does not care.

    const BIRTHDAY = '1991-07-19';
    const MOBILE = '0917 555 0142';

    function body(overrides: Record<string, unknown>): Record<string, unknown> {
      const sent: Record<string, unknown> = {
        first_name: 'Celia',
        last_name: 'Marquez',
        birth_date: BIRTHDAY,
        mobile_number: MOBILE,
        sex: 'FEMALE',
        civil_status: 'SINGLE',
        pastoral_leader_id: geraldine.id,
        ...overrides,
      };
      // An override of `undefined` means the key is absent from the body, not sent.
      for (const key of Object.keys(sent)) if (sent[key] === undefined) delete sent[key];
      return sent;
    }

    async function personCount(): Promise<number> {
      return (await db.selectFrom('persons').select('id').execute()).length;
    }

    async function storedRow(id: string) {
      return db
        .selectFrom('persons')
        .select(['birth_date', 'mobile_number', 'mobile_number_normalized'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
    }

    async function expectRefusedNaming(sent: Record<string, unknown>, fields: string[]) {
      const before = await personCount();
      const response = await post(adminAccount, randomUUID()).send(sent);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      const named = (response.body.error.details.fields as { field: string }[]).map(
        (entry) => entry.field,
      );
      expect(named.some((field) => fields.includes(field))).toBe(true);

      // The status says nothing about whether a row was written; this does.
      expect(await personCount()).toBe(before);
    }

    it.each([
      ['absent', undefined],
      ['null', null],
      ['an empty string', ''],
      ['spaces only', '   '],
    ])('refuses a birthday that is %s without its tick, naming birth_date', async (_, value) => {
      await expectRefusedNaming(body({ birth_date: value }), ['birth_date']);
    });

    it.each([
      ['absent', undefined],
      ['null', null],
      ['an empty string', ''],
      ['spaces only', '   '],
    ])(
      'refuses a mobile number that is %s without its tick, naming mobile_number',
      async (_, value) => {
        await expectRefusedNaming(body({ mobile_number: value }), ['mobile_number']);
      },
    );

    it('refuses birth_date_not_given beside a birthday', async () => {
      // The request says two things about one field (decision 0328, point 1). Either
      // name is a fair answer to which field is at fault, so either is accepted.
      await expectRefusedNaming(body({ birth_date_not_given: true }), [
        'birth_date',
        'birth_date_not_given',
      ]);
    });

    it('refuses mobile_number_not_given beside a number', async () => {
      await expectRefusedNaming(body({ mobile_number_not_given: true }), [
        'mobile_number',
        'mobile_number_not_given',
      ]);
    });

    it.each([
      ['absent', undefined],
      ['null', null],
      ['an empty string', ''],
      ['spaces only', '   '],
    ])('accepts a ticked birthday that is %s, and stores no birthday', async (_, value) => {
      const response = await post(adminAccount, randomUUID()).send(
        body({ birth_date: value, birth_date_not_given: true }),
      );

      expect(response.status).toBe(201);
      const stored = await storedRow(response.body.id);
      // Null, never a placeholder (section 3, Never fabricate one).
      expect(stored.birth_date).toBeNull();
      expect(stored.mobile_number).toBe(MOBILE);
    });

    it.each([
      ['absent', undefined],
      ['null', null],
      ['an empty string', ''],
      ['spaces only', '   '],
    ])('accepts a ticked mobile number that is %s, and stores no number', async (_, value) => {
      const response = await post(adminAccount, randomUUID()).send(
        body({ mobile_number: value, mobile_number_not_given: true }),
      );

      expect(response.status).toBe(201);
      const stored = await storedRow(response.body.id);
      expect(stored.mobile_number).toBeNull();
      // The matcher reads the normalized column; a blank stored there would let two
      // people with no number match each other at Tier 1 (section 3).
      expect(stored.mobile_number_normalized).toBeNull();
      expect(stored.birth_date).toBe(BIRTHDAY);
    });

    it('accepts both ticks together, storing neither field', async () => {
      const response = await post(adminAccount, randomUUID()).send(
        body({
          birth_date: undefined,
          mobile_number: undefined,
          birth_date_not_given: true,
          mobile_number_not_given: true,
        }),
      );

      expect(response.status).toBe(201);
      const stored = await storedRow(response.body.id);
      expect(stored.birth_date).toBeNull();
      expect(stored.mobile_number).toBeNull();
      expect(stored.mobile_number_normalized).toBeNull();
    });

    it('stores both as sent when both are given with no tick', async () => {
      const response = await post(adminAccount, randomUUID()).send(body({}));

      expect(response.status).toBe(201);
      const stored = await storedRow(response.body.id);
      expect(stored.birth_date).toBe(BIRTHDAY);
      expect(stored.mobile_number).toBe(MOBILE);
      expect(stored.mobile_number_normalized).not.toBeNull();
    });

    it('accepts a false tick beside a value, as no tick at all', async () => {
      const response = await post(adminAccount, randomUUID()).send(
        body({ birth_date_not_given: false, mobile_number_not_given: false }),
      );

      expect(response.status).toBe(201);
      const stored = await storedRow(response.body.id);
      expect(stored.birth_date).toBe(BIRTHDAY);
      expect(stored.mobile_number).toBe(MOBILE);
    });

    it('does not require either on an edit that changes only the name', async () => {
      // Decision 0328, point 4: PATCH keeps its rules, so a record added without a
      // birthday or a number can still have its name corrected.
      const created = await post(adminAccount, randomUUID()).send(
        body({
          birth_date: undefined,
          mobile_number: undefined,
          birth_date_not_given: true,
          mobile_number_not_given: true,
        }),
      );
      expect(created.status).toBe(201);

      const edited = await request(app.getHttpServer())
        .patch(`/api/v1/people/${created.body.id}`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ first_name: 'Cecilia' });

      expect(edited.status).toBe(200);
      const stored = await db
        .selectFrom('persons')
        .select(['first_name', 'birth_date', 'mobile_number'])
        .where('id', '=', created.body.id)
        .executeTakeFirstOrThrow();
      expect(stored.first_name).toBe('Cecilia');
      expect(stored.birth_date).toBeNull();
      expect(stored.mobile_number).toBeNull();
    });
  });

  function post(actor: TestAccount, key: string) {
    return request(app.getHttpServer())
      .post('/api/v1/people')
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', key);
  }

  function create(actor: TestAccount, overrides: Record<string, unknown> = {}) {
    return post(actor, randomUUID()).send(personBody(overrides));
  }

  describe('an identifier names the same record however it is spelled', () => {
    // A `uuid` column compares case-insensitively and TypeScript does not, and
    // `@IsUUID()` accepts either case. Compared raw, a client echoing candidate ids
    // back in uppercase never satisfies the Tier 1 gate — so the refusal becomes
    // permanent and that Person can never be created, which is the block section 3
    // says must never happen and which is worse than the duplicate it guards
    // against. `UUID().uuidString` on iOS is uppercase by default (section 2).
    it('accepts a duplicate acknowledgement whose ids are uppercase', async () => {
      // Same Network as the leader they are placed under: a cross-Network edge is
      // refused before any of this is reached, and `personBody` defaults to MALE
      // while Manuel leads in the Men's Network.
      const twin = personBody({
        first_name: 'Mario',
        last_name: 'Delacruz',
        birth_date: '1991-07-19',
        pastoral_leader_id: manuel.id,
      });

      const first = await request(app.getHttpServer())
        .post('/api/v1/people')
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(twin);

      expect(first.status).toBe(201);

      const gated = await request(app.getHttpServer())
        .post('/api/v1/people')
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(twin);

      expect(gated.status).toBe(409);
      expect(gated.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');

      const candidateIds: string[] = gated.body.error.details.candidates.map(
        (candidate: { id: string }) => candidate.id.toUpperCase(),
      );
      expect(candidateIds.length).toBeGreaterThan(0);

      const acknowledged = await request(app.getHttpServer())
        .post('/api/v1/people')
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...twin, acknowledged_duplicate_ids: candidateIds });

      // Compared raw, this is 409 forever and the Person can never be created.
      expect(acknowledged.status).toBe(201);
    });
  });

  describe('creating a Network root (section 5, Network roots)', () => {
    /**
     * **The root path had no caller and no test**, which is how the defect this
     * suite now pins survived: `pastoralLeaderId: string | null` read as though
     * null meant root, and what it did was open no assignment row at all. The
     * import — its only intended caller — would have produced two unassigned
     * Persons and a tree with no roots, silently.
     *
     * Reached through the service rather than the API on purpose: section 5 makes
     * who holds a root a Network-level decision, so no endpoint offers it, and a
     * test that could only go through HTTP could not reach this at all.
     */
    async function mintClaim(): Promise<{ key: string; accountId: string; claimId: string }> {
      const idempotency = app.get(IdempotencyService);
      const key = randomUUID();
      const claimed = await idempotency.claim({
        key,
        accountId: adminAccount.id,
        fingerprint: randomUUID(),
      });

      if (claimed.outcome !== 'claimed') {
        throw new Error(`Expected a fresh key to be claimable, got ${claimed.outcome}.`);
      }

      return { key, accountId: adminAccount.id, claimId: claimed.claimId };
    }

    it('opens a row with a null leader and the Network seat', async () => {
      // Free the seat by closing the fixture root, which is how section 5 says a
      // seat is freed. A DELETE is refused outright — principle 12.
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: new Date() })
        .where('leader_id', 'is', null)
        .where('ended_at', 'is', null)
        .execute();

      const people = app.get(PeopleService);
      const created = await people.create(
        {
          firstName: 'Nena',
          lastName: 'Bagumbayan',
          birthDate: '1962-11-08',
          sex: 'FEMALE',
          civilStatus: 'MARRIED',
          placement: { kind: 'ROOT' },
        },
        { accountId: adminAccount.id, personId: oriel.id },
        await mintClaim(),
        () => Promise.resolve(true),
      );

      const row = await db
        .selectFrom('pastoral_assignments')
        .select(['leader_id', 'root_network'])
        .where('person_id', '=', String(created.id))
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();

      // Both facts together. A row with a null leader and no seat is what the old
      // shape produced, and a row with no seat is not a root (section 5).
      expect(row.leader_id).toBeNull();
      expect(row.root_network).toBe('WOMENS');
    });

    it('takes the seat from the person own sex, not from anything the caller says', async () => {
      // Section 4: Network follows from sex, and is assigned rather than proposed.
      // The placement carries no Network, so there is no way for a caller to ask
      // for the wrong seat — which is what the database trigger would refuse.
      // Free the seat by closing the fixture root, which is how section 5 says a
      // seat is freed. A DELETE is refused outright — principle 12.
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: new Date() })
        .where('leader_id', 'is', null)
        .where('ended_at', 'is', null)
        .execute();

      const people = app.get(PeopleService);
      const created = await people.create(
        {
          firstName: 'Bayani',
          lastName: 'Bagumbayan',
          birthDate: '1960-02-14',
          sex: 'MALE',
          civilStatus: 'MARRIED',
          placement: { kind: 'ROOT' },
        },
        { accountId: adminAccount.id, personId: oriel.id },
        await mintClaim(),
        () => Promise.resolve(true),
      );

      const row = await db
        .selectFrom('pastoral_assignments')
        .select('root_network')
        .where('person_id', '=', String(created.id))
        .executeTakeFirstOrThrow();

      expect(row.root_network).toBe('MENS');
    });

    it('refuses a second root in the same Network, through the service', async () => {
      // The fixtures already give the Men's Network a root. The database refuses
      // the second, and the service does not swallow it.
      const people = app.get(PeopleService);

      await expect(
        people.create(
          {
            firstName: 'Bayani',
            lastName: 'Bagumbayan',
            birthDate: '1960-02-14',
            sex: 'MALE',
            civilStatus: 'MARRIED',
            placement: { kind: 'ROOT' },
          },
          { accountId: adminAccount.id, personId: oriel.id },
          await mintClaim(),
          () => Promise.resolve(true),
        ),
      ).rejects.toThrow(/pastoral_assignments_one_root_per_network/);
    });

    it('records in the audit entry which of the two states was created', async () => {
      // Section 21 wants the values. A null `pastoral_leader_id` alone cannot say
      // whether a root or an unassigned Person was created, and those are
      // different facts about the tree.
      // Free the seat by closing the fixture root, which is how section 5 says a
      // seat is freed. A DELETE is refused outright — principle 12.
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: new Date() })
        .where('leader_id', 'is', null)
        .where('ended_at', 'is', null)
        .execute();

      const people = app.get(PeopleService);
      const created = await people.create(
        {
          firstName: 'Nena',
          lastName: 'Bagumbayan',
          birthDate: '1962-11-08',
          sex: 'FEMALE',
          civilStatus: 'MARRIED',
          placement: { kind: 'ROOT' },
        },
        { accountId: adminAccount.id, personId: oriel.id },
        await mintClaim(),
        () => Promise.resolve(true),
      );

      const entry = await db
        .selectFrom('audit_log')
        .select('after')
        .where('action', '=', 'person.created')
        .where('target_id', '=', String(created.id))
        .executeTakeFirstOrThrow();

      expect(entry.after).toMatchObject({ network_root: true, pastoral_leader_id: null });
    });
  });

  /**
   * The search, narrowed to the actor's own scope unless `churchWide` is passed
   * (SKILL.md section 8, decision 0244).
   *
   * The flag is explicit at every call site rather than defaulted here, because
   * which of the two a case exercises is the thing most of these cases are about.
   */
  function search(
    actor: TestAccount,
    q: string,
    options: { limit?: number; churchWide?: boolean; upline?: boolean } = {},
  ) {
    const query: Record<string, string | number | boolean> = { q };
    if (options.limit !== undefined) {
      query.limit = options.limit;
    }
    if (options.churchWide) {
      query.church_wide = true;
    }
    if (options.upline) {
      query.upline = true;
    }

    return request(app.getHttpServer())
      .get('/api/v1/people')
      .query(query)
      .set('Authorization', `Bearer ${actor.accessToken}`);
  }
});

/**
 * The create body with the birthday omitted entirely, as a client sends it when a
 * leader did not ask or the person declined (SKILL.md section 3) — which since
 * decision 0328 means *Not given yet* is ticked.
 */
function withoutBirthday(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body = personBody({ birth_date_not_given: true, ...overrides });
  delete body.birth_date;
  return body;
}

/**
 * A field the case leaves blank is marked *Not given yet*, so a body that does not care
 * about a birthday or a number satisfies decision 0328 without inventing one.
 */
function personBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    first_name: 'Bene',
    last_name: 'Newcomer',
    birth_date: '1994-03-02',
    sex: 'MALE',
    civil_status: 'SINGLE',
    ...overrides,
  };
  if (body.birth_date === undefined || body.birth_date === null) body.birth_date_not_given ??= true;
  if (body.mobile_number === undefined || body.mobile_number === null) {
    body.mobile_number_not_given ??= true;
  }
  return body;
}
