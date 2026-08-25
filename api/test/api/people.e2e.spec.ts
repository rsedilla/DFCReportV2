import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { PeopleService } from '../../src/people/people.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `/api/v1/people` — creation, church-wide search, and the basic edit.
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

    it('is not gated on a name match alone once the birthday is absent', async () => {
      // **The consequence worth pinning.** Two of the three Tier 1 rules read the
      // birthday, and Tier 1 blocks creation — so with none, a name match alone
      // reaches only Tier 2 and creation proceeds.
      //
      // Not "Tier 1 is unreachable": the third rule reads a mobile number, and
      // equal names on a shared household number are still a Tier 1 refusal
      // (section 3). An earlier version of this comment claimed otherwise, as did
      // six other places on this branch, this case's own title among them.
      //
      // Same name as an existing fixture, which with a matching birthday is the
      // Tier 1 refusal two cases above. Without one it creates.
      const created = await post(raymondAccount, randomUUID()).send(
        withoutBirthday({
          pastoral_leader_id: manuel.id,
          first_name: 'Manuel',
          last_name: 'Testfixture',
        }),
      );

      expect(created.status).toBe(201);
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
          reason: 'NO_LONGER_IN_CURRENT_NETWORK',
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

    it('refuses a request with no idempotency key', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/people')
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .send(personBody({ pastoral_leader_id: manuel.id }));

      expect(response.status).toBe(422);
      expect(await db.selectFrom('persons').select('id').execute()).toHaveLength(7);
    });
  });

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

      const found = (response.body.data as Record<string, unknown>[]).find(
        (candidate) => candidate.id === juan.id,
      );

      expect(found).toMatchObject({ possible_match: true });
      expect(found).not.toHaveProperty('tier');
      expect(found).not.toHaveProperty('reasons');
    });

    it('withholds the match reasons for a candidate outside the actor scope', async () => {
      // A reason reading "same birthday" asserts that an out-of-scope person's
      // birthday equals the value just submitted, which section 8 forbids
      // disclosing. On a read endpoint that would be a silent oracle.
      const response = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Juan', last_name: 'Testfixture', birth_date: '1985-06-15' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);

      const outOfScope = (response.body.data as Record<string, unknown>[]).find(
        (candidate) => candidate.id === juan.id,
      );

      expect(outOfScope).toBeDefined();
      // Identified, and flagged as possible -- which is what section 3 needs the
      // encoder to know. Neither the tier nor the reasons travel: both name which
      // field matched, and with an equal name a tier is a yes/no birthday oracle.
      expect(outOfScope).toMatchObject({
        member_id: expect.any(String),
        possible_match: true,
      });
      expect(outOfScope).not.toHaveProperty('tier');
      expect(outOfScope).not.toHaveProperty('reasons');
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

      const withWrongBirthday = await request(app.getHttpServer())
        .get('/api/v1/people/duplicate-candidates')
        .query({ first_name: 'Juan', last_name: 'Testfixture', birth_date: '1970-01-01' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      const juanIn = (response: { body: { data: Record<string, unknown>[] } }) =>
        response.body.data.find((candidate) => candidate.id === juan.id);

      // Asserted present first. `.find()` returns undefined when the candidate is
      // absent, and `expect(undefined).toEqual(undefined)` passes -- so without
      // this the case goes green for any regression that empties the list, which
      // is the very channel the redaction does not cover.
      expect(juanIn(withRightBirthday)).toBeDefined();
      expect(juanIn(withWrongBirthday)).toBeDefined();
      expect(juanIn(withRightBirthday)).toEqual(juanIn(withWrongBirthday));
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
  });

  describe('church-wide search (SKILL.md section 8)', () => {
    it('returns the full profile for someone in the searcher scope', async () => {
      const response = await search(raymondAccount, 'Manuel');

      expect(response.status).toBe(200);
      const found = (response.body.data as Record<string, unknown>[]).find(
        (row) => row.id === manuel.id,
      );

      expect(found).toMatchObject({ scope: 'FULL', member_id: expect.any(String) });
      expect(found).toHaveProperty('birth_date');
      expect(found).toHaveProperty('civil_status');
      expect(found).toHaveProperty('mobile_number');
    });

    it('returns only identifying fields for someone outside it', async () => {
      // Section 8 permits exactly Member ID, full name, sex, current Network and
      // the current direct leader's name. Everything else is withheld -- and the
      // assertion is on the whole key set, so a field added to the profile later
      // cannot leak here unnoticed.
      const response = await search(raymondAccount, 'Juan');

      const found = (response.body.data as Record<string, unknown>[]).find(
        (row) => row.id === juan.id,
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
      expect(found).toMatchObject({
        scope: 'IDENTITY_ONLY',
        network: 'MENS',
        direct_leader_name: expect.stringContaining('Rico'),
      });
    });

    it('still finds people outside the scope, because that is what prevents duplicates', async () => {
      // Narrowing the rows to the searcher's own subtree would defeat the purpose:
      // they would create a second record for someone another leader already has.
      const response = await search(raymondAccount, 'Juan');

      expect((response.body.data as unknown[]).length).toBeGreaterThan(0);
    });

    it('does not page out the directory for a term that normalizes to nothing', async () => {
      // `normalizeName` drops suffix tokens, so `Jr` arrives empty and would build
      // the pattern `%%` -- the directory dump the LIKE escaping was added to
      // prevent, reached by a shorter route.
      for (const q of ['Jr', 'II', '  ']) {
        const response = await search(raymondAccount, q);

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual([]);
      }
    });

    it('pages with an opaque cursor and no total', async () => {
      const first = await search(adminAccount, 'Testfixture', 2);

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

  function search(actor: TestAccount, q: string, limit?: number) {
    return request(app.getHttpServer())
      .get('/api/v1/people')
      .query(limit === undefined ? { q } : { q, limit })
      .set('Authorization', `Bearer ${actor.accessToken}`);
  }
});

/**
 * The create body with the birthday omitted entirely, as a client sends it when a
 * leader did not ask or the person declined (SKILL.md section 3).
 */
function withoutBirthday(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body = personBody(overrides);
  delete body.birth_date;
  return body;
}

function personBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    first_name: 'Bene',
    last_name: 'Newcomer',
    birth_date: '1994-03-02',
    sex: 'MALE',
    civil_status: 'SINGLE',
    ...overrides,
  };
}
