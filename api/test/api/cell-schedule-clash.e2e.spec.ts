import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { slotsClash } from '../../src/cells/schedule-clash';
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
  });
});
