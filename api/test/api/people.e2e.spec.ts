import { randomUUID } from 'node:crypto';

import request from 'supertest';

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

  function search(actor: TestAccount, q: string, limit?: number) {
    return request(app.getHttpServer())
      .get('/api/v1/people')
      .query(limit === undefined ? { q } : { q, limit })
      .set('Authorization', `Bearer ${actor.accessToken}`);
  }
});

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
