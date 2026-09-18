import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The three tree routes of section 22: `GET /api/v1/network/my-tree`,
 * `GET /api/v1/leaders/{id}/children` and `GET /api/v1/leaders/{id}/descendants`
 * (SKILL.md section 17, decision 0252; decision 0253 for the refusal order).
 *
 * **Three properties are worth the care here, and each fails quietly.**
 *
 * *One branch, as it stands now, with its headcounts* (decision 0252, clauses 1, 2 and
 * 4). `my-tree` and `children` answer the same envelope -- the focus `person` and one
 * page of their direct reports, **ordered by name** -- and every node carries the
 * headcounts of the tree now: `direct_reports`, and `beneath`, which excludes the
 * person. The cases assert a node's **whole key set**, because a figure that carries a
 * month (DCC or Cell meetings behind) belongs on its own route under its own capability,
 * and one added to a node here would break that by addition, which a spot check cannot
 * see. The monthly figures are pinned in `network-figures.e2e.spec.ts`.
 *
 * *Scope first, existence second* (section 22; decision 0253 clause 2 applies the same
 * order to report selectors). A narrower grant is refused whether or not the identifier
 * names anybody, so each actor's answer is decided by their own scope rather than by the
 * record, and only an actor whose scope *would* have covered the person reaches
 * `NOT_FOUND`. (Not an existence oracle: decision 0253 withdraws that ground, since
 * section 8 discloses a Person's identity church-wide.) It is pinned by comparing the two
 * refusals as whole bodies rather than by checking that each is a 403, because checking
 * each separately stays green if one of them starts naming what it refused.
 *
 * *Direct leaders and descendants are distinct* (section 5). `children` stops at one
 * generation and `descendants` drops depth 0, so neither route can be read as the
 * other.
 *
 * **Nothing here is dated.** These routes take no period, so no case computes one: a
 * fixture pinned to a calendar date is how a green suite turns red on the first of a
 * month, which the recording-queue spec next door had to be written around.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets). The given names
 * are the example tree's -- Raymond, Manuel, Mark -- because that is the tree the
 * authorization cases are written against.
 */
