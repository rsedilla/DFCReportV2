import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { lastFinishedMonths } from '../../src/reporting/absent-people.service';
import { createTestDb, truncateAll } from '../setup/database';
import {
  EPOCH,
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
 * People's *Absent 3+ Months* list, and archiving and restoring a Person (SKILL.md sections
 * 3, 6 and 19; decision 0397).
 *
 * Authorization is asked of the API, as `CLAUDE.md` requires. The tree is
 * `Raymond (root) -> Manuel -> Mark -> Juan, Pedro, Ana, Leo`, Mark leading the Youth Cell
 * all four are in, and Nestor a second leader under Raymond whose branch holds nobody.
 * The months are whichever three have finished when the suite runs, so the marks are dated
 * from them rather than from a fixed calendar.
 *
 * Fixture names and email addresses are invented (`CLAUDE.md`, Secrets).
 */
describe('absent three months and archiving (decision 0397)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let juan: TestPerson;
  let pedro: TestPerson;
  let ana: TestPerson;
  let leo: TestPerson;
  let nestor: TestPerson;
  let cell: TestCell;

  let admin: TestAccount;
  let manuelAccount: TestAccount;
  let nestorAccount: TestAccount;

  const months = lastFinishedMonths(manilaDayOf(new Date()), 3);
  const dayIn = (index: number, day: number): string =>
    `${months[index].first.slice(0, 8)}${String(day).padStart(2, '0')}`;

  /** The first Sunday from the 15th of the month, so it sits mid-month. */
  const sundayIn = (index: number): string => {
    for (let day = 15; day <= 21; day += 1) {
      if (new Date(`${dayIn(index, day)}T00:00:00Z`).getUTCDay() === 0) {
        return dayIn(index, day);
      }
    }
    throw new Error('Every week has a Sunday.');
  };

  const mondayOf = (day: string): string => {
    const at = new Date(`${day}T00:00:00Z`);
    const isoDay = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
    at.setUTCDate(at.getUTCDate() - (isoDay - 1));
    return at.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);
    nestor = await createPerson(db, { firstName: 'Nestor', network: 'MENS' });
    await assignTo(db, nestor.id, raymond.id);

    juan = await createPerson(db, { firstName: 'Juan', lastName: 'Reyes', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);
    pedro = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
    await assignTo(db, pedro.id, mark.id);
    leo = await createPerson(db, { firstName: 'Leo', network: 'MENS' });
    await assignTo(db, leo.id, mark.id);
    // New: under Mark and in the Cell only from the 20th of the first month.
    const joined = new Date(`${dayIn(0, 20)}T00:00:00+08:00`);
    ana = await createPerson(db, { firstName: 'Ana', network: 'MENS' });
    await assignTo(db, ana.id, mark.id, joined);

    cell = await createCell(db, { leader: mark, createdAt: EPOCH });
    for (const person of [juan, pedro, leo]) {
      await db
        .insertInto('cell_memberships')
        .values({ person_id: person.id, cell_id: cell.id, started_at: EPOCH })
        .execute();
    }
    await db
      .insertInto('cell_memberships')
      .values({ person_id: ana.id, cell_id: cell.id, started_at: joined })
      .execute();

    const adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    nestorAccount = await createAccount(app, db, { person: nestor, roles: ['LEADER'] });

    // Each month: one Cell meeting held by Mark and one DCC Sunday, with marks below.
    for (let index = 0; index < 3; index += 1) {
      const day = dayIn(index, 10);
      const meeting = await db
        .insertInto('cell_meetings')
        .values({
          cell_id: cell.id,
          scheduled_date: day,
          scheduled_time: '19:00',
          week_starting: mondayOf(day),
          reporting_month: `${day.slice(0, 7)}-01`,
          status: 'HELD',
          responsible_leader_id: mark.id,
          submitted_by: admin.id,
          submitted_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sunday = await db
        .insertInto('dcc_events')
        .values({ event_date: sundayIn(index) })
        .returning('id')
        .executeTakeFirstOrThrow();

      const cellMarks: [TestPerson, boolean][] = [
        [juan, false],
        [pedro, index !== 1],
        [ana, false],
        ...(index < 2 ? ([[leo, false]] as [TestPerson, boolean][]) : []),
      ];
      for (const [person, present] of cellMarks) {
        await db
          .insertInto('cell_attendance')
          .values({
            cell_meeting_id: meeting.id,
            person_id: person.id,
            present,
            recorded_by: admin.id,
          })
          .execute();
      }

      // Mark misses every DCC Sunday, but his Cell met every month.
      for (const [person, leader] of [
        [juan, mark],
        [mark, manuel],
      ] as [TestPerson, TestPerson][]) {
        await db
          .insertInto('dcc_attendance')
          .values({
            dcc_event_id: sunday.id,
            person_id: person.id,
            present: false,
            responsible_leader_id: leader.id,
            recorded_by: admin.id,
          })
          .execute();
      }
    }
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const absent = (as: TestAccount): request.Test =>
    request(app.getHttpServer())
      .get('/api/v1/people/absent')
      .set('Authorization', `Bearer ${as.accessToken}`);

  const archive = (
    as: TestAccount,
    person: TestPerson,
    body: Record<string, unknown>,
  ): request.Test =>
    request(app.getHttpServer())
      .post(`/api/v1/people/${person.id}/archive`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const restore = (as: TestAccount, person: TestPerson): request.Test =>
    request(app.getHttpServer())
      .post(`/api/v1/people/${person.id}/restore`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', randomUUID());

  const namesOf = (response: request.Response): string[] =>
    (response.body.data as { full_name: string }[]).map((row) => row.full_name);

  describe('GET /people/absent', () => {
    it('lists only somebody Absent in each month with no Present mark, all month on a roster', async () => {
      const response = await absent(admin).expect(200);

      // Pedro came once; Ana joined in the first month; Leo was not marked in the third;
      // Mark missed DCC but led a Cell that met.
      expect(namesOf(response)).toEqual(['Juan Reyes']);
      expect(response.body.months).toEqual(months.map((month) => month.first.slice(0, 7)));

      const row = response.body.data[0];
      expect(row.leader.person_id).toBe(mark.id);
      expect(row.cell.id).toBe(cell.id);
      expect(row.leads).toEqual([]);
      expect(row.last_at_cell).toBeNull();
      expect(row.last_at_dcc).toBeNull();
    });

    it('gives a Full view leader their branch, and a leader outside it nobody', async () => {
      expect(namesOf(await absent(manuelAccount).expect(200))).toEqual(['Juan Reyes']);
      expect(namesOf(await absent(nestorAccount).expect(200))).toEqual([]);
    });

    it('leaves out an archived person', async () => {
      await archive(admin, juan, { reason: 'MOVED_AWAY' }).expect(200);

      expect(namesOf(await absent(admin).expect(200))).toEqual([]);
    });

    it('lists a leader whose Cell did not meet, with the Cell they lead', async () => {
      // Rico leads a Cell that was recorded as not held every month, and missed DCC.
      const rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      await assignTo(db, rico.id, mark.id);
      const quiet = await createCell(db, { leader: rico, createdAt: EPOCH });
      const sundays = await db.selectFrom('dcc_events').select('id').execute();

      for (let index = 0; index < 3; index += 1) {
        const day = dayIn(index, 12);
        await db
          .insertInto('cell_meetings')
          .values({
            cell_id: quiet.id,
            scheduled_date: day,
            scheduled_time: '19:00',
            week_starting: mondayOf(day),
            reporting_month: `${day.slice(0, 7)}-01`,
            status: 'NOT_HELD',
            not_held_reason: 'LEADER_UNAVAILABLE',
            responsible_leader_id: rico.id,
            submitted_by: admin.id,
            submitted_at: new Date(),
          })
          .execute();
      }
      for (const sunday of sundays) {
        await db
          .insertInto('dcc_attendance')
          .values({
            dcc_event_id: sunday.id,
            person_id: rico.id,
            present: false,
            responsible_leader_id: mark.id,
            recorded_by: admin.id,
          })
          .execute();
      }

      const rows = (await absent(admin).expect(200)).body.data as {
        id: string;
        leads: { id: string; members: number }[];
      }[];

      expect(rows.find((row) => row.id === rico.id)?.leads).toEqual([
        expect.objectContaining({ id: quiet.id, members: 0 }),
      ]);
      // Mark still leads a Cell that met, so he is not listed.
      expect(rows.map((row) => row.id)).not.toContain(mark.id);
    });
  });

  describe('POST /people/{id}/archive', () => {
    it('is the Admin’s alone', async () => {
      const response = await archive(manuelAccount, juan, { reason: 'MOVED_AWAY' }).expect(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('archives from now, ending the pastoral edge and the Cell membership', async () => {
      const response = await archive(admin, juan, { reason: 'WORKING_AWAY' }).expect(200);
      expect(response.body).toMatchObject({
        state: 'ARCHIVED',
        reason: 'WORKING_AWAY',
        account_access: null,
      });

      const life = await db
        .selectFrom('person_lifecycle')
        .select(['state', 'reason', 'actor_id'])
        .where('person_id', '=', juan.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(life).toEqual({ state: 'ARCHIVED', reason: 'WORKING_AWAY', actor_id: admin.id });

      const openEdges = await db
        .selectFrom('pastoral_assignments')
        .select('id')
        .where('person_id', '=', juan.id)
        .where('ended_at', 'is', null)
        .execute();
      expect(openEdges).toEqual([]);

      const openMemberships = await db
        .selectFrom('cell_memberships')
        .select('id')
        .where('person_id', '=', juan.id)
        .where('ended_at', 'is', null)
        .execute();
      expect(openMemberships).toEqual([]);

      const audit = await db
        .selectFrom('audit_log')
        .select(['action'])
        .where('target_id', '=', juan.id)
        .execute();
      expect(audit.map((row) => row.action).sort()).toEqual([
        'cell_membership.ended',
        'person.archived',
      ]);

      const page = await request(app.getHttpServer())
        .get(`/api/v1/people/${juan.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(page.body.archived).toMatchObject({ reason: 'WORKING_AWAY', note: null });
    });

    it('refuses somebody who leads a Cell, naming it and its members', async () => {
      const response = await archive(admin, mark, { reason: 'MOVED_AWAY' }).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.cells).toEqual([
        expect.objectContaining({ id: cell.id, members: 4 }),
      ]);
    });

    it('refuses a Network root', async () => {
      const response = await archive(admin, raymond, { reason: 'MOVED_AWAY' }).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses Other with no comment, and the retired reason', async () => {
      const other = await archive(admin, juan, { reason: 'OTHER' }).expect(422);
      expect(other.body.error.code).toBe('VALIDATION_FAILED');

      const retired = await archive(admin, juan, { reason: 'NO_LONGER_IN_CURRENT_NETWORK' }).expect(
        422,
      );
      expect(retired.body.error.code).toBe('VALIDATION_FAILED');

      await archive(admin, juan, { reason: 'OTHER', note: 'Asked to be removed' }).expect(200);
    });

    it('asks about an account, and disables it when told to', async () => {
      const asked = await archive(admin, manuel, { reason: 'MOVED_AWAY' }).expect(422);
      expect(asked.body.error.details.field).toBe('account_access');

      await archive(admin, manuel, { reason: 'MOVED_AWAY', account_access: 'DISABLE' }).expect(200);

      const account = await db
        .selectFrom('accounts')
        .select('status')
        .where('id', '=', manuelAccount.id)
        .executeTakeFirstOrThrow();
      expect(account.status).toBe('DISABLED');

      const entry = await db
        .selectFrom('audit_log')
        .select('after')
        .where('action', '=', 'person.archived')
        .where('target_id', '=', manuel.id)
        .executeTakeFirstOrThrow();
      expect(entry.after).toMatchObject({ account_access: 'DISABLE' });

      // His disciple's leader now holds no assignment, so Mark waits for a new one.
      const waiting = await request(app.getHttpServer())
        .get('/api/v1/people/awaiting-reassignment')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect((waiting.body.data as { id: string }[]).map((row) => row.id)).toContain(mark.id);
    });

    it('keeps the account when told to keep it', async () => {
      await archive(admin, nestor, { reason: 'STUDYING_AWAY', account_access: 'KEEP' }).expect(200);

      const account = await db
        .selectFrom('accounts')
        .select('status')
        .where('id', '=', nestorAccount.id)
        .executeTakeFirstOrThrow();
      expect(account.status).toBe('ACTIVE');
    });

    it('refuses the actor’s own Person, and somebody already archived', async () => {
      const adele = await db
        .selectFrom('accounts')
        .select('person_id')
        .where('id', '=', admin.id)
        .executeTakeFirstOrThrow();
      const self = await archive(admin, { id: adele.person_id } as TestPerson, {
        reason: 'MOVED_AWAY',
        account_access: 'KEEP',
      }).expect(409);
      expect(self.body.error.code).toBe('INVARIANT_VIOLATION');

      await archive(admin, juan, { reason: 'MOVED_AWAY' }).expect(200);
      const again = await archive(admin, juan, { reason: 'MOVED_AWAY' }).expect(409);
      expect(again.body.error.code).toBe('INVARIANT_VIOLATION');
    });
  });

  describe('restore and the Archived view', () => {
    it('restores to current and gives back nothing else', async () => {
      await archive(admin, juan, { reason: 'PASSED_AWAY' }).expect(200);

      const list = await request(app.getHttpServer())
        .get('/api/v1/people/archived')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(list.body.data[0]).toMatchObject({
        id: juan.id,
        reason: 'PASSED_AWAY',
        leader: { person_id: mark.id },
        cell: { id: cell.id },
      });

      await restore(admin, juan).expect(200);

      const life = await db
        .selectFrom('person_lifecycle')
        .select('state')
        .where('person_id', '=', juan.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(life.state).toBe('CURRENT');

      const openMemberships = await db
        .selectFrom('cell_memberships')
        .select('id')
        .where('person_id', '=', juan.id)
        .where('ended_at', 'is', null)
        .execute();
      expect(openMemberships).toEqual([]);

      const again = await restore(admin, juan).expect(409);
      expect(again.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('is the Admin’s alone', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/people/archived')
        .set('Authorization', `Bearer ${manuelAccount.accessToken}`)
        .expect(403);
      await restore(manuelAccount, juan).expect(403);
    });
  });

  describe('migration 0032', () => {
    const insertArchived = (reason: string | null, note: string | null) =>
      db
        .insertInto('person_lifecycle')
        .values({
          person_id: leo.id,
          state: 'ARCHIVED',
          reason: reason as never,
          note,
          started_at: new Date('2030-01-01T00:00:00Z'),
        })
        .execute();

    it('refuses a new archive with no reason, the retired one, or Other with no comment', async () => {
      // Leo's CURRENT row is closed first, so the one-open-row index allows the insert and
      // each refusal is the trigger's.
      await db
        .updateTable('person_lifecycle')
        .set({ ended_at: new Date('2029-12-31T00:00:00Z') })
        .where('person_id', '=', leo.id)
        .execute();

      await expect(insertArchived(null, null)).rejects.toThrow(/every archive gives a reason/);
      await expect(insertArchived('NO_LONGER_IN_CURRENT_NETWORK', null)).rejects.toThrow(
        /no longer given/,
      );
      await expect(insertArchived('OTHER', '\t')).rejects.toThrow(/written comment/);
      await expect(insertArchived('MOVED_AWAY', null)).resolves.toBeDefined();
    });
  });
});
