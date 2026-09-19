import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { sql } from 'kysely';

import { startOfNextManilaMonth } from '../../src/common/time/manila';
import { currentReportingMonth, databaseNow } from '../../src/common/time/submission-window';
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
 * `GET /api/v1/reports/dcc/monthly/by-leader` and `GET /api/v1/reports/cells/monthly/by-leader`
 * -- a report's coverage line listed by the leader who owns each obligation (SKILL.md
 * section 17, decision 0254; sections 7, 20 and 24; decisions 0214, 0216 and 0253).
 *
 * **Tested at the API**, because the API is the sole authority for authorization and the
 * naming rule is an authorization rule (`CLAUDE.md`, Definition of Done).
 *
 * **Reconciliation is the reason the list exists in this shape.** Decision 0254 replaced a
 * subtree drill-down that stopped adding up once somebody was reassigned inside the period.
 * Every case that builds figures asserts the §20 identity for this surface: the named rows
 * plus the unnamed line equal `total`, and `total` equals the monthly report's own coverage
 * line for the same scope and period. A mismatch is a data-integrity defect.
 *
 * The tree is `CLAUDE.md`'s `Raymond -> Manuel -> Mark`, with a sibling branch under Raymond
 * (Onofre) and a Women's root (Oriel). Surnames are chosen so name order differs from
 * creation order: Oriel **Abad** sorts before the reader, Raymond **Alvarez**, which is what
 * lets "reader first" be told apart from "sorted by name". All names are invented
 * (`CLAUDE.md`, Secrets).
 *
 * June 2026 is the reported month: closed, fixed, and in the past. Its Sundays are the 7th,
 * 14th, 21st and 28th, and its Saturdays (`createCell`'s default meeting day) the 6th,
 * 13th, 20th and 27th. Only the `open` and not-yet-begun cases read the clock.
 */
describe('Reports coverage by leader (section 17, decision 0254)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let onofre: TestPerson;
  let oriel: TestPerson;
  let anacleto: TestPerson;
  let pio: TestPerson;
  let lorna: TestPerson;

  let adminAccount: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

  const JUNE = '2026-06-01';
  const SUNDAYS = ['2026-06-07', '2026-06-14', '2026-06-21', '2026-06-28'];
  const BEFORE = new Date('2026-05-01T00:00:00+08:00');
  const MID_JUNE = new Date('2026-06-15T00:00:00+08:00');

  type Route = 'dcc' | 'cells';

  const call = (path: string, query: string, account: TestAccount) =>
    request(app.getHttpServer())
      .get(`/api/v1/reports/${path}?${query}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const byLeader = (route: Route, query: string, account: TestAccount) =>
    call(`${route}/monthly/by-leader`, query, account);

  /** The monthly report's own coverage line, as `{ filed, owed }`. */
  const monthlyCoverage = async (route: Route, query: string, account: TestAccount) => {
    const response = await call(`${route}/monthly`, query, account);
    expect(response.status).toBe(200);

    return route === 'dcc'
      ? { filed: response.body.coverage.met, owed: response.body.coverage.owed }
      : { filed: response.body.coverage.recorded, owed: response.body.coverage.scheduled };
  };

  interface Row {
    leader: { id: string; member_id: string; full_name: string };
    filed: number;
    owed: number;
  }

  /** Every page, walked by cursor, and the body of the first. */
  const allPages = async (route: Route, query: string, account: TestAccount, limit: number) => {
    const rows: Row[] = [];
    let cursor: string | null = null;
    let first: Record<string, unknown> | null = null;

    for (let guard = 0; guard < 50; guard += 1) {
      const response = await byLeader(
        route,
        `${query}&limit=${limit}${cursor === null ? '' : `&cursor=${cursor}`}`,
        account,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(limit);
      first ??= response.body;
      rows.push(...(response.body.data as Row[]));
      cursor = response.body.next_cursor;
      if (cursor === null) {
        return { rows, first: first as Record<string, unknown> };
      }
    }

    throw new Error('paging did not terminate');
  };

  /**
   * The §20 identity for this surface: rows plus the unnamed line equal `total`, and
   * `total` equals the monthly report's coverage line. Reads every row in one page.
   */
  const reconcile = async (route: Route, query: string, account: TestAccount) => {
    const response = await byLeader(route, `${query}&limit=200`, account);
    expect(response.status).toBe(200);
    expect(response.body.next_cursor).toBeNull();

    const rows = response.body.data as Row[];
    const others = response.body.others as { filed: number; owed: number } | null;
    const summed = rows.reduce(
      (sum, row) => ({ filed: sum.filed + row.filed, owed: sum.owed + row.owed }),
      others ?? { filed: 0, owed: 0 },
    );

    expect(summed).toEqual(response.body.total);
    expect(response.body.total).toEqual(await monthlyCoverage(route, query, account));

    return response.body as {
      period: string;
      open: boolean;
      data: Row[];
      others: { filed: number; owed: number } | null;
      total: { filed: number; owed: number };
      next_cursor: string | null;
    };
  };

  const rowOf = (rows: readonly Row[], person: TestPerson) =>
    rows.find((row) => row.leader.id === person.id);

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
    onofre = await createPerson(db, { firstName: 'Onofre', lastName: 'Delgado', network: 'MENS' });
    oriel = await createPerson(db, { firstName: 'Oriel', lastName: 'Abad', network: 'WOMENS' });
    anacleto = await createPerson(db, {
      firstName: 'Anacleto',
      lastName: 'Espino',
      network: 'MENS',
    });
    pio = await createPerson(db, { firstName: 'Pio', lastName: 'Fajardo', network: 'MENS' });
    lorna = await createPerson(db, {
      firstName: 'Lorna',
      lastName: 'Gatchalian',
      network: 'WOMENS',
    });

    await assignTo(db, raymond.id, null);
    await assignTo(db, oriel.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, onofre.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, anacleto.id, mark.id);
    await assignTo(db, pio.id, onofre.id);
    await assignTo(db, lorna.id, oriel.id);

    adminAccount = await createAccount(app, db, { person: raymond, roles: ['ADMIN'] });
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  // ---------------------------------------------------------------------------------------
  // DCC fixtures
  // ---------------------------------------------------------------------------------------

  const addSundays = async (): Promise<string[]> => {
    const ids: string[] = [];
    for (const sunday of SUNDAYS) {
      const row = await db
        .insertInto('dcc_events')
        .values({ event_date: sunday })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    }

    return ids;
  };

  const recordDcc = async (eventId: string, personId: string, leaderId: string) => {
    await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: personId,
        present: true,
        responsible_leader_id: leaderId,
        recorded_by: adminAccount.id,
      })
      .execute();
  };

  // ---------------------------------------------------------------------------------------
  // Cell fixtures
  // ---------------------------------------------------------------------------------------

  const cells: Record<string, string> = {};

  const addCells = async () => {
    for (const [name, leader] of [
      ['raymond', raymond],
      ['manuel', manuel],
      ['mark', mark],
      ['onofre', onofre],
      ['oriel', oriel],
    ] as const) {
      cells[name] = (await createCell(db, { leader, createdAt: BEFORE })).id;
    }
  };

  /** One recorded meeting on a scheduled date. */
  const recordMeeting = async (cellId: string, scheduledDate: string, leaderId: string) => {
    await sql`
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
    `.execute(db);
  };

  /** Mark's Cell passes to Onofre at one instant, the only shape migration 0009 admits. */
  const handOverMarksCell = async (at: Date) => {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: at })
        .where('cell_id', '=', cells.mark)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('cell_leaderships')
        .values({ cell_id: cells.mark, person_id: onofre.id, started_at: at })
        .execute();
    });
  };

  // ---------------------------------------------------------------------------------------
  // 1. Reconciliation (Definition of Done, section 20)
  // ---------------------------------------------------------------------------------------

  describe('the rows reconcile with the report (section 20)', () => {
    it.each([
      ['LEADER (Manuel, by Manuel)', () => [`scope=LEADER&leader_id=${manuel.id}`, manuelAccount]],
      ['LEADER (Raymond, by Admin)', () => [`scope=LEADER&leader_id=${raymond.id}`, adminAccount]],
      ['WHOLE_CHURCH', () => ['scope=WHOLE_CHURCH', adminAccount]],
      ['NETWORK MENS', () => ['scope=NETWORK&network=MENS', adminAccount]],
      ['NETWORK WOMENS', () => ['scope=NETWORK&network=WOMENS', adminAccount]],
    ] as const)('DCC at %s, with a reassignment and records', async (_name, args) => {
      const ids = await addSundays();
      await reassign(mark.id, onofre.id, MID_JUNE);
      await recordDcc(ids[0], mark.id, manuel.id);
      await recordDcc(ids[0], anacleto.id, mark.id);
      await recordDcc(ids[2], pio.id, onofre.id);
      await recordDcc(ids[3], lorna.id, oriel.id);

      const [scope, account] = args() as [string, TestAccount];
      const body = await reconcile('dcc', `period=${JUNE}&${scope}`, account);

      expect(body.total.owed).toBeGreaterThan(0);
    });

    it('DCC Whole Church carries every owner, with the expected own-obligation counts', async () => {
      const ids = await addSundays();
      await reassign(mark.id, onofre.id, MID_JUNE);
      await recordDcc(ids[0], mark.id, manuel.id);

      const body = await reconcile('dcc', `period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      // Raymond, Onofre, Mark and Oriel lead somebody at all four Sundays; Manuel only at
      // the 7th and 14th, before Mark moved. One obligation per leader-event (decision 0224).
      expect(body.total).toEqual({ filed: 1, owed: 18 });
      expect(rowOf(body.data, manuel)).toMatchObject({ filed: 1, owed: 2 });
      expect(rowOf(body.data, onofre)).toMatchObject({ filed: 0, owed: 4 });
      expect(body.others).toBeNull();
    });

    it.each([
      ['LEADER (Manuel, by Manuel)', () => [`scope=LEADER&leader_id=${manuel.id}`, manuelAccount]],
      ['LEADER (Raymond, by Admin)', () => [`scope=LEADER&leader_id=${raymond.id}`, adminAccount]],
      ['WHOLE_CHURCH', () => ['scope=WHOLE_CHURCH', adminAccount]],
      ['CELL', () => [`scope=CELL&cell_id=${cells.mark}`, adminAccount]],
    ] as const)('Cells at %s, with a handover, a reassignment and records', async (_n, args) => {
      await addCells();
      await handOverMarksCell(MID_JUNE);
      await reassign(onofre.id, manuel.id, new Date('2026-06-24T00:00:00+08:00'));
      await recordMeeting(cells.mark, '2026-06-06', mark.id);
      await recordMeeting(cells.mark, '2026-06-20', onofre.id);
      await recordMeeting(cells.manuel, '2026-06-13', manuel.id);
      await recordMeeting(cells.oriel, '2026-06-27', oriel.id);

      const [scope, account] = args() as [string, TestAccount];
      const body = await reconcile('cells', `period=${JUNE}&${scope}`, account);

      expect(body.total.owed).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  // 2. Each row counts only that leader's own obligations
  // ---------------------------------------------------------------------------------------

  describe("each row counts that leader's own obligations (decision 0254, clause 2)", () => {
    it('DCC: recording one line moves only its owner', async () => {
      const ids = await addSundays();
      const query = `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`;

      const before = await reconcile('dcc', query, manuelAccount);
      expect(rowOf(before.data, manuel)).toMatchObject({ filed: 0, owed: 4 });
      expect(rowOf(before.data, mark)).toMatchObject({ filed: 0, owed: 4 });

      await recordDcc(ids[1], anacleto.id, mark.id);

      const after = await reconcile('dcc', query, manuelAccount);
      expect(rowOf(after.data, mark)).toMatchObject({ filed: 1, owed: 4 });
      expect(rowOf(after.data, manuel)).toMatchObject({ filed: 0, owed: 4 });

      // A row is the owner's own obligations, not their branch: Manuel's own report counts
      // Mark's too, so it shows a larger figure than Manuel's row (clause 3).
      expect(after.total).toEqual({ filed: 1, owed: 8 });
    });

    it('Cells: recording one meeting moves only its owner', async () => {
      await addCells();
      const query = `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`;

      const before = await reconcile('cells', query, manuelAccount);
      expect(rowOf(before.data, manuel)).toMatchObject({ filed: 0, owed: 4 });
      expect(rowOf(before.data, mark)).toMatchObject({ filed: 0, owed: 4 });

      await recordMeeting(cells.mark, '2026-06-13', mark.id);

      const after = await reconcile('cells', query, manuelAccount);
      expect(rowOf(after.data, mark)).toMatchObject({ filed: 1, owed: 4 });
      expect(rowOf(after.data, manuel)).toMatchObject({ filed: 0, owed: 4 });
      expect(after.total).toEqual({ filed: 1, owed: 8 });
    });
  });

  // ---------------------------------------------------------------------------------------
  // 3. A mid-period change leaves each obligation with its owner on the date
  // ---------------------------------------------------------------------------------------

  describe('a mid-period change keeps each obligation with its owner on the date', () => {
    it('DCC: a reassignment splits the leader-events and the rows still sum', async () => {
      await addSundays();
      await reassign(mark.id, onofre.id, MID_JUNE);

      const body = await reconcile('dcc', `period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      // Manuel owed for Mark on the 7th and 14th only; the move neither erases those nor
      // hands them to Onofre, who owes one per Sunday for Pio regardless.
      expect(rowOf(body.data, manuel)?.owed).toBe(2);
      expect(rowOf(body.data, onofre)?.owed).toBe(4);
      expect(rowOf(body.data, mark)?.owed).toBe(4);
    });

    it('Cells: a handover splits the scheduled meetings by date and the rows still sum', async () => {
      await addCells();
      await handOverMarksCell(MID_JUNE);
      await recordMeeting(cells.mark, '2026-06-20', onofre.id);

      const body = await reconcile('cells', `period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      // The 6th and 13th stay with Mark; the 20th and 27th are Onofre's, on top of his own.
      expect(rowOf(body.data, mark)).toMatchObject({ filed: 0, owed: 2 });
      expect(rowOf(body.data, onofre)).toMatchObject({ filed: 1, owed: 6 });
      expect(body.total).toEqual({ filed: 1, owed: 20 });
    });
  });

  // ---------------------------------------------------------------------------------------
  // 4. Naming: a leader the reader could not open is folded into `others`
  // ---------------------------------------------------------------------------------------

  describe('a row is named only where the reader could open it (clause 4, decision 0214)', () => {
    it('DCC: nothing is folded where every owner is within reach, and others is null', async () => {
      await addSundays();

      const body = await reconcile(
        'dcc',
        `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
        manuelAccount,
      );

      expect(body.data.map((row) => row.leader.id)).toEqual([manuel.id, mark.id]);
      expect(body.others).toBeNull();
    });

    it('DCC: a leader who left the reader’s subtree by the period end is counted, not named', async () => {
      const ids = await addSundays();
      await reassign(mark.id, onofre.id, MID_JUNE);
      await recordDcc(ids[0], anacleto.id, mark.id);

      const body = await reconcile(
        'dcc',
        `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
        manuelAccount,
      );

      // Mark owed inside Manuel's scope on the 7th and 14th, and at June's final
      // millisecond is under Onofre, so the guard would refuse Manuel a LEADER=Mark report.
      expect(body.data.map((row) => row.leader.id)).toEqual([manuel.id]);
      expect(JSON.stringify(body)).not.toContain(mark.id);
      expect(body.others).toEqual({ filed: 1, owed: 2 });
      expect(body.total).toEqual({ filed: 1, owed: 4 });
    });

    // Naming is decided on the tree at the period's end, not today's: a move after June
    // changes nothing about who is named for June, in either direction.
    const JULY = new Date('2026-07-15T00:00:00+08:00');
    const setUpRoute = async (route: Route) => {
      if (route === 'dcc') {
        await addSundays();
      } else {
        await addCells();
      }
    };

    it.each(['dcc', 'cells'] as const)(
      '%s: a leader who moved away after the period is still named for it',
      async (route) => {
        await setUpRoute(route);
        await reassign(mark.id, onofre.id, JULY);

        const body = await reconcile(
          route,
          `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
          manuelAccount,
        );

        expect(body.data.map((row) => row.leader.id)).toEqual([manuel.id, mark.id]);
        expect(body.others).toBeNull();
      },
    );

    it.each(['dcc', 'cells'] as const)(
      '%s: a leader who came back after the period is not named for it',
      async (route) => {
        await setUpRoute(route);
        await reassign(mark.id, onofre.id, MID_JUNE);
        await reassign(mark.id, manuel.id, JULY);

        const body = await reconcile(
          route,
          `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
          manuelAccount,
        );

        expect(body.data.map((row) => row.leader.id)).toEqual([manuel.id]);
        expect(JSON.stringify(body)).not.toContain(mark.id);
        expect(body.others).not.toBeNull();
      },
    );

    it('DCC: a Network-scoped grantee is named every leader of its Network', async () => {
      await addSundays();
      const grantee = await networkGrantee('MENS');

      const body = await reconcile('dcc', `period=${JUNE}&scope=NETWORK&network=MENS`, grantee);

      expect(body.data.map((row) => row.leader.id).sort()).toEqual(
        [raymond.id, manuel.id, mark.id, onofre.id].sort(),
      );
      expect(body.others).toBeNull();
    });

    it('Cells: a leader who left the reader’s subtree by the period end is counted, not named', async () => {
      await addCells();
      await reassign(mark.id, onofre.id, MID_JUNE);
      await recordMeeting(cells.mark, '2026-06-06', mark.id);

      const body = await reconcile(
        'cells',
        `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
        manuelAccount,
      );

      expect(body.data.map((row) => row.leader.id)).toEqual([manuel.id]);
      expect(JSON.stringify(body)).not.toContain(mark.id);
      expect(body.others).toEqual({ filed: 1, owed: 2 });
      expect(body.total).toEqual({ filed: 1, owed: 6 });
    });

    it('Cells: nothing is folded where every owner is within reach, and others is null', async () => {
      await addCells();

      const body = await reconcile(
        'cells',
        `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
        manuelAccount,
      );

      expect(body.data.map((row) => row.leader.id)).toEqual([manuel.id, mark.id]);
      expect(body.others).toBeNull();
    });
  });

  /** An account holding `reports.view_subtree` at one Network and nothing else. */
  const networkGrantee = async (network: 'MENS' | 'WOMENS'): Promise<TestAccount> => {
    const holder = await createPerson(db, { firstName: 'Perla', lastName: 'Kalaw', network });
    const grantee = await createAccount(app, db, { person: holder, roles: [] });
    await db
      .insertInto('capability_grants')
      .values({
        account_id: grantee.id,
        capability: 'reports.view_subtree',
        scope_type: 'NETWORK',
        scope_network: network,
        read_only: true,
        reason: 'A Network-scoped reporting grant for the by-leader list.',
        granted_by: adminAccount.id,
      })
      .execute();

    return grantee;
  };

  // ---------------------------------------------------------------------------------------
  // 5. Order and paging
  // ---------------------------------------------------------------------------------------

  describe('the reader first, then by name, paged without loss or repetition', () => {
    // Raymond (Alvarez) reads as Admin; Oriel Abad sorts before him by name.
    const expectedOrder = () => [raymond.id, oriel.id, manuel.id, mark.id, onofre.id];

    const setUp = async (route: Route) => {
      if (route === 'dcc') {
        await addSundays();
      } else {
        await addCells();
      }
    };

    it.each(['dcc', 'cells'] as const)('%s: the reader first, then by name', async (route) => {
      await setUp(route);

      const body = await reconcile(route, `period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      expect(body.data.map((row) => row.leader.id)).toEqual(expectedOrder());
      expect(body.data[0].leader).toMatchObject({ id: raymond.id, full_name: expect.any(String) });
      expect(body.data[0].leader.member_id).toMatch(/^M-/);
    });

    it.each([
      ['dcc', 1],
      ['dcc', 2],
      ['cells', 1],
      ['cells', 2],
    ] as const)(
      '%s: paging at limit %i loses nothing and repeats nothing',
      async (route, limit) => {
        await setUp(route);

        const { rows, first } = await allPages(
          route,
          `period=${JUNE}&scope=WHOLE_CHURCH`,
          adminAccount,
          limit,
        );

        expect(rows.map((row) => row.leader.id)).toEqual(expectedOrder());
        // Each full page holds exactly `limit` rows, the reader's included.
        expect((first.data as Row[]).length).toBe(limit);
      },
    );

    it.each(['dcc', 'cells'] as const)('%s: the total is on every page', async (route) => {
      await setUp(route);
      const query = `period=${JUNE}&scope=WHOLE_CHURCH&limit=2`;

      const page1 = await byLeader(route, query, adminAccount);
      const page2 = await byLeader(
        route,
        `${query}&cursor=${page1.body.next_cursor}`,
        adminAccount,
      );

      expect(page2.status).toBe(200);
      expect(page2.body.total).toEqual(page1.body.total);
      expect(page2.body.data.map((row: Row) => row.leader.id)).not.toContain(raymond.id);
    });

    it.each(['dcc', 'cells'] as const)('%s: refuses a cursor it cannot read', async (route) => {
      const response = await byLeader(
        route,
        `period=${JUNE}&scope=WHOLE_CHURCH&cursor=not-a-cursor`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('cursor');
    });

    it.each(['dcc', 'cells'] as const)('%s: refuses a limit of zero', async (route) => {
      const response = await byLeader(
        route,
        `period=${JUNE}&scope=WHOLE_CHURCH&limit=0`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  // ---------------------------------------------------------------------------------------
  // 6. Authorization, open, and a period that has not begun
  // ---------------------------------------------------------------------------------------

  describe('the same guard as the monthly report', () => {
    it.each(['dcc', 'cells'] as const)(
      '%s: CAPABILITY_DENIED without reports.view_subtree',
      async (route) => {
        const grantless = await createAccount(app, db, { person: pio, roles: [] });

        const response = await byLeader(route, `period=${JUNE}&scope=WHOLE_CHURCH`, grantless);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      },
    );

    it.each(['dcc', 'cells'] as const)(
      '%s: SCOPE_DENIED for a scope above the reader, with no figures',
      async (route) => {
        await addSundays();

        const response = await byLeader(route, `period=${JUNE}&scope=WHOLE_CHURCH`, markAccount);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
        expect(response.body).not.toHaveProperty('data');
        expect(response.body).not.toHaveProperty('total');
      },
    );

    it.each(['dcc', 'cells'] as const)(
      '%s: SCOPE_DENIED for a sibling branch and for the reader’s upline',
      async (route) => {
        for (const target of [onofre, raymond]) {
          const response = await byLeader(
            route,
            `period=${JUNE}&scope=LEADER&leader_id=${target.id}`,
            manuelAccount,
          );

          expect(response.status).toBe(403);
          expect(response.body.error.code).toBe('SCOPE_DENIED');
        }
      },
    );

    it.each(['dcc', 'cells'] as const)(
      '%s: a leader naming nobody -- SCOPE_DENIED to a narrow grant, NOT_FOUND to a wide one (decision 0253)',
      async (route) => {
        const missing = randomUUID();
        const query = `period=${JUNE}&scope=LEADER&leader_id=${missing}`;

        const narrow = await byLeader(route, query, manuelAccount);
        const wide = await byLeader(route, query, adminAccount);

        expect(narrow.status).toBe(403);
        expect(narrow.body.error.code).toBe('SCOPE_DENIED');
        expect(wide.status).toBe(404);
        expect(wide.body.error.code).toBe('NOT_FOUND');
      },
    );

    it('cells: a Cell naming nothing -- SCOPE_DENIED to a narrow grant, NOT_FOUND to a wide one (decision 0253)', async () => {
      const query = `period=${JUNE}&scope=CELL&cell_id=${randomUUID()}`;

      const narrow = await byLeader('cells', query, manuelAccount);
      const wide = await byLeader('cells', query, adminAccount);

      expect(narrow.status).toBe(403);
      expect(narrow.body.error.code).toBe('SCOPE_DENIED');
      expect(wide.status).toBe(404);
      expect(wide.body.error.code).toBe('NOT_FOUND');
    });

    it.each(['dcc', 'cells'] as const)(
      '%s monthly: a leader naming nobody -- SCOPE_DENIED to a narrow grant, NOT_FOUND to a wide one (decision 0253)',
      async (route) => {
        const query = `period=${JUNE}&scope=LEADER&leader_id=${randomUUID()}`;

        const narrow = await call(`${route}/monthly`, query, manuelAccount);
        const wide = await call(`${route}/monthly`, query, adminAccount);

        expect(narrow.status).toBe(403);
        expect(narrow.body.error.code).toBe('SCOPE_DENIED');
        expect(wide.status).toBe(404);
        expect(wide.body.error.code).toBe('NOT_FOUND');
      },
    );

    it('dcc: refuses a NETWORK grantee the other Network', async () => {
      const grantee = await networkGrantee('MENS');

      const response = await byLeader(
        'dcc',
        `period=${JUNE}&scope=NETWORK&network=WOMENS`,
        grantee,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('cells: refuses a NETWORK scope, which the Cell report does not compute', async () => {
      const response = await byLeader(
        'cells',
        `period=${JUNE}&scope=NETWORK&network=MENS`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it.each(['dcc', 'cells'] as const)('%s: a closed month is not open', async (route) => {
      const response = await byLeader(route, `period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(200);
      expect(response.body.open).toBe(false);
      expect(response.body.period).toBe(JUNE);
    });

    it.each(['dcc', 'cells'] as const)('%s: the current month is open', async (route) => {
      const thisMonth = await currentReportingMonth(db);

      const response = await byLeader(
        route,
        `period=${thisMonth}&scope=WHOLE_CHURCH`,
        adminAccount,
      );

      expect(response.status).toBe(200);
      expect(response.body.open).toBe(true);
    });

    it.each(['dcc', 'cells'] as const)(
      '%s: refuses a month that has not begun (decision 0216), after the scope check',
      async (route) => {
        const nextMonth = startOfNextManilaMonth(await databaseNow(db));

        const refused = await byLeader(
          route,
          `period=${nextMonth}&scope=WHOLE_CHURCH`,
          adminAccount,
        );
        expect(refused.status).toBe(422);
        expect(refused.body.error.code).toBe('VALIDATION_FAILED');
        expect(refused.body.error.details.field).toBe('period');
        expect(refused.body).not.toHaveProperty('data');

        const outOfScope = await byLeader(
          route,
          `period=${nextMonth}&scope=WHOLE_CHURCH`,
          markAccount,
        );
        expect(outOfScope.status).toBe(403);
        expect(outOfScope.body.error.code).toBe('SCOPE_DENIED');
      },
    );
  });
});
