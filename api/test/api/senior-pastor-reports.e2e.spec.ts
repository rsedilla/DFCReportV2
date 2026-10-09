import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * The Senior Pastors' *Number of Cells*, *Number of people*, *Encounter candidates* and
 * *Trends* at the API (SKILL.md sections 19 and 20; decision 0326, points 3, 4 and 5).
 *
 * The two Network roots are `Oriel Villanueva` (Men's) and `Gemma Bautista` (Women's), each
 * holding a Senior Pastor account. Gemma sorts first by surname, so a table order putting
 * Oriel first is the Network order rather than the name order. **No Admin account exists
 * unless a case creates one**, so the Leader refusals are not resting on anybody else's
 * account. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('Senior Pastor reports (decision 0326)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let gemma: TestPerson;
  let pastor: TestAccount;
  let otherPastor: TestAccount;

  /** Long before any month read here, for Cells that have always existed. */
  const LONG_AGO = new Date('2024-01-03T12:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', lastName: 'Villanueva', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    gemma = await createPerson(db, { firstName: 'Gemma', lastName: 'Bautista', network: 'WOMENS' });
    await assignTo(db, gemma.id, null);
    nameSeniorPastors(app, [oriel.id, gemma.id]);
    pastor = await createAccount(app, db, {
      person: oriel,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    otherPastor = await createAccount(app, db, {
      person: gemma,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 2,
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** The current Manila month, read from the database's clock as the API reads it. */
  const currentMonth = async (): Promise<string> => {
    const result = await sql<{ month: string }>`
      SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Manila'), 'YYYY-MM-DD') AS month
    `.execute(db);

    return result.rows[0].month;
  };

  const shiftMonth = (month: string, offset: number): string => {
    const [year, number] = month.split('-').map(Number);

    return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 10);
  };

  /** Noon, Manila, on the 15th of a month: well inside it whatever day the suite runs. */
  const midMonth = (month: string): Date => new Date(`${month.slice(0, 7)}-15T12:00:00+08:00`);

  async function leader(
    firstName: string,
    lastName: string,
    under: TestPerson,
  ): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, lastName, network: under.network });
    await assignTo(db, person.id, under.id);

    return person;
  }

  async function cellOf(
    person: TestPerson,
    category: 'YOUTH' | 'YOUNG_PRO' | 'COUPLE',
    createdAt: Date = LONG_AGO,
  ): Promise<TestCell> {
    return createCell(db, { leader: person, category, createdAt });
  }

  /** A category change at an instant, as section 10 makes one: close and open together. */
  async function recategorise(
    cell: TestCell,
    category: 'YOUTH' | 'YOUNG_PRO' | 'COUPLE',
    at: Date,
  ): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_categories')
        .set({ ended_at: at })
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('cell_categories')
        .values({ cell_id: cell.id, category, started_at: at })
        .execute();
    });
  }

  /** Archives a Person at an instant: the open lifecycle row closes and ARCHIVED opens. */
  async function archiveAt(person: TestPerson, at: Date): Promise<void> {
    await db
      .updateTable('person_lifecycle')
      .set({ ended_at: at })
      .where('person_id', '=', person.id)
      .where('ended_at', 'is', null)
      .execute();
    await db
      .insertInto('person_lifecycle')
      .values({
        person_id: person.id,
        state: 'ARCHIVED',
        reason: 'NO_LONGER_IN_CURRENT_NETWORK',
        started_at: at,
      })
      .execute();
  }

  function counts(as: TestAccount, period: string): request.Test {
    return request(app.getHttpServer())
      .get('/api/v1/reports/church-counts')
      .query({ period })
      .set('Authorization', `Bearer ${as.accessToken}`);
  }

  function trends(as: TestAccount, query: Record<string, string>): request.Test {
    return request(app.getHttpServer())
      .get('/api/v1/reports/trends')
      .query(query)
      .set('Authorization', `Bearer ${as.accessToken}`);
  }

  function candidates(as: TestAccount): request.Test {
    return request(app.getHttpServer())
      .get('/api/v1/suynl/encounter-candidates')
      .set('Authorization', `Bearer ${as.accessToken}`);
  }

  const FIELDS = ['cell_groups', 'youth', 'young_pro', 'couple', 'cell_leaders', 'people'] as const;
  type Figures = Record<(typeof FIELDS)[number], number>;
  interface CountRow extends Figures {
    leader: { id: string };
  }
  interface CountTable {
    root: { id: string };
    network: string | null;
    rows: CountRow[];
  }
  interface Counts {
    period: string;
    current: boolean;
    whole_church: Figures;
    tables: CountTable[] | null;
    others: Figures | null;
  }

  /**
   * The reconciliation decision 0326 point 5 asks for (CLAUDE.md, Definition of Done): the
   * rows of both tables and *Others* add up to the whole church, field by field. A failure is
   * a data-integrity defect, not a rounding issue.
   */
  function expectReconciles(body: Counts): void {
    expect(body.tables).not.toBeNull();
    expect(body.others).not.toBeNull();
    for (const field of FIELDS) {
      const rows = body
        .tables!.flatMap((table) => table.rows)
        .reduce((sum, row) => sum + row[field], 0);
      expect({ field, total: rows + body.others![field] }).toEqual({
        field,
        total: body.whole_church[field],
      });
    }
  }

  const rowOf = (body: Counts, person: TestPerson): CountRow | undefined =>
    body.tables!.flatMap((table) => table.rows).find((row) => row.leader.id === person.id);

  // ---------------------------------------------------------------------------
  // Number of Cells and Number of people
  // ---------------------------------------------------------------------------

  describe('GET /reports/church-counts', () => {
    /**
     *   Oriel (Men's root, leads a YOUNG_PRO Cell)
     *     -> Ben Dizon (no Cell)
     *     -> Ana Cruz (YOUTH) -> Dan Esguerra (COUPLE)
     *   Gemma (Women's root) -> Cara Flores (YOUNG_PRO)
     *   Adele Ocampo, outside the tree, -> Ines Pineda (COUPLE)
     *   Xavier Gatchalian, no assignment (YOUTH)
     */
    let ana: TestPerson;
    let ben: TestPerson;
    let dan: TestPerson;
    let cara: TestPerson;

    async function buildChurch(): Promise<void> {
      // Ben before Ana, so the rows' surname order is tested rather than creation order.
      ben = await leader('Ben', 'Dizon', oriel);
      ana = await leader('Ana', 'Cruz', oriel);
      dan = await leader('Dan', 'Esguerra', ana);
      cara = await leader('Cara', 'Flores', gemma);
      const adele = await createPerson(db, {
        firstName: 'Adele',
        lastName: 'Ocampo',
        network: 'WOMENS',
      });
      const ines = await createPerson(db, {
        firstName: 'Ines',
        lastName: 'Pineda',
        network: 'WOMENS',
      });
      await assignTo(db, ines.id, adele.id);
      const xavier = await createPerson(db, {
        firstName: 'Xavier',
        lastName: 'Gatchalian',
        network: 'MENS',
      });

      await cellOf(oriel, 'YOUNG_PRO');
      await cellOf(ana, 'YOUTH');
      await cellOf(dan, 'COUPLE');
      await cellOf(cara, 'YOUNG_PRO');
      await cellOf(ines, 'COUPLE');
      await cellOf(xavier, 'YOUTH');
    }

    it('adds both root tables and Others up to the whole church, Men’s root first, rows by surname', async () => {
      await buildChurch();
      const last = shiftMonth(await currentMonth(), -1);

      const response = await counts(pastor, last).expect(200);
      const body = response.body as Counts;

      expect(body.period).toBe(last);
      expect(body.current).toBe(false);
      expect(body.whole_church).toEqual({
        cell_groups: 6,
        youth: 2,
        young_pro: 2,
        couple: 2,
        cell_leaders: 6,
        people: 9,
      });
      // Every Cell here has a category, so the three add up to Cell Groups.
      expect(body.whole_church.youth + body.whole_church.young_pro + body.whole_church.couple).toBe(
        body.whole_church.cell_groups,
      );

      // The Men's root's table first, though Gemma sorts first by surname.
      expect(body.tables!.map((table) => table.root.id)).toEqual([oriel.id, gemma.id]);
      expect(body.tables!.map((table) => table.network)).toEqual(['MENS', 'WOMENS']);
      expect(body.tables![0].rows.map((row) => row.leader.id)).toEqual([ana.id, ben.id]);
      expect(body.tables![1].rows.map((row) => row.leader.id)).toEqual([cara.id]);

      // A row counts that leader and everyone beneath them.
      expect(rowOf(body, ana)).toMatchObject({
        cell_groups: 2,
        youth: 1,
        young_pro: 0,
        couple: 1,
        cell_leaders: 2,
        people: 2,
      });
      expect(rowOf(body, ben)).toMatchObject({ cell_groups: 0, cell_leaders: 0, people: 1 });
      expect(rowOf(body, cara)).toMatchObject({ cell_groups: 1, young_pro: 1, people: 1 });

      // Others: both roots (Oriel's own Cell among them), Adele and Ines, and Xavier.
      expect(body.others).toEqual({
        cell_groups: 3,
        youth: 1,
        young_pro: 1,
        couple: 1,
        cell_leaders: 3,
        people: 5,
      });

      expectReconciles(body);
    });

    it('answers the current month as current, and still adds up', async () => {
      await buildChurch();
      const month = await currentMonth();

      const response = await counts(otherPastor, month).expect(200);
      const body = response.body as Counts;

      expect(body.current).toBe(true);
      expect(body.whole_church.cell_groups).toBe(6);
      expectReconciles(body);
    });

    it('counts a Cell closed, created or recategorised in a month, and an archived person, as at the month’s final millisecond', async () => {
      const month = await currentMonth();
      const last = shiftMonth(month, -1);
      const before = shiftMonth(month, -2);
      const during = midMonth(last);

      const ana = await leader('Ana', 'Cruz', oriel);
      const lito = await leader('Lito', 'Mercado', ana);
      const rico = await leader('Rico', 'Navarro', ana);
      const sam = await leader('Sam', 'Ortega', ana);
      const paz = await leader('Paz', 'Herrera', gemma);

      const closing = await cellOf(lito, 'YOUTH');
      await cellOf(rico, 'YOUNG_PRO', during);
      const changing = await cellOf(sam, 'YOUTH');
      await closeCellDirectly(db, closing.id, { reason: 'MEMBERS_DISPERSED', at: during });
      await recategorise(changing, 'COUPLE', during);
      await archiveAt(paz, during);

      const earlier = (await counts(pastor, before).expect(200)).body as Counts;
      const later = (await counts(pastor, last).expect(200)).body as Counts;

      // Two months ago: the closing Cell still ran, the new one did not yet, the changing
      // one was YOUTH, and Paz was current.
      expect(earlier.whole_church).toEqual({
        cell_groups: 2,
        youth: 2,
        young_pro: 0,
        couple: 0,
        cell_leaders: 2,
        people: 7,
      });
      // Last month: closed, created and recategorised, and Paz archived.
      expect(later.whole_church).toEqual({
        cell_groups: 2,
        youth: 0,
        young_pro: 1,
        couple: 1,
        cell_leaders: 2,
        people: 6,
      });

      expect(rowOf(earlier, ana)).toMatchObject({ cell_groups: 2, youth: 2, people: 4 });
      expect(rowOf(later, ana)).toMatchObject({ cell_groups: 2, young_pro: 1, couple: 1 });

      expectReconciles(earlier);
      expectReconciles(later);
    });

    it('refuses a month that has not begun', async () => {
      const next = shiftMonth(await currentMonth(), 1);

      const response = await counts(pastor, next).expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  // ---------------------------------------------------------------------------
  // Encounter candidates
  // ---------------------------------------------------------------------------

  describe('GET /suynl/encounter-candidates', () => {
    const lessons = async (person: TestPerson, numbers: number[]) => {
      for (const lesson of numbers) {
        await db
          .insertInto('suynl_lessons')
          .values({ person_id: person.id, lesson, confirmed_by: null, recorded_by: pastor.id })
          .execute();
      }
    };

    const supersededLesson = async (person: TestPerson, lesson: number) => {
      await db
        .insertInto('suynl_lessons')
        .values({
          person_id: person.id,
          lesson,
          confirmed_by: null,
          recorded_by: pastor.id,
          superseded_at: new Date(),
          corrected_by: pastor.id,
          correction_reason: 'Ticked against the wrong person.',
        })
        .execute();
    };

    const graduation = async (person: TestPerson, program: 'ENCOUNTER' | 'LIFE_CLASS') => {
      await db
        .insertInto('training_graduations')
        .values({ person_id: person.id, program, confirmed_by: null, recorded_by: pastor.id })
        .execute();
    };

    /**
     *   Oriel (4 lessons)                          -> candidate, in Others
     *     -> Ben Dizon (3 lessons)                 -> left out
     *     -> Ana Cruz (5 lessons, ENCOUNTER)       -> left out
     *          -> Dan Esguerra (4 lessons)         -> candidate, Ana's row
     *          -> Silas Ybarra (5 lessons, archived) -> left out
     *          -> Pio Quinto (3 current, 1 superseded) -> left out
     *   Gemma
     *     -> Cara Flores (6 lessons, LIFE_CLASS)   -> left out
     *          -> Hana Ramos (4 lessons)           -> candidate, Cara's row
     *   Adele Ocampo, outside the tree -> Ines Pineda (4 lessons) -> candidate, in Others
     */
    let ana: TestPerson;
    let ben: TestPerson;
    let cara: TestPerson;

    beforeEach(async () => {
      ben = await leader('Ben', 'Dizon', oriel);
      ana = await leader('Ana', 'Cruz', oriel);
      const dan = await leader('Dan', 'Esguerra', ana);
      const silas = await createPerson(db, {
        firstName: 'Silas',
        lastName: 'Ybarra',
        network: 'MENS',
        archived: true,
      });
      await assignTo(db, silas.id, ana.id);
      const pio = await leader('Pio', 'Quinto', ana);
      cara = await leader('Cara', 'Flores', gemma);
      const hana = await leader('Hana', 'Ramos', cara);
      const adele = await createPerson(db, {
        firstName: 'Adele',
        lastName: 'Ocampo',
        network: 'WOMENS',
      });
      const ines = await createPerson(db, {
        firstName: 'Ines',
        lastName: 'Pineda',
        network: 'WOMENS',
      });
      await assignTo(db, ines.id, adele.id);

      await lessons(oriel, [1, 2, 3, 4]);
      await lessons(ben, [1, 2, 3]);
      await lessons(ana, [1, 2, 3, 4, 5]);
      await graduation(ana, 'ENCOUNTER');
      await lessons(dan, [1, 2, 3, 4]);
      await lessons(silas, [1, 2, 3, 4, 5]);
      await lessons(pio, [1, 2, 3]);
      await supersededLesson(pio, 4);
      await lessons(cara, [1, 2, 3, 4, 5, 6]);
      await graduation(cara, 'LIFE_CLASS');
      await lessons(hana, [1, 2, 3, 4]);
      await lessons(ines, [1, 2, 3, 4]);
    });

    interface CandidateTable {
      root: { id: string };
      network: string | null;
      rows: { leader: { id: string }; candidates: number }[];
    }

    it('counts four or more current lessons and no Encounter or Life Class graduation, and the rows and Others add up', async () => {
      const response = await candidates(pastor).expect(200);
      const body = response.body as { total: number; tables: CandidateTable[]; others: number };

      // Oriel, Dan, Hana and Ines. Not Ben (3), Pio (3 current), Ana (ENCOUNTER), Cara
      // (LIFE_CLASS) or Silas (archived).
      expect(body.total).toBe(4);

      expect(body.tables.map((table) => table.root.id)).toEqual([oriel.id, gemma.id]);
      expect(body.tables[0].rows.map((row) => [row.leader.id, row.candidates])).toEqual([
        [ana.id, 1],
        [ben.id, 0],
      ]);
      expect(body.tables[1].rows.map((row) => [row.leader.id, row.candidates])).toEqual([
        [cara.id, 1],
      ]);
      // The root itself and the person outside the tree.
      expect(body.others).toBe(2);

      const rows = body.tables
        .flatMap((table) => table.rows)
        .reduce((sum, row) => sum + row.candidates, 0);
      expect(rows + body.others).toBe(body.total);
    });

    it('stops counting somebody the moment an Encounter graduation is recorded for them', async () => {
      const before = (await candidates(pastor).expect(200)).body as { total: number };
      await graduation(oriel, 'ENCOUNTER');
      const after = (await candidates(pastor).expect(200)).body as {
        total: number;
        others: number;
      };

      expect(after.total).toBe(before.total - 1);
      expect(after.others).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Trends
  // ---------------------------------------------------------------------------

  describe('GET /reports/trends', () => {
    interface Line {
      leader: { id: string } | null;
      values: (number | null)[];
    }

    let ana: TestPerson;

    beforeEach(async () => {
      ana = await leader('Ana', 'Cruz', oriel);
      const dan = await leader('Dan', 'Esguerra', ana);
      const cara = await leader('Cara', 'Flores', gemma);
      await cellOf(ana, 'YOUTH');
      await cellOf(dan, 'COUPLE');
      await cellOf(cara, 'YOUNG_PRO');
      // A Cell created last month, so the line moves within the twelve months.
      const last = shiftMonth(await currentMonth(), -1);
      await cellOf(dan, 'YOUTH', midMonth(last));
    });

    it('draws twelve months ending with the current one, the church then the Men’s and Women’s branches', async () => {
      const month = await currentMonth();

      const response = await trends(pastor, { figure: 'CELLS' }).expect(200);

      expect(response.body.figure).toBe('CELLS');
      expect(response.body.current).toBe(month);
      expect(response.body.months).toHaveLength(12);
      expect(response.body.months[11]).toBe(month);
      expect(response.body.months[0]).toBe(shiftMonth(month, -11));

      const lines = response.body.lines as Line[];
      expect(lines.map((line) => line.leader?.id ?? null)).toEqual([null, oriel.id, gemma.id]);
      for (const line of lines) {
        expect(line.values).toHaveLength(12);
      }

      // Each month's church point is that month's Cell Groups on Number of Cells.
      for (const index of [9, 10, 11]) {
        const period = response.body.months[index] as string;
        const read = (await counts(pastor, period).expect(200)).body as Counts;
        expect({ period, value: lines[0].values[index] }).toEqual({
          period,
          value: read.whole_church.cell_groups,
        });
      }
      // The Men's branch is its root and everyone beneath: Ana's and Dan's Cells.
      expect(lines[1].values[9]).toBe(2);
      expect(lines[1].values[10]).toBe(3);
      expect(lines[2].values[10]).toBe(1);
    });

    it('draws the church’s People as Number of people’s whole-church figure', async () => {
      const response = await trends(pastor, { figure: 'PEOPLE' }).expect(200);
      const lines = response.body.lines as Line[];
      const period = response.body.months[10] as string;
      const month = (await counts(pastor, period).expect(200)).body as Counts;

      expect(lines[0].values[10]).toBe(month.whole_church.people);
    });

    it('draws one line for a leader named, and answers NOT_FOUND for nobody', async () => {
      const response = await trends(pastor, { figure: 'CELLS', leader_id: ana.id }).expect(200);
      const lines = response.body.lines as Line[];

      expect(lines.map((line) => line.leader?.id)).toEqual([ana.id]);
      const period = response.body.months[10] as string;
      const month = (await counts(pastor, period).expect(200)).body as Counts;
      expect(lines[0].values[10]).toBe(rowOf(month, ana)!.cell_groups);

      const unknown = await trends(pastor, { figure: 'CELLS', leader_id: randomUUID() }).expect(
        404,
      );
      expect(unknown.body.error.code).toBe('NOT_FOUND');
    });

    it('answers the two attendance figures with three lines', async () => {
      for (const figure of ['CG', 'DCC']) {
        const response = await trends(pastor, { figure }).expect(200);
        expect((response.body.lines as Line[]).map((line) => line.leader?.id ?? null)).toEqual([
          null,
          oriel.id,
          gemma.id,
        ]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Who may read them (SKILL.md section 7: the API is the sole authority)
  // ---------------------------------------------------------------------------

  describe('authorization', () => {
    it('refuses a Leader, with or without Full view, all three routes, while no Admin account exists', async () => {
      const ana = await leader('Ana', 'Cruz', oriel);
      const ben = await leader('Ben', 'Dizon', oriel);
      const withFullView = await createAccount(app, db, {
        person: ana,
        roles: ['LEADER'],
        fullView: true,
      });
      const without = await createAccount(app, db, {
        person: ben,
        roles: ['LEADER'],
        fullView: false,
      });
      const admins = await db
        .selectFrom('account_roles')
        .select('id')
        .where('role', '=', 'ADMIN')
        .execute();
      expect(admins).toEqual([]);

      const last = shiftMonth(await currentMonth(), -1);

      // Full view holds reports.view_subtree and suynl.view_subtree over its own subtree,
      // which does not cover the church.
      for (const response of [
        await counts(withFullView, last),
        await trends(withFullView, { figure: 'CELLS' }),
        await trends(withFullView, { figure: 'CELLS', leader_id: ana.id }),
        await candidates(withFullView),
      ]) {
        expect({ status: response.status, code: response.body.error?.code }).toEqual({
          status: 403,
          code: 'SCOPE_DENIED',
        });
      }

      // Without Full view the Leader holds no reports.view_subtree at all.
      for (const response of [
        await counts(without, last),
        await trends(without, { figure: 'PEOPLE' }),
      ]) {
        expect({ status: response.status, code: response.body.error?.code }).toEqual({
          status: 403,
          code: 'CAPABILITY_DENIED',
        });
      }
      // Encounter candidates' guard checks suynl.view_subtree first, which a Leader holds
      // over their own subtree with or without Full view, so the refusal is on scope there
      // before reports.view_subtree is reached.
      const encounter = await candidates(without);
      expect({ status: encounter.status, code: encounter.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
    });

    it('refuses Encounter candidates to a Leader granted suynl.view_subtree at Whole Church but holding reports.view_subtree over their subtree only', async () => {
      const ana = await leader('Ana', 'Cruz', oriel);
      const reader = await createAccount(app, db, {
        person: ana,
        roles: ['LEADER'],
        fullView: true,
      });
      await db
        .insertInto('capability_grants')
        .values({
          account_id: reader.id,
          capability: 'suynl.view_subtree',
          scope_type: 'WHOLE_CHURCH',
          scope_network: null,
          read_only: true,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: pastor.id,
        })
        .execute();

      // The guard's capability is covered, so this is the controller's second check.
      const response = await candidates(reader);
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
    });

    it('admits both Senior Pastors and an Admin', async () => {
      const admin = await createAccount(app, db, {
        person: await createPerson(db, {
          firstName: 'Nora',
          lastName: 'Santos',
          network: 'WOMENS',
        }),
        roles: ['ADMIN'],
      });
      const last = shiftMonth(await currentMonth(), -1);

      for (const reader of [pastor, otherPastor, admin]) {
        await counts(reader, last).expect(200);
        await trends(reader, { figure: 'PEOPLE' }).expect(200);
        await candidates(reader).expect(200);
      }
    });
  });
});
