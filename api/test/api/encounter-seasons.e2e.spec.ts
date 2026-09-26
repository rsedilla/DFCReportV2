import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  EPOCH,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * Encounter seasons at the API (SKILL.md section 28, *Encounter seasons*; section 7,
 * `settings.manage`; section 21; decision 0296).
 *
 * What is pinned, each from the specification rather than from the service:
 *
 *   - anyone who reads SUYNL reads the seasons;
 *   - only a Whole Church `settings.manage` holder adds or changes one;
 *   - each LC Party is at least five weeks before its own weekend, one left empty is
 *     exactly five, and nothing limits how early a party may be;
 *   - two seasons may not hold the same weekend, and nothing deletes one;
 *   - every change is audited with its previous and new values.
 *
 * Fixture names are invented (CLAUDE.md, Secrets). The tree is the example one:
 *
 *   Raymond (Men's root, a Senior Pastor) -> Manuel -> Mark
 *   Adele: an administrator outside the pastoral tree
 *   Perla: an account holding no role
 *   Grace (Women's root) -> Joy, and Noel, a Person in no Network, where a case needs them
 */
describe('Encounter seasons (section 28, decision 0296)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let seniorPastor: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;
  let noRole: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);

    const adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });

    seniorPastor = await createAccount(app, db, {
      person: raymond,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    nameSeniorPastors(app, [raymond.id]);

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    const perla = await createPerson(db, { firstName: 'Perla', network: 'WOMENS' });
    noRole = await createAccount(app, db, { person: perla, roles: [] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  interface Body {
    mens_encounter_on?: unknown;
    womens_encounter_on?: unknown;
    mens_lc_party_on?: unknown;
    womens_lc_party_on?: unknown;
  }

  const list = (account: TestAccount) =>
    request(app.getHttpServer())
      .get('/api/v1/encounter-seasons')
      .set('Authorization', `Bearer ${account.accessToken}`);

  const create = (account: TestAccount, body: Body, key: string = randomUUID()) =>
    request(app.getHttpServer())
      .post('/api/v1/encounter-seasons')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);

  const update = (account: TestAccount, id: string, body: Body, key: string = randomUUID()) =>
    request(app.getHttpServer())
      .patch(`/api/v1/encounter-seasons/${id}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);

  /** A calendar date moved by whole days, computed independently of the service. */
  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  // A December season, the Women's weekend a week after the Men's (decision 0295).
  const MENS = '2027-12-03';
  const WOMENS = '2027-12-10';

  const rows = () => db.selectFrom('encounter_seasons').selectAll().orderBy('created_at').execute();

  const auditOf = (action: string) =>
    db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action as never)
      .execute();

  /** Records a season through the API as the administrator, and returns its id. */
  const seed = async (body: Body): Promise<string> => {
    const response = await create(admin, body);
    expect(response.status).toBe(201);
    return response.body.id as string;
  };

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  describe('GET /encounter-seasons: anyone who reads SUYNL reads the seasons', () => {
    // The owner's ruling on which half a reader is shown (relayed 2026-09-26, recorded in the
    // service's docblock): a Whole Church suynl.view_subtree reader both, any other reader
    // their own Network's half now, the other half null, and a reader in no Network neither.

    const AUGUST_MENS = '2027-08-13';
    const AUGUST_WOMENS = '2027-08-06';

    /** Three seasons recorded out of order, the August one's Women's weekend first. */
    const seedThree = async () => {
      const december = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });
      const august = await seed({
        mens_encounter_on: AUGUST_MENS,
        womens_encounter_on: AUGUST_WOMENS,
      });
      const april = await seed({
        mens_encounter_on: '2027-04-02',
        womens_encounter_on: '2027-04-09',
      });
      return { april, august, december };
    };

    const both = (id: string) => ({
      id,
      mens_lc_party_on: shift(AUGUST_MENS, -35),
      mens_encounter_on: AUGUST_MENS,
      womens_lc_party_on: shift(AUGUST_WOMENS, -35),
      womens_encounter_on: AUGUST_WOMENS,
    });

    /** A Women's Network leader: Grace (root) -> Joy. */
    const womensLeader = async (): Promise<TestAccount> => {
      const grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
      await assignTo(db, grace.id, null);
      const joy = await createPerson(db, { firstName: 'Joy', network: 'WOMENS' });
      await assignTo(db, joy.id, grace.id);
      return createAccount(app, db, { person: joy, roles: ['LEADER'] });
    };

    /** A Leader whose Person holds no Network row at all. */
    const leaderInNoNetwork = async (): Promise<TestAccount> => {
      const person = await db
        .insertInto('persons')
        .values({
          id: randomUUID(),
          first_name: 'Noel',
          middle_name: null,
          last_name: 'Testfixture',
          birth_date: '1985-06-15',
          sex: 'MALE',
          civil_status: 'SINGLE',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('person_lifecycle')
        .values({ person_id: person.id, state: 'CURRENT', reason: null, started_at: EPOCH })
        .execute();
      return createAccount(app, db, {
        // createAccount reads the id and the first name; the network field is never read.
        person: { id: person.id, firstName: 'Noel', network: 'MENS' },
        roles: ['LEADER'],
      });
    };

    it('orders the seasons by the earlier of their two weekends, for every reader', async () => {
      const { april, august, december } = await seedThree();
      const readers = [markAccount, manuelAccount, seniorPastor, admin, await womensLeader()];

      for (const account of readers) {
        const response = await list(account);
        expect(response.status).toBe(200);
        expect(response.body.data.map((season: { id: string }) => season.id)).toEqual([
          april,
          august,
          december,
        ]);
      }
    });

    it('shows an Admin and a Senior Pastor both halves', async () => {
      const { august } = await seedThree();

      for (const account of [admin, seniorPastor]) {
        const response = await list(account);
        expect(response.status).toBe(200);
        expect(response.body.shows).toBe('BOTH');
        expect(response.body.data[1]).toEqual(both(august));
      }
    });

    it("shows a Men's Network leader the Men's half only, the Women's dates null", async () => {
      const { august } = await seedThree();

      for (const account of [markAccount, manuelAccount]) {
        const response = await list(account);
        expect(response.status).toBe(200);
        expect(response.body.shows).toBe('MENS');
        expect(response.body.data[1]).toEqual({
          ...both(august),
          womens_lc_party_on: null,
          womens_encounter_on: null,
        });
        for (const season of response.body.data) {
          expect(season.womens_lc_party_on).toBeNull();
          expect(season.womens_encounter_on).toBeNull();
          expect(season.mens_encounter_on).not.toBeNull();
        }
      }
    });

    it("shows a Women's Network leader the Women's half only, the Men's dates null", async () => {
      const { august } = await seedThree();

      const response = await list(await womensLeader());
      expect(response.status).toBe(200);
      expect(response.body.shows).toBe('WOMENS');
      expect(response.body.data[1]).toEqual({
        ...both(august),
        mens_lc_party_on: null,
        mens_encounter_on: null,
      });
      for (const season of response.body.data) {
        expect(season.mens_lc_party_on).toBeNull();
        expect(season.mens_encounter_on).toBeNull();
        expect(season.womens_encounter_on).not.toBeNull();
      }
    });

    it('shows a reader in no Network neither half, every date null', async () => {
      const { august } = await seedThree();

      const response = await list(await leaderInNoNetwork());
      expect(response.status).toBe(200);
      expect(response.body.shows).toBe('NEITHER');
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[1]).toEqual({
        id: august,
        mens_lc_party_on: null,
        mens_encounter_on: null,
        womens_lc_party_on: null,
        womens_encounter_on: null,
      });
    });

    it('shows both halves to a Leader holding a Whole Church suynl.view_subtree grant', async () => {
      const { august } = await seedThree();
      await db
        .insertInto('capability_grants')
        .values({
          account_id: markAccount.id,
          capability: 'suynl.view_subtree',
          scope_type: 'WHOLE_CHURCH',
          scope_network: null,
          read_only: true,
          reason: 'A Whole Church reading grant is what decides both halves, not a role.',
          granted_by: admin.id,
        })
        .execute();

      const response = await list(markAccount);
      expect(response.body.shows).toBe('BOTH');
      expect(response.body.data[1]).toEqual(both(august));
    });

    it('answers the write routes the whole season, whichever half the list shows', async () => {
      // POST and PATCH answer an Admin, and the ruling leaves their responses whole.
      const response = await create(admin, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
      });
      expect(response.body.mens_encounter_on).toBe(MENS);
      expect(response.body.womens_encounter_on).toBe(WOMENS);
    });

    it("breaks a tie on the earlier weekend by the Men's weekend, whichever is recorded first", async () => {
      // One season's Men's weekend is the other's Women's weekend, which the per-column
      // unique indexes allow, so the earlier weekend alone does not order them.
      const later = await seed({
        mens_encounter_on: '2028-04-14',
        womens_encounter_on: '2028-04-07',
      });
      const earlier = await seed({
        mens_encounter_on: '2028-04-07',
        womens_encounter_on: '2028-04-21',
      });

      for (let read = 0; read < 3; read += 1) {
        const response = await list(admin);
        expect(response.body.data.map((season: { id: string }) => season.id)).toEqual([
          earlier,
          later,
        ]);
      }
    });

    it('answers an empty list when no season has been set', async () => {
      const response = await list(markAccount);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ shows: 'MENS', data: [] });
    });

    it('refuses a request carrying no token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/encounter-seasons');
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('refuses an account that does not hold suynl.view_subtree', async () => {
      const response = await list(noRole);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });
  });

  // ---------------------------------------------------------------------------
  // Who may write
  // ---------------------------------------------------------------------------

  describe('only a Whole Church settings.manage holder adds or changes a season', () => {
    it('refuses a Leader and a Senior Pastor, and writes nothing', async () => {
      // Section 7's table gives settings.manage to Admin alone.
      for (const account of [markAccount, manuelAccount, seniorPastor]) {
        const response = await create(account, {
          mens_encounter_on: MENS,
          womens_encounter_on: WOMENS,
        });
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      }

      expect(await rows()).toHaveLength(0);
      expect(await auditOf('encounter_season.created')).toHaveLength(0);
    });

    it('refuses a Senior Pastor and a Leader an edit, and changes nothing', async () => {
      const id = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });

      for (const account of [markAccount, seniorPastor]) {
        const response = await update(account, id, {
          mens_encounter_on: shift(MENS, 7),
          womens_encounter_on: shift(WOMENS, 7),
        });
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      }

      const [row] = await rows();
      expect(String(row.mens_encounter_on)).toBe(MENS);
      expect(row.updated_by).toBeNull();
      expect(await auditOf('encounter_season.changed')).toHaveLength(0);
    });

    it('refuses a settings.manage grant narrower than Whole Church', async () => {
      // Section 7: settings.manage is Whole Church only, so a narrower grant covers nothing.
      await db
        .insertInto('capability_grants')
        .values({
          account_id: markAccount.id,
          capability: 'settings.manage',
          scope_type: 'NETWORK',
          scope_network: 'MENS',
          read_only: false,
          reason: 'A Network-scoped grant of a Whole-Church-only capability.',
          granted_by: admin.id,
        })
        .execute();

      const response = await create(markAccount, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
      });
      expect(response.status).toBe(403);
      expect(['CAPABILITY_DENIED', 'SCOPE_DENIED']).toContain(response.body.error.code);
      expect(await rows()).toHaveLength(0);
    });

    it('refuses a write carrying no token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/encounter-seasons')
        .set('Idempotency-Key', randomUUID())
        .send({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });
      expect(response.status).toBe(401);
      expect(await rows()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // POST
  // ---------------------------------------------------------------------------

  describe('POST /encounter-seasons', () => {
    it('records a season, each LC Party left out being exactly five weeks before its weekend', async () => {
      const response = await create(admin, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
      });

      expect(response.status).toBe(201);
      expect(Object.keys(response.body).sort()).toEqual(
        [
          'id',
          'mens_encounter_on',
          'mens_lc_party_on',
          'womens_encounter_on',
          'womens_lc_party_on',
        ].sort(),
      );
      expect(response.body).toEqual({
        id: expect.any(String),
        mens_lc_party_on: '2027-10-29',
        mens_encounter_on: MENS,
        womens_lc_party_on: '2027-11-05',
        womens_encounter_on: WOMENS,
      });
      expect(response.body.mens_lc_party_on).toBe(shift(MENS, -35));
      expect(response.body.womens_lc_party_on).toBe(shift(WOMENS, -35));

      const [row] = await rows();
      expect(row.id).toBe(response.body.id);
      expect(row.created_by).toBe(admin.id);
      expect(row.updated_by).toBeNull();
      expect(row.updated_at).toBeNull();
    });

    it('defaults each party from its own weekend, not from the other', async () => {
      const response = await create(admin, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        mens_lc_party_on: '2027-09-01',
      });

      expect(response.status).toBe(201);
      expect(response.body.mens_lc_party_on).toBe('2027-09-01');
      expect(response.body.womens_lc_party_on).toBe(shift(WOMENS, -35));
    });

    it('accepts a party exactly 35 days before its weekend', async () => {
      const response = await create(admin, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        mens_lc_party_on: shift(MENS, -35),
        womens_lc_party_on: shift(WOMENS, -35),
      });
      expect(response.status).toBe(201);
    });

    it.each([
      ['mens_lc_party_on', MENS],
      ['womens_lc_party_on', WOMENS],
    ] as const)(
      'refuses %s 34 days before its weekend, naming the field',
      async (field, weekend) => {
        const response = await create(admin, {
          mens_encounter_on: MENS,
          womens_encounter_on: WOMENS,
          [field]: shift(weekend, -34),
        });

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.field).toBe(field);
        expect(response.body.error.details.latest).toBe(shift(weekend, -35));
        expect(await rows()).toHaveLength(0);
        expect(await auditOf('encounter_season.created')).toHaveLength(0);
      },
    );

    it.each([
      ['mens_lc_party_on', MENS],
      ['womens_lc_party_on', WOMENS],
    ] as const)('refuses %s on or after its own weekend', async (field, weekend) => {
      for (const party of [weekend, shift(weekend, 1)]) {
        const response = await create(admin, {
          mens_encounter_on: MENS,
          womens_encounter_on: WOMENS,
          [field]: party,
        });
        expect(response.status).toBe(422);
        expect(response.body.error.details.field).toBe(field);
      }
    });

    it('accepts a party months before its weekend, there being no early limit', async () => {
      const response = await create(admin, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        mens_lc_party_on: '2027-03-01',
        womens_lc_party_on: '2026-12-31',
      });
      expect(response.status).toBe(201);
      expect(response.body.mens_lc_party_on).toBe('2027-03-01');
      expect(response.body.womens_lc_party_on).toBe('2026-12-31');
    });

    it.each([
      'mens_encounter_on',
      'womens_encounter_on',
      'mens_lc_party_on',
      'womens_lc_party_on',
    ] as const)('refuses %s that is not a calendar day, naming the field', async (field) => {
      const response = await create(admin, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        [field]: '2026-02-30',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(
        response.body.error.details.fields.map((entry: { field: string }) => entry.field),
      ).toEqual([field]);
      expect(await rows()).toHaveLength(0);
    });

    it.each(['mens_encounter_on', 'womens_encounter_on'] as const)(
      'refuses a body without %s',
      async (field) => {
        const body: Body = { mens_encounter_on: MENS, womens_encounter_on: WOMENS };
        delete body[field];
        const response = await create(admin, body);
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(
          response.body.error.details.fields.map((entry: { field: string }) => entry.field),
        ).toContain(field);
      },
    );

    it.each([
      ['mens_encounter_on', { mens_encounter_on: MENS, womens_encounter_on: '2027-12-17' }],
      ['womens_encounter_on', { mens_encounter_on: '2027-11-26', womens_encounter_on: WOMENS }],
    ] as const)(
      'refuses a second season holding the same weekend, naming %s',
      async (field, second) => {
        await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });

        const response = await create(admin, second);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
        expect(response.body.error.details.field).toBe(field);
        expect(await rows()).toHaveLength(1);
        expect(await auditOf('encounter_season.created')).toHaveLength(1);
      },
    );

    it('admits one of two concurrent seasons on the same weekend, and refuses the other', async () => {
      // Concurrent, so that nothing read before either insert can decide it: only the
      // unique index can (CLAUDE.md, Definition of Done).
      const responses = await Promise.all([
        create(admin, { mens_encounter_on: MENS, womens_encounter_on: WOMENS }),
        create(admin, { mens_encounter_on: MENS, womens_encounter_on: '2027-12-17' }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const refused = responses.find((response) => response.status === 409)!;
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(refused.body.error.details.field).toBe('mens_encounter_on');
      expect(await rows()).toHaveLength(1);
      expect(await auditOf('encounter_season.created')).toHaveLength(1);
    });

    it('requires an Idempotency-Key', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/encounter-seasons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await rows()).toHaveLength(0);
    });

    it('replays the stored response for a repeated key, without a second row', async () => {
      const key = randomUUID();
      const body = { mens_encounter_on: MENS, womens_encounter_on: WOMENS };

      const first = await create(admin, body, key);
      const replay = await create(admin, body, key);

      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      expect(await rows()).toHaveLength(1);
      expect(await auditOf('encounter_season.created')).toHaveLength(1);
    });

    it('answers IDEMPOTENCY_KEY_REUSED for the same key with a different body', async () => {
      const key = randomUUID();
      await create(admin, { mens_encounter_on: MENS, womens_encounter_on: WOMENS }, key);

      const different = await create(
        admin,
        { mens_encounter_on: '2028-04-07', womens_encounter_on: '2028-04-14' },
        key,
      );

      expect(different.status).toBe(409);
      expect(different.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await rows()).toHaveLength(1);
    });

    it('audits the record with no previous value and the four dates', async () => {
      const response = await create(admin, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        mens_lc_party_on: '2027-10-01',
      });

      const entries = await auditOf('encounter_season.created');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actor_id: admin.id,
        target_type: 'encounter_season',
        target_id: response.body.id,
        before: null,
        after: {
          mens_lc_party_on: '2027-10-01',
          mens_encounter_on: MENS,
          womens_lc_party_on: shift(WOMENS, -35),
          womens_encounter_on: WOMENS,
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH
  // ---------------------------------------------------------------------------

  describe('PATCH /encounter-seasons/:id', () => {
    it('replaces all four dates and records who changed them and when', async () => {
      const id = await seed({
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        mens_lc_party_on: '2027-09-01',
        womens_lc_party_on: '2027-09-08',
      });

      const response = await update(admin, id, {
        mens_encounter_on: '2027-12-04',
        womens_encounter_on: '2027-12-11',
        mens_lc_party_on: '2027-10-02',
        womens_lc_party_on: '2027-10-09',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id,
        mens_lc_party_on: '2027-10-02',
        mens_encounter_on: '2027-12-04',
        womens_lc_party_on: '2027-10-09',
        womens_encounter_on: '2027-12-11',
      });

      const [row] = await rows();
      expect(row.updated_by).toBe(admin.id);
      expect(row.updated_at).toBeInstanceOf(Date);
      expect(row.created_by).toBe(admin.id);

      const listed = await list(admin);
      expect(listed.body).toEqual({ shows: 'BOTH', data: [response.body] });
    });

    it('sets a party left out of the edit to five weeks before its weekend, not to what it was', async () => {
      const id = await seed({
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        mens_lc_party_on: '2027-09-01',
      });

      const response = await update(admin, id, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
      });

      expect(response.status).toBe(200);
      expect(response.body.mens_lc_party_on).toBe(shift(MENS, -35));
    });

    it('answers NOT_FOUND for a season that does not exist', async () => {
      const response = await update(admin, randomUUID(), {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
      });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(await auditOf('encounter_season.changed')).toHaveLength(0);
    });

    it('refuses an identifier that is not a UUID', async () => {
      const response = await update(admin, 'not-a-uuid', {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
      });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('id');
    });

    it.each([
      ['mens_lc_party_on', MENS],
      ['womens_lc_party_on', WOMENS],
    ] as const)(
      'refuses %s 34 days before its weekend, and changes nothing',
      async (field, weekend) => {
        const id = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });

        const response = await update(admin, id, {
          mens_encounter_on: MENS,
          womens_encounter_on: WOMENS,
          [field]: shift(weekend, -34),
        });

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.field).toBe(field);
        expect(response.body.error.details.latest).toBe(shift(weekend, -35));

        const [row] = await rows();
        expect(row.updated_by).toBeNull();
        expect(await auditOf('encounter_season.changed')).toHaveLength(0);
      },
    );

    it('refuses a weekend moved to within five weeks of the party it keeps', async () => {
      // The party stays where it was and the weekend moves back to within five weeks of it.
      const id = await seed({
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        mens_lc_party_on: shift(MENS, -35),
      });

      const response = await update(admin, id, {
        mens_encounter_on: shift(MENS, -1),
        womens_encounter_on: WOMENS,
        mens_lc_party_on: shift(MENS, -35),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('mens_lc_party_on');
    });

    it('refuses a date that is not a calendar day, naming the field', async () => {
      const id = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });

      const response = await update(admin, id, {
        mens_encounter_on: MENS,
        womens_encounter_on: '2027-02-29',
      });

      expect(response.status).toBe(422);
      expect(
        response.body.error.details.fields.map((entry: { field: string }) => entry.field),
      ).toEqual(['womens_encounter_on']);
    });

    it.each([
      ['mens_encounter_on', { mens_encounter_on: '2028-04-07', womens_encounter_on: '2027-12-24' }],
      [
        'womens_encounter_on',
        { mens_encounter_on: '2027-12-24', womens_encounter_on: '2028-04-14' },
      ],
    ] as const)("refuses moving onto another season's weekend, naming %s", async (field, moved) => {
      await seed({ mens_encounter_on: '2028-04-07', womens_encounter_on: '2028-04-14' });
      const id = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });

      const response = await update(admin, id, moved);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.field).toBe(field);

      const row = await db
        .selectFrom('encounter_seasons')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(String(row.mens_encounter_on)).toBe(MENS);
      expect(String(row.womens_encounter_on)).toBe(WOMENS);
      expect(await auditOf('encounter_season.changed')).toHaveLength(0);
    });

    it('lets a season keep its own weekends', async () => {
      const id = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });
      const response = await update(admin, id, {
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        womens_lc_party_on: '2027-10-15',
      });
      expect(response.status).toBe(200);
    });

    it('requires an Idempotency-Key, and replays a repeated one without a second audit entry', async () => {
      const id = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });
      const body = { mens_encounter_on: shift(MENS, 7), womens_encounter_on: shift(WOMENS, 7) };

      const keyless = await request(app.getHttpServer())
        .patch(`/api/v1/encounter-seasons/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(body);
      expect(keyless.status).toBe(422);
      expect(await auditOf('encounter_season.changed')).toHaveLength(0);

      const key = randomUUID();
      const first = await update(admin, id, body, key);
      const replay = await update(admin, id, body, key);
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(first.body);
      expect(await auditOf('encounter_season.changed')).toHaveLength(1);
    });

    it('audits the edit with the previous and the new dates', async () => {
      const id = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });

      await update(admin, id, {
        mens_encounter_on: '2027-12-04',
        womens_encounter_on: '2027-12-11',
        womens_lc_party_on: '2027-10-01',
      });

      const entries = await auditOf('encounter_season.changed');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actor_id: admin.id,
        target_type: 'encounter_season',
        target_id: id,
        before: {
          mens_lc_party_on: shift(MENS, -35),
          mens_encounter_on: MENS,
          womens_lc_party_on: shift(WOMENS, -35),
          womens_encounter_on: WOMENS,
        },
        after: {
          mens_lc_party_on: shift('2027-12-04', -35),
          mens_encounter_on: '2027-12-04',
          womens_lc_party_on: '2027-10-01',
          womens_encounter_on: '2027-12-11',
        },
      });
    });

    it('offers no way to delete a season', async () => {
      const id = await seed({ mens_encounter_on: MENS, womens_encounter_on: WOMENS });

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/encounter-seasons/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID());

      expect(response.status).toBe(404);
      expect(await rows()).toHaveLength(1);
    });
  });
});
