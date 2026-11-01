import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { EPOCH, assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

interface Row {
  leader: { person_id: string; has_account: boolean };
  recorded_by: { person_id: string } | null;
  recorded_by_administrator: boolean;
  record_for: string | null;
  may_record: boolean;
}

/**
 * An administrator records a DCC line where nobody above has an account, then or now
 * (SKILL.md section 9, decision 0418).
 *
 * Lorenzo is a Network root holding no account. Ramon leads beneath him, also holding none,
 * with Anselmo and Benito beneath Ramon, and Pascual sits directly under Lorenzo. Nobody in
 * that chain holds an account, so before this ruling nobody could record any of them.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('an administrator records where nobody above has an account (decision 0418)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let lorenzo: TestPerson;
  let ramon: TestPerson;
  let anselmo: TestPerson;
  let benito: TestPerson;
  let pascual: TestPerson;
  let adele: TestPerson;
  let eventId: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    lorenzo = await createPerson(db, { firstName: 'Lorenzo', network: 'MENS' });
    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    anselmo = await createPerson(db, { firstName: 'Anselmo', network: 'MENS' });
    benito = await createPerson(db, { firstName: 'Benito', network: 'MENS' });
    pascual = await createPerson(db, { firstName: 'Pascual', network: 'MENS' });
    // The administrator, outside the pastoral tree (section 6).
    adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    await assignTo(db, lorenzo.id, null);
    await assignTo(db, ramon.id, lorenzo.id);
    await assignTo(db, anselmo.id, ramon.id);
    await assignTo(db, benito.id, ramon.id);
    await assignTo(db, pascual.id, lorenzo.id);

    // The most recent Sunday before today, whose week is still open.
    const today = (
      await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
      `.execute(db)
    ).rows[0].today;
    const [y, m, d] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const sunday = new Date(Date.UTC(y, m - 1, d - (weekday === 0 ? 7 : weekday)))
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

  const admin = (): Promise<TestAccount> =>
    createAccount(app, db, { person: adele, roles: ['ADMIN'] });

  async function rows(reader: TestAccount): Promise<Row[]> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dcc/pending-leaders')
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .expect(200);
    return response.body.data as Row[];
  }

  const rowOf = (all: Row[], person: TestPerson): Row | undefined =>
    all.find((row) => row.leader.person_id === person.id);

  async function leaderRoster(reader: TestAccount, leader: TestPerson): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/dcc/events/${eventId}/leaders/${leader.id}/roster?limit=200`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .expect(200);
    return (response.body.data as { person_id: string }[]).map((line) => line.person_id).sort();
  }

  it('offers the administrator Record on every row of the chain, opening the root’s checklist', async () => {
    const all = await rows(await admin());

    for (const person of [lorenzo, ramon]) {
      expect(rowOf(all, person)).toMatchObject({
        leader: { has_account: false },
        recorded_by: null,
        recorded_by_administrator: true,
        may_record: true,
        record_for: lorenzo.id,
      });
    }
  });

  it('lists the root’s people on that checklist, as though the root held an account', async () => {
    expect(await leaderRoster(await admin(), lorenzo)).toEqual(
      [ramon.id, pascual.id, anselmo.id, benito.id].sort(),
    );
  });

  it('saves the administrator’s marks', async () => {
    const reader = await admin();

    await request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${eventId}/submit`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        records: [
          { person_id: anselmo.id, present: true, version: null },
          { person_id: pascual.id, present: false, version: null },
        ],
      })
      .expect(201);

    // A leader with a line recorded owes nothing more for the Sunday (decision 0224).
    const after = await rows(reader);
    expect(rowOf(after, ramon)).toBeUndefined();
    expect(rowOf(after, lorenzo)).toBeUndefined();
  });

  it('ends once a leader in the chain holds an account', async () => {
    await createAccount(app, db, { person: ramon, roles: ['LEADER'], createdAt: EPOCH });
    const reader = await admin();
    const all = await rows(reader);

    // Ramon records his own people; only Lorenzo's own two lines stay with the administrator.
    expect(rowOf(all, ramon)).toMatchObject({ recorded_by_administrator: false });
    expect(rowOf(all, lorenzo)).toMatchObject({ recorded_by_administrator: true });
    expect(await leaderRoster(reader, lorenzo)).toEqual([ramon.id, pascual.id].sort());
  });

  it('leaves the checklist of a leader somebody above covers empty', async () => {
    await createAccount(app, db, { person: lorenzo, roles: ['LEADER'], createdAt: EPOCH });

    // Ramon has no account, but Lorenzo above him does: Ramon's people are on Lorenzo's.
    expect(await leaderRoster(await admin(), ramon)).toEqual([]);
  });
});
