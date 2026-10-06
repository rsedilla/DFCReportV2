import request from 'supertest';
import { Client } from 'pg';
import { sql } from 'kysely';

import { prepareToStore } from '../../src/reporting/report-snapshots';
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
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * Stored closed months (SKILL.md section 20, decision 0320): the four tests section 20
 * names, against `GET /api/v1/reports/dcc/monthly` and migration 0022.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('stored closed months (section 20, decision 0320)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let nino: TestPerson;
  let admin: TestAccount;
  let cell: TestCell;
  let juneEventId: string;
  let juneMeetingId: string;

  /** A closed month, and the months either side of it. */
  const JUNE = '2026-06-01';
  const APRIL = '2026-04-01';
  const JULY = '2026-07-01';
  const IN_JUNE = new Date('2026-06-15T10:00:00+08:00');

  const report = (period: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/reports/dcc/monthly?period=${period}&scope=WHOLE_CHURCH`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

  const version = async (month: string): Promise<string | undefined> =>
    (
      await db
        .selectFrom('report_month_versions')
        .select('version')
        .where('month', '=', month)
        .executeTakeFirst()
    )?.version;

  const record = (eventId: string, person: TestPerson, leader: TestPerson) =>
    db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: person.id,
        present: true,
        responsible_leader_id: leader.id,
        recorded_by: admin.id,
      })
      .execute();

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    nino = await createPerson(db, { firstName: 'Nino', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, nino.id, mark.id);
    admin = await createAccount(app, db, { person: raymond, roles: ['ADMIN'] });

    cell = await createCell(db, { leader: mark, createdAt: new Date('2026-03-02T10:00:00+08:00') });
    await db
      .insertInto('cell_memberships')
      .values({
        person_id: nino.id,
        cell_id: cell.id,
        started_at: new Date('2026-03-02T10:00:00+08:00'),
      })
      .execute();

    juneEventId = (
      await db
        .insertInto('dcc_events')
        .values({ event_date: '2026-06-07' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await record(juneEventId, manuel, raymond);

    juneMeetingId = (
      await db
        .insertInto('cell_meetings')
        .values({
          cell_id: cell.id,
          scheduled_date: '2026-06-06',
          scheduled_time: '19:00',
          week_starting: '2026-06-01',
          reporting_month: JUNE,
          status: 'HELD',
          responsible_leader_id: mark.id,
          submitted_by: admin.id,
          submitted_at: new Date('2026-06-06T21:00:00+08:00'),
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('every table is moved by the migration or listed as one the stored reports do not read', () => {
    /** Tables `GET /reports/dcc/monthly` and `/reports/cells/monthly` never read, each with why. */
    const NOT_READ = new Map<string, string>([
      ['schema_migrations', 'the migration runner’s own history'],
      ['report_snapshots', 'the stored months themselves'],
      ['report_month_versions', 'the versions the triggers move'],
      ['hierarchy_tree_version', 'the in-memory tree’s version, not a figure (decision 0321)'],
      ['person_lifecycle', 'neither monthly report filters on lifecycle (decision 0320 review)'],
      ['accounts', 'read by the Record and Branch lists, not by the monthly reports'],
      ['account_roles', 'authorization, decided before the report'],
      ['capability_grants', 'authorization, decided before the report'],
      ['refresh_tokens', 'sign-in state'],
      ['account_tokens', 'sign-in state'],
      ['second_steps', 'sign-in state'],
      ['second_step_recovery_codes', 'sign-in state'],
      ['second_step_challenges', 'sign-in state'],
      ['cell_leadership_requests', 'a request is not a leadership until approved'],
      ['audit_log', 'a record of changes, not a source of figures'],
      ['idempotency_keys', 'request replay state'],
      ['settings', 'the monthly reports read no setting; My 12 reads the calendar start'],
      ['suynl_lessons', 'Growth, not attendance'],
      ['training_graduations', 'Growth, not attendance'],
      ['conquest_confirmations', 'Growth, not attendance'],
      ['encounter_seasons', 'Growth, not attendance'],
    ]);

    it('fails on a table in neither list, and on a table in both', async () => {
      const tables = (
        await sql<{ table_name: string }>`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `.execute(db)
      ).rows.map((row) => row.table_name);
      const moved = new Set(
        (
          await sql<{ table_name: string }>`
            SELECT DISTINCT event_object_table AS table_name FROM information_schema.triggers
            WHERE trigger_schema = 'public' AND trigger_name LIKE 'report\\_months\\_%'
          `.execute(db)
        ).rows.map((row) => row.table_name),
      );

      const unclassified = tables.filter((table) => !moved.has(table) && !NOT_READ.has(table));
      const both = tables.filter((table) => moved.has(table) && NOT_READ.has(table));
      expect(unclassified).toEqual([]);
      expect(both).toEqual([]);
      // A listed table that no longer exists is a stale reason.
      expect([...NOT_READ.keys()].filter((table) => !tables.includes(table))).toEqual([]);
    });
  });

  describe('changing each moved table moves the stored month', () => {
    beforeEach(async () => {
      await db
        .insertInto('report_month_versions')
        .values([{ month: APRIL }, { month: JUNE }, { month: JULY }])
        .execute();
    });

    /**
     * Each change runs in a transaction that is rolled back, so the fixture is shared and
     * the deferred constraint triggers never run. What is read is the version as the
     * changing transaction sees it.
     */
    async function versionsAfter(
      change: (trx: Kysely<Database>) => Promise<unknown>,
    ): Promise<{ april?: string; june?: string; july?: string }> {
      let seen: { april?: string; june?: string; july?: string } = {};
      await db
        .transaction()
        .execute(async (trx) => {
          // What the change moved, rather than where the versions stand, so a fixture
          // committed before the change does not count.
          const read = async () => {
            const rows = await trx.selectFrom('report_month_versions').selectAll().execute();
            const of = (month: string) =>
              Number(rows.find((row) => row.month === month)?.version ?? NaN);
            return { april: of(APRIL), june: of(JUNE), july: of(JULY) };
          };
          const before = await read();
          await change(trx);
          const after = await read();
          seen = {
            april: String(after.april - before.april),
            june: String(after.june - before.june),
            july: String(after.july - before.july),
          };
          throw new Error('rollback');
        })
        .catch((error: Error) => {
          if (error.message !== 'rollback') throw error;
        });
      return seen;
    }

    const juneAndLater = { april: '0', june: '1', july: '1' };

    it('dcc_events: removing a June Sunday', async () => {
      expect(
        await versionsAfter((trx) =>
          trx
            .updateTable('dcc_events')
            .set({ removed_at: new Date(), removed_by: admin.id, removal_reason: 'No service.' })
            .where('id', '=', juneEventId)
            .execute(),
        ),
      ).toEqual(juneAndLater);
    });

    it('dcc_attendance: a June record', async () => {
      expect(
        await versionsAfter((trx) =>
          trx
            .insertInto('dcc_attendance')
            .values({
              dcc_event_id: juneEventId,
              person_id: mark.id,
              present: true,
              responsible_leader_id: manuel.id,
              recorded_by: admin.id,
            })
            .execute(),
        ),
      ).toEqual(juneAndLater);
    });

    it('cell_meetings: a June meeting', async () => {
      expect(
        await versionsAfter((trx) =>
          trx
            .insertInto('cell_meetings')
            .values({
              cell_id: cell.id,
              scheduled_date: '2026-06-13',
              scheduled_time: '19:00',
              week_starting: '2026-06-08',
              reporting_month: JUNE,
              status: 'HELD',
              responsible_leader_id: mark.id,
              submitted_by: admin.id,
              submitted_at: new Date('2026-06-13T21:00:00+08:00'),
            } as never)
            .execute(),
        ),
      ).toEqual(juneAndLater);
    });

    it('cell_attendance: a mark at a June meeting', async () => {
      expect(
        await versionsAfter((trx) =>
          trx
            .insertInto('cell_attendance')
            .values({
              cell_meeting_id: juneMeetingId,
              person_id: nino.id,
              present: true,
              recorded_by: admin.id,
            })
            .execute(),
        ),
      ).toEqual(juneAndLater);
    });

    it('cell_meeting_changes: a change to a June meeting', async () => {
      expect(
        await versionsAfter((trx) =>
          trx
            .insertInto('cell_meeting_changes')
            .values({
              cell_meeting_id: juneMeetingId,
              from_status: 'HELD',
              to_status: 'NOT_HELD',
              reason: 'OTHER',
              note: 'Recorded in error.',
              actor_id: admin.id,
            } as never)
            .execute(),
        ),
      ).toEqual(juneAndLater);
    });

    for (const table of [
      'pastoral_assignments',
      'network_assignments',
      'cell_leaderships',
      'cell_memberships',
      'cell_schedules',
      'cell_categories',
    ] as const) {
      it(`${table}: an open row closed in June`, async () => {
        const person = table === 'cell_leaderships' ? mark : nino;
        expect(
          await versionsAfter((trx) =>
            table === 'cell_schedules' || table === 'cell_categories'
              ? trx
                  .updateTable(table)
                  .set({ ended_at: IN_JUNE })
                  .where('cell_id', '=', cell.id)
                  .where('ended_at', 'is', null)
                  .execute()
              : trx
                  .updateTable(table)
                  .set({ ended_at: IN_JUNE })
                  .where('person_id', '=', person.id)
                  .where('ended_at', 'is', null)
                  .execute(),
          ),
        ).toEqual(juneAndLater);
      });
    }

    it('an inserted row moves the month it starts in', async () => {
      const ana = await createPerson(db, { firstName: 'Ana', network: 'MENS' });
      expect(
        await versionsAfter((trx) =>
          trx
            .insertInto('cell_memberships')
            .values({ person_id: ana.id, cell_id: cell.id, started_at: IN_JUNE })
            .execute(),
        ),
      ).toEqual(juneAndLater);
    });

    it('a correction moves the month of the old value as well as the new', async () => {
      // Closed in June and committed; then corrected to August. A trigger reading only the
      // new value would move nothing before August.
      await db
        .updateTable('cell_memberships')
        .set({ ended_at: IN_JUNE })
        .where('person_id', '=', nino.id)
        .where('ended_at', 'is', null)
        .execute();
      expect(
        await versionsAfter((trx) =>
          trx
            .updateTable('cell_memberships')
            .set({ ended_at: new Date('2026-08-15T10:00:00+08:00') })
            .where('person_id', '=', nino.id)
            .execute(),
        ),
      ).toEqual(juneAndLater);
    });

    it('cells: a Cell closed in June', async () => {
      expect(
        await versionsAfter((trx) =>
          trx
            .updateTable('cells')
            .set({
              state: 'CLOSED',
              closed_at: IN_JUNE,
              closure_reason: 'MEMBERS_DISPERSED',
            } as never)
            .where('id', '=', cell.id)
            .execute(),
        ),
      ).toEqual(juneAndLater);
    });

    it('persons: a merge moves every month', async () => {
      expect(
        await versionsAfter((trx) =>
          trx
            .updateTable('persons')
            .set({ merged_into_id: mark.id })
            .where('id', '=', nino.id)
            .execute(),
        ),
      ).toEqual({ april: '1', june: '1', july: '1' });
    });

    it('a change in a later month leaves an earlier stored month alone', async () => {
      // A July Sunday and a record of it: each moves July, and neither moves June.
      expect(
        await versionsAfter(async (trx) => {
          const julyEvent = await trx
            .insertInto('dcc_events')
            .values({ event_date: '2026-07-05' })
            .returning('id')
            .executeTakeFirstOrThrow();
          await trx
            .insertInto('dcc_attendance')
            .values({
              dcc_event_id: julyEvent.id,
              person_id: mark.id,
              present: true,
              responsible_leader_id: manuel.id,
              recorded_by: admin.id,
            })
            .execute();
        }),
      ).toEqual({ april: '0', june: '0', july: '2' });
    });
  });

  describe('serving a stored month', () => {
    it('stores a closed month and serves it until a change moves it', async () => {
      const first = await report(JUNE).expect(200);
      expect(first.body.unique_people).toBe(1);
      expect(await db.selectFrom('report_snapshots').selectAll().execute()).toHaveLength(1);

      // Served from the store: the same answer.
      expect((await report(JUNE).expect(200)).body).toEqual(first.body);

      // An amendment to June moves its version, so June is computed again.
      await record(juneEventId, mark, manuel);
      const after = await report(JUNE).expect(200);
      expect(after.body.unique_people).toBe(2);

      // And what is served equals a fresh computation.
      await db.deleteFrom('report_snapshots').execute();
      expect((await report(JUNE).expect(200)).body).toEqual(after.body);
    });

    it('never stores an open month', async () => {
      const month = (
        await sql<{ month: string }>`
          SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Manila'), 'YYYY-MM-DD') AS month
        `.execute(db)
      ).rows[0].month;

      await report(month).expect(200);

      expect(await db.selectFrom('report_snapshots').selectAll().execute()).toHaveLength(0);
      expect(await version(month)).toBeUndefined();
    });
  });

  describe('a change and a report at once, on two connections', () => {
    it('serves the change when it began before the month was first stored and committed after', async () => {
      const writer = new Client({ connectionString: process.env.DATABASE_URL });
      await writer.connect();
      try {
        // The write runs before June has a version row, so its trigger moves nothing.
        await writer.query('BEGIN');
        await writer.query(
          `INSERT INTO dcc_attendance (dcc_event_id, person_id, present, responsible_leader_id, recorded_by)
           VALUES ($1, $2, true, $3, $4)`,
          [juneEventId, mark.id, manuel.id, admin.id],
        );

        // The report creates the row and must wait for the write before computing.
        const pending = report(JUNE).then((response) => response);
        // Commit only after June's row exists, so a report that does not wait computes
        // without the write.
        for (let tries = 0; (await version(JUNE)) === undefined; tries += 1) {
          if (tries > 150) throw new Error('June was never made storable');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        await writer.query('COMMIT');

        const served = await pending;
        expect(served.status).toBe(200);
        expect(served.body.unique_people).toBe(2);

        // And the stored copy, served next, still agrees with a fresh computation.
        const again = await report(JUNE).expect(200);
        await db.deleteFrom('report_snapshots').execute();
        expect((await report(JUNE).expect(200)).body).toEqual(again.body);
      } finally {
        await writer.end();
      }
    });
  });

  describe('waiting before a month is first stored', () => {
    it('waits for a write whose id is later than the row’s creation and whose trigger ran before it', async () => {
      const creator = new Client({ connectionString: process.env.DATABASE_URL });
      const writer = new Client({ connectionString: process.env.DATABASE_URL });
      await creator.connect();
      await writer.connect();
      try {
        // The row is created and not yet committed, so the write below finds no row and
        // moves nothing, while holding a later transaction id than the creation's.
        await creator.query('BEGIN');
        await creator.query(`INSERT INTO report_month_versions (month) VALUES ($1)`, [JUNE]);
        await writer.query('BEGIN');
        await writer.query(
          `INSERT INTO dcc_attendance (dcc_event_id, person_id, present, responsible_leader_id, recorded_by)
           VALUES ($1, $2, true, $3, $4)`,
          [juneEventId, mark.id, manuel.id, admin.id],
        );
        await creator.query('COMMIT');

        let settled = false;
        const preparing = prepareToStore(db, JUNE).then((ready) => {
          settled = true;
          return ready;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(settled).toBe(false);

        await writer.query('COMMIT');
        expect(await preparing).toBe(true);
        expect((await report(JUNE).expect(200)).body.unique_people).toBe(2);
      } finally {
        await creator.end();
        await writer.end();
      }
    });
  });

  describe('a stored month is filed under its own report and scope', () => {
    it('serves each leader their own stored month', async () => {
      // With Nino recorded, Mark's figure is 1 (Nino) and Manuel's is 2 (Manuel and Nino),
      // so two leaders sharing one stored month would fail below.
      await record(juneEventId, nino, mark);
      const leader = (person: TestPerson) =>
        request(app.getHttpServer())
          .get(`/api/v1/reports/dcc/monthly?period=${JUNE}&scope=LEADER&leader_id=${person.id}`)
          .set('Authorization', `Bearer ${admin.accessToken}`);

      const forMark = await leader(mark).expect(200);
      const forManuel = await leader(manuel).expect(200);
      expect(forMark.body.unique_people).toBe(1);
      expect(forManuel.body.unique_people).toBe(2);
      expect(await db.selectFrom('report_snapshots').selectAll().execute()).toHaveLength(2);

      expect((await leader(mark).expect(200)).body).toEqual(forMark.body);
      expect((await leader(manuel).expect(200)).body).toEqual(forManuel.body);
      expect(forMark.body.scope).toEqual({ kind: 'LEADER', person_id: mark.id });
      expect(forManuel.body.scope).toEqual({ kind: 'LEADER', person_id: manuel.id });
    });

    it('stores a Cell’s month and serves it until a mark moves it', async () => {
      const cellReport = () =>
        request(app.getHttpServer())
          .get(`/api/v1/reports/cells/monthly?period=${JUNE}&scope=CELL&cell_id=${cell.id}`)
          .set('Authorization', `Bearer ${admin.accessToken}`);

      const first = await cellReport().expect(200);
      expect(first.body.unique_people).toBe(0);
      expect((await cellReport().expect(200)).body).toEqual(first.body);
      expect(await db.selectFrom('report_snapshots').select('report_kind').execute()).toEqual([
        { report_kind: 'CELL_MONTHLY' },
      ]);

      await db
        .insertInto('cell_attendance')
        .values({
          cell_meeting_id: juneMeetingId,
          person_id: nino.id,
          present: true,
          recorded_by: admin.id,
        })
        .execute();
      const after = await cellReport().expect(200);
      expect(after.body.unique_people).toBe(1);

      await db.deleteFrom('report_snapshots').execute();
      expect((await cellReport().expect(200)).body).toEqual(after.body);
    });
  });

  describe('a write into the open month', () => {
    it('does not wait on stored months', async () => {
      await report(JUNE).expect(200);

      const today = (
        await sql<{ sunday: string }>`
          SELECT to_char(
            date_trunc('month', now() AT TIME ZONE 'Asia/Manila')::date
              + ((7 - EXTRACT(ISODOW FROM date_trunc('month', now() AT TIME ZONE 'Asia/Manila'))::int) % 7),
            'YYYY-MM-DD') AS sunday
        `.execute(db)
      ).rows[0].sunday;
      const openEvent = (
        await db
          .insertInto('dcc_events')
          .values({ event_date: today })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      const writer = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      await writer.connect();
      try {
        // Every stored month is locked by somebody else.
        await holder.query('BEGIN');
        await holder.query('SELECT month FROM report_month_versions FOR UPDATE');

        await writer.query(`SET lock_timeout = '500ms'`);
        await expect(
          writer.query(
            `INSERT INTO dcc_attendance (dcc_event_id, person_id, present, responsible_leader_id, recorded_by)
             VALUES ($1, $2, true, $3, $4)`,
            [openEvent, mark.id, manuel.id, admin.id],
          ),
        ).resolves.toBeDefined();
      } finally {
        await holder.query('ROLLBACK');
        await holder.end();
        await writer.end();
      }
    });
  });
});
