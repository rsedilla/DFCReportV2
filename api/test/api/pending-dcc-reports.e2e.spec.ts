import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  EPOCH,
  nameSeniorPastors,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

interface Row {
  leader: { person_id: string; is_actor: boolean; has_account: boolean };
  recorded_by: { person_id: string; full_name: string } | null;
  recorded_by_you: boolean;
  sundays: { event_id: string; event_date: string; due_at: string | null; closes_at: string }[];
  record_for: string | null;
  may_record: boolean;
}

/**
 * Record's *Pending DCC Records* (SKILL.md section 19, decision 0336):
 * `GET /api/v1/dcc/pending-leaders`.
 *
 * The Men's tree is `Oriel -> Raymond -> Jhoemar -> Dave -> Angelo -> Pedro`, so Angelo is
 * three levels below Raymond; the Women's is `Geraldine -> Grace -> Hanna`. Adele holds an
 * Admin account and no place in the tree. The weekly rule is moved to January 2026 through
 * `WEEKLY_DEADLINE_FROM` unless a case says otherwise, and every date comes from the
 * database's day. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('Pending DCC Records (decision 0336)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let raymond: TestPerson;
  let jhoemar: TestPerson;
  let dave: TestPerson;
  let angelo: TestPerson;
  let pedro: TestPerson;
  let geraldine: TestPerson;
  let grace: TestPerson;
  let adele: TestPerson;

  const previous = process.env.WEEKLY_DEADLINE_FROM;

  beforeAll(async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.WEEKLY_DEADLINE_FROM;
    } else {
      process.env.WEEKLY_DEADLINE_FROM = previous;
    }
    await db.destroy();
    await app.close();
  });

  beforeEach(async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';
    await truncateAll(db);
    resetRateLimits(app);
    nameSeniorPastors(app, []);

    oriel = await createPerson(db, { firstName: 'Oriel', lastName: 'Arcega', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    raymond = await createPerson(db, { firstName: 'Raymond', lastName: 'Bernal', network: 'MENS' });
    await assignTo(db, raymond.id, oriel.id);
    jhoemar = await createPerson(db, { firstName: 'Jhoemar', lastName: 'Cruz', network: 'MENS' });
    await assignTo(db, jhoemar.id, raymond.id);
    dave = await createPerson(db, { firstName: 'Dave', lastName: 'Dela Paz', network: 'MENS' });
    await assignTo(db, dave.id, jhoemar.id);
    angelo = await createPerson(db, { firstName: 'Angelo', lastName: 'Esguerra', network: 'MENS' });
    await assignTo(db, angelo.id, dave.id);
    pedro = await createPerson(db, { firstName: 'Pedro', lastName: 'Flores', network: 'MENS' });
    await assignTo(db, pedro.id, angelo.id);

    geraldine = await createPerson(db, {
      firstName: 'Geraldine',
      lastName: 'Gomez',
      network: 'WOMENS',
    });
    await assignTo(db, geraldine.id, null);
    grace = await createPerson(db, { firstName: 'Grace', lastName: 'Hizon', network: 'WOMENS' });
    await assignTo(db, grace.id, geraldine.id);
    const hanna = await createPerson(db, {
      firstName: 'Hanna',
      lastName: 'Ilagan',
      network: 'WOMENS',
    });
    await assignTo(db, hanna.id, grace.id);

    adele = await createPerson(db, { firstName: 'Adele', lastName: 'Zamora', network: 'WOMENS' });
  });

  const today = async (): Promise<string> => {
    const result = await sql<{ today: string }>`
      SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
    `.execute(db);

    return result.rows[0].today;
  };

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  /** The most recent Sunday strictly before today: always held, its week always open. */
  const recentSunday = async (): Promise<string> => {
    const now = await today();
    const weekday = new Date(`${now}T00:00:00Z`).getUTCDay();

    return shift(now, weekday === 0 ? -7 : -weekday);
  };

  async function createEvent(eventDate: string): Promise<string> {
    const row = await db
      .insertInto('dcc_events')
      .values({ event_date: eventDate })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  }

  const leader = (person: TestPerson, fullView = true): Promise<TestAccount> =>
    createAccount(app, db, { person, roles: ['LEADER'], fullView });

  const admin = (): Promise<TestAccount> =>
    createAccount(app, db, { person: adele, roles: ['ADMIN'] });

  async function list(
    reader: TestAccount,
    query: Record<string, string | number> = {},
    status = 200,
  ): Promise<{ data: Row[]; next_cursor: string | null } & Record<string, unknown>> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dcc/pending-leaders')
      .query(query)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .expect(status);

    return response.body as { data: Row[]; next_cursor: string | null };
  }

  const ids = (rows: Row[]): string[] => rows.map((row) => row.leader.person_id);
  const rowOf = (rows: Row[], person: TestPerson): Row | undefined =>
    rows.find((row) => row.leader.person_id === person.id);

  it('lists the whole branch by surname, and drops a leader once anybody on their checklist is marked', async () => {
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);
    const reader = await leader(raymond);
    await leader(jhoemar);
    const daveAccount = await leader(dave);
    await leader(angelo);

    // Angelo is three levels down, so Leaders Under Me would stop short of him (decision
    // 0324); nobody outside Raymond's branch is listed.
    const before = await list(reader);
    expect(ids(before.data)).toEqual([raymond.id, jhoemar.id, dave.id, angelo.id]);
    expect(rowOf(before.data, raymond)?.leader.is_actor).toBe(true);
    expect(rowOf(before.data, raymond)?.may_record).toBe(true);
    expect(before.data[0].sundays.map((s) => s.event_date)).toEqual([sunday]);
    expect(before).not.toHaveProperty('total');

    await request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${eventId}/submit`)
      .set('Authorization', `Bearer ${daveAccount.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ records: [{ person_id: angelo.id, present: false }] })
      .expect(201);

    expect(ids((await list(reader)).data)).toEqual([raymond.id, jhoemar.id, angelo.id]);
  });

  it('gives an Admin outside the tree both Networks, with Record wherever a recorder exists', async () => {
    const sunday = await recentSunday();
    await createEvent(sunday);
    // Jhoemar holds no account, so Raymond records for him (section 9).
    await leader(raymond);
    await leader(dave);
    await leader(angelo);
    await leader(grace);
    const reader = await admin();

    const rows = (await list(reader)).data;
    expect(ids(rows)).toEqual([
      oriel.id,
      raymond.id,
      jhoemar.id,
      dave.id,
      angelo.id,
      geraldine.id,
      grace.id,
    ]);
    for (const person of [raymond, dave, angelo, grace]) {
      expect(rowOf(rows, person)).toMatchObject({ may_record: true, record_for: person.id });
    }
    // A leader with no account: the Admin records on the recorder's screen.
    expect(rowOf(rows, jhoemar)).toMatchObject({
      leader: { has_account: false },
      recorded_by: { person_id: raymond.id },
      may_record: true,
      record_for: raymond.id,
    });
    // The roots hold no account and nobody is above them.
    for (const root of [oriel, geraldine]) {
      expect(rowOf(rows, root)).toMatchObject({
        recorded_by: null,
        may_record: false,
        record_for: null,
      });
    }

    expect(ids((await list(reader, { network: 'WOMENS' })).data)).toEqual([geraldine.id, grace.id]);
  });

  it('names who records a leader with no account, and offers Record only to that recorder', async () => {
    await createEvent(await recentSunday());
    const reader = await leader(raymond);
    const jhoemarAccount = await leader(jhoemar);
    // Dave and Angelo hold no account, so Jhoemar records for both (section 9).

    const rows = (await list(reader)).data;
    for (const person of [dave, angelo]) {
      expect(rowOf(rows, person)).toMatchObject({
        leader: { has_account: false },
        recorded_by: { person_id: jhoemar.id },
        recorded_by_you: false,
        record_for: null,
        may_record: false,
      });
    }

    // Jhoemar's own view: those two rows are his to record.
    const jhoemarRows = (await list(jhoemarAccount)).data;
    expect(rowOf(jhoemarRows, dave)).toMatchObject({ recorded_by_you: true, may_record: true });
  });

  it('does not name a recorder outside the reader’s scope', async () => {
    const sunday = await recentSunday();
    await createEvent(sunday);
    // On the Sunday Dave sat under Ben, who holds an account; he has since moved under
    // Jhoemar, and Ben is outside Raymond's branch.
    const ben = await createPerson(db, {
      firstName: 'Ben',
      lastName: 'Gatchalian',
      network: 'MENS',
    });
    await assignTo(db, ben.id, oriel.id);
    await leader(ben);
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: new Date(EPOCH.getTime() + 86_400_000) })
      .where('person_id', '=', dave.id)
      .where('ended_at', 'is', null)
      .execute();
    await assignTo(db, dave.id, ben.id, new Date(EPOCH.getTime() + 86_400_000));
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: new Date(Date.now() - 60_000) })
      .where('person_id', '=', dave.id)
      .where('ended_at', 'is', null)
      .execute();
    await assignTo(db, dave.id, jhoemar.id, new Date(Date.now() - 60_000));

    const reader = await leader(raymond);
    await leader(jhoemar);

    expect(rowOf((await list(reader)).data, dave)).toMatchObject({
      leader: { has_account: false },
      recorded_by: null,
      may_record: false,
    });
  });

  it('reads who holds an account now, so a leader given one after the Sunday records it', async () => {
    await createEvent(await recentSunday());
    const reader = await leader(raymond);
    await leader(jhoemar);
    await leader(dave);

    expect(rowOf((await list(reader)).data, dave)).toMatchObject({
      leader: { has_account: true },
      recorded_by: null,
    });
  });

  it('lists only Sundays still open, held and not removed', async () => {
    const sunday = await recentSunday();
    const reader = await leader(raymond);
    await createEvent(sunday);
    await createEvent(shift(sunday, -21)); // its week closed a week ago (decision 0335)
    await createEvent(shift(sunday, 14)); // not held yet, on any day of the week
    const removed = await createEvent(shift(sunday, -7));
    const adminAccount = await admin();
    await db
      .updateTable('dcc_events')
      .set({ removed_at: new Date(), removed_by: adminAccount.id, removal_reason: 'Typhoon.' })
      .where('id', '=', removed)
      .execute();

    const own = rowOf((await list(reader)).data, raymond);
    expect(own?.sundays.map((s) => s.event_date)).toEqual([sunday]);
    expect(own?.sundays[0].due_at).not.toBeNull();
  });

  it('keeps a Sunday from before the weekly rule until the end of the next month’s 7th', async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2100-01-04';
    const sunday = await recentSunday();
    await createEvent(sunday);
    const reader = await leader(raymond);

    const [year, month] = sunday.split('-').map(Number);
    const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    const own = rowOf((await list(reader)).data, raymond);
    expect(own?.sundays[0]).toMatchObject({
      due_at: null,
      closes_at: new Date(`${next}-08T00:00:00+08:00`).toISOString(),
    });
  });

  it('searches by name or Member ID, and refuses a term shorter than two letters', async () => {
    await createEvent(await recentSunday());
    const reader = await admin();

    const { member_id: memberId } = await db
      .selectFrom('persons')
      .select('member_id')
      .where('id', '=', dave.id)
      .executeTakeFirstOrThrow();

    expect(ids((await list(reader, { q: 'dela paz' })).data)).toEqual([dave.id]);
    // A space matches anything, as on the People and Cells searches.
    expect(ids((await list(reader, { q: 'dave paz' })).data)).toEqual([dave.id]);
    expect(ids((await list(reader, { q: memberId })).data)).toEqual([dave.id]);

    // A title is never compared (section 3, decision 0271).
    await db.updateTable('persons').set({ title: 'Pastora' }).where('id', '=', grace.id).execute();
    expect(ids((await list(reader, { q: 'pastora' })).data)).toEqual([]);

    for (const q of ['a-', ' a']) {
      const refused = await list(reader, { q }, 422);
      expect(refused).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('orders by surname, never by how many Sundays are owed', async () => {
    const sunday = await recentSunday();
    const earlier = await createEvent(shift(sunday, -7)); // its week still open
    await createEvent(sunday);
    const reader = await leader(raymond);
    // Aquino joins last, so he is last in the table, and owes both Sundays.
    const aquino = await createPerson(db, {
      firstName: 'Lito',
      lastName: 'Aquino',
      network: 'MENS',
    });
    await assignTo(db, aquino.id, raymond.id);
    const disciple = await createPerson(db, {
      firstName: 'Nilo',
      lastName: 'Ramos',
      network: 'MENS',
    });
    await assignTo(db, disciple.id, aquino.id);
    // Raymond records one of his own for the earlier Sunday, so he owes one Sunday.
    await request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${earlier}/submit`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ records: [{ person_id: jhoemar.id, present: true }] })
      .expect(201);

    const rows = (await list(reader)).data;
    expect(ids(rows).slice(0, 2)).toEqual([aquino.id, raymond.id]);
    expect(rows[0].sundays).toHaveLength(2);
    expect(rows[1].sundays).toHaveLength(1);
  });

  it('pages by name with a cursor', async () => {
    await createEvent(await recentSunday());
    const reader = await admin();

    const first = await list(reader, { limit: 3 });
    expect(ids(first.data)).toEqual([oriel.id, raymond.id, jhoemar.id]);
    expect(first.next_cursor).not.toBeNull();

    const second = await list(reader, { limit: 3, cursor: first.next_cursor as string });
    expect(ids(second.data)).toEqual([dave.id, angelo.id, geraldine.id]);

    const third = await list(reader, { limit: 3, cursor: second.next_cursor as string });
    expect(ids(third.data)).toEqual([grace.id]);
    expect(third.next_cursor).toBeNull();
  });
});
