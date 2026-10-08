import request from 'supertest';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  EPOCH,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * *People I oversee* stops two levels down (SKILL.md section 19, decision 0324), on both
 * of Record's branch views: `GET /api/v1/cells/meetings/awaiting?whose=branch` and
 * `GET /api/v1/dcc/owed`.
 *
 * The tree is the ruling's example, `Raymond -> Jhoemar -> Dave -> Angelo`, under a Network
 * root, `Oriel`. Raymond reads; Jhoemar is one level down, Dave two and Angelo three.
 * Everybody else in a case is a disciple, there so that the leader above them owes a record.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('People I oversee stops two levels down (decision 0324)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let raymond: TestPerson;
  let jhoemar: TestPerson;
  let dave: TestPerson;
  let angelo: TestPerson;
  let pedro: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
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
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
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

  const weekdayOf = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };

  /** The most recent Sunday strictly before today: always past, always in an open month. */
  const recentSunday = async (): Promise<string> => {
    const now = await today();
    const weekday = weekdayOf(now);

    return shift(now, weekday === 0 ? -7 : -weekday);
  };

  const monthOf = (day: string): string => `${day.slice(0, 7)}-01`;

  async function account(person: TestPerson, fullView = true): Promise<TestAccount> {
    return createAccount(app, db, { person, roles: ['LEADER'], fullView });
  }

  // -------------------------------------------------------------------------
  // The Cell half
  // -------------------------------------------------------------------------

  /** A Cell for each leader, meeting yesterday's weekday, so each has a meeting due. */
  async function cellsFor(leaders: TestPerson[]): Promise<{ month: string; date: string }> {
    const date = shift(await today(), -1);
    const iso = weekdayOf(date) === 0 ? 7 : weekdayOf(date);
    const created = new Date(`${shift(date, -400)}T12:00:00+08:00`);

    for (const leader of leaders) {
      await createCell(db, { leader, dayOfWeek: iso, createdAt: created });
    }

    return { month: monthOf(date), date };
  }

  async function cellLeadersListed(reader: TestAccount, month: string): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cells/meetings/awaiting')
      .query({ month, whose: 'branch' })
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .expect(200);

    return [
      ...new Set((response.body.meetings as { leader: { id: string } }[]).map((r) => r.leader.id)),
    ].sort();
  }

  describe('Cell meetings', () => {
    it('lists the reader, their direct leaders and theirs with Full view, and nobody three down', async () => {
      const { month } = await cellsFor([raymond, jhoemar, dave, angelo]);
      const reader = await account(raymond);

      expect(await cellLeadersListed(reader, month)).toEqual(
        [raymond.id, jhoemar.id, dave.id].sort(),
      );
    });

    it('lists the reader and their direct leaders only without Full view', async () => {
      const { month } = await cellsFor([raymond, jhoemar, dave, angelo]);
      const reader = await account(raymond, false);

      expect(await cellLeadersListed(reader, month)).toEqual([raymond.id, jhoemar.id].sort());
    });

    it('leaves a Senior Pastor’s list unchanged', async () => {
      const { month } = await cellsFor([raymond, jhoemar, dave, angelo]);
      nameSeniorPastors(app, [oriel.id]);
      const pastor = await createAccount(app, db, {
        person: oriel,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });

      expect(await cellLeadersListed(pastor, month)).toEqual(
        [raymond.id, jhoemar.id, dave.id, angelo.id].sort(),
      );
    });

    it('leaves an Admin’s list unchanged', async () => {
      const { month } = await cellsFor([raymond, jhoemar, dave, angelo]);
      const admin = await createAccount(app, db, { person: raymond, roles: ['ADMIN'] });

      expect(await cellLeadersListed(admin, month)).toEqual(
        [raymond.id, jhoemar.id, dave.id, angelo.id].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // The DCC half
  // -------------------------------------------------------------------------

  async function createEvent(eventDate: string): Promise<string> {
    const row = await db
      .insertInto('dcc_events')
      .values({ event_date: eventDate })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  }

  async function dccLeadersListed(
    reader: TestAccount,
    sunday: string,
    eventId: string,
  ): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dcc/owed')
      .query({ month: monthOf(sunday) })
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .expect(200);

    return (response.body.data as { event_id: string; leader: { person_id: string } }[])
      .filter((row) => row.event_id === eventId)
      .map((row) => row.leader.person_id)
      .sort();
  }

  /** Closes the person's open assignment at `at` and opens one under `leader` from then. */
  async function moveAt(person: TestPerson, leader: TestPerson, at: Date): Promise<void> {
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: at })
      .where('person_id', '=', person.id)
      .where('ended_at', 'is', null)
      .execute();
    await assignTo(db, person.id, leader.id, at);
  }

  /**
   * Dave sat under `former` from the day after the epoch until a minute ago, and has been
   * under Jhoemar since: so on the Sunday he was under `former`.
   */
  async function daveWasUnder(former: TestPerson): Promise<void> {
    await moveAt(dave, former, new Date(EPOCH.getTime() + 86_400_000));
    await moveAt(dave, jhoemar, new Date(Date.now() - 60_000));
  }

  describe('DCC', () => {
    it('lists the reader, their direct leaders and theirs with Full view, and nobody three down', async () => {
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);
      const reader = await account(raymond);
      await account(jhoemar);
      await account(dave);
      await account(angelo);

      expect(await dccLeadersListed(reader, sunday, eventId)).toEqual(
        [raymond.id, jhoemar.id, dave.id].sort(),
      );
    });

    it('lists a line a direct leader records for a leader with no account two levels further down', async () => {
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);
      const reader = await account(raymond);
      // Dave and Angelo hold no account, so Jhoemar records both of their lines (section 9).
      await account(jhoemar);

      expect(await dccLeadersListed(reader, sunday, eventId)).toEqual(
        [raymond.id, jhoemar.id, dave.id, angelo.id].sort(),
      );
    });

    it('lists the reader and their direct leaders only without Full view', async () => {
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);
      const reader = await account(raymond, false);
      await account(jhoemar);
      await account(dave);

      expect(await dccLeadersListed(reader, sunday, eventId)).toEqual(
        [raymond.id, jhoemar.id].sort(),
      );
    });

    it('does not list a line whose submitter as of the Sunday is outside the reader’s branch now', async () => {
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);
      // On the Sunday Dave sat under Ben, who holds an account and records his line; he has
      // since moved under Jhoemar.
      const ben = await createPerson(db, {
        firstName: 'Ben',
        lastName: 'Gatchalian',
        network: 'MENS',
      });
      await assignTo(db, ben.id, oriel.id);
      await account(ben);
      await daveWasUnder(ben);

      const reader = await account(raymond);
      await account(jhoemar);
      await account(angelo);

      // Dave owed a line for Angelo; Jhoemar had no disciple on the Sunday and owed none.
      expect(await dccLeadersListed(reader, sunday, eventId)).toEqual([raymond.id]);
    });

    it('does not list a line with no submitter as of the Sunday', async () => {
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);
      // On the Sunday Dave sat under Xavier, who holds no assignment and no account, so the
      // walk for Dave's line reached the top with nobody to record it.
      const xavier = await createPerson(db, {
        firstName: 'Xavier',
        lastName: 'Ilagan',
        network: 'MENS',
      });
      await daveWasUnder(xavier);

      const reader = await account(raymond);
      await account(jhoemar);
      await account(angelo);

      // Dave owed a line for Angelo; Jhoemar had no disciple on the Sunday and owed none.
      expect(await dccLeadersListed(reader, sunday, eventId)).toEqual([raymond.id]);
    });

    it('leaves a Senior Pastor’s list unchanged', async () => {
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);
      nameSeniorPastors(app, [oriel.id]);
      const pastor = await createAccount(app, db, {
        person: oriel,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });
      await account(raymond);
      await account(jhoemar);
      await account(dave);
      await account(angelo);

      expect(await dccLeadersListed(pastor, sunday, eventId)).toEqual(
        [oriel.id, raymond.id, jhoemar.id, dave.id, angelo.id].sort(),
      );
    });

    it('leaves an Admin’s list unchanged', async () => {
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);
      const admin = await createAccount(app, db, { person: raymond, roles: ['ADMIN'] });
      await account(jhoemar);
      await account(dave);
      await account(angelo);

      expect(await dccLeadersListed(admin, sunday, eventId)).toEqual(
        [raymond.id, jhoemar.id, dave.id, angelo.id].sort(),
      );
    });
  });
});
