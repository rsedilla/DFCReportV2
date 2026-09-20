import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
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
 * The Network screen's monthly figures: `GET /api/v1/leaders/{id}/dcc-behind` and
 * `GET /api/v1/leaders/{id}/cell-figures` (SKILL.md section 17, decision 0252).
 *
 * **What is pinned is the tally.** Each figure is a sum, over a branch as it stands now,
 * of each leader's *own* unmet obligations, each obligation owned by exactly one leader
 * (section 20; the ownership decision 0254 states for Reports). So the focus leader's
 * branch total is their own gap plus the sum of `behind_by_child`, an obligation moves
 * exactly one row when it is met, and a meeting after a handover is charged to the leader
 * on its date rather than to the Cell's current leader.
 *
 * **Every date comes from the database's own Manila day.** These routes answer the
 * current month only and read their instant from the database with no seam to inject
 * one, so a literal date is true for a few weeks and then a defect that is the calendar.
 * Where the calendar cannot stage a case -- no Sunday of this month has begun yet, say --
 * the case narrows to what it can assert and says so, rather than failing or skipping
 * silently. The recording-queue spec takes the same approach.
 *
 * The tree is `Oriel (root) -> { Raymond -> { Manuel -> Mark -> Noel, Ben }, Rico -> Juan }`.
 * Pastoral leaders, and so DCC obligation holders, are Oriel, Raymond, Manuel, Mark and
 * Rico; Ben, Noel and Juan lead nobody.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('the Network screen figures (SKILL.md section 17, decision 0252)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let noel: TestPerson;
  let ben: TestPerson;
  let rico: TestPerson;
  let juan: TestPerson;

  let admin: TestAccount;
  let raymondAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    noel = await createPerson(db, { firstName: 'Noel', network: 'MENS' });
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, noel.id, mark.id);
    await assignTo(db, ben.id, raymond.id);
    await assignTo(db, rico.id, oriel.id);
    await assignTo(db, juan.id, rico.id);

    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Dates, all from the database's Manila day
  // ---------------------------------------------------------------------------

  const pad = (value: number): string => String(value).padStart(2, '0');

  const manilaToday = async (): Promise<string> => {
    const result = await sql<{ today: string }>`
      SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
    `.execute(db);

    return result.rows[0].today;
  };

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  /** ISO 8601 weekday: 1 is Monday, 7 is Sunday. */
  const isoWeekday = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  };

  /** Every day of the current month on `weekday`, split around today (today is begun). */
  const monthDays = async (
    weekday: number,
  ): Promise<{ month: string; begun: string[]; ahead: string[] }> => {
    const today = await manilaToday();
    const [y, m] = today.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const days: string[] = [];

    for (let d = 1; d <= last; d += 1) {
      const date = `${y}-${pad(m)}-${pad(d)}`;
      if (isoWeekday(date) === weekday) {
        days.push(date);
      }
    }

    return {
      month: `${y}-${pad(m)}-01`,
      begun: days.filter((date) => date <= today),
      ahead: days.filter((date) => date > today),
    };
  };

  /** The instant a Manila day begins. */
  const startOfManila = (date: string): Date => new Date(`${date}T00:00:00+08:00`);

  /** Long enough ago that a Cell's schedule governs every day of the current month. */
  const lastYear = async (): Promise<Date> => {
    const year = Number((await manilaToday()).slice(0, 4));

    return new Date(Date.UTC(year - 1, 0, 1, 2));
  };

  // ---------------------------------------------------------------------------
  // Fixture writes
  // ---------------------------------------------------------------------------

  const createEvent = async (eventDate: string, removedBy?: TestAccount): Promise<string> => {
    const row = await db
      .insertInto('dcc_events')
      .values({
        event_date: eventDate,
        removed_at: removedBy ? new Date() : null,
        removed_by: removedBy?.id ?? null,
        removal_reason: removedBy ? 'Typhoon signal no. 3' : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  /** A live DCC line for one person, attributed to their responsible leader. */
  const recordDcc = async (eventId: string, personId: string, leaderId: string): Promise<void> => {
    await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: personId,
        present: true,
        responsible_leader_id: leaderId,
        recorded_by: admin.id,
      })
      .execute();
  };

  const mondayOf = (date: string): string => shift(date, 1 - isoWeekday(date));

  /** A meeting row for a Cell's scheduled date, in whichever status the case names. */
  const recordMeeting = async (
    cell: TestCell,
    scheduledDate: string,
    status: 'HELD' | 'NOT_HELD' | 'RESCHEDULED',
  ): Promise<void> => {
    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: cell.id,
        scheduled_date: scheduledDate,
        scheduled_time: cell.timeOfDay,
        week_starting: mondayOf(scheduledDate),
        reporting_month: `${scheduledDate.slice(0, 7)}-01`,
        status,
        not_held_reason: status === 'NOT_HELD' ? 'LEADER_UNAVAILABLE' : null,
        actual_date: status === 'RESCHEDULED' ? shift(scheduledDate, 1) : null,
        actual_time: status === 'RESCHEDULED' ? cell.timeOfDay : null,
        responsible_leader_id: cell.leaderId,
      })
      .execute();
  };

  const handOver = async (cell: TestCell, to: TestPerson, at: Date): Promise<void> => {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: at })
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({ person_id: to.id, cell_id: cell.id, started_at: at })
        .execute();
    });
  };

  const grant = async (
    account: TestAccount,
    capability: 'people.view_subtree' | 'dcc.view_subtree' | 'cell.view_subtree',
  ): Promise<void> => {
    await db
      .insertInto('capability_grants')
      .values({
        account_id: account.id,
        capability,
        scope_type: 'OWN_SUBTREE',
        read_only: true,
        reason: 'A reader holding one Network screen capability and not the others.',
        granted_by: admin.id,
      })
      .execute();
  };

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  const dccBehind = (as: TestAccount, id: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/leaders/${id}/dcc-behind`)
      .set('Authorization', `Bearer ${as.accessToken}`);

  const cellFigures = (as: TestAccount, id: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/leaders/${id}/cell-figures`)
      .set('Authorization', `Bearer ${as.accessToken}`);

  const children = (as: TestAccount, id: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/leaders/${id}/children`)
      .set('Authorization', `Bearer ${as.accessToken}`);

  const sumOf = (byChild: Record<string, number>): number =>
    Object.values(byChild).reduce((sum, value) => sum + value, 0);

  // ---------------------------------------------------------------------------
  // DCC records behind
  // ---------------------------------------------------------------------------

  describe('DCC records behind', () => {
    it('answers the current month, open, in its own shape and no other', async () => {
      const { month } = await monthDays(7);

      const response = await dccBehind(admin, raymond.id);

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        'behind_by_child',
        'branch_behind',
        'open',
        'reporting_month',
      ]);
      expect(response.body.reporting_month).toBe(month);
      // Section 17: the month is named and marked open.
      expect(response.body.open).toBe(true);
      // Every direct disciple has a row, a zero included, so the screen's filter can
      // work across the whole generation.
      expect(Object.keys(response.body.behind_by_child).sort()).toEqual([manuel.id, ben.id].sort());
    });

    it('tallies: the branch is the leader’s own gap plus the sum of their rows', async () => {
      const { begun } = await monthDays(7);
      for (const sunday of begun) {
        await createEvent(sunday);
      }
      const k = begun.length;

      // Raymond owes k for Manuel and Ben; Manuel owes k for Mark; Mark owes k for Noel.
      // Ben leads nobody and owes nothing.
      const forRaymond = await dccBehind(admin, raymond.id);
      expect(forRaymond.status).toBe(200);
      expect(forRaymond.body.behind_by_child).toEqual({ [manuel.id]: 2 * k, [ben.id]: 0 });
      expect(forRaymond.body.branch_behind).toBe(3 * k);
      expect(forRaymond.body.branch_behind).toBe(k + sumOf(forRaymond.body.behind_by_child));

      // At the root the sibling branch joins: Rico owes k for Juan.
      const forOriel = await dccBehind(admin, oriel.id);
      expect(forOriel.body.behind_by_child).toEqual({ [raymond.id]: 3 * k, [rico.id]: k });
      expect(forOriel.body.branch_behind).toBe(5 * k);
      expect(forOriel.body.branch_behind).toBe(k + sumOf(forOriel.body.behind_by_child));

      // `k` is zero only in the days before this month's first Sunday; the tally still
      // holds then, trivially, which is all the calendar lets the case say.
    });

    it('moves exactly one row at every level when one obligation is met', async () => {
      const { begun } = await monthDays(7);

      if (begun.length === 0) {
        // No Sunday of this month has begun, so no obligation exists to meet.
        expect((await dccBehind(admin, oriel.id)).body.branch_behind).toBe(0);
        return;
      }

      const eventId = await createEvent(begun[begun.length - 1]);

      const beforeRaymond = (await dccBehind(admin, raymond.id)).body;
      const beforeOriel = (await dccBehind(admin, oriel.id)).body;

      // Mark's line, recorded under Manuel: Manuel's own obligation for that event.
      await recordDcc(eventId, mark.id, manuel.id);

      const afterRaymond = (await dccBehind(admin, raymond.id)).body;
      const afterOriel = (await dccBehind(admin, oriel.id)).body;

      expect(afterRaymond.behind_by_child).toEqual({
        [manuel.id]: beforeRaymond.behind_by_child[manuel.id] - 1,
        [ben.id]: beforeRaymond.behind_by_child[ben.id],
      });
      expect(afterRaymond.branch_behind).toBe(beforeRaymond.branch_behind - 1);

      expect(afterOriel.behind_by_child).toEqual({
        [raymond.id]: beforeOriel.behind_by_child[raymond.id] - 1,
        [rico.id]: beforeOriel.behind_by_child[rico.id],
      });
      expect(afterOriel.branch_behind).toBe(beforeOriel.branch_behind - 1);

      // Manuel's own branch: himself now clear, Mark still owing for Noel.
      const forManuel = (await dccBehind(admin, manuel.id)).body;
      expect(forManuel.behind_by_child).toEqual({ [mark.id]: 1 });
      expect(forManuel.branch_behind).toBe(1);
    });

    it('owes nothing for a Sunday not yet begun, nor for a removed one', async () => {
      const { begun, ahead } = await monthDays(7);

      // At least one of the two always exists: a month has four Sundays or more.
      expect(begun.length + ahead.length).toBeGreaterThanOrEqual(4);

      if (ahead.length > 0) {
        await createEvent(ahead[0]);
      }
      if (begun.length > 0) {
        await createEvent(begun[begun.length - 1], admin);
      }

      const response = await dccBehind(admin, oriel.id);

      expect(response.status).toBe(200);
      expect(response.body.branch_behind).toBe(0);
      expect(response.body.behind_by_child).toEqual({ [raymond.id]: 0, [rico.id]: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // Cell meetings behind, and Cell Leaders beneath
  // ---------------------------------------------------------------------------

  describe('Cell meetings behind', () => {
    it('answers the current month, open, in its own shape and no other', async () => {
      const { month } = await monthDays(1);

      const response = await cellFigures(admin, raymond.id);

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        'branch_meetings_behind',
        'cell_leaders_beneath',
        'meetings_behind_by_child',
        'open',
        'reporting_month',
      ]);
      expect(response.body.reporting_month).toBe(month);
      expect(response.body.open).toBe(true);
      expect(Object.keys(response.body.meetings_behind_by_child).sort()).toEqual(
        [manuel.id, ben.id].sort(),
      );
    });

    it('counts each meeting whose day has begun, and none ahead of today', async () => {
      // Meeting on today's weekday: today's own meeting has begun and counts.
      const today = await manilaToday();
      const weekday = isoWeekday(today);
      const { begun, ahead } = await monthDays(weekday);
      const created = await lastYear();

      await createCell(db, { leader: manuel, dayOfWeek: weekday, createdAt: created });
      await createCell(db, { leader: mark, dayOfWeek: weekday, createdAt: created });
      await createCell(db, { leader: raymond, dayOfWeek: weekday, createdAt: created });

      const response = await cellFigures(admin, raymond.id);

      // `begun` holds today at least; `ahead` holds any later date on the same weekday,
      // which are scheduled and are not behind (decision 0238).
      expect(begun).toContain(today);
      expect(response.body.meetings_behind_by_child).toEqual({
        [manuel.id]: 2 * begun.length,
        [ben.id]: 0,
      });
      // Raymond's own Cell is his own gap: in the branch, in no child's row.
      expect(response.body.branch_meetings_behind).toBe(3 * begun.length);
      expect(response.body.branch_meetings_behind).toBe(
        begun.length + sumOf(response.body.meetings_behind_by_child),
      );
      // Stated so the exclusion is visible where the calendar allows it.
      expect(ahead.every((date) => date > today)).toBe(true);
    });

    it('is not behind on a Cell whose every meeting this month is still ahead', async () => {
      // A Cell created today, meeting on tomorrow's weekday: every meeting it has this
      // month is on a day not yet begun. Where today is the month's last day tomorrow is
      // next month and the Cell has no meeting here at all, so the answer is zero either
      // way -- but only the first case is the one this names.
      const tomorrow = shift(await manilaToday(), 1);
      await createCell(db, { leader: manuel, dayOfWeek: isoWeekday(tomorrow) });

      const response = await cellFigures(admin, raymond.id);

      expect(response.status).toBe(200);
      expect(response.body.meetings_behind_by_child[manuel.id]).toBe(0);
      expect(response.body.branch_meetings_behind).toBe(0);
    });

    it('clears a meeting recorded in any status', async () => {
      const weekday = isoWeekday(await manilaToday());
      const { begun } = await monthDays(weekday);
      const created = await lastYear();
      const first = begun[0];

      const held = await createCell(db, {
        leader: manuel,
        dayOfWeek: weekday,
        createdAt: created,
      });
      const notHeld = await createCell(db, {
        leader: mark,
        dayOfWeek: weekday,
        createdAt: created,
      });
      const moved = await createCell(db, { leader: ben, dayOfWeek: weekday, createdAt: created });

      const before = (await cellFigures(admin, raymond.id)).body;

      await recordMeeting(held, first, 'HELD');
      await recordMeeting(notHeld, first, 'NOT_HELD');
      await recordMeeting(moved, first, 'RESCHEDULED');

      const after = (await cellFigures(admin, raymond.id)).body;

      // Manuel's row holds his and Mark's Cells; Ben's holds his own.
      expect(before.meetings_behind_by_child).toEqual({
        [manuel.id]: 2 * begun.length,
        [ben.id]: begun.length,
      });
      expect(after.meetings_behind_by_child).toEqual({
        [manuel.id]: 2 * begun.length - 2,
        [ben.id]: begun.length - 1,
      });
      expect(after.branch_meetings_behind).toBe(before.branch_meetings_behind - 3);
    });

    it('charges a meeting after a handover to the leader on its date', async () => {
      // Manuel's Cell, handed to Ben the evening before today. Today's meeting is Ben's;
      // every earlier one this month stays Manuel's although Ben leads the Cell now
      // (section 20) -- which only a month with an earlier meeting on this weekday can
      // show, and from the 8th onward every month does.
      const today = await manilaToday();
      const weekday = isoWeekday(today);
      const { begun } = await monthDays(weekday);
      const cell = await createCell(db, {
        leader: manuel,
        dayOfWeek: weekday,
        createdAt: await lastYear(),
      });

      await handOver(cell, ben, new Date(startOfManila(today).getTime() - 60 * 60 * 1000));

      const response = await cellFigures(admin, raymond.id);

      expect(response.status).toBe(200);
      expect(response.body.meetings_behind_by_child).toEqual({
        [manuel.id]: begun.length - 1,
        [ben.id]: 1,
      });
      expect(response.body.branch_meetings_behind).toBe(begun.length);
    });
  });

  describe('Cell Leaders beneath', () => {
    it('counts current Cell Leaders beneath the person, never the person or a closed Cell’s', async () => {
      // Oriel and Raymond each lead a Cell -- the focus person is not beneath themselves.
      await createCell(db, { leader: oriel });
      await createCell(db, { leader: raymond });
      // Manuel leads two and is one leader.
      await createCell(db, { leader: manuel });
      await createCell(db, { leader: manuel });
      // Mark's Cell is closed, so he is not a current Cell Leader (decision 0025).
      const marks = await createCell(db, { leader: mark });
      await closeCellDirectly(db, marks.id, { reason: 'MEMBERS_DISPERSED' });
      // Juan is in Oriel's branch and not in Raymond's.
      await createCell(db, { leader: juan });

      const forRaymond = await cellFigures(admin, raymond.id);
      expect(forRaymond.status).toBe(200);
      expect(forRaymond.body.cell_leaders_beneath).toBe(1);

      const forOriel = await cellFigures(admin, oriel.id);
      // Raymond, Manuel and Juan.
      expect(forOriel.body.cell_leaders_beneath).toBe(3);

      const forNoel = await cellFigures(admin, noel.id);
      expect(forNoel.body.cell_leaders_beneath).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Never combined
  // ---------------------------------------------------------------------------

  it('keeps DCC and Cell figures apart: neither route counts the other’s obligations', async () => {
    const weekday = isoWeekday(await manilaToday());
    const { begun: cellDays } = await monthDays(weekday);
    const { begun: sundays } = await monthDays(7);

    for (const sunday of sundays) {
      await createEvent(sunday);
    }
    await createCell(db, { leader: ben, dayOfWeek: weekday, createdAt: await lastYear() });

    const dcc = (await dccBehind(admin, raymond.id)).body;
    const cell = (await cellFigures(admin, raymond.id)).body;

    // Ben owes no DCC record (he leads nobody) and every Cell meeting; Manuel and Mark
    // owe DCC records and lead no Cell.
    expect(dcc.behind_by_child[ben.id]).toBe(0);
    expect(dcc.branch_behind).toBe(3 * sundays.length);
    expect(cell.meetings_behind_by_child[ben.id]).toBe(cellDays.length);
    expect(cell.meetings_behind_by_child[manuel.id]).toBe(0);
    expect(cell.branch_meetings_behind).toBe(cellDays.length);
  });

  // ---------------------------------------------------------------------------
  // Authorization
  // ---------------------------------------------------------------------------

  describe('each figure is read under its own capability (decision 0252)', () => {
    it('refuses both figures to a reader holding only people.view_subtree', async () => {
      const reader = await createAccount(app, db, { person: manuel, roles: [] });
      await grant(reader, 'people.view_subtree');

      // The tree is reachable, which is what makes the refusals mean something.
      expect((await children(reader, manuel.id)).status).toBe(200);

      const dcc = await dccBehind(reader, manuel.id);
      expect(dcc.status).toBe(403);
      expect(dcc.body.error.code).toBe('CAPABILITY_DENIED');

      const cell = await cellFigures(reader, manuel.id);
      expect(cell.status).toBe(403);
      expect(cell.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('answers a reader holding dcc.view_subtree the DCC figure and not the Cell one', async () => {
      const reader = await createAccount(app, db, { person: manuel, roles: [] });
      await grant(reader, 'dcc.view_subtree');

      expect((await dccBehind(reader, manuel.id)).status).toBe(200);
      expect((await cellFigures(reader, manuel.id)).status).toBe(403);
    });

    it('answers a reader holding cell.view_subtree the Cell figures and not the DCC one', async () => {
      const reader = await createAccount(app, db, { person: manuel, roles: [] });
      await grant(reader, 'cell.view_subtree');

      expect((await cellFigures(reader, manuel.id)).status).toBe(200);
      expect((await dccBehind(reader, manuel.id)).status).toBe(403);
    });
  });

  describe('scope first, existence second (section 22, decision 0253)', () => {
    it.each([
      ['dcc-behind', dccBehind],
      ['cell-figures', cellFigures],
    ])(
      '%s answers a narrow grant identically for nobody and for somebody out of scope',
      async (_route, call) => {
        const absent = await call(raymondAccount, randomUUID());
        const outOfScope = await call(raymondAccount, rico.id);

        expect(absent.status).toBe(403);
        expect(absent.body.error.code).toBe('SCOPE_DENIED');
        expect(outOfScope.body).toEqual(absent.body);
      },
    );

    it.each([
      ['dcc-behind', dccBehind],
      ['cell-figures', cellFigures],
    ])(
      '%s reaches NOT_FOUND only for a scope that would have covered the person',
      async (_route, call) => {
        const missingId = randomUUID();

        const narrow = await call(raymondAccount, missingId);
        const wide = await call(admin, missingId);

        expect([narrow.status, wide.status]).toEqual([403, 404]);
        expect(wide.body.error.code).toBe('NOT_FOUND');
      },
    );
  });

  describe('what a leader may read (SKILL.md section 7)', () => {
    it('reads a leader inside their own subtree, and themselves', async () => {
      expect((await dccBehind(raymondAccount, manuel.id)).status).toBe(200);
      expect((await cellFigures(raymondAccount, manuel.id)).status).toBe(200);
      expect((await dccBehind(raymondAccount, raymond.id)).status).toBe(200);
    });

    it('answers an identifier in another case exactly as its canonical form', async () => {
      // The branch walk keys its maps by the database's lowercase identifiers and seeds
      // them with the path's, so it depends on decision 0101's global normalization: an
      // uppercase path that reached it raw would answer a branch of one and zeroes.
      const { begun } = await monthDays(7);
      for (const sunday of begun) {
        await createEvent(sunday);
      }

      const canonical = await dccBehind(admin, raymond.id);
      const shouted = await dccBehind(admin, raymond.id.toUpperCase());

      expect(shouted.status).toBe(200);
      expect(shouted.body).toEqual(canonical.body);
    });

    it('is refused their own upline', async () => {
      const response = await dccBehind(raymondAccount, oriel.id);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect((await cellFigures(raymondAccount, oriel.id)).status).toBe(403);
    });
  });
});
