import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'kysely';

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
 * `GET /api/v1/cells/meetings/awaiting?whose=…` — the recording queue's branch view
 * (SKILL.md section 19, "The queue has a branch view beside the leader's own"; decision
 * 0258).
 *
 * The tree is CLAUDE.md's example, `Raymond -> Manuel -> Mark`, with `Ben` beside Manuel
 * under Raymond as the sibling branch and `Juan` beneath Mark as a disciple. An
 * administrator, `Oscar`, holds a Whole Church grant and no pastoral assignment at all.
 *
 * What these cases pin, each against the API rather than the service, because section 7
 * makes the API the sole authority:
 *
 *   - `mine` is decision 0251's population, unchanged, and is the default
 *   - `branch` is the pastoral tree as it stands now, and never the actor's grant — so a
 *     Whole Church administrator outside the tree sees nobody else's work
 *   - `may_record` is decided per row under `cell.submit_on_behalf` measured against the
 *     filing leader (decision 0192), and agrees with what the submission route answers
 *   - DCC is listed by Sunday, counting leaders **beneath** the actor who still owe a
 *     record; the actor's own obligation is on their own checklist and is not counted
 *
 * Meeting dates are derived from the database's clock by the same staging rule
 * `cell-meetings-awaiting.e2e.spec.ts` uses and documents; see that file for why.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('the recording queue’s branch view (section 19, decision 0258)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let ben: TestPerson;
  let juan: TestPerson;
  let oscar: TestPerson;

  let raymondAccount: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;
  let benAccount: TestAccount;
  let adminAccount: TestAccount;

  const pad = (value: number): string => String(value).padStart(2, '0');

  const manilaToday = async (): Promise<string> => {
    const result = await sql<{ today: string }>`
      SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
    `.execute(db);

    return result.rows[0].today;
  };

  const daysFalling = (
    year: number,
    month: number,
    through: number,
    dayOfWeek: number,
  ): string[] => {
    const dates: string[] = [];

    for (let d = 1; d <= through; d += 1) {
      const at = new Date(Date.UTC(year, month - 1, d));
      if (at.getUTCDay() === dayOfWeek % 7) {
        dates.push(`${year}-${pad(month)}-${pad(d)}`);
      }
    }

    return dates;
  };

  /** An open month and a weekday of it with `count` or more elapsed meeting dates. */
  const stage = async (
    count: number,
  ): Promise<{ month: string; dayOfWeek: number; dates: string[]; created: Date }> => {
    const today = await manilaToday();
    const [year, month, day] = today.split('-').map(Number);

    const candidates = [{ year, month, through: day }];

    if (day <= 7) {
      const previous = new Date(Date.UTC(year, month - 2, 1));
      const previousYear = previous.getUTCFullYear();
      const previousMonth = previous.getUTCMonth() + 1;

      candidates.push({
        year: previousYear,
        month: previousMonth,
        through: new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate(),
      });
    }

    for (const candidate of candidates) {
      for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
        const dates = daysFalling(candidate.year, candidate.month, candidate.through, dayOfWeek);

        if (dates.length >= count) {
          return {
            month: `${candidate.year}-${pad(candidate.month)}-01`,
            dayOfWeek,
            dates,
            created: new Date(Date.UTC(candidate.year - 1, 0, 1, 2)),
          };
        }
      }
    }

    throw new Error(`no open month carries ${count} elapsed meetings falling on one weekday`);
  };

  /** A Manila calendar date shifted by whole days. */
  const shift = (date: string, days: number): string => {
    const [y, m, d] = date.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d + days));

    return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  };

  /** Midday on a Manila date: strictly inside the day, never on a boundary. */
  const manilaNoonOf = (date: string): Date => new Date(`${date}T12:00:00+08:00`);

  /** The most recent Sunday strictly before today — past, and in an open month. */
  const recentSunday = async (): Promise<string> => {
    const today = await manilaToday();
    const [y, m, d] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    return shift(today, weekday === 0 ? -7 : -weekday);
  };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alcantara',
      network: 'MENS',
    });
    await assignTo(db, raymond.id, null);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });

    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Bautista', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });

    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    ben = await createPerson(db, { firstName: 'Ben', lastName: 'Dizon', network: 'MENS' });
    await assignTo(db, ben.id, raymond.id);
    benAccount = await createAccount(app, db, { person: ben, roles: ['LEADER'] });

    juan = await createPerson(db, { firstName: 'Juan', lastName: 'Estrada', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);

    // Outside the pastoral structure altogether (section 5 permits it for an
    // administrator), holding every capability at Whole Church.
    oscar = await createPerson(db, { firstName: 'Oscar', lastName: 'Fajardo', network: 'MENS' });
    adminAccount = await createAccount(app, db, { person: oscar, roles: ['ADMIN'] });
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  const queue = (month: string, as: TestAccount, whose?: string) =>
    request(app.getHttpServer())
      .get('/api/v1/cells/meetings/awaiting')
      .query(whose === undefined ? { month } : { month, whose })
      .set('Authorization', `Bearer ${as.accessToken}`);

  interface Row {
    cell_id: string;
    scheduled_date: string;
    category: string | null;
    member_count: number;
    leader: { id: string; full_name: string | null; is_actor: boolean };
    may_record: boolean;
  }

  const rowsOf = (body: { meetings: Row[] }, cell: TestCell): Row[] =>
    body.meetings.filter((row) => row.cell_id === cell.id);

  const cellsIn = (body: { meetings: Row[] }): Set<string> =>
    new Set(body.meetings.map((row) => row.cell_id));

  const addMember = async (cell: TestCell, person: TestPerson, at: Date): Promise<void> => {
    await db
      .insertInto('cell_memberships')
      .values({ person_id: person.id, cell_id: cell.id, started_at: at })
      .execute();
  };

  describe('the Cell half', () => {
    it('answers `mine` as before, the default, with the new fields added and nobody else’s work', async () => {
      const { month, dayOfWeek, dates, created } = await stage(1);
      const manuelCell = await createCell(db, { leader: manuel, dayOfWeek, createdAt: created });
      await createCell(db, { leader: mark, dayOfWeek, createdAt: created });

      const byDefault = await queue(month, manuelAccount);
      const explicit = await queue(month, manuelAccount, 'mine');

      expect(byDefault.status).toBe(200);
      expect(explicit.status).toBe(200);
      // The default is `mine`, and the two answers are the same answer.
      expect(byDefault.body).toEqual(explicit.body);

      expect(byDefault.body.whose).toBe('mine');
      expect(byDefault.body.open).toBe(true);
      expect(byDefault.body).not.toHaveProperty('dcc');

      // Decision 0251's population: Manuel's own meetings, and Mark's are absent.
      expect(byDefault.body.meetings.map((row: Row) => row.scheduled_date)).toEqual(dates);
      expect(cellsIn(byDefault.body)).toEqual(new Set([manuelCell.id]));

      // Additive: every field decision 0251 returned is still there, with the new ones
      // beside it and nothing else.
      for (const row of byDefault.body.meetings) {
        expect(Object.keys(row).sort()).toEqual(
          [
            'cell_id',
            'cell_code',
            'scheduled_date',
            'scheduled_time',
            'reporting_month',
            'cell_closed_on',
            'day_of_week',
            'category',
            'member_count',
            'leader',
            'may_record',
          ].sort(),
        );
        expect(row.cell_code).toBe(manuelCell.cellId);
        expect(row.reporting_month).toBe(month);
        expect(row.cell_closed_on).toBeNull();
        expect(row.day_of_week).toBe(dayOfWeek);
        expect(row.leader).toEqual({
          id: manuel.id,
          full_name: 'Manuel Bautista',
          is_actor: true,
        });
        expect(row.may_record).toBe(true);
      }
    });

    it('adds a downline leader’s meetings in `branch`, naming them, with Record offered', async () => {
      const { month, dayOfWeek, dates, created } = await stage(1);
      const manuelCell = await createCell(db, { leader: manuel, dayOfWeek, createdAt: created });
      const markCell = await createCell(db, { leader: mark, dayOfWeek, createdAt: created });
      await addMember(markCell, juan, created);

      const response = await queue(month, manuelAccount, 'branch');

      expect(response.status).toBe(200);
      expect(response.body.whose).toBe('branch');
      expect(cellsIn(response.body)).toEqual(new Set([manuelCell.id, markCell.id]));

      const markRows = rowsOf(response.body, markCell);
      expect(markRows.map((row) => row.scheduled_date)).toEqual(dates);
      for (const row of markRows) {
        expect(row.leader).toEqual({ id: mark.id, full_name: 'Mark Castillo', is_actor: false });
        // Manuel is a LEADER, holding cell.submit_on_behalf over his own subtree.
        expect(row.may_record).toBe(true);
      }

      for (const row of rowsOf(response.body, manuelCell)) {
        expect(row.leader.is_actor).toBe(true);
        expect(row.may_record).toBe(true);
      }

      // **`may_record: true` is a promise the submission route must keep.** Manuel
      // records Mark's meeting on his behalf (section 14), and it leaves both views.
      const submitted = await request(app.getHttpServer())
        .post(`/api/v1/cells/${markCell.id}/meetings/${dates[0]}/submit`)
        .set('Authorization', `Bearer ${manuelAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ status: 'HELD', attendance: [{ person_id: juan.id, present: true }] });

      expect(submitted.status).toBe(201);

      const after = await queue(month, manuelAccount, 'branch');
      expect(rowsOf(after.body, markCell).map((row) => row.scheduled_date)).toEqual(dates.slice(1));
    });

    it('never reaches a sibling branch or the upline', async () => {
      const { month, dayOfWeek, created } = await stage(1);
      const raymondCell = await createCell(db, { leader: raymond, dayOfWeek, createdAt: created });
      const manuelCell = await createCell(db, { leader: manuel, dayOfWeek, createdAt: created });
      const markCell = await createCell(db, { leader: mark, dayOfWeek, createdAt: created });
      const benCell = await createCell(db, { leader: ben, dayOfWeek, createdAt: created });

      // Manuel: himself and Mark, never Ben beside him nor Raymond above him.
      const forManuel = await queue(month, manuelAccount, 'branch');
      expect(forManuel.status).toBe(200);
      expect(cellsIn(forManuel.body)).toEqual(new Set([manuelCell.id, markCell.id]));

      // Mark leads nobody: his branch is his own work.
      const forMark = await queue(month, markAccount, 'branch');
      expect(cellsIn(forMark.body)).toEqual(new Set([markCell.id]));

      // Ben: his own, and nothing from Manuel's branch.
      const forBen = await queue(month, benAccount, 'branch');
      expect(cellsIn(forBen.body)).toEqual(new Set([benCell.id]));

      // Raymond, the root, reaches all four — the contrast that shows the three above
      // are narrowed by the tree rather than by something else.
      const forRaymond = await queue(month, raymondAccount, 'branch');
      expect(cellsIn(forRaymond.body)).toEqual(
        new Set([raymondCell.id, manuelCell.id, markCell.id, benCell.id]),
      );
    });

    it('is the pastoral tree and never the grant: a Whole Church administrator outside the tree sees nobody else’s work', async () => {
      const { month, dayOfWeek, created } = await stage(1);
      await createCell(db, { leader: manuel, dayOfWeek, createdAt: created });
      await createCell(db, { leader: mark, dayOfWeek, createdAt: created });
      await createCell(db, { leader: ben, dayOfWeek, createdAt: created });

      const branch = await queue(month, adminAccount, 'branch');
      expect(branch.status).toBe(200);
      expect(branch.body.meetings).toEqual([]);

      const mine = await queue(month, adminAccount);
      expect(mine.status).toBe(200);
      expect(mine.body.meetings).toEqual([]);
    });

    it('lists a downline leader’s row only where the actor may see it and record it', async () => {
      const { month, dayOfWeek, dates, created } = await stage(1);
      const manuelCell = await createCell(db, { leader: manuel, dayOfWeek, createdAt: created });
      const markCell = await createCell(db, { leader: mark, dayOfWeek, createdAt: created });
      await addMember(markCell, juan, created);

      // Manuel's LEADER role is revoked (section 7: revocation sets `revoked_at`, never a
      // delete) and one explicit grant is issued in its place — cell.take_attendance over
      // his own subtree, without cell.submit_on_behalf.
      await db
        .updateTable('account_roles')
        .set({ revoked_at: new Date() })
        .where('account_id', '=', manuelAccount.id)
        .execute();
      await db
        .insertInto('capability_grants')
        .values({
          account_id: manuelAccount.id,
          capability: 'cell.take_attendance',
          scope_type: 'OWN_SUBTREE',
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: adminAccount.id,
        })
        .execute();
      const recorderOnly = manuelAccount;

      // **The tree sets the population and a capability authorizes each row** (section 7):
      // with no viewing capability, another leader's rows are withheld.
      const unseen = await queue(month, recorderOnly, 'branch');
      expect(unseen.status).toBe(200);
      expect(rowsOf(unseen.body, markCell)).toEqual([]);

      await db
        .insertInto('capability_grants')
        .values({
          account_id: manuelAccount.id,
          capability: 'cell.view_subtree',
          scope_type: 'OWN_SUBTREE',
          read_only: true,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: adminAccount.id,
        })
        .execute();

      const response = await queue(month, recorderOnly, 'branch');

      expect(response.status).toBe(200);
      // Seeing is not enough: every queue entry carries the action that resolves it
      // (sections 15 and 19, owner's choice of 2026-09-19), so a meeting he may not record
      // is not listed. His own rows are.
      expect(rowsOf(response.body, markCell)).toEqual([]);
      const ownRows = rowsOf(response.body, manuelCell);
      expect(ownRows.length).toBeGreaterThan(0);
      for (const row of ownRows) {
        expect(row.may_record).toBe(true);
      }

      // **Leaving it out agrees with the submission route**, which refuses him.
      const submitted = await request(app.getHttpServer())
        .post(`/api/v1/cells/${markCell.id}/meetings/${dates[0]}/submit`)
        .set('Authorization', `Bearer ${recorderOnly.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ status: 'HELD', attendance: [{ person_id: juan.id, present: true }] });

      expect(submitted.status).toBe(403);
    });

    it('carries the category and the roster size in force on each scheduled date', async () => {
      const { month, dayOfWeek, dates, created } = await stage(2);
      const cell = await createCell(db, {
        leader: mark,
        dayOfWeek,
        createdAt: created,
        category: 'YOUTH',
      });

      const [first, second] = dates;
      // Strictly between the two meetings, so neither falls on a change's own day —
      // which category a meeting carries when the change lands on its day is not
      // something section 10 states.
      const between = manilaNoonOf(shift(first, 1));

      // A category change taking effect between them (section 10: on the day it is made).
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_categories')
          .set({ ended_at: between })
          .where('cell_id', '=', cell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_categories')
          .values({ cell_id: cell.id, category: 'COUPLE', started_at: between })
          .execute();
      });

      // Juan stays throughout. Pedro leaves between the two meetings. Luis left the day
      // before the first, so is on neither roster.
      await addMember(cell, juan, created);

      const pedro = await createPerson(db, {
        firstName: 'Pedro',
        lastName: 'Garcia',
        network: 'MENS',
      });
      await assignTo(db, pedro.id, mark.id);
      await addMember(cell, pedro, created);
      await db
        .updateTable('cell_memberships')
        .set({ ended_at: between })
        .where('person_id', '=', pedro.id)
        .execute();

      const luis = await createPerson(db, {
        firstName: 'Luis',
        lastName: 'Hernandez',
        network: 'MENS',
      });
      await assignTo(db, luis.id, mark.id);
      await addMember(cell, luis, created);
      await db
        .updateTable('cell_memberships')
        .set({ ended_at: manilaNoonOf(shift(first, -1)) })
        .where('person_id', '=', luis.id)
        .execute();

      const response = await queue(month, markAccount);
      expect(response.status).toBe(200);

      const byDate = new Map(rowsOf(response.body, cell).map((row) => [row.scheduled_date, row]));

      expect(byDate.get(first)?.category).toBe('YOUTH');
      expect(byDate.get(first)?.member_count).toBe(2);

      expect(byDate.get(second)?.category).toBe('COUPLE');
      expect(byDate.get(second)?.member_count).toBe(1);

      // The count is the roster the meeting would be recorded against: the same number
      // `GET …/meetings/{date}/roster` answers is the rule decision 0258 names.
      for (const date of [first, second]) {
        const roster = await request(app.getHttpServer())
          .get(`/api/v1/cells/${cell.id}/meetings/${date}/roster`)
          .set('Authorization', `Bearer ${markAccount.accessToken}`);

        expect(roster.status).toBe(200);
        expect(roster.body.members).toHaveLength(byDate.get(date)?.member_count ?? -1);
      }
    });
  });

  describe('the DCC half', () => {
    let sunday: string;
    let month: string;

    beforeEach(async () => {
      sunday = await recentSunday();
      month = `${sunday.slice(0, 7)}-01`;

      // A Sunday on which every leader beneath the actor still owes a record.
      await db.insertInto('dcc_events').values({ event_date: sunday }).execute();
    });

    // **DCC stays each leader's own checklist** (owner's choice of 2026-09-19, decision
    // 0258): a branch row for DCC led to a page offering no act, so the queue lists none.
    it('lists no DCC in either view, even where the actor’s downline owes a record', async () => {
      for (const whose of ['branch', 'mine']) {
        const response = await queue(month, manuelAccount, whose);
        expect(response.status).toBe(200);
        expect(response.body).not.toHaveProperty('dcc');
      }
    });
  });

  it.each(['bogus', 'Branch', 'MINE', ''])(
    'refuses whose=%p as VALIDATION_FAILED',
    async (whose) => {
      const { month } = await stage(1);

      const response = await queue(month, manuelAccount, whose);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.fields).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'whose' })]),
      );
    },
  );
});
