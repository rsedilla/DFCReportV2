import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/reports/dcc/twelve` -- DCC's My 12 over a week, a month, a quarter or a year
 * (SKILL.md sections 9, 13 and 20; decision 0294).
 *
 * **Tested at the API**, because the API is the sole authority for authorization (section 7,
 * `CLAUDE.md` Definition of Done).
 *
 * **Every response carrying figures goes through `reconcile`**, the section 20 identities
 * this surface owes: in every row, in the own row and in the total, the five classification
 * buckets sum to `unique_people`; the People column adds up in plain sight --
 * `sum(rows) + own - overlap + elsewhere = total`; and, for a month, the attendance buckets
 * sum to the same total. A mismatch is a data-integrity defect, not a rounding issue.
 *
 * The tree is `CLAUDE.md`'s `Raymond -> Manuel -> Mark`, with two more direct disciples of
 * Raymond, Onofre and Pio, and a disciple under each of Mark and Onofre. Surnames are chosen
 * so surname order (Abella, Bautista, Zamora) differs from creation order and from any
 * figure. Oriel is the Women's root, and her surname (Abad) sorts before Raymond's (Alvarez),
 * which is what lets Network order be told apart from surname order on the whole-church
 * rows. All names are invented (`CLAUDE.md`, Secrets).
 *
 * 2020 is the reported year: closed, fixed and in the past. Its Sundays used here are
 * 5 April; 3, 10, 17, 24 and 31 May; 7, 14, 21 and 28 June; and 5 July. June's weeks
 * (decision 0054) begin on Monday the 1st, 8th, 15th, 22nd and 29th. Only the cases under
 * "a period still running" read the clock.
 */
describe('GET /api/v1/reports/dcc/twelve (sections 9, 13 and 20; decision 0294)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let onofre: TestPerson;
  let pio: TestPerson;
  let oriel: TestPerson;

  /** Mark's disciple. */
  let anacleto: TestPerson;
  /** Onofre's disciple. */
  let benigno: TestPerson;
  /** Oriel's disciple. */
  let carmelita: TestPerson;

  let adminAccount: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

  const JUNE = '2020-06-01';

  const ZERO = { vip: 0, second_timer: 0, third_timer: 0, fourth_timer: 0, regular: 0 };

  const twelve = (query: string, account?: TestAccount) => {
    const call = request(app.getHttpServer()).get(`/api/v1/reports/dcc/twelve?${query}`);

    return account === undefined
      ? call
      : call.set('Authorization', `Bearer ${account.accessToken}`);
  };

  const monthly = (query: string, account: TestAccount) =>
    request(app.getHttpServer())
      .get(`/api/v1/reports/dcc/monthly?${query}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  /** The calendar row for a Sunday, created on first use. */
  const events = new Map<string, string>();
  const eventOn = async (sunday: string): Promise<string> => {
    const known = events.get(sunday);
    if (known !== undefined) {
      return known;
    }
    const row = await db
      .insertInto('dcc_events')
      .values({ event_date: sunday })
      .returning('id')
      .executeTakeFirstOrThrow();
    events.set(sunday, row.id);

    return row.id;
  };

  /** Mark a Sunday removed, as the calendar route would: with an actor and a reason. */
  const removeSunday = async (sunday: string) => {
    await eventOn(sunday);
    await db
      .updateTable('dcc_events')
      .set({
        removed_at: new Date(),
        removed_by: adminAccount.id,
        removal_reason: 'No service was held.',
      })
      .where('event_date', '=', sunday)
      .execute();
  };

  /**
   * One present record. `leader` is the responsible leader frozen on the row; a Network
   * root's is null (section 9).
   */
  const present = async (sunday: string, person: TestPerson, leader: TestPerson | null) => {
    await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: await eventOn(sunday),
        person_id: person.id,
        present: true,
        responsible_leader_id: leader?.id ?? null,
        recorded_by: adminAccount.id,
      })
      .execute();
  };

  interface Figure {
    unique_people: number;
    classification: Record<keyof typeof ZERO, number>;
  }

  interface Bucket {
    times: number;
    people: number;
    completed: boolean;
  }

  interface Twelve {
    kind: string;
    start: string;
    end: string;
    open: boolean;
    coverage: { met: number; owed: number };
    n: number;
    removed_events: string[];
    rows: (Figure & {
      leader: { id: string; member_id: string; full_name: string } | null;
      network: 'MENS' | 'WOMENS' | null;
    })[];
    own: Figure | null;
    overlap: number;
    elsewhere: number;
    total: Figure;
    buckets: Bucket[] | null;
  }

  /**
   * The fields a refusal names. A DTO refusal carries `details.fields`; one thrown in code or
   * by the guard carries `details.field`. Read both, so a case cannot pass by reading a
   * property the path it took does not set.
   */
  const refusedFields = (body: {
    error: { details: { field?: string; fields?: { field: string }[] } };
  }): string[] =>
    body.error.details.field !== undefined
      ? [body.error.details.field]
      : [...new Set((body.error.details.fields ?? []).map((entry) => entry.field))];

  const classified = (figure: Figure): number =>
    Object.values(figure.classification).reduce((sum, count) => sum + count, 0);

  /**
   * Section 20's identities for this surface, asserted on every response that carries
   * figures. Returned so a case can go on to assert what it is about.
   */
  const reconcile = (body: Twelve): Twelve => {
    for (const figure of [...body.rows, ...(body.own === null ? [] : [body.own]), body.total]) {
      expect(classified(figure)).toBe(figure.unique_people);
    }

    const rows = body.rows.reduce((sum, row) => sum + row.unique_people, 0);
    const own = body.own?.unique_people ?? 0;
    expect(rows + own - body.overlap + body.elsewhere).toBe(body.total.unique_people);
    expect(body.overlap).toBeGreaterThanOrEqual(0);
    expect(body.elsewhere).toBeGreaterThanOrEqual(0);

    // Section 9: the buckets exist for a month only, and there they sum to the same total.
    if (body.kind === 'MONTH') {
      expect(body.buckets).not.toBeNull();
      if (body.n > 0) {
        expect(body.buckets!.reduce((sum, entry) => sum + entry.people, 0)).toBe(
          body.total.unique_people,
        );
      }
    } else {
      expect(body.buckets).toBeNull();
    }

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
    events.clear();

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

    await assignTo(db, raymond.id, null);
    await assignTo(db, oriel.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, pio.id, raymond.id);
    await assignTo(db, onofre.id, raymond.id);
    await assignTo(db, anacleto.id, mark.id);
    await assignTo(db, benigno.id, onofre.id);
    await assignTo(db, carmelita.id, oriel.id);

    adminAccount = await createAccount(app, db, { person: raymond, roles: ['ADMIN'] });
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  const juneOf = (person: TestPerson) =>
    `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=LEADER&leader_id=${person.id}`;
  const WHOLE_JUNE = `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=WHOLE_CHURCH`;

  // ---------------------------------------------------------------------------------------
  // The table
  // ---------------------------------------------------------------------------------------

  describe('the table', () => {
    it('lists the direct disciples in surname order, never by a figure (section 13)', async () => {
      // Onofre 2 (himself and Benigno), Manuel 1 (Anacleto), Pio 0: ascending by figure is
      // Pio first, descending is Onofre then Manuel then Pio -- and surname order is Abella,
      // Bautista, Zamora. Only the last passes this case with both figure orders excluded.
      await present('2020-06-07', onofre, raymond);
      await present('2020-06-07', benigno, onofre);
      await present('2020-06-14', anacleto, mark);

      const body = await ok(juneOf(raymond), adminAccount);

      expect(body.rows.map((row) => row.leader?.id)).toEqual([onofre.id, manuel.id, pio.id]);
      expect(body.rows.map((row) => row.unique_people)).toEqual([2, 1, 0]);
      expect(rowOf(body, onofre).leader?.full_name).toContain('Abella');
      expect(rowOf(body, onofre).leader?.member_id).toMatch(/^M-/);
      expect(rowOf(body, pio).classification).toEqual(ZERO);
      expect(body.rows.every((row) => row.network === null)).toBe(true);
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
      const body = await ok(juneOf(raymond), adminAccount);

      expect(body).toMatchObject({ kind: 'MONTH', start: JUNE, end: '2020-06-30', open: false });
    });

    it('makes the own row the subject alone: 1 when they came (decision 0294)', async () => {
      await present('2020-05-31', raymond, null);
      await present('2020-06-07', raymond, null);
      await present('2020-06-07', anacleto, mark);

      const body = await ok(juneOf(raymond), adminAccount);

      // Two visits by June's end, so a second timer, and nobody else is in the own row.
      expect(body.own).toEqual({ unique_people: 1, classification: { ...ZERO, second_timer: 1 } });
      expect(body.total.unique_people).toBe(2);
      expect(body.overlap).toBe(0);
      expect(body.elsewhere).toBe(0);
      // No `cells` on a DCC own row: it is the subject alone.
      expect(Object.keys(body.own!).sort()).toEqual(['classification', 'unique_people']);
    });

    it('makes the own row 0 when the subject did not come, though their disciples did', async () => {
      await present('2020-06-07', manuel, raymond);
      await present('2020-06-07', mark, manuel);

      const body = await ok(juneOf(raymond), adminAccount);

      expect(body.own).toEqual({ unique_people: 0, classification: ZERO });
      expect(rowOf(body, manuel).unique_people).toBe(2);
      expect(body.total.unique_people).toBe(2);
    });

    it('gives a leader with no disciples no rows and only their own row', async () => {
      await present('2020-06-07', pio, raymond);

      const body = await ok(juneOf(pio), adminAccount);

      expect(body.rows).toEqual([]);
      expect(body.own).toEqual({ unique_people: 1, classification: { ...ZERO, vip: 1 } });
      expect(body.total.unique_people).toBe(1);
    });

    it('makes each row that leader’s own figure, so opening it shows the same numbers', async () => {
      await present('2020-06-07', manuel, raymond);
      await present('2020-06-07', anacleto, mark);
      await present('2020-06-14', anacleto, mark);

      const raymonds = await ok(juneOf(raymond), adminAccount);
      const manuels = await ok(juneOf(manuel), manuelAccount);

      expect(rowOf(raymonds, manuel).unique_people).toBe(2);
      expect(rowOf(raymonds, manuel).unique_people).toBe(manuels.total.unique_people);
      expect(rowOf(raymonds, manuel).classification).toEqual(manuels.total.classification);
      // Manuel's own table: Mark carries Anacleto, and Manuel is his own row.
      expect(manuels.rows.map((row) => row.leader?.id)).toEqual([mark.id]);
      expect(rowOf(manuels, mark).unique_people).toBe(1);
      expect(manuels.own).toEqual({ unique_people: 1, classification: { ...ZERO, vip: 1 } });
    });

    it('counts, as elsewhere, people under a leader who left within the period', async () => {
      // Quirino was Raymond's disciple until mid-June and then held no assignment at all. He
      // is no row at June's end, but section 20 still places him and his disciple under
      // Raymond for June (decision 0209), so they are in the total and in no row.
      const quirino = await createPerson(db, {
        firstName: 'Quirino',
        lastName: 'Lopez',
        network: 'MENS',
      });
      const dionisio = await createPerson(db, {
        firstName: 'Dionisio',
        lastName: 'Herrera',
        network: 'MENS',
      });
      await assignTo(db, quirino.id, raymond.id);
      await assignTo(db, dionisio.id, quirino.id);
      await present('2020-06-07', dionisio, quirino);
      await present('2020-06-07', anacleto, mark);
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: new Date('2020-06-15T00:00:00+08:00') })
        .where('person_id', '=', quirino.id)
        .where('ended_at', 'is', null)
        .execute();

      const body = await ok(juneOf(raymond), adminAccount);

      expect(body.rows.map((row) => row.leader?.id)).not.toContain(quirino.id);
      expect(body.elsewhere).toBe(1);
      expect(body.total.unique_people).toBe(2);
    });

    it('gives a whole-church reader the two Network roots as rows, in Network order', async () => {
      await present('2020-06-07', carmelita, oriel);
      await present('2020-06-07', anacleto, mark);
      await present('2020-06-07', benigno, onofre);

      const body = await ok(WHOLE_JUNE, adminAccount);

      // Oriel Abad sorts before Raymond Alvarez by surname; MENS before WOMENS is the order.
      expect(body.rows.map((row) => [row.leader?.id, row.network])).toEqual([
        [raymond.id, 'MENS'],
        [oriel.id, 'WOMENS'],
      ]);
      expect(body.own).toBeNull();
      expect(rowOf(body, raymond).unique_people).toBe(2);
      expect(rowOf(body, oriel).unique_people).toBe(1);
      expect(body.total.unique_people).toBe(3);
      expect(body.elsewhere).toBe(0);
    });

    it('counts, as elsewhere in the whole church, somebody under neither root', async () => {
      // A Person holding no pastoral assignment. Section 9 would refuse the record through the
      // route; it is written directly so the whole-church total is shown to count it and the
      // rows are shown not to.
      const outsider = await createPerson(db, {
        firstName: 'Teodoro',
        lastName: 'Ignacio',
        network: 'MENS',
      });
      await present('2020-06-07', outsider, null);
      await present('2020-06-07', anacleto, mark);

      const body = await ok(WHOLE_JUNE, adminAccount);

      expect(rowOf(body, raymond).unique_people).toBe(1);
      expect(rowOf(body, oriel).unique_people).toBe(0);
      expect(body.elsewhere).toBe(1);
      expect(body.total.unique_people).toBe(2);
    });

    it('does not count a record marked absent', async () => {
      await db
        .insertInto('dcc_attendance')
        .values({
          dcc_event_id: await eventOn('2020-06-07'),
          person_id: benigno.id,
          present: false,
          responsible_leader_id: onofre.id,
          recorded_by: adminAccount.id,
        })
        .execute();

      const body = await ok(juneOf(raymond), adminAccount);

      expect(body.total.unique_people).toBe(0);
      expect(rowOf(body, onofre).unique_people).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  // A month is the monthly report
  // ---------------------------------------------------------------------------------------

  describe('a MONTH answers exactly what the monthly report answers', () => {
    beforeEach(async () => {
      // History before June, so the stages are not all VIP, a removed Sunday, and a
      // record on it that must count nowhere.
      await present('2020-05-24', anacleto, mark);
      await present('2020-05-31', anacleto, mark);
      await present('2020-05-31', benigno, onofre);
      await present('2020-06-07', anacleto, mark);
      await present('2020-06-07', benigno, onofre);
      await present('2020-06-14', anacleto, mark);
      await present('2020-06-14', raymond, null);
      await present('2020-06-21', carmelita, oriel);
      await present('2020-06-21', manuel, raymond);
      await eventOn('2020-06-28');
      await removeSunday('2020-06-21');
    });

    it.each([
      ['LEADER Raymond', () => `scope=LEADER&leader_id=${raymond.id}`],
      ['LEADER Manuel', () => `scope=LEADER&leader_id=${manuel.id}`],
      ['LEADER Onofre', () => `scope=LEADER&leader_id=${onofre.id}`],
      ['LEADER Mark', () => `scope=LEADER&leader_id=${mark.id}`],
      ['WHOLE_CHURCH', () => 'scope=WHOLE_CHURCH'],
    ])('%s', async (_label, selector) => {
      const month = await monthly(`period=${JUNE}&${selector()}`, adminAccount);
      const body = await ok(`kind=MONTH&start=${JUNE}&period=${JUNE}&${selector()}`, adminAccount);

      expect(month.status).toBe(200);
      expect(body.total.unique_people).toBe(month.body.unique_people);
      expect(body.total.classification).toEqual(month.body.classification);
      expect(body.buckets).toEqual(month.body.buckets);
      expect(body.coverage).toEqual(month.body.coverage);
      expect(body.n).toBe(month.body.n);
      expect(body.removed_events).toEqual(month.body.removed_events);
      expect(body.open).toBe(month.body.open);
    });

    it('leaves the removed Sunday out of N and lists it, and counts nobody on it', async () => {
      const body = await ok(WHOLE_JUNE, adminAccount);

      expect(body.n).toBe(3);
      expect(body.removed_events).toEqual(['2020-06-21']);
      // Carmelita and Manuel came only on the removed Sunday, so neither is anywhere.
      expect(body.total.unique_people).toBe(3);
      expect(rowOf(body, oriel).unique_people).toBe(0);
      // Anacleto: 24 May, 31 May, 7 June, 14 June. Benigno: 31 May, 7 June. Raymond: 14 June.
      expect(body.total.classification).toEqual({
        ...ZERO,
        vip: 1,
        second_timer: 1,
        fourth_timer: 1,
      });
      expect(body.buckets).toEqual([
        { times: 1, people: 2, completed: false },
        { times: 2, people: 1, completed: false },
        { times: 3, people: 0, completed: true },
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------
  // Weeks, quarters and years
  // ---------------------------------------------------------------------------------------

  describe('a WEEK is the same rule on its one Sunday', () => {
    const week = (start: string, period = JUNE) =>
      `kind=WEEK&start=${start}&period=${period}&scope=LEADER&leader_id=${raymond.id}`;

    beforeEach(async () => {
      await present('2020-05-31', anacleto, mark);
      await present('2020-06-07', anacleto, mark);
      await present('2020-06-14', anacleto, mark);
      await present('2020-06-14', benigno, onofre);
      await eventOn('2020-06-21');
    });

    it('counts only the week’s Sunday, at the stage reached by it', async () => {
      const first = await ok(week('2020-06-01'), adminAccount);
      const second = await ok(week('2020-06-08'), adminAccount);
      const third = await ok(week('2020-06-15'), adminAccount);

      expect(first).toMatchObject({ kind: 'WEEK', start: '2020-06-01', end: '2020-06-07', n: 1 });
      // The 31 May visit is before the week, so it is not counted in it and does set the stage.
      expect(first.total.unique_people).toBe(1);
      expect(first.total.classification).toEqual({ ...ZERO, second_timer: 1 });
      // A week that has passed never changes: the 14 June visit does not move week one.
      expect(second.total.unique_people).toBe(2);
      expect(second.total.classification).toEqual({ ...ZERO, vip: 1, third_timer: 1 });
      expect(rowOf(second, manuel).unique_people).toBe(1);
      expect(rowOf(second, onofre).unique_people).toBe(1);
      // A week with a service and nobody at it.
      expect(third.total).toEqual({ unique_people: 0, classification: ZERO });
      expect(third.n).toBe(1);
    });

    it('carries no buckets, which section 9 defines over a month', async () => {
      const body = await ok(week('2020-06-08'), adminAccount);

      expect(body.buckets).toBeNull();
    });

    it('reads a week crossing a month end as of the month holding its Sunday', async () => {
      await present('2020-07-05', benigno, onofre);

      const straddling = await ok(week('2020-06-29', '2020-07-01'), adminAccount);
      expect(straddling.end).toBe('2020-07-05');
      expect(straddling.total.classification).toEqual({ ...ZERO, second_timer: 1 });

      const refused = await twelve(week('2020-06-29', JUNE), adminAccount);
      expect(refused.status).toBe(422);
      expect(refused.body.error.details).toMatchObject({ field: 'period', expected: '2020-07-01' });
    });
  });

  describe('a QUARTER and a YEAR are the same rule on a longer one', () => {
    beforeEach(async () => {
      // Anacleto: 5 April, 7 June, 5 July. Benigno: 3 May only. Carmelita: 5 July only.
      await present('2020-04-05', anacleto, mark);
      await present('2020-05-03', benigno, onofre);
      await present('2020-06-07', anacleto, mark);
      await present('2020-07-05', anacleto, mark);
      await present('2020-07-05', carmelita, oriel);
    });

    it('counts those who came in the quarter, at the stage reached by its last day', async () => {
      const q2 = await ok(
        `kind=QUARTER&start=2020-04-01&period=${JUNE}&scope=WHOLE_CHURCH`,
        adminAccount,
      );
      const q3 = await ok(
        `kind=QUARTER&start=2020-07-01&period=2020-09-01&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(q2).toMatchObject({ start: '2020-04-01', end: '2020-06-30', open: false });
      // The July visit is after Q2's end, so Anacleto is a second timer in it, not a third.
      expect(q2.total.unique_people).toBe(2);
      expect(q2.total.classification).toEqual({ ...ZERO, vip: 1, second_timer: 1 });
      expect(q2.buckets).toBeNull();
      // Benigno came only in Q2, so he is not in Q3.
      expect(q3.total.unique_people).toBe(2);
      expect(q3.total.classification).toEqual({ ...ZERO, vip: 1, third_timer: 1 });
      expect(rowOf(q3, raymond).unique_people).toBe(1);
      expect(rowOf(q3, oriel).unique_people).toBe(1);
    });

    it('counts a closed year at its last day', async () => {
      const year = await ok(
        `kind=YEAR&start=2020-01-01&period=2020-12-01&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(year).toMatchObject({ start: '2020-01-01', end: '2020-12-31', open: false });
      expect(year.total.unique_people).toBe(3);
      expect(year.total.classification).toEqual({ ...ZERO, vip: 2, third_timer: 1 });
      expect(year.n).toBe(4);
      expect(year.buckets).toBeNull();
    });

    it('leaves a removed Sunday out of N and lists it', async () => {
      await eventOn('2020-05-10');
      await removeSunday('2020-06-07');

      const q2 = await ok(
        `kind=QUARTER&start=2020-04-01&period=${JUNE}&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      // 5 April, 3 May and 10 May stand; 7 June is removed and Anacleto's record on it with it.
      expect(q2.n).toBe(3);
      expect(q2.removed_events).toEqual(['2020-06-07']);
      expect(q2.total.classification).toEqual({ ...ZERO, vip: 2 });
    });
  });

  // ---------------------------------------------------------------------------------------
  // Coverage over a period (decision 0224, decision 0294)
  // ---------------------------------------------------------------------------------------

  describe('coverage over a period is the sum of its months', () => {
    const Q2_SUNDAYS = [
      '2020-04-05',
      '2020-04-12',
      '2020-04-19',
      '2020-04-26',
      '2020-05-03',
      '2020-05-10',
      '2020-05-17',
      '2020-05-24',
      '2020-05-31',
      '2020-06-07',
      '2020-06-14',
      '2020-06-21',
      '2020-06-28',
    ];

    beforeEach(async () => {
      for (const sunday of Q2_SUNDAYS) {
        await eventOn(sunday);
      }
      await removeSunday('2020-05-17');
      // A leader assigned mid-quarter owes from their assignment and not before it.
      const late = await createPerson(db, {
        firstName: 'Lucas',
        lastName: 'Ramos',
        network: 'MENS',
      });
      await assignTo(db, late.id, pio.id, new Date('2020-05-20T00:00:00+08:00'));

      await present('2020-04-05', mark, manuel);
      await present('2020-04-05', anacleto, mark);
      await present('2020-05-10', benigno, onofre);
      await present('2020-06-14', manuel, raymond);
      await present('2020-06-14', late, pio);
    });

    it.each([
      ['WHOLE_CHURCH', () => 'scope=WHOLE_CHURCH'],
      ['LEADER Raymond', () => `scope=LEADER&leader_id=${raymond.id}`],
      ['LEADER Manuel', () => `scope=LEADER&leader_id=${manuel.id}`],
    ])('%s', async (_label, selector) => {
      const quarter = await ok(
        `kind=QUARTER&start=2020-04-01&period=${JUNE}&${selector()}`,
        adminAccount,
      );

      let met = 0;
      let owed = 0;
      for (const month of ['2020-04-01', '2020-05-01', '2020-06-01']) {
        const response = await monthly(`period=${month}&${selector()}`, adminAccount);
        expect(response.status).toBe(200);
        met += response.body.coverage.met;
        owed += response.body.coverage.owed;
      }

      expect(quarter.coverage).toEqual({ met, owed });
      expect(quarter.coverage.owed).toBeGreaterThan(0);
      expect(quarter.n).toBe(12);
      expect(quarter.removed_events).toEqual(['2020-05-17']);
    });

    it('makes a week’s coverage its one Sunday’s', async () => {
      const body = await ok(
        `kind=WEEK&start=2020-06-08&period=${JUNE}&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      // On 14 June the leaders holding an edge are Raymond, Manuel, Mark, Onofre, Pio and
      // Oriel; Raymond's record for Manuel and Pio's for Lucas are two of the six.
      expect(body.coverage).toEqual({ met: 2, owed: 6 });
    });

    it('owes nothing for a removed Sunday', async () => {
      const body = await ok(
        `kind=WEEK&start=2020-05-11&period=2020-05-01&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(body.coverage).toEqual({ met: 0, owed: 0 });
      expect(body.n).toBe(0);
      expect(body.removed_events).toEqual(['2020-05-17']);
    });
  });

  // ---------------------------------------------------------------------------------------
  // A period still running
  // ---------------------------------------------------------------------------------------

  describe('a period still running', () => {
    let today: string;
    let currentMonth: string;

    const pad = (n: number) => String(n).padStart(2, '0');
    const addDays = (day: string, days: number): string => {
      const at = new Date(`${day}T00:00:00Z`);
      at.setUTCDate(at.getUTCDate() + days);
      return at.toISOString().slice(0, 10);
    };
    /** The first Sunday strictly after `day`. */
    const nextSunday = (day: string): string => {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      return addDays(day, 7 - weekday || 7);
    };

    beforeEach(async () => {
      today = manilaDayOf(await databaseNow(db));
      currentMonth = `${today.slice(0, 7)}-01`;
    });

    it('owes nothing for a Sunday that has not come', async () => {
      const year = today.slice(0, 4);
      const past = addDays(nextSunday(today), -14);
      const future = nextSunday(today);
      if (past.slice(0, 4) !== year || future.slice(0, 4) !== year) {
        // Only the first and last weeks of a year cannot hold both in one year.
        return;
      }
      await eventOn(past);
      const query = `kind=YEAR&start=${year}-01-01&period=${currentMonth}&scope=WHOLE_CHURCH`;

      const before = await ok(query, adminAccount);
      await eventOn(future);
      const after = await ok(query, adminAccount);

      expect(before.open).toBe(true);
      expect(before.coverage.owed).toBeGreaterThan(0);
      expect(after.coverage).toEqual(before.coverage);
      // The future Sunday is still on the calendar, so it is in N (section 9).
      expect(after.n).toBe(before.n + 1);
    });

    it('reads the running quarter as of the current month and says it is open', async () => {
      const [year, month] = today.split('-').map(Number);
      const firstMonth = month - ((month - 1) % 3);
      const start = `${year}-${pad(firstMonth)}-01`;

      const body = await ok(
        `kind=QUARTER&start=${start}&period=${currentMonth}&scope=WHOLE_CHURCH`,
        adminAccount,
      );
      expect(body.open).toBe(true);

      const refused = await twelve(
        `kind=QUARTER&start=${start}&period=${year - 1}-01-01&scope=WHOLE_CHURCH`,
        adminAccount,
      );
      expect(refused.status).toBe(422);
      expect(refused.body.error.details).toMatchObject({
        field: 'period',
        expected: currentMonth,
      });
      expect(refused.body).not.toHaveProperty('rows');
    });

    it.each(['WEEK', 'MONTH', 'QUARTER', 'YEAR'])(
      'refuses a %s that has not begun, naming start',
      async (kind) => {
        const [year, month] = today.split('-').map(Number);
        let start: string;
        if (kind === 'WEEK') {
          start = addDays(nextSunday(today), 1);
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
      },
    );
  });

  // ---------------------------------------------------------------------------------------
  // A Network (decision 0294, decision 0219)
  // ---------------------------------------------------------------------------------------

  /**
   * **A Network's figure is its membership, not its root's subtree**, exactly as the monthly
   * report counts it (decision 0219), and it has no rows: nothing is in a row, so the whole
   * total is `elsewhere` and section 20's identity still holds in plain sight.
   *
   * Teodoro holds no pastoral assignment and is in the Men's Network, so he is in no root's
   * subtree and is in the Men's figure. Rosa was in the Men's Network until 20 June and is in
   * the Women's from then, so the period's end places her in the Women's.
   */
  describe('a NETWORK subject', () => {
    const networkOf = (network: 'MENS' | 'WOMENS', kind = 'MONTH', start = JUNE, period = JUNE) =>
      `kind=${kind}&start=${start}&period=${period}&scope=NETWORK&network=${network}`;

    beforeEach(async () => {
      const teodoro = await createPerson(db, {
        firstName: 'Teodoro',
        lastName: 'Ignacio',
        network: 'MENS',
      });
      const rosa = await createPerson(db, {
        firstName: 'Rosa',
        lastName: 'Limbaga',
        network: 'MENS',
      });
      const switched = new Date('2020-06-20T00:00:00+08:00');
      await db
        .updateTable('network_assignments')
        .set({ ended_at: switched })
        .where('person_id', '=', rosa.id)
        .execute();
      await db
        .insertInto('network_assignments')
        .values({
          person_id: rosa.id,
          network: 'WOMENS',
          reason: 'A fixture standing in for a section 4 correction.',
          actor_id: null,
          started_at: switched,
        })
        .execute();

      for (const sunday of ['2020-04-05', '2020-05-03', '2020-06-07', '2020-06-14', '2020-06-21']) {
        await eventOn(sunday);
      }
      await removeSunday('2020-06-21');
      await present('2020-04-05', anacleto, mark);
      await present('2020-06-07', anacleto, mark);
      await present('2020-06-07', teodoro, null);
      await present('2020-06-07', rosa, null);
      await present('2020-06-14', carmelita, oriel);
      await present('2020-06-14', benigno, onofre);
      await present('2020-05-03', manuel, raymond);
    });

    it.each(['MENS', 'WOMENS'] as const)(
      '%s: a month answers what the monthly NETWORK report answers, with no rows',
      async (network) => {
        const month = await monthly(
          `period=${JUNE}&scope=NETWORK&network=${network}`,
          adminAccount,
        );
        const body = await ok(networkOf(network), adminAccount);

        expect(month.status).toBe(200);
        expect(body.rows).toEqual([]);
        expect(body.own).toBeNull();
        expect(body.overlap).toBe(0);
        expect(body.elsewhere).toBe(body.total.unique_people);
        expect(body.total.unique_people).toBe(month.body.unique_people);
        expect(body.total.classification).toEqual(month.body.classification);
        expect(body.buckets).toEqual(month.body.buckets);
        expect(body.coverage).toEqual(month.body.coverage);
        expect(body.n).toBe(month.body.n);
        expect(body.removed_events).toEqual(month.body.removed_events);
        expect(body.open).toBe(month.body.open);
      },
    );

    it('counts membership at the period’s end, not a root’s subtree', async () => {
      const mens = await ok(networkOf('MENS'), adminAccount);
      const womens = await ok(networkOf('WOMENS'), adminAccount);

      // Men's: Anacleto, Benigno and Teodoro, who is under no root. Women's: Carmelita, and
      // Rosa, who moved on the 20th.
      expect(mens.total.unique_people).toBe(3);
      expect(womens.total.unique_people).toBe(2);
      expect(mens.total.classification).toEqual({ ...ZERO, vip: 2, second_timer: 1 });
    });

    it('adds up, Men’s and Women’s, to the whole church (section 20)', async () => {
      for (const [kind, start, period] of [
        ['MONTH', JUNE, JUNE],
        ['WEEK', '2020-06-01', JUNE],
        ['QUARTER', '2020-04-01', JUNE],
        ['YEAR', '2020-01-01', '2020-12-01'],
      ]) {
        const mens = await ok(networkOf('MENS', kind, start, period), adminAccount);
        const womens = await ok(networkOf('WOMENS', kind, start, period), adminAccount);
        const whole = await ok(
          `kind=${kind}&start=${start}&period=${period}&scope=WHOLE_CHURCH`,
          adminAccount,
        );

        expect(mens.total.unique_people + womens.total.unique_people).toBe(
          whole.total.unique_people,
        );
        expect(mens.buckets === null).toBe(kind !== 'MONTH');
      }
    });

    it('sums its coverage over a quarter from the months', async () => {
      const quarter = await ok(networkOf('MENS', 'QUARTER', '2020-04-01', JUNE), adminAccount);

      let met = 0;
      let owed = 0;
      for (const month of ['2020-04-01', '2020-05-01', '2020-06-01']) {
        const response = await monthly(`period=${month}&scope=NETWORK&network=MENS`, adminAccount);
        expect(response.status).toBe(200);
        met += response.body.coverage.met;
        owed += response.body.coverage.owed;
      }

      expect(quarter.coverage).toEqual({ met, owed });
      expect(quarter.coverage.owed).toBeGreaterThan(0);
      expect(quarter.rows).toEqual([]);
    });

    it.each([
      ['Manuel', () => manuelAccount],
      ['Mark', () => markAccount],
    ])('refuses %s, whose grant is their own subtree, with no figures', async (_label, account) => {
      const response = await twelve(networkOf('MENS'), account());

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('total');
      expect(response.body).not.toHaveProperty('coverage');
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
        'a week not starting on a Monday',
        `kind=WEEK&start=2020-06-07&period=${JUNE}&scope=WHOLE_CHURCH`,
        'start',
      ],
      [
        'a quarter starting in May',
        `kind=QUARTER&start=2020-05-01&period=${JUNE}&scope=WHOLE_CHURCH`,
        'start',
      ],
      [
        'a month read as of another month',
        `kind=MONTH&start=${JUNE}&period=2020-07-01&scope=WHOLE_CHURCH`,
        'period',
      ],
      [
        'a closed year read as of June',
        `kind=YEAR&start=2020-01-01&period=${JUNE}&scope=WHOLE_CHURCH`,
        'period',
      ],
    ])('refuses %s, naming the field it breaks', async (_label, query, field) => {
      const response = await twelve(query, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(refusedFields(response.body)).toEqual([field]);
      expect(response.body).not.toHaveProperty('rows');
    });

    it('names the month it expects, and that month is accepted', async () => {
      const response = await twelve(
        `kind=QUARTER&start=2020-04-01&period=2020-04-01&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.details).toMatchObject({ field: 'period', expected: JUNE });

      await ok(`kind=QUARTER&start=2020-04-01&period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);
    });

    it('refuses a NETWORK scope that names no Network', async () => {
      const response = await twelve(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=NETWORK`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body).not.toHaveProperty('rows');
    });

    it('refuses a CELL scope, which the DCC report does not offer', async () => {
      const response = await twelve(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=CELL&cell_id=${raymond.id}`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(refusedFields(response.body)).toEqual(['query.scope']);
      expect(response.body).not.toHaveProperty('rows');
    });

    it('answers a Whole Church holder NOT_FOUND for a leader who does not exist', async () => {
      const response = await twelve(
        `kind=MONTH&start=${JUNE}&period=${JUNE}&scope=LEADER&leader_id=00000000-0000-4000-8000-000000000000`,
        adminAccount,
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------------------
  // Authorization (section 7)
  // ---------------------------------------------------------------------------------------

  describe('the same guard as the DCC monthly report', () => {
    beforeEach(async () => {
      await present('2020-06-07', benigno, onofre);
    });

    it('answers 401 with no token', async () => {
      const response = await twelve(juneOf(raymond));

      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('rows');
    });

    it('answers CAPABILITY_DENIED without reports.view_subtree', async () => {
      const grantless = await createAccount(app, db, { person: benigno, roles: [] });

      const response = await twelve(juneOf(benigno), grantless);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it.each([
      ['a sibling branch', () => onofre],
      ['their own upline', () => raymond],
    ])('refuses a leader %s, with no figures', async (_label, subject) => {
      const response = await twelve(juneOf(subject()), manuelAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('rows');
      expect(response.body).not.toHaveProperty('total');
      expect(response.body).not.toHaveProperty('coverage');
    });

    it('refuses WHOLE_CHURCH to a leader whose grant is their own subtree', async () => {
      const response = await twelve(WHOLE_JUNE, markAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('rows');
      expect(response.body).not.toHaveProperty('coverage');
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
      await ok(juneOf(subject()), manuelAccount);
    });
  });

  /**
   * **The guard reads a month; a week is read at its own Sunday** (decision 0214). For the
   * week of Monday 29 June to Sunday 5 July 2026 those are 31 July and 5 July, and Lucio
   * changes branch between them, on 20 July. Fixed dates in the past.
   */
  describe('the actor’s reach at the instant the figures were read', () => {
    it('refuses a week that ended before the leader joined the actor’s subtree', async () => {
      const lucio = await createPerson(db, {
        firstName: 'Lucio',
        lastName: 'Navarro',
        network: 'MENS',
      });
      const moved = new Date('2026-07-20T00:00:00+08:00');
      await assignTo(db, lucio.id, raymond.id);
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('pastoral_assignments')
          .set({ ended_at: moved })
          .where('person_id', '=', lucio.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('pastoral_assignments')
          .values({ person_id: lucio.id, leader_id: manuel.id, started_at: moved })
          .execute();
      });

      const week = `kind=WEEK&start=2026-06-29&period=2026-07-01&scope=LEADER&leader_id=${lucio.id}`;
      const refused = await twelve(week, manuelAccount);

      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('SCOPE_DENIED');
      expect(refused.body).not.toHaveProperty('rows');

      await ok(
        `kind=WEEK&start=2026-07-20&period=2026-07-01&scope=LEADER&leader_id=${lucio.id}`,
        manuelAccount,
      );
      await ok(week, adminAccount);
    });
  });
});
