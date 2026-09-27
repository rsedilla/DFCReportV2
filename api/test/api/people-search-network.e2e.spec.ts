import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/people?network=` — the two pickers that search one Network (decision 0299).
 *
 * The parameter narrows the rows and widens nothing: the capability, the searcher's scope,
 * section 8's per-person field scoping and the pagination are all as they were. What is
 * worth pinning is that it narrows in the query rather than on the page, and that it reads
 * the Network a person holds now rather than their sex.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('people search narrowed to one Network (decision 0299)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Men's: Oriel -> Raymond -> Manuel, and a sibling branch Oriel -> Rico -> Juan that
  // Raymond does not oversee. Women's: Geraldine -> Grace.
  let oriel: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let rico: TestPerson;
  let juan: TestPerson;
  let geraldine: TestPerson;
  let grace: TestPerson;

  let raymondAccount: TestAccount;
  let adminAccount: TestAccount;

  const MEN = () => [oriel.id, raymond.id, manuel.id, rico.id, juan.id];
  const WOMEN = () => [geraldine.id, grace.id];

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
    grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });

    await assignTo(db, oriel.id, null);
    await assignTo(db, geraldine.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, rico.id, oriel.id);
    await assignTo(db, juan.id, rico.id);
    await assignTo(db, grace.id, geraldine.id);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    // An administrator outside the tree, under a surname the searches below do not match.
    adminAccount = await createAccount(app, db, {
      person: await createPerson(db, {
        firstName: 'Ester',
        lastName: 'Adminfixture',
        network: 'WOMENS',
      }),
      roles: ['ADMIN'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('church-wide, as the pickers ask', () => {
    it('returns men only for MENS and women only for WOMENS, for a term matching both', async () => {
      const everyone = await search(raymondAccount, 'Testfixture', { churchWide: true });
      expect(everyone.status).toBe(200);
      // The term does match both Networks, or the two cases below prove nothing.
      expect(idsOf(everyone).sort()).toEqual([...MEN(), ...WOMEN()].sort());

      const men = await search(raymondAccount, 'Testfixture', {
        churchWide: true,
        network: 'MENS',
      });
      expect(men.status).toBe(200);
      expect(idsOf(men).sort()).toEqual(MEN().sort());

      const women = await search(raymondAccount, 'Testfixture', {
        churchWide: true,
        network: 'WOMENS',
      });
      expect(women.status).toBe(200);
      expect(idsOf(women).sort()).toEqual(WOMEN().sort());
    });

    it('narrows the rows and never widens the fields', async () => {
      // Section 8: somebody outside the searcher's scope carries the minimal identity
      // whatever else the request asks. Juan is outside Raymond's scope; Manuel is inside.
      const response = await search(raymondAccount, 'Testfixture', {
        churchWide: true,
        network: 'MENS',
      });
      const rows = response.body.data as Record<string, unknown>[];

      const outside = rows.find((row) => row.id === juan.id);
      expect(outside).toBeDefined();
      expect(Object.keys(outside as object).sort()).toEqual([
        'direct_leader_name',
        'full_name',
        'id',
        'member_id',
        'network',
        'scope',
        'sex',
      ]);
      expect(outside).toMatchObject({ scope: 'IDENTITY_ONLY', network: 'MENS' });

      const inside = rows.find((row) => row.id === manuel.id);
      expect(inside).toMatchObject({ scope: 'FULL' });
    });

    it('fills every page from the Network, and never pages the church then filters it', async () => {
      // Five men and five women under one surname, interleaved by first name, so the
      // church-wide order alternates W, M, W, M... A filter applied to the page rather than
      // the query would answer the first page of two with one man, or none.
      const menNames = ['Abe', 'Adam', 'Al', 'Amos', 'Andy'];
      const womenNames = ['Abby', 'Ada', 'Agnes', 'Alma', 'Anna'];
      const men: string[] = [];
      for (const firstName of menNames) {
        men.push(
          (await createPerson(db, { firstName, lastName: 'Pagefixture', network: 'MENS' })).id,
        );
      }
      for (const firstName of womenNames) {
        await createPerson(db, { firstName, lastName: 'Pagefixture', network: 'WOMENS' });
      }

      // Confirm the interleaving the case depends on: church-wide, two per page, the first
      // page holds a woman. An administrator sees full rows, which carry sex and no network.
      const unfiltered = await search(adminAccount, 'Pagefixture', { churchWide: true, limit: 2 });
      const firstUnfiltered = unfiltered.body.data as { id: string; sex: string }[];
      expect(firstUnfiltered.map((row) => row.sex)).toContain('FEMALE');

      const pages: string[][] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 6; page += 1) {
        const response: request.Response = await search(adminAccount, 'Pagefixture', {
          churchWide: true,
          network: 'MENS',
          limit: 2,
          cursor: cursor ?? undefined,
        });
        expect(response.status).toBe(200);
        pages.push(idsOf(response));
        cursor = response.body.next_cursor as string | null;
        if (cursor === null) {
          break;
        }
      }

      expect(cursor).toBeNull();
      // Five men at two a page: full, full, then the one left. A short page anywhere but
      // the last is the defect this case exists for.
      expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
      const seen = pages.flat();
      expect(new Set(seen).size).toBe(5);
      expect(seen.sort()).toEqual([...men].sort());
    });
  });

  describe("within the searcher's own scope", () => {
    it('intersects the Network with the scope, and does not replace it', async () => {
      // MENS alone would add Oriel, Rico and Juan; scope alone is Raymond and Manuel.
      const men = await search(raymondAccount, 'Testfixture', { network: 'MENS' });
      expect(men.status).toBe(200);
      expect(idsOf(men).sort()).toEqual([raymond.id, manuel.id].sort());

      // Raymond's scope holds no woman, so WOMENS inside it is empty rather than the
      // Women's Network.
      const women = await search(raymondAccount, 'Testfixture', { network: 'WOMENS' });
      expect(women.status).toBe(200);
      expect(idsOf(women)).toEqual([]);
    });

    it('narrows a Whole Church scope to the Network', async () => {
      // An administrator's scope is the whole church, which is no restriction; the
      // Network then stands alone.
      const response = await search(adminAccount, 'Testfixture', { network: 'WOMENS' });
      expect(response.status).toBe(200);
      expect(idsOf(response).sort()).toEqual(WOMEN().sort());
    });

    it('narrows the scope listing with no term too', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/people')
        .query({ network: 'MENS' })
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

      expect(response.status).toBe(200);
      expect(idsOf(response).sort()).toEqual([raymond.id, manuel.id].sort());
    });
  });

  describe('the values it accepts', () => {
    it.each(['banana', 'mens', 'womens', 'Mens', 'BOTH', ''])(
      'refuses network=%p as VALIDATION_FAILED naming network',
      async (value) => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/people')
          .query({ q: 'Testfixture', church_wide: true, network: value })
          .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(response.body.error)).toContain('network');
      },
    );

    it('changes nothing when network is absent', async () => {
      const wide = await search(raymondAccount, 'Testfixture', { churchWide: true });
      expect(idsOf(wide).sort()).toEqual([...MEN(), ...WOMEN()].sort());

      const own = await search(raymondAccount, 'Testfixture');
      expect(idsOf(own).sort()).toEqual([raymond.id, manuel.id].sort());
    });
  });

  describe('the Network a person holds now', () => {
    it('counts a person under the Network their open row names, after a correction', async () => {
      // Kit is encoded as a man and corrected to a woman (section 4): the MENS row is
      // closed and a WOMENS row opened. The search must follow the open row.
      const kit = await createPerson(db, { firstName: 'Kit', network: 'MENS' });
      await assignTo(db, kit.id, raymond.id);

      const corrected = await request(app.getHttpServer())
        .put(`/api/v1/people/${kit.id}/sex`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: geraldine.id,
        });
      expect(corrected.status).toBe(200);

      const rows = await db
        .selectFrom('network_assignments')
        .select(['network', 'ended_at'])
        .where('person_id', '=', kit.id)
        .orderBy('started_at')
        .execute();
      expect(rows.map((row) => [row.network, row.ended_at === null])).toEqual([
        ['MENS', false],
        ['WOMENS', true],
      ]);

      const women = await search(adminAccount, 'Kit', { churchWide: true, network: 'WOMENS' });
      expect(idsOf(women)).toEqual([kit.id]);

      const men = await search(adminAccount, 'Kit', { churchWide: true, network: 'MENS' });
      expect(idsOf(men)).toEqual([]);
    });
  });

  function idsOf(response: { body: { data: { id: string }[] } }): string[] {
    return response.body.data.map((row) => row.id);
  }

  function search(
    actor: TestAccount,
    q: string,
    options: {
      churchWide?: boolean;
      network?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    const query: Record<string, string | number | boolean> = { q };
    if (options.churchWide) {
      query.church_wide = true;
    }
    if (options.network !== undefined) {
      query.network = options.network;
    }
    if (options.limit !== undefined) {
      query.limit = options.limit;
    }
    if (options.cursor !== undefined) {
      query.cursor = options.cursor;
    }

    return request(app.getHttpServer())
      .get('/api/v1/people')
      .query(query)
      .set('Authorization', `Bearer ${actor.accessToken}`);
  }
});
