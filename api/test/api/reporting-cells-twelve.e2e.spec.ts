import request from 'supertest';

import { sql } from 'kysely';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
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
 * `GET /api/v1/reports/cells/twelve` -- My 12 over a week, a month, a quarter or a year
 * (SKILL.md sections 12, 13 and 20; decision 0293).
 *
 * **Tested at the API**, because the API is the sole authority for authorization (section 7,
 * `CLAUDE.md` Definition of Done).
 *
 * **Every response carrying figures goes through `reconcile`**, the section 20 identity this
 * surface owes: in every row, in the own row and in the total, the five classification
 * buckets sum to `unique_people`; and the People column adds up in plain sight --
 * `sum(rows) + own - overlap + elsewhere = total`. A mismatch is a data-integrity defect,
 * not a rounding issue.
 *
 * The tree is `CLAUDE.md`'s `Raymond -> Manuel -> Mark`, with two more direct disciples of
 * Raymond: Onofre, who leads a Cell, and Pio, who leads nothing. Surnames are chosen so that
 * surname order (Abella, Bautista, Zamora) differs from creation order **and** from the order
 * of any figure, which is what lets "surname order, never by a figure" (section 13) be told
 * apart from either sort. Oriel is the Women's root. All names are invented (`CLAUDE.md`,
 * Secrets).
 *
 * June 2020 is the reported month: closed, fixed and in the past. Its Saturdays --
 * `createCell`'s default meeting day -- are the 6th, 13th, 20th and 27th, and its weeks
 * (decision 0054) begin on Monday the 1st, 8th, 15th, 22nd and 29th. Only the cases under
 * "a period still running" read the clock.
 */
