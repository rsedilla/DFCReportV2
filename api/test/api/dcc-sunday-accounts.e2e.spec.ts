import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { EPOCH, assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * A past Sunday stays with whoever held an account that Sunday (SKILL.md section 9,
 * decision 0403).
 *
 * Raymond holds an account throughout; Mark, beneath him, is given one after the Sunday.
 * Mark's people stay on Raymond's checklist for that Sunday, Mark's own checklist for it
 * is empty, and only Raymond records them. Given an account before the Sunday, Mark owes
 * it instead, which is what shows the read is of the Sunday rather than of nobody.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('a past Sunday stays with whoever held an account that Sunday (decision 0403)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let mark: TestPerson;
  let ana: TestPerson;
  let ben: TestPerson;
  let raymondAccount: TestAccount;
  let eventId: string;
  let sunday: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    ana = await createPerson(db, { firstName: 'Anselmo', network: 'MENS' });
    ben = await createPerson(db, { firstName: 'Benito', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, mark.id, raymond.id);
    await assignTo(db, ana.id, mark.id);
    await assignTo(db, ben.id, mark.id);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });

    // The most recent Sunday before today, whose week is still open.
    const today = (
      await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
      `.execute(db)
    ).rows[0].today;
    const [y, m, d] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    sunday = new Date(Date.UTC(y, m - 1, d - (weekday === 0 ? 7 : weekday)))
      .toISOString()
      .slice(0, 10);
    eventId = (
      await db
        .insertInto('dcc_events')
        .values({ event_date: sunday })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const roster = async (account: TestAccount): Promise<string[]> => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/dcc/events/${eventId}/roster?limit=200`)
      .set('Authorization', `Bearer ${account.accessToken}`);
    expect(response.status).toBe(200);
    return (response.body.data as { person_id: string }[]).map((line) => line.person_id).sort();
  };

  /** The row for Mark's obligation that Sunday on Raymond's Record (`GET /dcc/owed`). */
  const marksRow = async (): Promise<Record<string, unknown> | undefined> => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/dcc/owed?month=${sunday.slice(0, 8)}01`)
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
    expect(response.status).toBe(200);
    const row = (
      response.body.data as { event_id: string; leader: Record<string, unknown> }[]
    ).find((line) => line.event_id === eventId && line.leader.person_id === mark.id);
    expect(row).toBeDefined();
    return row?.leader;
  };

  const recordPresent = (account: TestAccount, personId: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${eventId}/submit`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ records: [{ person_id: personId, present: true, version: null }] });

  describe('Mark given an account after the Sunday', () => {
    let markAccount: TestAccount;

    beforeEach(async () => {
      markAccount = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
        createdAt: new Date(),
      });
    });

    it("keeps Mark's people on Raymond's checklist for that Sunday", async () => {
      expect(await roster(raymondAccount)).toEqual([mark.id, ana.id, ben.id].sort());
    });

    it("leaves Mark's own checklist for that Sunday empty", async () => {
      expect(await roster(markAccount)).toEqual([]);
    });

    it('lets Raymond record them, and not Mark', async () => {
      expect((await recordPresent(raymondAccount, ana.id)).status).toBe(201);
      expect((await recordPresent(markAccount, ben.id)).status).toBe(403);
    });

    it("lists Mark's Sunday on Raymond's Record as Raymond's to file", async () => {
      // Record's lists read the Sunday as the checklist does, so the two agree.
      expect(await marksRow()).toMatchObject({ recorded_by_you: true });
    });
  });

  describe('Mark given an account before the Sunday', () => {
    let markAccount: TestAccount;

    beforeEach(async () => {
      markAccount = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
        createdAt: EPOCH,
      });
    });

    it("puts his people on his own checklist, and not on Raymond's", async () => {
      expect(await roster(raymondAccount)).toEqual([mark.id]);
      expect(await roster(markAccount)).toEqual([ana.id, ben.id].sort());
    });

    it("lists Mark's Sunday on Raymond's Record as Mark's own to file", async () => {
      expect(await marksRow()).toMatchObject({ recorded_by_you: false });
    });
  });
});
