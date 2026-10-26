import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { Client } from 'pg';
import request from 'supertest';

import { slotsClash } from '../../src/cells/schedule-clash';
import { holdPersonLock } from '../setup/concurrency';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createRequestMembers,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * One leader's Cells start at least two hours apart (SKILL.md section 10, decision 0392).
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('one leader’s Cells start two hours apart (decision 0392)', () => {
  describe('the distance', () => {
    it('is measured around the week, past midnight and past Sunday', () => {
      // Saturday 23:00 and Sunday 00:30: ninety minutes.
      expect(
        slotsClash({ dayOfWeek: 6, timeOfDay: '23:00' }, { dayOfWeek: 7, timeOfDay: '00:30' }),
      ).toBe(true);
      // Sunday 23:30 and Monday 00:30: an hour, across the week's end.
      expect(
        slotsClash({ dayOfWeek: 7, timeOfDay: '23:30' }, { dayOfWeek: 1, timeOfDay: '00:30' }),
      ).toBe(true);
    });

    it('allows two hours exactly, and refuses a minute less', () => {
      expect(
        slotsClash({ dayOfWeek: 6, timeOfDay: '19:00' }, { dayOfWeek: 6, timeOfDay: '21:00' }),
      ).toBe(false);
      expect(
        slotsClash({ dayOfWeek: 6, timeOfDay: '19:00' }, { dayOfWeek: 6, timeOfDay: '20:59' }),
      ).toBe(true);
    });

    it('counts seconds, so 12:00:59 to 14:00 is less than two hours', () => {
      expect(
        slotsClash(
          { dayOfWeek: 7, timeOfDay: '12:00:59' },
          { dayOfWeek: 7, timeOfDay: '14:00:00' },
        ),
      ).toBe(true);
    });

    it('does not compare different days far apart', () => {
      expect(
        slotsClash({ dayOfWeek: 6, timeOfDay: '19:00' }, { dayOfWeek: 3, timeOfDay: '19:00' }),
      ).toBe(false);
    });
  });

  describe('the routes', () => {
    let app: INestApplication;
    let db: Kysely<Database>;

    let admin: TestAccount;
    let root: TestPerson;
    let mark: TestPerson;
    let markAccount: TestAccount;
    let markCell: TestCell;
    let juan: TestPerson;
    let juanCell: TestCell;

    beforeAll(async () => {
      db = createTestDb();
      app = await createTestApp();
    });

    beforeEach(async () => {
      await truncateAll(db);

      root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
      await assignTo(db, root.id, null);
      admin = await createAccount(app, db, { person: root, roles: ['ADMIN'] });

      // Mark leads a Cell on Saturday at 19:00 and disciples Juan, who leads one on
      // Wednesday at 19:00.
      mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      await assignTo(db, mark.id, root.id);
      markCell = await createCell(db, { leader: mark, dayOfWeek: 6, timeOfDay: '19:00' });
      markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

      juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      await assignTo(db, juan.id, mark.id);
      juanCell = await createCell(db, { leader: juan, dayOfWeek: 3, timeOfDay: '19:00' });
    });

    afterAll(async () => {
      await app.close();
      await db.destroy();
    });

    const post = (actor: TestAccount, path: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    const put = (actor: TestAccount, path: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .put(path)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    const membersFor = async (personId: string): Promise<string[]> =>
      (await createRequestMembers(db, 'MENS', { under: personId })).ids;

    const newCell = async (leaderId: string, day: number, time: string) => ({
      kind: 'NEW_CELL',
      prospective_leader_id: leaderId,
      category: 'COUPLE',
      day_of_week: day,
      time_of_day: time,
      members: await membersFor(leaderId),
    });

    it('refuses a new-Cell request less than two hours from a Cell the leader runs', async () => {
      // Admin asks for Juan, who leads on Wednesday at 19:00.
      const response = await post(
        admin,
        '/api/v1/cells/leadership-requests',
        await newCell(juan.id, 3, '20:00'),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.clashes).toEqual([
        {
          source: 'CELL',
          cell_id: juanCell.cellId,
          category: 'YOUTH',
          day_of_week: 3,
          time_of_day: '19:00',
        },
      ]);
    });

    it('sends one two hours or more away', async () => {
      await post(
        admin,
        '/api/v1/cells/leadership-requests',
        await newCell(juan.id, 3, '21:00'),
      ).expect(201);
    });

    it('re-checks at approval, against a change made since the request', async () => {
      const sent = await post(
        markAccount,
        '/api/v1/cells/leadership-requests',
        await newCell(juan.id, 3, '22:00'),
      ).expect(201);

      // Juan's Cell moves to 21:00 from next month: a waiting change counts.
      await put(admin, `/api/v1/cells/${juanCell.id}/schedule`, {
        day_of_week: 3,
        time_of_day: '21:00',
      }).expect(409);

      // The request itself counts as a commitment, so the move above was refused. Move it
      // somewhere harmless, then put the clash in the database directly, as data entered
      // before the rule would be.
      await db
        .updateTable('cell_schedules')
        .set({ time_of_day: '21:30' })
        .where('cell_id', '=', juanCell.id)
        .execute();

      const response = await post(
        admin,
        `/api/v1/cells/leadership-requests/${sent.body.id as string}/approve`,
        {},
      );

      expect(response.status).toBe(409);
      expect(response.body.error.details.clashes[0].cell_id).toBe(juanCell.cellId);
    });

    it('refuses a schedule change that brings two of one leader’s Cells together', async () => {
      const second = await createCell(db, { leader: juan, dayOfWeek: 5, timeOfDay: '19:00' });

      const response = await put(admin, `/api/v1/cells/${second.id}/schedule`, {
        day_of_week: 3,
        time_of_day: '20:30',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.details.clashes[0].cell_id).toBe(juanCell.cellId);

      // Moving the Cell itself, by less than two hours, compares with nothing.
      await put(admin, `/api/v1/cells/${juanCell.id}/schedule`, {
        day_of_week: 3,
        time_of_day: '19:30',
      }).expect(200);
    });

    it('refuses a handover to somebody whose own Cell starts too close', async () => {
      // Juan would take Mark's Saturday 19:00 Cell, while leading Saturday 20:00 himself.
      await db
        .updateTable('cell_schedules')
        .set({ day_of_week: 6, time_of_day: '20:00' })
        .where('cell_id', '=', juanCell.id)
        .execute();

      const response = await post(admin, '/api/v1/cells/leadership-requests', {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: markCell.id,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.details.clashes[0].cell_id).toBe(juanCell.cellId);
    });

    it('counts a pending request as a commitment', async () => {
      await post(
        admin,
        '/api/v1/cells/leadership-requests',
        await newCell(juan.id, 1, '19:00'),
      ).expect(201);

      // Juan's Wednesday Cell may not move to Monday 20:00 while that request waits.
      const response = await put(admin, `/api/v1/cells/${juanCell.id}/schedule`, {
        day_of_week: 1,
        time_of_day: '20:00',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.details.clashes).toEqual([
        {
          source: 'REQUEST',
          cell_id: null,
          category: 'COUPLE',
          day_of_week: 1,
          time_of_day: '19:00',
        },
      ]);
    });

    it('names only what the asker may see, and says the rest exists (decision 0392, section 8)', async () => {
      // Carlo leads a Thursday 20:00 Cell in Ben's branch, outside Mark's, and Admin asks
      // for it to be handed to Juan, beneath Mark.
      const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
      await assignTo(db, ben.id, root.id);
      const carlo = await createPerson(db, { firstName: 'Carlo', network: 'MENS' });
      await assignTo(db, carlo.id, ben.id);
      const carloCell = await createCell(db, { leader: carlo, dayOfWeek: 4, timeOfDay: '20:00' });
      await post(admin, '/api/v1/cells/leadership-requests', {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: carloCell.id,
      }).expect(201);

      // Mark asks for a new Cell for Juan an hour before it: told only that something clashes.
      const asMark = await post(
        markAccount,
        '/api/v1/cells/leadership-requests',
        await newCell(juan.id, 4, '19:00'),
      );
      expect(asMark.status).toBe(409);
      expect(asMark.body.error.details).toEqual({ leader_id: juan.id, clashes: [], others: true });
      expect(asMark.body.error.message).not.toContain(carloCell.cellId);
      expect(asMark.body.error.message).toContain('a Cell Group, or a request for one');

      // Admin, who sees the whole church, is told which.
      const asAdmin = await post(
        admin,
        '/api/v1/cells/leadership-requests',
        await newCell(juan.id, 4, '19:00'),
      );
      expect(asAdmin.status).toBe(409);
      expect(asAdmin.body.error.details.clashes).toEqual([
        {
          source: 'REQUEST',
          cell_id: carloCell.cellId,
          category: 'YOUTH',
          day_of_week: 4,
          time_of_day: '20:00',
        },
      ]);
      expect(asAdmin.body.error.details.others).toBe(false);
    });

    it('lists clashes that already exist for Admin, and to nobody else', async () => {
      // Entered before the rule: Juan leads Wednesday 19:00 and 19:30.
      const second = await createCell(db, {
        leader: juan,
        dayOfWeek: 3,
        timeOfDay: '19:30',
        category: 'YOUNG_PRO',
      });

      const list = await request(app.getHttpServer())
        .get('/api/v1/cells/schedule-clashes')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(list.body.data).toEqual([
        {
          leader: {
            person_id: juan.id,
            member_id: expect.any(String),
            full_name: expect.any(String),
          },
          minutes_apart: 30,
          cells: expect.arrayContaining([
            expect.objectContaining({
              cell_id: juanCell.cellId,
              day_of_week: 3,
              time_of_day: '19:00',
            }),
            expect.objectContaining({
              cell_id: second.cellId,
              day_of_week: 3,
              time_of_day: '19:30',
            }),
          ]),
        },
      ]);

      await request(app.getHttpServer())
        .get('/api/v1/cells/schedule-clashes')
        .set('Authorization', `Bearer ${markAccount.accessToken}`)
        .expect(403);
    });

    it('decides two writes for one leader one after the other', async () => {
      // Two of Juan's Cells move toward each other at once: Wednesday 19:00 and Friday
      // 19:00 both to Thursday, an hour apart. One may land; both may not.
      const second = await createCell(db, { leader: juan, dayOfWeek: 5, timeOfDay: '19:00' });

      const [a, b] = await Promise.all([
        put(admin, `/api/v1/cells/${juanCell.id}/schedule`, {
          day_of_week: 4,
          time_of_day: '19:00',
        }),
        put(admin, `/api/v1/cells/${second.id}/schedule`, { day_of_week: 4, time_of_day: '20:00' }),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it('decides a request and a schedule change for one leader one after the other', async () => {
      // A new Cell for Juan on Monday at 19:00, and his Wednesday Cell moving to Monday at
      // 20:00, sent together. One may land; both may not.
      const body = await newCell(juan.id, 1, '19:00');

      const [a, b] = await Promise.all([
        post(admin, '/api/v1/cells/leadership-requests', body),
        put(admin, `/api/v1/cells/${juanCell.id}/schedule`, {
          day_of_week: 1,
          time_of_day: '20:00',
        }),
      ]);

      expect([a.status, b.status].sort()).toEqual(a.status === 201 ? [201, 409] : [200, 409]);
    });

    it('answers RESOURCE_BUSY when the Cell changes hands while its change waits for the leader', async () => {
      // The change reads Juan as the leader, then waits for his lock. Meanwhile the Cell is
      // handed to Mark. Deciding under Juan's lock would check the wrong leader's Cells.
      const blocker = new Client({ connectionString: process.env.DATABASE_URL });
      await blocker.connect();

      try {
        await blocker.query('BEGIN');
        await holdPersonLock(blocker, juan.id);
        const pid = Number(
          (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as string,
        );

        const pending = put(admin, `/api/v1/cells/${juanCell.id}/schedule`, {
          day_of_week: 2,
          time_of_day: '19:00',
        }).then((response) => response);
        await waitForBlockedBy(db, pid);

        await db.transaction().execute(async (trx) => {
          const at = (await sql<{ at: Date }>`SELECT clock_timestamp() AS at`.execute(trx)).rows[0]
            .at;
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: at })
            .where('cell_id', '=', juanCell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({ person_id: mark.id, cell_id: juanCell.id, started_at: at })
            .execute();
        });

        await blocker.query('ROLLBACK');

        const response = await pending;
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');
        // This refusal, not a lock that timed out, which answers the same code.
        expect(response.body.error.details).toEqual({ cell_id: juanCell.cellId });
      } finally {
        try {
          await blocker.query('ROLLBACK');
        } finally {
          await blocker.end();
        }
      }
    }, 30000);
  });
});

/** Polls until a backend is waiting on `blockerPid`; 2s, under the service's 3s lock bound. */
async function waitForBlockedBy(db: Kysely<Database>, blockerPid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await sql<{ count: string }>`
      SELECT count(*) AS count
        FROM pg_stat_activity
       WHERE ${blockerPid}::int = ANY (pg_blocking_pids(pid))
    `.execute(db);

    if (Number(waiting.rows[0].count) > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Nothing ever blocked on backend ${blockerPid}.`);
}
