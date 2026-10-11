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
 * The Senior Pastors' *Number of Cells*, *Number of Cell Leaders*, *Number of people* and
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
  // A Cell created in error (decision 0330, SKILL.md section 19)
  // ---------------------------------------------------------------------------

  describe('a Cell created in error is in no month’s count (decision 0330)', () => {
    /**
     *   Oriel (Men's root, leads a YOUNG_PRO Cell — closed now)
     *     -> Ana Cruz (YOUTH)
     *          -> Lito Mercado (COUPLE — closed now; his only Cell)
     *          -> Dan Esguerra (YOUTH, and a COUPLE Cell — closed now)
     *   Gemma (Women's root) -> Cara Flores (YOUNG_PRO)
     *
     * Every Cell has run since long before the months read. The three marked are closed at
     * the moment the case runs, which is after every past month the case reads, so the
     * closure itself never removes them from a past month: only its reason can.
     */
    let ana: TestPerson;
    let dan: TestPerson;
    let cara: TestPerson;

    async function buildAndClose(reason: 'CREATED_IN_ERROR' | 'MEMBERS_DISPERSED'): Promise<void> {
      ana = await leader('Ana', 'Cruz', oriel);
      const lito = await leader('Lito', 'Mercado', ana);
      dan = await leader('Dan', 'Esguerra', ana);
      cara = await leader('Cara', 'Flores', gemma);

      const rootCell = await cellOf(oriel, 'YOUNG_PRO');
      await cellOf(ana, 'YOUTH');
      const litoCell = await cellOf(lito, 'COUPLE');
      await cellOf(dan, 'YOUTH');
      const danSecond = await cellOf(dan, 'COUPLE');
      await cellOf(cara, 'YOUNG_PRO');

      // No `at`: closed now, in the current month, after every past month read below.
      for (const cell of [rootCell, litoCell, danSecond]) {
        await closeCellDirectly(db, cell.id, { reason });
      }
    }

    /** What a past month reads with the three Cells left out. */
    const WITHOUT_ERRONEOUS: Figures = {
      cell_groups: 3,
      youth: 2,
      young_pro: 1,
      couple: 0,
      cell_leaders: 3,
      people: 6,
    };

    it('leaves a Cell closed CREATED_IN_ERROR after a month out of that month’s counts, and still adds up', async () => {
      await buildAndClose('CREATED_IN_ERROR');
      const month = await currentMonth();

      // Last month and the month before it: the months before the closure are included.
      for (const period of [shiftMonth(month, -1), shiftMonth(month, -2)]) {
        const body = (await counts(pastor, period).expect(200)).body as Counts;

        expect({ period, figures: body.whole_church }).toEqual({
          period,
          figures: WITHOUT_ERRONEOUS,
        });
        // Ana's row: her own Cell and Dan's remaining one. Lito, whose only Cell was
        // created in error, is no Cell Leader; Dan still is, by his other Cell.
        expect(rowOf(body, ana)).toMatchObject({
          cell_groups: 2,
          youth: 2,
          young_pro: 0,
          couple: 0,
          cell_leaders: 2,
          people: 3,
        });
        expect(rowOf(body, cara)).toMatchObject({
          cell_groups: 1,
          young_pro: 1,
          cell_leaders: 1,
        });
        // The root's own Cell, in Others, is gone too.
        expect(body.others).toMatchObject({ cell_groups: 0, young_pro: 0, cell_leaders: 0 });

        expectReconciles(body);
      }
    });

    it('still counts, in the months it ran, a Cell closed afterwards for another reason', async () => {
      await buildAndClose('MEMBERS_DISPERSED');
      const last = shiftMonth(await currentMonth(), -1);

      const body = (await counts(pastor, last).expect(200)).body as Counts;

      expect(body.whole_church).toEqual({
        cell_groups: 6,
        youth: 2,
        young_pro: 2,
        couple: 2,
        // Ana, Lito, Dan (once, for two Cells), Cara and Oriel.
        cell_leaders: 5,
        people: 6,
      });
      expect(rowOf(body, ana)).toMatchObject({
        cell_groups: 4,
        youth: 2,
        couple: 2,
        cell_leaders: 3,
      });
      expect(body.others).toMatchObject({ cell_groups: 1, young_pro: 1, cell_leaders: 1 });

      expectReconciles(body);
    });

    it('draws Trends’ Cells and Cell Leaders without it, agreeing with the month’s counts', async () => {
      await buildAndClose('CREATED_IN_ERROR');

      interface Line {
        leader: { id: string } | null;
        values: (number | null)[];
      }

      const cells = (await trends(pastor, { figure: 'CELLS' }).expect(200)).body;
      const leaders = (await trends(pastor, { figure: 'CELL_LEADERS' }).expect(200)).body;
      const cellLines = cells.lines as Line[];
      const leaderLines = leaders.lines as Line[];

      for (const index of [9, 10]) {
        const period = cells.months[index] as string;
        expect(leaders.months[index]).toBe(period);
        const month = (await counts(pastor, period).expect(200)).body as Counts;

        // The church line: the figures case 1 pins.
        expect({ period, cells: cellLines[0].values[index] }).toEqual({
          period,
          cells: WITHOUT_ERRONEOUS.cell_groups,
        });
        expect({ period, leaders: leaderLines[0].values[index] }).toEqual({
          period,
          leaders: WITHOUT_ERRONEOUS.cell_leaders,
        });
        expect(cellLines[0].values[index]).toBe(month.whole_church.cell_groups);
        expect(leaderLines[0].values[index]).toBe(month.whole_church.cell_leaders);

        // The Men's branch is Oriel and everyone beneath: Ana's and Dan's YOUTH Cells only.
        expect({ period, cells: cellLines[1].values[index] }).toEqual({ period, cells: 2 });
        expect({ period, leaders: leaderLines[1].values[index] }).toEqual({ period, leaders: 2 });
        // The Women's branch is untouched.
        expect({ period, cells: cellLines[2].values[index] }).toEqual({ period, cells: 1 });
      }
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
      // Each branch names its Network, so no client infers it from position (decision 0327).
      expect(lines.map((line) => (line as Line & { network: string | null }).network)).toEqual([
        null,
        'MENS',
        'WOMENS',
      ]);
      // A count is so far only in the month still running (decision 0326), even while the
      // month before is inside its recording window.
      const open = response.body.open as boolean[];
      expect(open).toHaveLength(12);
      expect(open[11]).toBe(true);
      expect(open.slice(0, 11).every((each) => !each)).toBe(true);
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

    it('draws the church’s Cell Leaders as # of Cell Leaders’ whole-church figure (decision 0327)', async () => {
      const response = await trends(pastor, { figure: 'CELL_LEADERS' }).expect(200);
      const lines = response.body.lines as Line[];

      for (const index of [10, 11]) {
        const period = response.body.months[index] as string;
        const month = (await counts(pastor, period).expect(200)).body as Counts;
        expect({ period, value: lines[0].values[index] }).toEqual({
          period,
          value: month.whole_church.cell_leaders,
        });
      }
      // Ana, Dan and Cara each lead a Cell this month, so the point is not a default zero.
      expect(lines[0].values[11]).toBe(3);
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
  // One list of Primaries on every tab (decision 0331, SKILL.md sections 19 and 20)
  // ---------------------------------------------------------------------------

  describe('every Senior Pastor tab lists the same Primaries (decision 0331)', () => {
    /**
     *   Oriel (Men's root)
     *     -> Manuel Bautista -> Mark Ilagan (leads a YOUTH Cell) -> Anacleto Reyes
     *     -> Ana Cruz (leads a COUPLE Cell) -> Benigno Santos
     *   Gemma (Women's root) -> Cara Flores
     *
     * `CLAUDE.md`'s `Raymond -> Manuel -> Mark`, with this suite's Oriel in Raymond's seat.
     * Manuel's assignment closes on 15 June 2020 with no successor, and he is archived at the
     * same instant, so he holds no assignment at June's end: the case decision 0331 is about.
     * May 2020 is a month in which nothing changed. Both months are closed and fixed, so no
     * case here reads the clock. Bautista sorts before Cruz, so Manuel is Oriel's first row.
     */
    const MAY = '2020-05-01';
    const JUNE = '2020-06-01';
    const CREATED = new Date('2020-01-04T12:00:00+08:00');
    const MID_JUNE = new Date('2020-06-15T12:00:00+08:00');

    let manuel: TestPerson;
    let mark: TestPerson;
    let anacleto: TestPerson;
    let ana: TestPerson;
    let benigno: TestPerson;
    let cara: TestPerson;

    interface Figure {
      unique_people: number;
      classification: Record<string, number>;
    }
    interface Twelve {
      kind: string;
      n?: number;
      rows: (Figure & { leader: { id: string } | null; root_id: string })[];
      roots: { id: string; network: string }[];
      own: Figure | null;
      overlap: number;
      elsewhere: number;
      total: Figure;
      buckets?: { people: number }[] | null;
    }

    const twelve = (domain: 'cells' | 'dcc', month: string, rows: boolean): request.Test =>
      request(app.getHttpServer())
        .get(`/api/v1/reports/${domain}/twelve`)
        .query({
          kind: 'MONTH',
          start: month,
          period: month,
          scope: 'WHOLE_CHURCH',
          ...(rows ? { rows: 'ROOT_LEADERS' } : {}),
        })
        .set('Authorization', `Bearer ${pastor.accessToken}`);

    const classified = (figure: Figure): number =>
      Object.values(figure.classification).reduce((sum, count) => sum + count, 0);

    /**
     * Section 20 on an attendance table: every figure's buckets sum to its unique people,
     * the rows less overlap plus elsewhere are the total, and for DCC the attendance buckets
     * sum to the same total. A failure is a data-integrity defect, not a rounding issue.
     */
    const reconcileTwelve = (body: Twelve): Twelve => {
      for (const figure of [...body.rows, ...(body.own === null ? [] : [body.own]), body.total]) {
        expect(classified(figure)).toBe(figure.unique_people);
      }
      const rows = body.rows.reduce((sum, row) => sum + row.unique_people, 0);
      const own = body.own?.unique_people ?? 0;
      expect(rows + own - body.overlap + body.elsewhere).toBe(body.total.unique_people);
      expect(body.overlap).toBeGreaterThanOrEqual(0);
      expect(body.elsewhere).toBeGreaterThanOrEqual(0);
      if (body.buckets !== undefined && body.buckets !== null && (body.n ?? 0) > 0) {
        expect(body.buckets.reduce((sum, entry) => sum + entry.people, 0)).toBe(
          body.total.unique_people,
        );
      }

      return body;
    };

    const attendance = async (domain: 'cells' | 'dcc', month: string): Promise<Twelve> => {
      const response = await twelve(domain, month, true);
      expect({ domain, month, status: response.status }).toEqual({ domain, month, status: 200 });

      return reconcileTwelve(response.body as Twelve);
    };

    /** `[leader, root]` pairs, sorted, so two surfaces' row sets compare as sets. */
    const pairsOfTwelve = (body: Twelve): string[] =>
      body.rows.map((row) => `${row.leader?.id}:${row.root_id}`).sort();
    const pairsOfCounts = (body: Counts): string[] =>
      body
        .tables!.flatMap((table) => table.rows.map((row) => `${row.leader.id}:${table.root.id}`))
        .sort();

    const twelveRowOf = (body: Twelve, person: TestPerson) =>
      body.rows.find((row) => row.leader?.id === person.id);

    /** One HELD meeting, with the derived columns computed by the database. */
    const meeting = async (cell: TestCell, date: string, leaderId: string): Promise<string> => {
      const rows = await sql<{ id: string }>`
        INSERT INTO cell_meetings (
          cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
          status, responsible_leader_id
        )
        VALUES (
          ${cell.id}::uuid, ${date}::date, '19:00'::time,
          ${date}::date - ((EXTRACT(ISODOW FROM ${date}::date)::integer) - 1),
          date_trunc('month', ${date}::date)::date,
          'HELD'::cell_meeting_status, ${leaderId}::uuid
        )
        RETURNING id
      `.execute(db);

      return rows.rows[0].id;
    };

    const attend = async (meetingId: string, person: TestPerson): Promise<void> => {
      await db
        .insertInto('cell_attendance')
        .values({
          cell_meeting_id: meetingId,
          person_id: person.id,
          present: true,
          recorded_by: pastor.id,
        })
        .execute();
    };

    const present = async (
      sunday: string,
      person: TestPerson,
      responsible: TestPerson,
    ): Promise<void> => {
      const event =
        (await db
          .selectFrom('dcc_events')
          .select('id')
          .where('event_date', '=', sunday)
          .executeTakeFirst()) ??
        (await db
          .insertInto('dcc_events')
          .values({ event_date: sunday })
          .returning('id')
          .executeTakeFirstOrThrow());
      await db
        .insertInto('dcc_attendance')
        .values({
          dcc_event_id: event.id,
          person_id: person.id,
          present: true,
          responsible_leader_id: responsible.id,
          recorded_by: pastor.id,
        })
        .execute();
    };

    beforeEach(async () => {
      manuel = await leader('Manuel', 'Bautista', oriel);
      mark = await leader('Mark', 'Ilagan', manuel);
      anacleto = await leader('Anacleto', 'Reyes', mark);
      ana = await leader('Ana', 'Cruz', oriel);
      benigno = await leader('Benigno', 'Santos', ana);
      cara = await leader('Cara', 'Flores', gemma);

      const markCell = await cellOf(mark, 'YOUTH', CREATED);
      const anaCell = await cellOf(ana, 'COUPLE', CREATED);

      // May: nothing changes. Saturdays are Cell days, Sundays DCC.
      await attend(await meeting(markCell, '2020-05-02', mark.id), anacleto);
      await attend(await meeting(anaCell, '2020-05-02', ana.id), benigno);
      await present('2020-05-03', anacleto, mark);
      await present('2020-05-03', benigno, ana);

      // June: Mark's and Ana's people attend, and then Manuel's assignment ends mid-month
      // with no successor, and he is archived at the same instant.
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);
      await attend(await meeting(anaCell, '2020-06-06', ana.id), benigno);
      await present('2020-06-07', anacleto, mark);
      await present('2020-06-07', benigno, ana);

      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: MID_JUNE })
        .where('person_id', '=', manuel.id)
        .where('ended_at', 'is', null)
        .execute();
      await archiveAt(manuel, MID_JUNE);
    });

    it('keeps a Primary whose assignment ended within the month as a row on CG and DCC attendance, carrying their branch, as on the # tabs', async () => {
      // The premise: Manuel holds no assignment in force at June's end.
      const open = await db
        .selectFrom('pastoral_assignments')
        .select('id')
        .where('person_id', '=', manuel.id)
        .where('ended_at', 'is', null)
        .execute();
      expect(open).toEqual([]);

      const counted = (await counts(pastor, JUNE).expect(200)).body as Counts;
      expect(rowOf(counted, manuel)).toBeDefined();

      for (const domain of ['cells', 'dcc'] as const) {
        const body = await attendance(domain, JUNE);

        // Oriel's two by surname (Bautista, Cruz), then Gemma's one.
        expect({
          domain,
          rows: body.rows.map((row) => [row.leader?.id, row.root_id]),
        }).toEqual({
          domain,
          rows: [
            [manuel.id, oriel.id],
            [ana.id, oriel.id],
            [cara.id, gemma.id],
          ],
        });

        // Manuel's row carries the person beneath him who attended, Anacleto.
        expect({ domain, people: twelveRowOf(body, manuel)?.unique_people }).toEqual({
          domain,
          people: 1,
        });
        expect({ domain, people: twelveRowOf(body, ana)?.unique_people }).toEqual({
          domain,
          people: 1,
        });
        // Nobody falls into the line under the tables.
        expect({ domain, elsewhere: body.elsewhere }).toEqual({ domain, elsewhere: 0 });

        // The same Primaries, under the same roots, as # of Cells for the month.
        expect({ domain, rows: pairsOfTwelve(body) }).toEqual({
          domain,
          rows: pairsOfCounts(counted),
        });
      }
    });

    it('still adds up to the whole-church total, rows and the lines under the tables', async () => {
      for (const month of [MAY, JUNE]) {
        const counted = (await counts(pastor, month).expect(200)).body as Counts;
        expectReconciles(counted);

        for (const domain of ['cells', 'dcc'] as const) {
          const body = await attendance(domain, month);
          const rows = body.rows.reduce((sum, row) => sum + row.unique_people, 0);
          expect({ domain, month, sum: rows - body.overlap + body.elsewhere }).toEqual({
            domain,
            month,
            sum: body.total.unique_people,
          });

          // The total is the plain Whole Church table's: the rows do not move it.
          const plain = await twelve(domain, month, false).expect(200);
          expect({ domain, month, total: body.total }).toEqual({
            domain,
            month,
            total: (plain.body as Twelve).total,
          });
          expect({ domain, month, people: body.total.unique_people }).toEqual({
            domain,
            month,
            people: 2,
          });
        }
      }
    });

    it('lists the same rows as before for a month in which nothing changed', async () => {
      const counted = (await counts(pastor, MAY).expect(200)).body as Counts;

      for (const domain of ['cells', 'dcc'] as const) {
        const body = await attendance(domain, MAY);

        expect({
          domain,
          rows: body.rows.map((row) => [row.leader?.id, row.root_id]),
        }).toEqual({
          domain,
          rows: [
            [manuel.id, oriel.id],
            [ana.id, oriel.id],
            [cara.id, gemma.id],
          ],
        });
        expect({ domain, people: twelveRowOf(body, manuel)?.unique_people }).toEqual({
          domain,
          people: 1,
        });
        expect({ domain, elsewhere: body.elsewhere }).toEqual({ domain, elsewhere: 0 });
        expect({ domain, rows: pairsOfTwelve(body) }).toEqual({
          domain,
          rows: pairsOfCounts(counted),
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Who may read them (SKILL.md section 7: the API is the sole authority)
  // ---------------------------------------------------------------------------

  describe('authorization', () => {
    it('refuses a Leader, with or without Full view, both routes, while no Admin account exists', async () => {
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

      // Full view holds reports.view_subtree over its own subtree,
      // which does not cover the church.
      for (const response of [
        await counts(withFullView, last),
        await trends(withFullView, { figure: 'CELLS' }),
        await trends(withFullView, { figure: 'CELLS', leader_id: ana.id }),
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
    });

    it('no longer has an Encounter candidates route (decision 0327)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/suynl/encounter-candidates')
        .set('Authorization', `Bearer ${pastor.accessToken}`)
        .expect(404);
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
      }
    });
  });
});
