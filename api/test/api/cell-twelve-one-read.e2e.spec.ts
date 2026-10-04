import request from 'supertest';
import { sql } from 'kysely';
import { Client } from 'pg';

import { endOfManilaDay, startOfManilaDay } from '../../src/common/time/manila';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * Cell Groups' My 12 over a period reads its people once rather than once per row
 * (checklist row perf-year-view), and answers exactly what the per-row reading answered.
 *
 * **The oracle is the per-row reading the report used before**: for each row, the people
 * present at a recorded meeting in the range whose responsible leader is in that row's
 * placement subtree, each with their lifetime attendance through the range's last day.
 * Its SQL is the former `CellFiguresService.rangeFigures`, kept here verbatim.
 *
 * Q2 2020 is closed and in the past, so no case reads the clock. The tree is
 * `Raymond -> { Manuel -> Mark, Onofre, Pio }` in the Men's Network and `Oriel` in the
 * Women's. Mark, Onofre, Manuel and Oriel lead Cells. Some people attend two Cells under two
 * rows, one attends before the quarter as well, and one of Onofre's meetings is frozen to Pio
 * after a handover. Names are invented (CLAUDE.md, Secrets).
 */
describe("Cell Groups' My 12 over a period, read once (perf-year-view)", () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let hierarchy: HierarchyService;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let onofre: TestPerson;
  let pio: TestPerson;
  let oriel: TestPerson;
  let admin: TestAccount;

  const FROM = '2020-04-01';
  const TO = '2020-06-30';

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    hierarchy = app.get(HierarchyService);
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    onofre = await createPerson(db, { firstName: 'Onofre', network: 'MENS' });
    pio = await createPerson(db, { firstName: 'Pio', network: 'MENS' });
    oriel = await createPerson(db, { firstName: 'Oriel', network: 'WOMENS' });
    await assignTo(db, raymond.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, onofre.id, raymond.id);
    await assignTo(db, pio.id, raymond.id);
    await assignTo(db, oriel.id, null);

    const member = async (firstName: string, network: 'MENS' | 'WOMENS', leader: TestPerson) => {
      const person = await createPerson(db, { firstName, network });
      await assignTo(db, person.id, leader.id);
      return person;
    };
    const anacleto = await member('Anacleto', 'MENS', mark);
    const benigno = await member('Benigno', 'MENS', onofre);
    const crisanto = await member('Crisanto', 'MENS', manuel);
    const dionisio = await member('Dionisio', 'MENS', pio);
    const elena = await member('Elena', 'WOMENS', oriel);

    admin = await createAccount(app, db, { person: oriel, roles: ['ADMIN'] });

    const createdAt = new Date('2020-01-01T00:00:00+08:00');
    const markCell = await createCell(db, { leader: mark, createdAt });
    const onofreCell = await createCell(db, { leader: onofre, createdAt });
    const manuelCell = await createCell(db, { leader: manuel, createdAt });
    const orielCell = await createCell(db, { leader: oriel, createdAt });

    const held = async (cellId: string, date: string, leader: TestPerson, people: TestPerson[]) => {
      const rows = await sql<{ id: string }>`
        INSERT INTO cell_meetings (
          cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
          status, responsible_leader_id
        )
        VALUES (
          ${cellId}::uuid, ${date}::date, '19:00'::time,
          ${date}::date - ((EXTRACT(ISODOW FROM ${date}::date)::integer) - 1),
          date_trunc('month', ${date}::date)::date,
          'HELD'::cell_meeting_status, ${leader.id}::uuid
        )
        RETURNING id
      `.execute(db);
      for (const person of people) {
        await db
          .insertInto('cell_attendance')
          .values({
            cell_meeting_id: rows.rows[0].id,
            person_id: person.id,
            present: true,
            recorded_by: admin.id,
          })
          .execute();
      }
    };

    // Before the quarter: lifetime counts carry across it.
    await held(markCell.id, '2020-03-07', mark, [anacleto, crisanto]);
    // In the quarter.
    await held(markCell.id, '2020-04-04', mark, [anacleto, crisanto, benigno]);
    await held(markCell.id, '2020-05-02', mark, [anacleto]);
    await held(onofreCell.id, '2020-04-11', onofre, [benigno, dionisio]);
    await held(onofreCell.id, '2020-06-06', pio, [benigno, crisanto]);
    await held(manuelCell.id, '2020-05-09', manuel, [crisanto, mark]);
    await held(orielCell.id, '2020-06-13', oriel, [elena, dionisio]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** The former `CellFiguresService.rangeFigures`, verbatim. */
  async function rangeFigures(leaders: readonly string[] | null) {
    const list = leaders === null ? null : [...leaders];
    const rows = await sql<{ person_id: string; lifetime: string }>`
      WITH scoped AS (
        SELECT id
          FROM cell_meetings
         WHERE scheduled_date BETWEEN ${FROM}::date AND ${TO}::date
           AND status IN ('HELD', 'RESCHEDULED')
           AND (${list}::uuid[] IS NULL OR responsible_leader_id = ANY (${list}::uuid[]))
      ),
      attended AS (
        SELECT DISTINCT a.person_id
          FROM scoped s
          JOIN cell_attendance a ON a.cell_meeting_id = s.id
         WHERE a.present = true
           AND a.superseded_at IS NULL
      )
      SELECT p.person_id, count(*)::text AS lifetime
        FROM attended p
        JOIN cell_attendance a ON a.person_id = p.person_id
        JOIN cell_meetings m ON m.id = a.cell_meeting_id
       WHERE a.present = true
         AND a.superseded_at IS NULL
         AND m.status IN ('HELD', 'RESCHEDULED')
         AND m.scheduled_date <= ${TO}::date
       GROUP BY p.person_id
    `.execute(db);
    return rows.rows.map((row) => ({ personId: row.person_id, lifetime: Number(row.lifetime) }));
  }

  const figureOf = (people: { lifetime: number }[]) => ({
    unique_people: people.length,
    classification: {
      vip: people.filter((p) => p.lifetime === 1).length,
      second_timer: people.filter((p) => p.lifetime === 2).length,
      third_timer: people.filter((p) => p.lifetime === 3).length,
      fourth_timer: people.filter((p) => p.lifetime === 4).length,
      regular: people.filter((p) => p.lifetime >= 5).length,
    },
  });

  /** The per-row reading, as the report did it before. */
  async function oracle(subject: TestPerson | null) {
    const end = endOfManilaDay(TO);
    const graph = await hierarchy.reportingGraph(db, startOfManilaDay(FROM), end);
    const rowIds =
      subject === null
        ? (await hierarchy.rootSeatsAsOf(db, end)).map((seat) => seat.personId)
        : await hierarchy.directChildrenAsOf(db, subject.id, end);

    const rows = new Map<string, ReturnType<typeof figureOf>>();
    const union = new Set<string>();
    let counted = 0;
    for (const leaderId of rowIds) {
      const people = await rangeFigures(graph.subtree(leaderId));
      rows.set(leaderId, figureOf(people));
      counted += people.length;
      people.forEach((p) => union.add(p.personId));
    }
    const own = subject === null ? null : await rangeFigures([subject.id]);
    for (const p of own ?? []) {
      counted += 1;
      union.add(p.personId);
    }
    const total = await rangeFigures(subject === null ? null : graph.subtree(subject.id));

    return {
      rows,
      own: own === null ? null : figureOf(own),
      overlap: counted - union.size,
      elsewhere: total.filter((p) => !union.has(p.personId)).length,
      total: figureOf(total),
    };
  }

  const report = async (subject: TestPerson | null) => {
    const scope = subject === null ? 'scope=WHOLE_CHURCH' : `scope=LEADER&leader_id=${subject.id}`;
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/cells/twelve?kind=QUARTER&start=${FROM}&period=2020-06-01&${scope}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(response.status).toBe(200);
    return response.body as {
      rows: { leader: { id: string } | null; unique_people: number; classification: object }[];
      own: { unique_people: number; classification: object } | null;
      overlap: number;
      elsewhere: number;
      total: { unique_people: number; classification: object };
    };
  };

  it.each([
    ['the whole church', () => null],
    ['Raymond', () => raymond],
    ['Manuel', () => manuel],
  ])('%s: every row, the own row and the total equal the per-row reading', async (_, who) => {
    const subject = who();
    const expected = await oracle(subject);
    const body = await report(subject);

    expect(
      body.rows.map((row) => ({
        leader: row.leader?.id,
        unique_people: row.unique_people,
        classification: row.classification,
      })),
    ).toEqual(
      body.rows.map((row) => ({ leader: row.leader?.id, ...expected.rows.get(row.leader!.id)! })),
    );
    expect(body.rows).toHaveLength(expected.rows.size);
    expect(
      body.own === null
        ? null
        : { unique_people: body.own.unique_people, classification: body.own.classification },
    ).toEqual(expected.own);
    expect({ overlap: body.overlap, elsewhere: body.elsewhere, total: body.total }).toEqual({
      overlap: expected.overlap,
      elsewhere: expected.elsewhere,
      total: expected.total,
    });
  });

  it('the fixture reaches what it is for: an overlap, a regular row and a handover', async () => {
    const raymondView = await oracle(raymond);
    expect(raymondView.overlap).toBeGreaterThan(0);
    // Pio's row holds the people of the meeting frozen to him after the handover.
    expect(raymondView.rows.get(pio.id)?.unique_people).toBe(2);
    // Anacleto attended before the quarter as well: a third timer by its end.
    expect(raymondView.total.classification.third_timer).toBeGreaterThan(0);
  });

  it('reads as many times for three rows as for one', async () => {
    const queries = async (subject: TestPerson) => {
      const spy = jest.spyOn(Client.prototype, 'query');
      await report(subject);
      const count = spy.mock.calls.length;
      spy.mockRestore();
      return count;
    };

    // Raymond's rows are Manuel, Onofre and Pio; Manuel's is Mark alone.
    expect(await queries(raymond)).toBe(await queries(manuel));
  });
});