describe('the pastoral tree routes (SKILL.md sections 5, 19 and 22)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Men's: Oriel -> Raymond -> Manuel -> Mark -> Noel, with Ben a second disciple of
  // Raymond who leads nobody, and Oriel -> Rico -> Juan the sibling branch Raymond does
  // not oversee. Ben is what makes `leads_anyone` a claim rather than a constant, and
  // Rico is what makes every refusal here mean something.
  let oriel: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let noel: TestPerson;
  let ben: TestPerson;
  let rico: TestPerson;
  let juan: TestPerson;

  let raymondAccount: TestAccount;
  let benAccount: TestAccount;
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
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    noel = await createPerson(db, { firstName: 'Noel', network: 'MENS' });
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, noel.id, mark.id);
    await assignTo(db, ben.id, raymond.id);
    await assignTo(db, rico.id, oriel.id);
    await assignTo(db, juan.id, rico.id);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    benAccount = await createAccount(app, db, { person: ben, roles: ['LEADER'] });
    adminAccount = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const myTree = (as: TestAccount) =>
    request(app.getHttpServer())
      .get('/api/v1/network/my-tree')
      .set('Authorization', `Bearer ${as.accessToken}`);

  const children = (as: TestAccount, id: string, query: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get(`/api/v1/leaders/${id}/children`)
      .query(query)
      .set('Authorization', `Bearer ${as.accessToken}`);

  const descendants = (as: TestAccount, id: string, query: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get(`/api/v1/leaders/${id}/descendants`)
      .query(query)
      .set('Authorization', `Bearer ${as.accessToken}`);

  const idsOf = (rows: { id: string }[]): string[] => rows.map((row) => row.id).sort();

  const placesOf = (rows: { id: string; depth: number }[]): { id: string; depth: number }[] =>
    rows.map(({ id, depth }) => ({ id, depth }));

  /**
   * The keys a branch node carries on `my-tree` and `children`, and nothing else.
   *
   * Asserted as the whole key set rather than field by field: decision 0252 reads the
   * monthly figures under `dcc.view_subtree` and `cell.view_subtree` on routes of their
   * own, so a figure arriving on a node guarded by `people.view_subtree` would pass every
   * assertion that names only the fields it expects.
   */
  const BRANCH_NODE_KEYS = [
    'beneath',
    'direct_reports',
    'full_name',
    'id',
    'leads_anyone',
    'member_id',
  ];

  /** The flat `descendants` node, which is unchanged and carries no headcount. */
  const TREE_NODE_KEYS = ['full_name', 'id', 'leads_anyone', 'member_id'];

  const namesOf = (rows: { full_name: string }[]): string[] => rows.map((row) => row.full_name);

  describe('GET /api/v1/network/my-tree (decision 0252)', () => {
    it('answers the actor and the disciples immediately beneath them, by name', async () => {
      const response = await myTree(raymondAccount);

      expect(response.status).toBe(200);
      expect(response.body.person.id).toBe(raymond.id);
      expect(response.body.person.full_name).toBe('Raymond Testfixture');
      expect(response.body.person.member_id).toMatch(/^M-\d{6,}$/);

      // Ben and Manuel, and not Mark: one generation per expansion is what makes a tree
      // of three thousand people a screen rather than a download. Name order (decision
      // 0252, clause 4) puts Ben first whatever their identifiers are.
      expect(response.body.data.map((node: { id: string }) => node.id)).toEqual([
        ben.id,
        manuel.id,
      ]);
      expect(response.body.next_cursor).toBeNull();
    });

    it('carries the headcounts of the tree now, and nothing that carries a month', async () => {
      const response = await myTree(raymondAccount);

      const byId = new Map<string, Record<string, unknown>>(
        (response.body.data as Record<string, unknown>[]).map((node) => [node.id as string, node]),
      );

      // Raymond leads Manuel and Ben; beneath him are Manuel, Mark, Noel and Ben. The
      // person is never counted beneath themselves (decision 0252, clause 2).
      expect(response.body.person).toMatchObject({
        leads_anyone: true,
        direct_reports: 2,
        beneath: 4,
      });
      // Manuel leads Mark, who leads Noel: one direct, two beneath. The pair of rows is
      // the assertion -- either alone would stay green against a constant.
      expect(byId.get(manuel.id)).toMatchObject({
        leads_anyone: true,
        direct_reports: 1,
        beneath: 2,
      });
      expect(byId.get(ben.id)).toMatchObject({
        leads_anyone: false,
        direct_reports: 0,
        beneath: 0,
      });

      for (const node of [response.body.person, ...(response.body.data as object[])]) {
        expect(Object.keys(node).sort()).toEqual(BRANCH_NODE_KEYS);
      }
    });

    it('counts a whole branch at a root, the sibling branch included', async () => {
      const orielAccount = await createAccount(app, db, { person: oriel, roles: ['LEADER'] });

      const response = await myTree(orielAccount);

      expect(response.status).toBe(200);
      // Raymond, Manuel, Mark, Noel, Ben, Rico and Juan.
      expect(response.body.person).toMatchObject({ direct_reports: 2, beneath: 7 });
      expect(response.body.data.map((node: { id: string }) => node.id)).toEqual([
        raymond.id,
        rico.id,
      ]);
      expect((response.body.data as { beneath: number }[]).map((node) => node.beneath)).toEqual([
        4, 1,
      ]);
    });

    it('answers a leader of nobody with themselves and an empty tree', async () => {
      // The route names nobody, so its target is the actor and `OWN_SUBTREE` covers it
      // by including the actor. A leaf actor is the case that proves the children are
      // read rather than assumed.
      const response = await myTree(benAccount);

      expect(response.status).toBe(200);
      expect(response.body.person).toMatchObject({
        id: ben.id,
        leads_anyone: false,
        direct_reports: 0,
        beneath: 0,
      });
      expect(response.body.data).toEqual([]);
      // The same envelope `children` answers in, because it is the same collection.
      expect(response.body.next_cursor).toBeNull();
    });
  });

  describe('GET /api/v1/leaders/{id}/children (SKILL.md section 5, decision 0252)', () => {
    it('returns the focus person and their direct disciples, never a grandchild', async () => {
      const response = await children(adminAccount, raymond.id);

      expect(response.status).toBe(200);
      // The same envelope `my-tree` answers: the focus node, then the page.
      expect(Object.keys(response.body).sort()).toEqual(['data', 'next_cursor', 'person']);
      expect(response.body.person).toMatchObject({
        id: raymond.id,
        direct_reports: 2,
        beneath: 4,
      });
      expect(Object.keys(response.body.person).sort()).toEqual(BRANCH_NODE_KEYS);

      expect(idsOf(response.body.data)).toEqual([manuel.id, ben.id].sort());
      expect(idsOf(response.body.data)).not.toContain(mark.id);
      // Section 5: direct leaders and descendants are different things, so the person
      // asked about is not among their own disciples.
      expect(idsOf(response.body.data)).not.toContain(raymond.id);
      expect(response.body.next_cursor).toBeNull();
    });

    describe('ordered by name, and paged by it', () => {
      /**
       * Six disciples of Noel, created in an order that is neither their name order nor,
       * except by chance, their identifier order.
       *
       * **Last name decides before first name**: Zeno Abad sorts before Aaron Zamora.
       * **Two share a whole name**, so the Member ID is what separates them, and it is
       * the tie-break a key of names alone would lose at a page boundary -- the case the
       * roster cursor carries all three keys for.
       */
      let expected: string[];

      beforeEach(async () => {
        const make = async (firstName: string, lastName: string): Promise<TestPerson> => {
          const person = await createPerson(db, { firstName, lastName, network: 'MENS' });
          await assignTo(db, person.id, noel.id);

          return person;
        };

        const zamora = await make('Aaron', 'Zamora');
        const twinFirst = await make('Luis', 'Mendoza');
        const abad = await make('Zeno', 'Abad');
        const twinSecond = await make('Luis', 'Mendoza');
        const cruzB = await make('Bea', 'Cruz');
        const cruzA = await make('Abel', 'Cruz');

        // The twins were created in this order, so the Member ID sequence orders them so.
        expected = [abad.id, cruzA.id, cruzB.id, twinFirst.id, twinSecond.id, zamora.id];
      });

      it('orders by last name, then first name, then Member ID', async () => {
        const response = await children(adminAccount, noel.id);

        expect(response.status).toBe(200);
        expect(response.body.data.map((node: { id: string }) => node.id)).toEqual(expected);
        expect(namesOf(response.body.data)[0]).toBe('Zeno Abad');
        expect(response.body.person).toMatchObject({ direct_reports: 6, beneath: 6 });
      });

      it.each([1, 2, 4, 5])(
        'pages at a limit of %i, losing nothing and repeating nothing at a boundary',
        async (limit) => {
          const walked: string[] = [];
          let cursor: string | null = null;

          for (let guard = 0; guard < 10; guard += 1) {
            const response: request.Response = await children(adminAccount, noel.id, {
              limit,
              ...(cursor === null ? {} : { cursor }),
            });

            expect(response.status).toBe(200);
            // Every page carries the focus person, not only the first.
            expect(response.body.person.id).toBe(noel.id);
            expect((response.body.data as unknown[]).length).toBeLessThanOrEqual(limit);
            walked.push(...(response.body.data as { id: string }[]).map((node) => node.id));

            cursor = response.body.next_cursor as string | null;
            if (cursor === null) {
              break;
            }
          }

          expect(cursor).toBeNull();
          // In name order across pages, so the boundary between the two Mendozas -- a
          // limit of 4 falls exactly on it -- is carried by the Member ID.
          expect(walked).toEqual(expected);
        },
      );

      it('answers the last page with no cursor rather than an empty page after it', async () => {
        const first = await children(adminAccount, noel.id, { limit: 3 });
        const second = await children(adminAccount, noel.id, {
          limit: 3,
          cursor: first.body.next_cursor as string,
        });

        expect(first.body.next_cursor).toEqual(expect.any(String));
        expect(second.body.data).toHaveLength(3);
        expect(second.body.next_cursor).toBeNull();
      });

      it('pages my-tree by the same key', async () => {
        const noelAccount = await createAccount(app, db, { person: noel, roles: ['LEADER'] });

        const first = await request(app.getHttpServer())
          .get('/api/v1/network/my-tree')
          .query({ limit: 4 })
          .set('Authorization', `Bearer ${noelAccount.accessToken}`);
        const second = await request(app.getHttpServer())
          .get('/api/v1/network/my-tree')
          .query({ limit: 4, cursor: first.body.next_cursor as string })
          .set('Authorization', `Bearer ${noelAccount.accessToken}`);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(
          [...first.body.data, ...second.body.data].map((node: { id: string }) => node.id),
        ).toEqual(expected);
        expect(second.body.next_cursor).toBeNull();
      });
    });

    it('refuses a cursor from the descendants route rather than reading it', async () => {
      // It decodes cleanly and its position means something else.
      const response = await children(adminAccount, raymond.id, {
        limit: 1,
        cursor: Buffer.from(JSON.stringify({ depth: 1, personId: manuel.id }), 'utf8').toString(
          'base64url',
        ),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('cursor');
    });

    it('refuses a cursor it cannot read rather than silently restarting', async () => {
      const response = await children(adminAccount, raymond.id, {
        limit: 1,
        cursor: 'not-a-cursor-this-route-ever-issued',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('cursor');
    });

    it('refuses an empty cursor rather than silently restarting', async () => {
      // Section 22 names this asymmetry: a value one byte too long was refused while one
      // of the right length carrying nothing readable was a silent restart. `@Length(1)`
      // is what closes it.
      const response = await children(adminAccount, raymond.id, { cursor: '' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      // The code and the status only. This refusal comes from the DTO rather than from
      // `unresolvableCursor()`, and the two carry different `details`.
    });
  });

  describe('GET /api/v1/leaders/{id}/descendants (SKILL.md section 5)', () => {
    /** Raymond's subtree, in the order the route promises: by depth, then by id. */
    const expected = (): { id: string; depth: number }[] => {
      const firstGeneration = [manuel.id, ben.id].sort().map((id) => ({ id, depth: 1 }));

      return [...firstGeneration, { id: mark.id, depth: 2 }, { id: noel.id, depth: 3 }];
    };

    it('returns the whole subtree excluding the person, in depth order', async () => {
      const response = await descendants(adminAccount, raymond.id);

      expect(response.status).toBe(200);
      expect(placesOf(response.body.data)).toEqual(expected());

      // Depth 0 is dropped: a person is not their own descendant (section 5).
      expect(idsOf(response.body.data)).not.toContain(raymond.id);
      // And the subtree stops where the branch does -- Rico's side is nobody's
      // descendant here.
      expect(idsOf(response.body.data)).not.toContain(juan.id);
      expect(response.body.next_cursor).toBeNull();
    });

    it('carries the same node as its siblings, plus a depth and nothing else', async () => {
      const response = await descendants(adminAccount, raymond.id);

      for (const node of response.body.data as object[]) {
        expect(Object.keys(node).sort()).toEqual([...TREE_NODE_KEYS, 'depth'].sort());
      }
    });

    it('pages, returning a cursor while rows remain', async () => {
      const first = await descendants(adminAccount, raymond.id, { limit: 2 });

      expect(first.status).toBe(200);
      expect((first.body.data as unknown[]).length).toBe(2);
      expect(first.body.next_cursor).toEqual(expect.any(String));

      const second = await descendants(adminAccount, raymond.id, {
        limit: 2,
        cursor: first.body.next_cursor as string,
      });

      expect(second.status).toBe(200);
      expect((second.body.data as unknown[]).length).toBe(2);
      // Four descendants in two pages of two, so the collection is exhausted and the
      // cursor says so rather than handing back an empty page to discover it on.
      expect(second.body.next_cursor).toBeNull();

      expect([...placesOf(first.body.data), ...placesOf(second.body.data)]).toEqual(expected());
    });

    it('loses nothing and repeats nothing at a page boundary', async () => {
      // A page of one, so every boundary in the collection is crossed -- including the
      // two that fall between depths, which a key of `(depth, person_id)` has to carry
      // and a key of `person_id` alone would not.
      const walked: { id: string; depth: number }[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 10; page += 1) {
        const query: Record<string, string | number> = { limit: 1 };
        if (cursor !== null) {
          query.cursor = cursor;
        }

        const response = await descendants(adminAccount, raymond.id, query);
        expect(response.status).toBe(200);

        walked.push(...placesOf(response.body.data));

        cursor = response.body.next_cursor as string | null;
        if (cursor === null) {
          break;
        }
      }

      expect(cursor).toBeNull();
      expect(walked).toEqual(expected());
      expect(new Set(walked.map((row) => row.id)).size).toBe(walked.length);
    });

    it('refuses a cursor it cannot read rather than silently restarting', async () => {
      // Decision 0159. A page that quietly began again would look like a collection
      // that changed under the client.
      const response = await descendants(adminAccount, raymond.id, {
        limit: 2,
        cursor: 'not-a-cursor-this-route-ever-issued',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('cursor');
    });

    it('refuses a cursor issued by the children route rather than reading it', async () => {
      // The reverse of the children case: a real name-keyed cursor, taken from a real
      // page, decodes cleanly here and carries no depth. Both directions are pinned,
      // because one direction resolving silently is the asymmetry that reads as a defect.
      const namePage = await children(adminAccount, raymond.id, { limit: 1 });
      expect(namePage.body.next_cursor).toEqual(expect.any(String));

      const response = await descendants(adminAccount, raymond.id, {
        limit: 2,
        cursor: namePage.body.next_cursor as string,
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('cursor');
    });

    it('refuses an empty cursor rather than silently restarting', async () => {
      const response = await descendants(adminAccount, raymond.id, { cursor: '' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    /**
     * A cursor that decodes cleanly and carries the wrong *kind* of value.
     *
     * Section 22 puts "unparseable, forged, or **structurally wrong**" on one answer,
     * and this is the third. Both keys are bound as casts — `::int` and `::uuid` — so
     * before the decoder validated them each of these reached PostgreSQL as `22P02`,
     * which nothing classifies and which renders `INTERNAL_ERROR`. `1e999` is the one
     * worth keeping: `JSON.parse` yields `Infinity`, whose `typeof` is `number`, so a
     * shape check alone admits it.
     */
    const UUID = '3f1b7c6e-0000-4000-8000-000000000001';

    it.each([
      ['a fractional depth', `{"depth":1.5,"personId":"${UUID}"}`],
      // Written as JSON rather than as a literal: `1e999` in source is a lint error for
      // losing precision, and a forged cursor is a string anyway. `JSON.parse` yields
      // `Infinity`, whose `typeof` is `number`, so a shape check alone admits it.
      ['an infinite depth', `{"depth":1e999,"personId":"${UUID}"}`],
      // The two values the first two fix attempts let through, pinned here because the
      // bound that refuses them was got wrong twice. `Number.isInteger` holds for both,
      // so a shape check admits them and only the `INT4_MAX` comparison refuses them:
      // 2147483648 reached PostgreSQL as `22003` and 1e30 as `22P02`, and neither code
      // is classified, so both rendered `INTERNAL_ERROR`.
      ['a depth one past int4', `{"depth":2147483648,"personId":"${UUID}"}`],
      ['a depth far past int4', `{"depth":1e30,"personId":"${UUID}"}`],
      ['a negative depth', `{"depth":-1,"personId":"${UUID}"}`],
      ['an identifier that is not one', '{"depth":1,"personId":"nope"}'],
      ['a null byte in the identifier', '{"depth":1,"personId":"a\\u0000b"}'],
      ['no keys at all', '{}'],
      ['an array rather than an object', '[1,2]'],
    ])('refuses %s rather than answering 500', async (_name, payload) => {
      const response = await descendants(adminAccount, raymond.id, {
        limit: 2,
        cursor: Buffer.from(payload, 'utf8').toString('base64url'),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('cursor');
    });
  });

  describe('scope is resolved first and existence second (decision 0253)', () => {
    it('answers a narrow grant identically for nobody and for somebody out of scope', async () => {
      // Raymond holds `people.view_subtree` over his own subtree only. Rico is a real
      // Person outside it; the random identifier names nobody at all. Section 22's rule,
      // which decision 0253 clause 2 applies to report selectors: scope decides the
      // answer and the record never does, so these two requests cannot be told apart.
      // *Not* because the pair would be an oracle for who exists -- decision 0253
      // withdraws that ground, section 8 disclosing a Person's identity church-wide
      // anyway -- but because an actor's answer must depend on their own scope alone.
      const absent = await children(raymondAccount, randomUUID());
      const outOfScope = await children(raymondAccount, rico.id);

      expect(absent.status).toBe(403);
      expect(absent.body.error.code).toBe('SCOPE_DENIED');
      expect(outOfScope.status).toBe(403);
      // Compared as whole bodies rather than as two codes: a refusal that began naming
      // what it refused would pass a code-only check.
      expect(outOfScope.body).toEqual(absent.body);
    });

    it('answers the same way on the descendants route', async () => {
      // One rule, two routes, so both are pinned rather than one.
      const absent = await descendants(raymondAccount, randomUUID());
      const outOfScope = await descendants(raymondAccount, juan.id);

      expect(absent.status).toBe(403);
      expect(absent.body.error.code).toBe('SCOPE_DENIED');
      expect(outOfScope.status).toBe(403);
      expect(outOfScope.body).toEqual(absent.body);
    });

    it('reaches NOT_FOUND only for an actor whose scope would have covered the person', async () => {
      // An administrator holds Whole Church, so nothing is out of scope and absence is
      // genuinely absence. Without the existence check this would answer 200 with an
      // empty tree for a person who does not exist.
      const missingId = randomUUID();

      const forChildren = await children(adminAccount, missingId);
      expect(forChildren.status).toBe(404);
      expect(forChildren.body.error.code).toBe('NOT_FOUND');

      const forDescendants = await descendants(adminAccount, missingId);
      expect(forDescendants.status).toBe(404);
      expect(forDescendants.body.error.code).toBe('NOT_FOUND');
    });

    it('gives the two actors different answers to the identical request', async () => {
      // The ordering stated as one claim: the same identifier, naming nobody, answers
      // 403 to a narrow grant and 404 to a wide one. Checking either alone leaves the
      // rule half pinned.
      const missingId = randomUUID();

      const narrow = await children(raymondAccount, missingId);
      const wide = await children(adminAccount, missingId);

      expect([narrow.status, wide.status]).toEqual([403, 404]);
    });
  });

  describe('what a leader may read (SKILL.md section 7)', () => {
    it('reads a leader inside their own subtree', async () => {
      const response = await children(raymondAccount, manuel.id);

      expect(response.status).toBe(200);
      expect(idsOf(response.body.data)).toEqual([mark.id]);
    });

    it('reads themselves, because OWN_SUBTREE includes the actor', async () => {
      const response = await children(raymondAccount, raymond.id);

      expect(response.status).toBe(200);
      expect(idsOf(response.body.data)).toEqual([manuel.id, ben.id].sort());
    });

    it('reads the subtree of somebody they oversee', async () => {
      const response = await descendants(raymondAccount, manuel.id);

      expect(response.status).toBe(200);
      expect(placesOf(response.body.data)).toEqual([
        { id: mark.id, depth: 1 },
        { id: noel.id, depth: 2 },
      ]);
    });

    it('is refused their own upline, who is not beneath them', async () => {
      // Oriel oversees Raymond and not the other way round. A subtree is downward.
      const response = await children(raymondAccount, oriel.id);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('is refused a sibling branch', async () => {
      const response = await descendants(raymondAccount, rico.id);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });
  });
});
