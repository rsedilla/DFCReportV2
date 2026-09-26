import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The SUYNL readiness table at the API (SKILL.md section 28; decisions 0278 and 0297).
 *
 * Fixture names are invented (CLAUDE.md, Secrets). The tree is the example one, widened:
 *
 *   Raymond Alcantara (Men's root)
 *     -> Manuel Bautista
 *          -> Nathan Abad
 *          -> Mark Castillo -> { Timothy Zamora, Silas Ybarra (archived), Quentin Xavier (merged) }
 *          -> Paulo Castillo
 *   Grace Domingo (Women's root) -> { Hannah Evangelista, Ruth Fajardo }
 *   Adele Ocampo: an administrator outside the pastoral tree, given one disciple, Ines Pineda
 *
 * Current SUYNL lessons and Encounter / Life Class graduations, and what each makes of
 * the person:
 *
 *   Raymond   1 lesson, a current LIFE_CLASS graduation     -> left out (past the LC Party)
 *   Manuel    lessons 1-6 current, lesson 7 superseded      -> 1-6 (6, not 7)
 *   Nathan    3 lessons, a current ENCOUNTER graduation     -> left out
 *   Mark      8 lessons                                     -> 7-9
 *   Timothy   10 lessons, current SOL_1 and SOL_2           -> completed (SOL alone excludes nobody)
 *   Silas     5 lessons, archived                           -> left out (not current)
 *   Quentin   3 lessons, merged into Timothy                -> left out (not current)
 *   Paulo     2 lessons, a superseded ENCOUNTER graduation  -> 1-6 (a withdrawn graduation excludes nobody)
 *   Grace     none                                          -> not counted
 *   Hannah    9 lessons                                     -> 7-9
 *   Ruth      one superseded lesson and nothing current     -> not counted
 *   Ines      4 lessons                                     -> 1-6, in neither root's branch
 */
describe('SUYNL readiness (decision 0297)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let nathan: TestPerson;
  let mark: TestPerson;
  let timothy: TestPerson;
  let silas: TestPerson;
  let quentin: TestPerson;
  let paulo: TestPerson;
  let grace: TestPerson;
  let hannah: TestPerson;
  let ruth: TestPerson;
  let adele: TestPerson;
  let ines: TestPerson;

  let admin: TestAccount;
  let raymondAccount: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;
  let grantless: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alcantara',
      network: 'MENS',
    });
    await assignTo(db, raymond.id, null);
    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Bautista', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    nathan = await createPerson(db, { firstName: 'Nathan', lastName: 'Abad', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);
    paulo = await createPerson(db, { firstName: 'Paulo', lastName: 'Castillo', network: 'MENS' });
    await assignTo(db, paulo.id, manuel.id);
    timothy = await createPerson(db, { firstName: 'Timothy', lastName: 'Zamora', network: 'MENS' });
    await assignTo(db, timothy.id, mark.id);
    silas = await createPerson(db, {
      firstName: 'Silas',
      lastName: 'Ybarra',
      network: 'MENS',
      archived: true,
    });
    await assignTo(db, silas.id, mark.id);
    quentin = await createPerson(db, { firstName: 'Quentin', lastName: 'Xavier', network: 'MENS' });
    await assignTo(db, quentin.id, mark.id);

    grace = await createPerson(db, { firstName: 'Grace', lastName: 'Domingo', network: 'WOMENS' });
    await assignTo(db, grace.id, null);
    hannah = await createPerson(db, {
      firstName: 'Hannah',
      lastName: 'Evangelista',
      network: 'WOMENS',
    });
    await assignTo(db, hannah.id, grace.id);
    ruth = await createPerson(db, { firstName: 'Ruth', lastName: 'Fajardo', network: 'WOMENS' });
    await assignTo(db, ruth.id, grace.id);

    // An administrator outside the pastoral tree who was given a disciple, which is the
    // one reachable way to be in a Network and in no walk from its root
    // (`test/database/reporting-leader-scope.spec.ts`).
    adele = await createPerson(db, { firstName: 'Adele', lastName: 'Ocampo', network: 'WOMENS' });
    ines = await createPerson(db, { firstName: 'Ines', lastName: 'Pineda', network: 'WOMENS' });
    await assignTo(db, ines.id, adele.id);

    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });
    raymondAccount = await createAccount(app, db, {
      person: raymond,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    nameSeniorPastors(app, [raymond.id]);
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    const nobody = await createPerson(db, {
      firstName: 'Nobody',
      lastName: 'Grantless',
      network: 'MENS',
    });
    await assignTo(db, nobody.id, raymond.id);
    grantless = await createAccount(app, db, { person: nobody, roles: [] });

    await db
      .updateTable('persons')
      .set({ merged_into_id: timothy.id })
      .where('id', '=', quentin.id)
      .execute();

    await lessons(raymond.id, [1]);
    await graduation(raymond.id, 'LIFE_CLASS');
    await lessons(manuel.id, [1, 2, 3, 4, 5, 6]);
    await supersededLesson(manuel.id, 7);
    await lessons(nathan.id, [1, 2, 3]);
    await graduation(nathan.id, 'ENCOUNTER');
    await lessons(mark.id, [1, 2, 3, 4, 5, 6, 7, 8]);
    await lessons(timothy.id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await graduation(timothy.id, 'SOL_1');
    await graduation(timothy.id, 'SOL_2');
    await lessons(silas.id, [1, 2, 3, 4, 5]);
    await lessons(quentin.id, [1, 2, 3]);
    await lessons(paulo.id, [1, 2]);
    await graduation(paulo.id, 'ENCOUNTER', { superseded: true });
    await lessons(hannah.id, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await supersededLesson(ruth.id, 1);
    await lessons(ines.id, [1, 2, 3, 4]);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Current lesson rows, written directly, as `suynl.e2e.spec.ts` seeds them. */
  const lessons = async (personId: string, numbers: number[]) => {
    for (const lesson of numbers) {
      await db
        .insertInto('suynl_lessons')
        .values({ person_id: personId, lesson, confirmed_by: null, recorded_by: admin.id })
        .execute();
    }
  };

  /** A lesson that was ticked and then withdrawn, with nothing current in its place. */
  const supersededLesson = async (personId: string, lesson: number) => {
    await db
      .insertInto('suynl_lessons')
      .values({
        person_id: personId,
        lesson,
        confirmed_by: null,
        recorded_by: admin.id,
        superseded_at: new Date(),
        corrected_by: admin.id,
        correction_reason: 'Ticked against the wrong person.',
      })
      .execute();
  };

  const graduation = async (
    personId: string,
    program: 'ENCOUNTER' | 'LIFE_CLASS' | 'SOL_1' | 'SOL_2' | 'SOL_3',
    options: { superseded?: boolean } = {},
  ) => {
    await db
      .insertInto('training_graduations')
      .values({
        person_id: personId,
        program,
        confirmed_by: null,
        recorded_by: admin.id,
        ...(options.superseded === true
          ? {
              superseded_at: new Date(),
              corrected_by: admin.id,
              correction_reason: 'Recorded in error.',
            }
          : {}),
      })
      .execute();
  };

  interface Figures {
    completed: number;
    seven_to_nine: number;
    one_to_six: number;
    people: number;
  }

  interface Member {
    person_id: string;
    full_name: string;
    lessons: number;
  }

  interface Row extends Figures {
    leader: { id: string; member_id: string; full_name: string } | null;
    network: 'MENS' | 'WOMENS' | null;
    leads_anyone: boolean;
    members: Member[];
  }

  interface Readiness {
    subject: { id: string; full_name: string } | null;
    rows: Row[];
    own: (Figures & { members: Member[] }) | null;
    elsewhere: (Figures & { members: Member[] }) | null;
    total: Figures;
  }

  const BUCKETS = ['completed', 'seven_to_nine', 'one_to_six', 'people'] as const;

  /**
   * The reconciliation every answer owes (CLAUDE.md, Definition of Done; SKILL.md section
   * 20's shape): each part's buckets sum to its `people`, and the rows, the subject's own
   * row and the elsewhere line are disjoint and sum to the total, bucket by bucket. A
   * failure here is a data-integrity defect, not a rounding issue.
   */
  const assertReconciles = (body: Readiness) => {
    const parts: (Figures & { members: Member[] })[] = [
      ...body.rows,
      ...(body.own === null ? [] : [body.own]),
      ...(body.elsewhere === null ? [] : [body.elsewhere]),
    ];

    for (const part of [...parts, body.total]) {
      expect(part.people).toBe(part.completed + part.seven_to_nine + part.one_to_six);
    }

    for (const part of parts) {
      // The listed people are the counted people, once each.
      expect(part.members).toHaveLength(part.people);
      expect(part.members.filter((member) => member.lessons >= 10)).toHaveLength(part.completed);
      expect(
        part.members.filter((member) => member.lessons >= 7 && member.lessons <= 9),
      ).toHaveLength(part.seven_to_nine);
      expect(
        part.members.filter((member) => member.lessons >= 1 && member.lessons <= 6),
      ).toHaveLength(part.one_to_six);
    }

    for (const bucket of BUCKETS) {
      const sum = parts.reduce((acc, part) => acc + part[bucket], 0);
      expect({ bucket, sum }).toEqual({ bucket, sum: body.total[bucket] });
    }

    // Disjoint: nobody is counted in two parts.
    const everyone = parts.flatMap((part) => part.members.map((member) => member.person_id));
    expect(new Set(everyone).size).toBe(everyone.length);
  };

  /** Every GET goes through here, so every 200 in the suite is reconciled. */
  const readiness = async (account: TestAccount, id?: string) => {
    const response = await request(app.getHttpServer())
      .get(id === undefined ? '/api/v1/suynl/readiness' : `/api/v1/suynl/readiness/${id}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

    if (response.status === 200) {
      assertReconciles(response.body as Readiness);
    }

    return response;
  };

  const figuresOf = (part: Figures): Figures => ({
    completed: part.completed,
    seven_to_nine: part.seven_to_nine,
    one_to_six: part.one_to_six,
    people: part.people,
  });

  const rowOf = (body: Readiness, person: TestPerson): Row => {
    const row = body.rows.find((candidate) => candidate.leader?.id === person.id);
    if (row === undefined) {
      throw new Error(`No row for ${person.firstName}`);
    }
    return row;
  };

  const memberIdOf = async (person: TestPerson) =>
    (
      await db
        .selectFrom('persons')
        .select('member_id')
        .where('id', '=', person.id)
        .executeTakeFirstOrThrow()
    ).member_id;

  const fig = (completed: number, sevenToNine: number, oneToSix: number): Figures => ({
    completed,
    seven_to_nine: sevenToNine,
    one_to_six: oneToSix,
    people: completed + sevenToNine + oneToSix,
  });

  // ---------------------------------------------------------------------------
  // Who is counted, and in which bucket
  // ---------------------------------------------------------------------------

  describe('a leader reading their own table', () => {
    it("rows are the leader's direct disciples in surname order, each counting their branch", async () => {
      const response = await readiness(manuelAccount);

      expect(response.status).toBe(200);
      const body = response.body as Readiness;

      expect(body.subject).toEqual({ id: manuel.id, full_name: 'Manuel Bautista' });
      // Surname, then first name: Abad, Castillo Mark, Castillo Paulo. Never by a figure,
      // or Mark's branch, the largest, would lead.
      expect(body.rows.map((row) => row.leader?.id)).toEqual([nathan.id, mark.id, paulo.id]);
      expect(body.elsewhere).toBeNull();

      // Mark's branch includes Mark himself; archived Silas and merged Quentin are not
      // current and count for nothing.
      const markRow = rowOf(body, mark);
      expect(markRow.leader).toEqual({
        id: mark.id,
        member_id: await memberIdOf(mark),
        full_name: 'Mark Castillo',
      });
      expect(markRow.network).toBeNull();
      expect(markRow.leads_anyone).toBe(true);
      expect(figuresOf(markRow)).toEqual(fig(1, 1, 0));
      expect(markRow.members).toEqual([
        { person_id: mark.id, full_name: 'Mark Castillo', lessons: 8 },
        { person_id: timothy.id, full_name: 'Timothy Zamora', lessons: 10 },
      ]);

      // Nathan holds a current Encounter graduation: past the LC Party, left out.
      const nathanRow = rowOf(body, nathan);
      expect(nathanRow.leads_anyone).toBe(false);
      expect(figuresOf(nathanRow)).toEqual(fig(0, 0, 0));
      expect(nathanRow.members).toEqual([]);

      // Paulo's Encounter graduation was withdrawn, so it excludes nobody.
      const pauloRow = rowOf(body, paulo);
      expect(pauloRow.leads_anyone).toBe(false);
      expect(figuresOf(pauloRow)).toEqual(fig(0, 0, 1));
      expect(pauloRow.members).toEqual([
        { person_id: paulo.id, full_name: 'Paulo Castillo', lessons: 2 },
      ]);

      // Manuel alone: six current lessons, the seventh withdrawn, so one to six.
      expect(figuresOf(body.own!)).toEqual(fig(0, 0, 1));
      expect(body.own!.members).toEqual([
        { person_id: manuel.id, full_name: 'Manuel Bautista', lessons: 6 },
      ]);

      expect(body.total).toEqual(fig(1, 1, 2));
    });

    it('buckets at the boundaries: ten completed, seven to nine, one to six', async () => {
      // Move Timothy to exactly 7 and Mark to exactly 9 by adding and withdrawing rows.
      await db
        .updateTable('suynl_lessons')
        .set({ superseded_at: new Date(), corrected_by: admin.id, correction_reason: 'Wrong.' })
        .where('person_id', '=', timothy.id)
        .where('lesson', '>', 7)
        .where('superseded_at', 'is', null)
        .execute();
      await lessons(mark.id, [9]);
      await lessons(paulo.id, [3, 4, 5, 6]);

      const body = (await readiness(manuelAccount)).body as Readiness;
      const markRow = rowOf(body, mark);

      expect(markRow.members).toEqual([
        { person_id: mark.id, full_name: 'Mark Castillo', lessons: 9 },
        { person_id: timothy.id, full_name: 'Timothy Zamora', lessons: 7 },
      ]);
      expect(figuresOf(markRow)).toEqual(fig(0, 2, 0));
      expect(rowOf(body, paulo).members[0].lessons).toBe(6);
      expect(figuresOf(rowOf(body, paulo))).toEqual(fig(0, 0, 1));
    });

    it('a Life Class graduation leaves a person out as an Encounter one does', async () => {
      await graduation(mark.id, 'LIFE_CLASS');

      const body = (await readiness(manuelAccount)).body as Readiness;

      expect(rowOf(body, mark).members.map((member) => member.person_id)).toEqual([timothy.id]);
    });

    it('SOL graduations alone leave nobody out', async () => {
      await graduation(paulo.id, 'SOL_1');
      await graduation(paulo.id, 'SOL_2');
      await graduation(paulo.id, 'SOL_3');

      const body = (await readiness(manuelAccount)).body as Readiness;

      expect(figuresOf(rowOf(body, paulo))).toEqual(fig(0, 0, 1));
    });

    it('a leader asking for nobody is their own subject, with no elsewhere line', async () => {
      const response = await readiness(markAccount);

      expect(response.status).toBe(200);
      const body = response.body as Readiness;
      expect(body.subject).toEqual({ id: mark.id, full_name: 'Mark Castillo' });
      expect(body.elsewhere).toBeNull();
      expect(figuresOf(rowOf(body, timothy))).toEqual(fig(1, 0, 0));
      expect(rowOf(body, timothy).leads_anyone).toBe(false);
      expect(figuresOf(body.own!)).toEqual(fig(0, 1, 0));
      expect(body.total).toEqual(fig(1, 1, 0));
    });
  });

  // ---------------------------------------------------------------------------
  // A drilled table
  // ---------------------------------------------------------------------------

  describe('a table for a leader the reader opened', () => {
    it('makes the opened disciple the subject', async () => {
      const response = await readiness(manuelAccount, mark.id);

      expect(response.status).toBe(200);
      const body = response.body as Readiness;
      expect(body.subject).toEqual({ id: mark.id, full_name: 'Mark Castillo' });
      expect(body.own!.members).toEqual([
        { person_id: mark.id, full_name: 'Mark Castillo', lessons: 8 },
      ]);
      expect(figuresOf(rowOf(body, timothy))).toEqual(fig(1, 0, 0));
      expect(body.elsewhere).toBeNull();
      expect(body.total).toEqual(fig(1, 1, 0));
    });

    it('answers a leader with nobody beneath them with no rows and their own figure', async () => {
      const response = await readiness(markAccount, timothy.id);

      expect(response.status).toBe(200);
      const body = response.body as Readiness;
      expect(body.subject).toEqual({ id: timothy.id, full_name: 'Timothy Zamora' });
      expect(body.rows).toEqual([]);
      expect(figuresOf(body.own!)).toEqual(fig(1, 0, 0));
      expect(body.total).toEqual(fig(1, 0, 0));
    });

    it('lets a whole-church reader open a root, and the root is the own row, not a Network row', async () => {
      const response = await readiness(admin, raymond.id);

      expect(response.status).toBe(200);
      const body = response.body as Readiness;
      expect(body.subject).toEqual({ id: raymond.id, full_name: 'Raymond Alcantara' });
      expect(body.elsewhere).toBeNull();
      expect(body.rows.map((row) => row.leader?.id)).toContain(manuel.id);
      expect(body.rows.every((row) => row.network === null)).toBe(true);
      // Manuel's branch, Manuel included.
      expect(figuresOf(rowOf(body, manuel))).toEqual(fig(1, 1, 2));
      // Raymond holds a current Life Class graduation.
      expect(figuresOf(body.own!)).toEqual(fig(0, 0, 0));
      expect(body.total).toEqual(fig(1, 1, 2));
    });
  });

  // ---------------------------------------------------------------------------
  // The whole church
  // ---------------------------------------------------------------------------

  describe('a whole-church reader asking for nobody', () => {
    it("answers the two roots' branches, Men's first, and a line for everybody in neither", async () => {
      for (const account of [admin, raymondAccount]) {
        const response = await readiness(account);

        expect(response.status).toBe(200);
        const body = response.body as Readiness;

        expect(body.subject).toBeNull();
        expect(body.own).toBeNull();
        expect(body.rows.map((row) => [row.leader?.id, row.network])).toEqual([
          [raymond.id, 'MENS'],
          [grace.id, 'WOMENS'],
        ]);

        const men = body.rows[0];
        expect(men.leader).toEqual({
          id: raymond.id,
          member_id: await memberIdOf(raymond),
          full_name: 'Raymond Alcantara',
        });
        expect(men.leads_anyone).toBe(true);
        expect(figuresOf(men)).toEqual(fig(1, 1, 2));
        // Surname order across the whole branch.
        expect(men.members.map((member) => member.person_id)).toEqual([
          manuel.id,
          mark.id,
          paulo.id,
          timothy.id,
        ]);

        const women = body.rows[1];
        expect(women.leads_anyone).toBe(true);
        // Ruth's only lesson was withdrawn, and Grace has none.
        expect(figuresOf(women)).toEqual(fig(0, 1, 0));
        expect(women.members).toEqual([
          { person_id: hannah.id, full_name: 'Hannah Evangelista', lessons: 9 },
        ]);

        // Ines sits under an administrator outside the tree.
        expect(body.elsewhere).not.toBeNull();
        expect(figuresOf(body.elsewhere!)).toEqual(fig(0, 0, 1));
        expect(body.elsewhere!.members).toEqual([
          { person_id: ines.id, full_name: 'Ines Pineda', lessons: 4 },
        ]);

        expect(body.total).toEqual(fig(1, 2, 3));
      }
    });

    it('answers an empty elsewhere line when everybody counted is under a root', async () => {
      await graduation(ines.id, 'ENCOUNTER');

      const body = (await readiness(admin)).body as Readiness;

      expect(body.elsewhere).not.toBeNull();
      expect(figuresOf(body.elsewhere!)).toEqual(fig(0, 0, 0));
      expect(body.total).toEqual(fig(1, 2, 2));
    });

    it('never counts an archived or merged person in the elsewhere line', async () => {
      // Both hold current lessons and neither is in a root's branch.
      const drifter = await createPerson(db, {
        firstName: 'Drifter',
        lastName: 'Quiambao',
        network: 'WOMENS',
        archived: true,
      });
      const absorbed = await createPerson(db, {
        firstName: 'Absorbed',
        lastName: 'Ramos',
        network: 'WOMENS',
      });
      await db
        .updateTable('persons')
        .set({ merged_into_id: ines.id })
        .where('id', '=', absorbed.id)
        .execute();
      await lessons(drifter.id, [1, 2]);
      await lessons(absorbed.id, [1, 2]);

      const body = (await readiness(admin)).body as Readiness;

      expect(body.elsewhere!.members.map((member) => member.person_id)).toEqual([ines.id]);
    });
  });

  // ---------------------------------------------------------------------------
  // Scope and capability
  // ---------------------------------------------------------------------------

  describe('scope (SKILL.md section 7; decision 0253)', () => {
    it('refuses a leader somebody outside their subtree: their upline, a sibling, the other Network', async () => {
      for (const target of [manuel, raymond, nathan, grace, hannah, ines]) {
        const response = await readiness(markAccount, target.id);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
      }
    });

    it('answers an unknown id SCOPE_DENIED to a narrow grant and NOT_FOUND to a whole-church one', async () => {
      const missing = randomUUID();

      const narrow = await readiness(markAccount, missing);
      const outOfScope = await readiness(markAccount, grace.id);
      const wide = await readiness(admin, missing);

      expect(narrow.status).toBe(403);
      expect(narrow.body.error.code).toBe('SCOPE_DENIED');
      // Scope decides the answer; the record never does.
      expect(outOfScope.body).toEqual(narrow.body);
      expect(wide.status).toBe(404);
      expect(wide.body.error.code).toBe('NOT_FOUND');
    });

    it('refuses a malformed id as malformed input, before any permission answer', async () => {
      for (const account of [admin, markAccount, grantless]) {
        const response = await readiness(account, 'not-a-uuid');

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('refuses an account without suynl.view_subtree on both routes', async () => {
      const own = await readiness(grantless);
      const other = await readiness(grantless, mark.id);

      expect(own.status).toBe(403);
      expect(own.body.error.code).toBe('CAPABILITY_DENIED');
      expect(other.status).toBe(403);
      expect(other.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('refuses an unauthenticated request', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/suynl/readiness');

      expect(response.status).toBe(401);
    });

    it('confines a NETWORK-scoped grant to its Network, and gives it no whole-church view', async () => {
      // A person outside the pastoral tree holding only a read-only Men's grant.
      const viewer = await createPerson(db, {
        firstName: 'Vicente',
        lastName: 'Lorenzo',
        network: 'MENS',
      });
      const account = await createAccount(app, db, { person: viewer, roles: [] });
      await db
        .insertInto('capability_grants')
        .values({
          account_id: account.id,
          capability: 'suynl.view_subtree',
          scope_type: 'NETWORK',
          scope_network: 'MENS',
          read_only: true,
          reason: 'Reads the Men’s Network readiness table.',
          granted_by: admin.id,
        })
        .execute();

      const men = await readiness(account, raymond.id);
      expect(men.status).toBe(200);
      expect((men.body as Readiness).total).toEqual(fig(1, 1, 2));
      expect((men.body as Readiness).elsewhere).toBeNull();

      for (const target of [grace, hannah, ines]) {
        const response = await readiness(account, target.id);
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
      }

      // Asking for nobody is the reader's own table, which is empty: a Network grant is
      // not a whole-church one, so no root rows and no elsewhere line.
      const own = await readiness(account);
      expect(own.status).toBe(200);
      const body = own.body as Readiness;
      expect(body.subject).toEqual({ id: viewer.id, full_name: 'Vicente Lorenzo' });
      expect(body.rows).toEqual([]);
      expect(body.elsewhere).toBeNull();
      expect(body.total).toEqual(fig(0, 0, 0));
    });
  });

  // ---------------------------------------------------------------------------
  // A read writes nothing
  // ---------------------------------------------------------------------------

  it('writes nothing: no audit entry, no idempotency key, and needs no key', async () => {
    const before = {
      lessons: await db.selectFrom('suynl_lessons').selectAll().orderBy('id').execute(),
      graduations: await db.selectFrom('training_graduations').selectAll().orderBy('id').execute(),
    };

    expect((await readiness(admin)).status).toBe(200);
    expect((await readiness(manuelAccount)).status).toBe(200);
    expect((await readiness(manuelAccount, mark.id)).status).toBe(200);

    expect(await db.selectFrom('audit_log').selectAll().execute()).toEqual([]);
    expect(await db.selectFrom('idempotency_keys').selectAll().execute()).toEqual([]);
    expect(await db.selectFrom('suynl_lessons').selectAll().orderBy('id').execute()).toEqual(
      before.lessons,
    );
    expect(await db.selectFrom('training_graduations').selectAll().orderBy('id').execute()).toEqual(
      before.graduations,
    );
  });
});