describe('GET /api/v1/reports/cells/twelve (sections 12, 13 and 20; decision 0293)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let onofre: TestPerson;
  let pio: TestPerson;
  let oriel: TestPerson;

  let anacleto: TestPerson;
  let benigno: TestPerson;
  let carmelita: TestPerson;
  let dionisio: TestPerson;

  let adminAccount: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

  let markCell: string;
  let onofreCell: string;

  const JUNE = '2020-06-01';
  const BEFORE = new Date('2020-05-01T00:00:00+08:00');

  const ZERO = { vip: 0, second_timer: 0, third_timer: 0, fourth_timer: 0, regular: 0 };

  const twelve = (query: string, account?: TestAccount) => {
    const call = request(app.getHttpServer()).get(`/api/v1/reports/cells/twelve?${query}`);

    return account === undefined
      ? call
      : call.set('Authorization', `Bearer ${account.accessToken}`);
  };

  const monthly = (query: string, account: TestAccount) =>
    request(app.getHttpServer())
      .get(`/api/v1/reports/cells/monthly?${query}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  /** One recorded meeting, with the derived columns computed by the database. */
  const meeting = async (cellId: string, scheduledDate: string, leaderId: string) => {
    const rows = await sql<{ id: string }>`
      INSERT INTO cell_meetings (
        cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
        status, responsible_leader_id
      )
      VALUES (
        ${cellId}::uuid, ${scheduledDate}::date, '19:00'::time,
        ${scheduledDate}::date - ((EXTRACT(ISODOW FROM ${scheduledDate}::date)::integer) - 1),
        date_trunc('month', ${scheduledDate}::date)::date,
        'HELD'::cell_meeting_status, ${leaderId}::uuid
      )
      RETURNING id
    `.execute(db);

    return rows.rows[0].id;
  };

  const attend = async (meetingId: string, ...people: TestPerson[]) => {
    for (const person of people) {
      await db
        .insertInto('cell_attendance')
        .values({
          cell_meeting_id: meetingId,
          person_id: person.id,
          present: true,
          recorded_by: adminAccount.id,
        })
        .execute();
    }
  };

  interface Figure {
    unique_people: number;
    classification: Record<keyof typeof ZERO, number>;
  }

  interface Twelve {
    kind: string;
    start: string;
    end: string;
    open: boolean;
    coverage: { recorded: number; scheduled: number; through: string };
    rows: (Figure & {
      leader: { id: string; member_id: string; full_name: string } | null;
      network: 'MENS' | 'WOMENS' | null;
    })[];
    own: (Figure & { cells: number }) | null;
    overlap: number;
    elsewhere: number;
    total: Figure;
  }

  /**
   * The fields a refusal names. A DTO refusal carries `details.fields`, an array built by the
   * global validation pipe; one thrown in code or by the guard carries `details.field`. Read
   * both, so a case cannot pass by reading a property the path it took does not set.
   */
  const refusedFields = (body: {
    error: { details: { field?: string; fields?: { field: string }[] } };
  }): string[] =>
    body.error.details.field !== undefined
      ? [body.error.details.field]
      : [...new Set((body.error.details.fields ?? []).map((entry) => entry.field))];

  const bucketSum = (figure: Figure): number =>
    Object.values(figure.classification).reduce((sum, count) => sum + count, 0);

  /**
   * Section 20's two identities for this surface, asserted on every response that carries
   * figures. Returned so a case can go on to assert what it is about.
   */
  const reconcile = (body: Twelve): Twelve => {
    for (const figure of [...body.rows, ...(body.own === null ? [] : [body.own]), body.total]) {
      expect(bucketSum(figure)).toBe(figure.unique_people);
    }

    const rows = body.rows.reduce((sum, row) => sum + row.unique_people, 0);
    const own = body.own?.unique_people ?? 0;
    expect(rows + own - body.overlap + body.elsewhere).toBe(body.total.unique_people);
    expect(body.overlap).toBeGreaterThanOrEqual(0);
    expect(body.elsewhere).toBeGreaterThanOrEqual(0);

    return body;
  };

  const ok = async (query: string, account: TestAccount): Promise<Twelve> => {
    const response = await twelve(query, account);
    expect(response.status).toBe(200);

    return reconcile(response.body as Twelve);
  };

  const rowOf = (body: Twelve, person: TestPerson) => {
    const row = body.rows.find((candidate) => candidate.leader?.id === person.id);
    expect(row).toBeDefined();

    return row!;
  };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alvarez',
      network: 'MENS',
    });
    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Bautista', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    pio = await createPerson(db, { firstName: 'Pio', lastName: 'Zamora', network: 'MENS' });
    onofre = await createPerson(db, { firstName: 'Onofre', lastName: 'Abella', network: 'MENS' });
    oriel = await createPerson(db, { firstName: 'Oriel', lastName: 'Abad', network: 'WOMENS' });

    anacleto = await createPerson(db, {
      firstName: 'Anacleto',
      lastName: 'Espino',
      network: 'MENS',
    });
    benigno = await createPerson(db, { firstName: 'Benigno', lastName: 'Flores', network: 'MENS' });
    carmelita = await createPerson(db, {
      firstName: 'Carmelita',
      lastName: 'Garcia',
      network: 'WOMENS',
    });
    dionisio = await createPerson(db, {
      firstName: 'Dionisio',
      lastName: 'Herrera',
      network: 'MENS',
    });

    await assignTo(db, raymond.id, null);
    await assignTo(db, oriel.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, pio.id, raymond.id);
    await assignTo(db, onofre.id, raymond.id);

    adminAccount = await createAccount(app, db, { person: raymond, roles: ['ADMIN'] });
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    markCell = (await createCell(db, { leader: mark, createdAt: BEFORE })).id;
    onofreCell = (await createCell(db, { leader: onofre, createdAt: BEFORE })).id;
  });

  const raymondsJune = `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=LEADER&leader_id=`;

  // ---------------------------------------------------------------------------------------
  // The table
  // ---------------------------------------------------------------------------------------

  describe('the table', () => {
    it('lists the direct disciples in surname order, never by a figure (section 13)', async () => {
      // Onofre 2, Manuel 1, Pio 0: ascending by figure is Pio first, descending is Onofre
      // then Manuel then Pio -- and surname order is Abella, Bautista, Zamora. Only the
      // last passes this case.
      await attend(await meeting(onofreCell, '2020-06-06', onofre.id), anacleto, benigno);
      await attend(await meeting(markCell, '2020-06-13', mark.id), dionisio);

      const body = await ok(`${raymondsJune}${raymond.id}`, adminAccount);

      expect(body.rows.map((row) => row.leader?.id)).toEqual([onofre.id, manuel.id, pio.id]);
      expect(body.rows.map((row) => row.unique_people)).toEqual([2, 1, 0]);
      expect(rowOf(body, onofre).leader?.full_name).toContain('Abella');
      expect(rowOf(body, onofre).leader?.member_id).toMatch(/^M-/);
      expect(rowOf(body, pio).classification).toEqual(ZERO);
      expect(body.total.unique_people).toBe(3);
      // Section 13: no row number, no rank, no proportion.
      for (const row of body.rows) {
        expect(Object.keys(row).sort()).toEqual([
          'classification',
          'leader',
          'network',
          'unique_people',
        ]);
      }
      expect(JSON.stringify(body)).not.toMatch(/percent|rank|position/);
    });

    it('answers the period it was asked for, and says a closed one is closed', async () => {
      const body = await ok(`${raymondsJune}${raymond.id}`, adminAccount);

      expect(body).toMatchObject({ kind: 'MONTH', start: JUNE, end: '2020-06-30', open: false });
    });

    it('makes each row that leader’s own figure, so drilling in shows the same numbers', async () => {
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto, benigno);

      const raymonds = await ok(`${raymondsJune}${raymond.id}`, adminAccount);
      const manuels = await ok(`${raymondsJune}${manuel.id}`, manuelAccount);

      // Manuel's row in Raymond's table is Manuel's whole branch, which is Manuel's total.
      expect(rowOf(raymonds, manuel).unique_people).toBe(2);
      expect(rowOf(raymonds, manuel).unique_people).toBe(manuels.total.unique_people);
      expect(rowOf(raymonds, manuel).classification).toEqual(manuels.total.classification);
      // And Manuel's own table is his 12: Mark, carrying the same two people.
      expect(manuels.rows.map((row) => row.leader?.id)).toEqual([mark.id]);
      expect(rowOf(manuels, mark).unique_people).toBe(2);
    });

    it('gives a leader with no Cell an own row of no Cells and nobody', async () => {
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);

      const body = await ok(`${raymondsJune}${manuel.id}`, manuelAccount);

      expect(body.own).toEqual({ cells: 0, unique_people: 0, classification: ZERO });
    });

    it('counts a Cell whose recorded meeting the leader led, though it is scheduled under another', async () => {
      // Raymond ran one of Mark's meetings: its frozen responsible leader is Raymond, while
      // the Cell's schedule and leadership stay Mark's. A row with people never reads "no Cell".
      await attend(await meeting(markCell, '2020-06-06', raymond.id), anacleto);

      const body = await ok(`${raymondsJune}${raymond.id}`, adminAccount);

      expect(body.own).toEqual({ cells: 1, unique_people: 1, classification: { ...ZERO, vip: 1 } });
      expect(rowOf(body, manuel).unique_people).toBe(0);
    });

    it('counts a person at two of the leader’s own Cells once, and says there are two', async () => {
      const first = (await createCell(db, { leader: raymond, createdAt: BEFORE })).id;
      const second = (await createCell(db, { leader: raymond, createdAt: BEFORE })).id;
      await attend(await meeting(first, '2020-06-06', raymond.id), dionisio);
      await attend(await meeting(second, '2020-06-13', raymond.id), dionisio, benigno);

      const body = await ok(`${raymondsJune}${raymond.id}`, adminAccount);

      // Dionisio came twice, once to each, so he is one person at his second visit.
      expect(body.own).toEqual({
        cells: 2,
        unique_people: 2,
        classification: { ...ZERO, vip: 1, second_timer: 1 },
      });
      expect(body.total.unique_people).toBe(2);
      expect(body.overlap).toBe(0);
    });

    it('puts a person at Cells in two branches in both rows and once in the total', async () => {
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);
      await attend(await meeting(onofreCell, '2020-06-13', onofre.id), anacleto, benigno);

      const body = await ok(`${raymondsJune}${raymond.id}`, adminAccount);

      expect(rowOf(body, manuel).unique_people).toBe(1);
      expect(rowOf(body, onofre).unique_people).toBe(2);
      expect(body.overlap).toBe(1);
      expect(body.elsewhere).toBe(0);
      expect(body.total.unique_people).toBe(2);
      // Anacleto's stage is the same in both rows and the total: two visits by June's end.
      expect(rowOf(body, manuel).classification).toEqual({ ...ZERO, second_timer: 1 });
      expect(body.total.classification).toEqual({ ...ZERO, vip: 1, second_timer: 1 });
    });

    it('still reconciles when one person is in two rows and the own row as well', async () => {
      // SKILL.md section 20 says the table counts how many people are in more than one row;
      // it does not say what that line holds for a person in *three*. Only the identity
      // the Definition of Done requires is asserted here, which `reconcile` does.
      const own = (await createCell(db, { leader: raymond, createdAt: BEFORE })).id;
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);
      await attend(await meeting(onofreCell, '2020-06-06', onofre.id), anacleto);
      await attend(await meeting(own, '2020-06-13', raymond.id), anacleto);

      const body = await ok(`${raymondsJune}${raymond.id}`, adminAccount);

      expect(body.total.unique_people).toBe(1);
    });

    it('counts, as elsewhere, people under a leader who left within the period', async () => {
      // Quirino was Raymond's disciple until mid-June and then held no assignment at all.
      // He is no row at June's end, but section 20 still places him under Raymond for June
      // (decision 0209), so the people at his meetings are in the total and in no row.
      const quirino = await createPerson(db, {
        firstName: 'Quirino',
        lastName: 'Lopez',
        network: 'MENS',
      });
      await assignTo(db, quirino.id, raymond.id);
      const quirinoCell = (await createCell(db, { leader: quirino, createdAt: BEFORE })).id;
      await attend(await meeting(quirinoCell, '2020-06-06', quirino.id), dionisio);
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: new Date('2020-06-15T00:00:00+08:00') })
        .where('person_id', '=', quirino.id)
        .where('ended_at', 'is', null)
        .execute();

      const body = await ok(`${raymondsJune}${raymond.id}`, adminAccount);

      expect(body.rows.map((row) => row.leader?.id)).not.toContain(quirino.id);
      expect(body.elsewhere).toBe(1);
      expect(body.total.unique_people).toBe(2);
    });

    it('splits a Cell handed over mid-period by meeting', async () => {
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);
      await db.transaction().execute(async (trx) => {
        const at = new Date('2020-06-15T00:00:00+08:00');
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: at })
          .where('cell_id', '=', markCell)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ cell_id: markCell, person_id: onofre.id, started_at: at })
          .execute();
      });
      await attend(await meeting(markCell, '2020-06-20', onofre.id), benigno);

      const body = await ok(`${raymondsJune}${raymond.id}`, adminAccount);

      // Each meeting follows its frozen responsible leader (section 20).
      expect(rowOf(body, manuel).unique_people).toBe(1);
      expect(rowOf(body, onofre).unique_people).toBe(1);
      expect(body.total.unique_people).toBe(2);
    });

    it('gives a whole-church reader the Network roots as rows, and no own row', async () => {
      const orielCell = (await createCell(db, { leader: oriel, createdAt: BEFORE })).id;
      await attend(await meeting(orielCell, '2020-06-06', oriel.id), carmelita);
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto, benigno);

      const body = await ok(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      // Labelled by Network, so in that order rather than by surname (decision 0293).
      expect(body.rows.map((row) => [row.leader?.id, row.network])).toEqual([
        [raymond.id, 'MENS'],
        [oriel.id, 'WOMENS'],
      ]);
      expect(body.own).toBeNull();

      // A leader's rows are their disciples, and carry no Network.
      const leader = await ok(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=LEADER&leader_id=${raymond.id}`,
        adminAccount,
      );
      expect(leader.rows.every((row) => row.network === null)).toBe(true);
      expect(rowOf(body, oriel).unique_people).toBe(1);
      expect(rowOf(body, raymond).unique_people).toBe(2);
      expect(body.total.unique_people).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------------------
  // A month is the monthly report
  // ---------------------------------------------------------------------------------------

  describe('a MONTH answers exactly what the monthly report answers', () => {
    beforeEach(async () => {
      // History before June, so the stages are not all VIP: Anacleto is a fourth timer by
      // June's end, Benigno a second timer, Dionisio a VIP.
      await attend(await meeting(markCell, '2020-05-02', mark.id), anacleto);
      await attend(await meeting(markCell, '2020-05-09', mark.id), anacleto, benigno);
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto, benigno);
      await attend(await meeting(onofreCell, '2020-06-13', onofre.id), dionisio, anacleto);
    });

    it.each([
      ['LEADER Raymond', () => `scope=LEADER&leader_id=${raymond.id}`],
      ['LEADER Manuel', () => `scope=LEADER&leader_id=${manuel.id}`],
      ['LEADER Onofre', () => `scope=LEADER&leader_id=${onofre.id}`],
      ['WHOLE_CHURCH', () => 'scope=WHOLE_CHURCH'],
    ])('%s', async (_label, selector) => {
      const month = await monthly(`period=${JUNE}&${selector()}`, adminAccount);
      const body = await ok(`kind=MONTH&start=${JUNE}&period=${JUNE}&${selector()}`, adminAccount);

      expect(month.status).toBe(200);
      expect(body.total.unique_people).toBe(month.body.unique_people);
      expect(body.total.classification).toEqual(month.body.classification);
      expect(body.coverage).toEqual({ ...month.body.coverage, through: '2020-06-30' });
      expect(body.open).toBe(month.body.open);
    });

    it('classifies at the end of the period, across both Cells', async () => {
      const body = await ok(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      // Anacleto: 2 May, 9 May, 6 June, 13 June. Benigno: 9 May, 6 June. Dionisio: 13 June.
      expect(body.total.classification).toEqual({
        ...ZERO,
        vip: 1,
        second_timer: 1,
        fourth_timer: 1,
      });
    });
  });

  // ---------------------------------------------------------------------------------------
  // Weeks, quarters and years
  // ---------------------------------------------------------------------------------------

  describe('a WEEK is the same rule on a shorter period (section 12, decision 0293)', () => {
    const week = (start: string, period = JUNE) =>
      `kind=WEEK&start=${start}&period=${period}&scope=LEADER&leader_id=${raymond.id}`;

    it('counts each person at the stage they had reached by that Sunday', async () => {
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);
      await attend(await meeting(markCell, '2020-06-13', mark.id), anacleto);

      const first = await ok(week('2020-06-01'), adminAccount);
      const second = await ok(week('2020-06-08'), adminAccount);

      expect(first).toMatchObject({ kind: 'WEEK', start: '2020-06-01', end: '2020-06-07' });
      // A week that has passed never changes: the later visit does not move week one.
      expect(first.total.classification).toEqual({ ...ZERO, vip: 1 });
      expect(second.total.classification).toEqual({ ...ZERO, second_timer: 1 });
    });

    it('does not count a meeting scheduled on the following Monday', async () => {
      const mondays = (await createCell(db, { leader: onofre, createdAt: BEFORE, dayOfWeek: 1 }))
        .id;
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);
      await attend(await meeting(mondays, '2020-06-08', onofre.id), benigno);

      const first = await ok(week('2020-06-01'), adminAccount);
      const second = await ok(week('2020-06-08'), adminAccount);

      expect(first.total.unique_people).toBe(1);
      expect(rowOf(first, onofre).unique_people).toBe(0);
      expect(second.total.unique_people).toBe(1);
      expect(rowOf(second, onofre).unique_people).toBe(1);
    });

    it('counts the week’s scheduled meetings for its coverage', async () => {
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);

      const body = await ok(week('2020-06-01'), adminAccount);

      // One Saturday in the week, two Cells, one recorded.
      expect(body.coverage).toEqual({ recorded: 1, scheduled: 2, through: '2020-06-07' });
    });

    it('reads a week crossing a month end as of the month holding its Sunday', async () => {
      const straddling = await ok(week('2020-06-29', '2020-07-01'), adminAccount);
      expect(straddling.end).toBe('2020-07-05');

      const refused = await twelve(week('2020-06-29', JUNE), adminAccount);
      expect(refused.status).toBe(422);
      expect(refused.body.error.details.field).toBe('period');
    });
  });

  describe('a QUARTER and a YEAR are the same rule on a longer one', () => {
    beforeEach(async () => {
      await attend(await meeting(markCell, '2020-05-02', mark.id), anacleto);
      await attend(await meeting(markCell, '2020-06-06', mark.id), anacleto);
      await attend(await meeting(markCell, '2020-07-04', mark.id), anacleto);
    });

    it('classifies a quarter at its last day, and a month inside it at the month’s', async () => {
      const quarter = await ok(
        `kind=QUARTER&start=2020-04-01&period=${JUNE}&scope=WHOLE_CHURCH`,
        adminAccount,
      );
      const may = await ok(
        `kind=MONTH&start=2020-05-01&period=2020-05-01&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(quarter).toMatchObject({ start: '2020-04-01', end: '2020-06-30', open: false });
      expect(quarter.total.classification).toEqual({ ...ZERO, second_timer: 1 });
      expect(may.total.classification).toEqual({ ...ZERO, vip: 1 });
    });

    it('classifies a closed year at its last day', async () => {
      const year = await ok(
        `kind=YEAR&start=2020-01-01&period=2020-12-01&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(year).toMatchObject({ start: '2020-01-01', end: '2020-12-31', open: false });
      expect(year.total.unique_people).toBe(1);
      expect(year.total.classification).toEqual({ ...ZERO, third_timer: 1 });
    });
  });

  describe('a period still running', () => {
    let today: string;
    let currentMonth: string;

    const pad = (n: number) => String(n).padStart(2, '0');

    beforeEach(async () => {
      today = manilaDayOf(await databaseNow(db));
      currentMonth = `${today.slice(0, 7)}-01`;
    });

    /** Saturdays from `from` to `to`, inclusive, counted without the code under test. */
    const saturdays = (from: string, to: string): number => {
      let count = 0;
      for (
        let day = new Date(`${from}T00:00:00Z`);
        day <= new Date(`${to}T00:00:00Z`);
        day.setUTCDate(day.getUTCDate() + 1)
      ) {
        if (day.getUTCDay() === 6) {
          count += 1;
        }
      }
      return count;
    };

    const lastDayOf = (month: string): string => {
      const [year, m] = month.split('-').map(Number);
      return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
    };

    it('reads the running quarter as of the current month and says it is open', async () => {
      const [year, month] = today.split('-').map(Number);
      const firstMonth = month - ((month - 1) % 3);
      const start = `${year}-${pad(firstMonth)}-01`;

      const body = await ok(
        `kind=QUARTER&start=${start}&period=${currentMonth}&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(body.open).toBe(true);
      expect(body.end).toBe(lastDayOf(`${year}-${pad(firstMonth + 2)}-01`));

      // Any other month is refused, so a client cannot choose the instant its own
      // authorization is decided at.
      const refused = await twelve(
        `kind=QUARTER&start=${start}&period=${year - 1}-01-01&scope=WHOLE_CHURCH`,
        adminAccount,
      );
      expect(refused.status).toBe(422);
      expect(refused.body.error.details.field).toBe('period');
      // The refusal names the month it wants, which is what the client retries with.
      expect(refused.body.error.details.expected).toBe(currentMonth);
    });

    it('stops a running year’s coverage at the end of the current month', async () => {
      const year = today.slice(0, 4);

      const body = await ok(
        `kind=YEAR&start=${year}-01-01&period=${currentMonth}&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(body).toMatchObject({ start: `${year}-01-01`, end: `${year}-12-31`, open: true });
      // Two Saturday Cells, both running since 2020, and nothing recorded this year.
      // `through` names the last day counted, so a client can say the year is due so far.
      expect(body.coverage).toEqual({
        recorded: 0,
        scheduled: 2 * saturdays(`${year}-01-01`, lastDayOf(currentMonth)),
        through: lastDayOf(currentMonth),
      });
      if (!currentMonth.endsWith('-12-01')) {
        expect(body.coverage.scheduled).toBeLessThan(
          2 * saturdays(`${year}-01-01`, `${year}-12-31`),
        );

        // December has not begun, so the guard may not be asked about it.
        const december = await twelve(
          `kind=YEAR&start=${year}-01-01&period=${year}-12-01&scope=WHOLE_CHURCH`,
          adminAccount,
        );
        expect(december.status).toBe(422);
        expect(december.body.error.details.field).toBe('period');
      }
    });

    it.each([
      ['WEEK', 'the next Monday'],
      ['MONTH', 'the next month'],
      ['QUARTER', 'the next quarter'],
      ['YEAR', 'the next year'],
    ])('refuses a %s that has not begun (%s), naming start', async (kind) => {
      const [year, month, day] = today.split('-').map(Number);
      const at = new Date(Date.UTC(year, month - 1, day));
      let start: string;
      if (kind === 'WEEK') {
        const ahead = (8 - at.getUTCDay()) % 7 || 7;
        at.setUTCDate(at.getUTCDate() + ahead);
        start = at.toISOString().slice(0, 10);
      } else if (kind === 'MONTH') {
        start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      } else if (kind === 'QUARTER') {
        const next = month - ((month - 1) % 3) + 3;
        start = new Date(Date.UTC(year, next - 1, 1)).toISOString().slice(0, 10);
      } else {
        start = `${year + 1}-01-01`;
      }

      const response = await twelve(
        `kind=${kind}&start=${start}&period=${currentMonth}&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('start');
      expect(response.body).not.toHaveProperty('rows');
    });
  });

  // ---------------------------------------------------------------------------------------
  // Refusals
  // ---------------------------------------------------------------------------------------

  describe('what the route refuses', () => {
    it.each([
      ['no kind', `start=${JUNE}&period=${JUNE}&scope=WHOLE_CHURCH`, 'kind'],
      ['an unknown kind', `kind=DAY&start=${JUNE}&period=${JUNE}&scope=WHOLE_CHURCH`, 'kind'],
      ['no start', `kind=MONTH&period=${JUNE}&scope=WHOLE_CHURCH`, 'start'],
      [
        'a start that is not a day',
        `kind=MONTH&start=2020-02-30&period=2020-02-01&scope=WHOLE_CHURCH`,
        'start',
      ],
      [
        'a week not starting on a Monday',
        `kind=WEEK&start=2020-06-02&period=${JUNE}&scope=WHOLE_CHURCH`,
        'start',
      ],
      [
        'a month not starting on its first',
        `kind=MONTH&start=2020-06-02&period=${JUNE}&scope=WHOLE_CHURCH`,
        'start',
      ],
      [
        'a quarter starting in May',
        `kind=QUARTER&start=2020-05-01&period=${JUNE}&scope=WHOLE_CHURCH`,
        'start',
      ],
      [
        'a quarter starting on the 2nd',
        `kind=QUARTER&start=2020-04-02&period=${JUNE}&scope=WHOLE_CHURCH`,
        'start',
      ],
      [
        'a year starting in February',
        `kind=YEAR&start=2020-02-01&period=2020-12-01&scope=WHOLE_CHURCH`,
        'start',
      ],
      [
        'a period that is not a month',
        `kind=MONTH&start=${JUNE}&period=2020-06-15&scope=WHOLE_CHURCH`,
        'query.period',
      ],
      [
        'a month read as of another month',
        `kind=MONTH&start=${JUNE}&period=2020-07-01&scope=WHOLE_CHURCH`,
        'period',
      ],
      [
        'a quarter read as of its first month',
        `kind=QUARTER&start=2020-04-01&period=2020-04-01&scope=WHOLE_CHURCH`,
        'period',
      ],
      [
        'a closed year read as of June',
        `kind=YEAR&start=2020-01-01&period=${JUNE}&scope=WHOLE_CHURCH`,
        'period',
      ],
    ])('refuses %s, naming %s', async (_label, query, field) => {
      const response = await twelve(query, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(refusedFields(response.body)).toEqual([field]);
      expect(response.body).not.toHaveProperty('rows');
    });

    it.each([
      ['a month read as of another month', `kind=MONTH&start=${JUNE}&period=2020-07-01`, JUNE],
      [
        'a quarter read as of its first month',
        `kind=QUARTER&start=2020-04-01&period=2020-04-01`,
        JUNE,
      ],
      ['a closed year read as of June', `kind=YEAR&start=2020-01-01&period=${JUNE}`, '2020-12-01'],
      [
        'a week crossing a month end read as of its Monday’s month',
        `kind=WEEK&start=2020-06-29&period=${JUNE}`,
        '2020-07-01',
      ],
    ])('names the month it expects when %s', async (_label, query, expected) => {
      const response = await twelve(`${query}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.details).toMatchObject({ field: 'period', expected });

      // And that month is accepted.
      const period = new URLSearchParams(query);
      period.set('period', expected);
      await ok(`${period.toString()}&scope=WHOLE_CHURCH`, adminAccount);
    });

    it('refuses a CELL scope, which has members rather than disciples', async () => {
      const response = await twelve(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=CELL&cell_id=${markCell}`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('scope');
    });

    it('refuses a NETWORK scope at the guard', async () => {
      const response = await twelve(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=NETWORK&network=MENS`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('query.scope');
    });

    it('answers a Whole Church holder NOT_FOUND for a leader who does not exist', async () => {
      const response = await twelve(
        `${raymondsJune}00000000-0000-4000-8000-000000000000`,
        adminAccount,
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------------------
  // Authorization (section 7)
  // ---------------------------------------------------------------------------------------

  describe('the same guard as the Cell monthly report', () => {
    beforeEach(async () => {
      await attend(await meeting(onofreCell, '2020-06-06', onofre.id), anacleto);
    });

    it('answers 401 with no token', async () => {
      const response = await twelve(`${raymondsJune}${raymond.id}`);

      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('rows');
    });

    it('answers CAPABILITY_DENIED without reports.view_subtree', async () => {
      const grantless = await createAccount(app, db, { person: dionisio, roles: [] });

      const response = await twelve(`${raymondsJune}${dionisio.id}`, grantless);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it.each([
      ['a sibling branch', () => onofre],
      ['their own upline', () => raymond],
    ])('refuses a leader %s, with no figures', async (_label, subject) => {
      const response = await twelve(`${raymondsJune}${subject().id}`, manuelAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('rows');
      expect(response.body).not.toHaveProperty('total');
    });

    it('refuses WHOLE_CHURCH to a leader whose grant is their own subtree', async () => {
      const response = await twelve(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=WHOLE_CHURCH`,
        markAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('rows');
    });

    it('refuses scope before it validates the period, so a refusal discloses nothing', async () => {
      const response = await twelve(
        `kind=WEEK&start=2020-06-02&period=${JUNE}&scope=LEADER&leader_id=${onofre.id}`,
        manuelAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it.each([
      ['themselves', () => manuel],
      ['a disciple', () => mark],
    ])('admits a leader asking about %s', async (_label, subject) => {
      await ok(`${raymondsJune}${subject().id}`, manuelAccount);
    });
  });

  // ---------------------------------------------------------------------------------------
  // Reach at the instant the figures were read (decision 0214)
  // ---------------------------------------------------------------------------------------

  /**
   * **The guard reads a month; a week is read at its own Sunday.** The guard resolves the
   * selector at the end of the month holding the period's last day, and the route checks the
   * actor's reach again at the end of `min(period's last day, today)`. For the week of Monday
   * 29 June to Sunday 5 July 2026 those are 31 July and 5 July, and Lucio changes branch
   * between them, on 20 July. Fixed dates in the past, so the case does not drift.
   */
  describe('the actor’s reach at the instant the figures were read', () => {
    let lucio: TestPerson;

    const MOVED = new Date('2026-07-20T00:00:00+08:00');
    const WEEK_OF_29_JUNE = 'kind=WEEK&start=2026-06-29&period=2026-07-01';

    /** Close one pastoral row and open the next at the same instant, as a move does. */
    const reassign = async (personId: string, leaderId: string, at: Date) => {
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('pastoral_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', personId)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('pastoral_assignments')
          .values({ person_id: personId, leader_id: leaderId, started_at: at })
          .execute();
      });
    };

    const asManuel = (query: string) =>
      twelve(`${query}&scope=LEADER&leader_id=${lucio.id}`, manuelAccount);

    beforeEach(async () => {
      lucio = await createPerson(db, { firstName: 'Lucio', lastName: 'Navarro', network: 'MENS' });
    });

    it('refuses a week that ended before the leader joined the actor’s subtree', async () => {
      // Under Raymond until 20 July, then under Manuel. At 31 July -- the guard's instant --
      // Lucio is Manuel's; at 5 July he was not. The guard alone admitted this.
      await assignTo(db, lucio.id, raymond.id);
      await reassign(lucio.id, manuel.id, MOVED);

      const refused = await asManuel(WEEK_OF_29_JUNE);

      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('SCOPE_DENIED');
      expect(refused.body).not.toHaveProperty('rows');
      expect(refused.body).not.toHaveProperty('total');

      // The month, read at 31 July, and a week after the move are his to read.
      await ok(
        `kind=MONTH&start=2026-07-01&period=2026-07-01&scope=LEADER&leader_id=${lucio.id}`,
        manuelAccount,
      );
      await ok(
        `kind=WEEK&start=2026-07-20&period=2026-07-01&scope=LEADER&leader_id=${lucio.id}`,
        manuelAccount,
      );
      // Whole Church reads it throughout.
      await ok(`${WEEK_OF_29_JUNE}&scope=LEADER&leader_id=${lucio.id}`, adminAccount);
    });

    it('still refuses the converse, at the guard: a leader who left after the week ended', async () => {
      // Under Manuel until 20 July, then under Raymond. At 5 July Lucio was Manuel's, so the
      // instant check alone would admit this week -- but the guard reads 31 July first and
      // refuses. **This pins the code as it stands**: a week before a leader left the actor's
      // subtree is refused whenever the leader has left by the end of that week's month.
      await assignTo(db, lucio.id, manuel.id);
      await reassign(lucio.id, raymond.id, MOVED);

      const refused = await asManuel(WEEK_OF_29_JUNE);

      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('SCOPE_DENIED');
      expect(refused.body).not.toHaveProperty('rows');

      // A week wholly inside June is read as of June and admitted.
      await ok(
        `kind=WEEK&start=2026-06-22&period=2026-06-01&scope=LEADER&leader_id=${lucio.id}`,
        manuelAccount,
      );
    });
  });
});
