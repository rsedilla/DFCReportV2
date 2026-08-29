import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { CellsConfigurationService } from '../../src/cells/cells.configuration.service';
import { startOfManilaDay, startOfNextManilaMonth } from '../../src/common/time/manila';
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
 * A Cell's category and schedule (SKILL.md section 10, *Category changes* and
 * *Schedule changes*).
 *
 * Migration 0009 already refuses a second open row per Cell, a period ending before
 * it starts, and a schedule row starting anywhere but the first of a Manila month or
 * the Cell's `created_at`; those are pinned in `test/database/cells.spec.ts`. What is
 * here is the endpoint's half — who may change a Cell's configuration, the effective
 * dates, and the refusals that need a sentence rather than a trigger message.
 *
 * **The two effective dates are the point.** A category change takes effect the day
 * it is made; a schedule change takes effect at the start of the following month, so
 * a month holds exactly one schedule and a past month's coverage figure does not move
 * (section 3). Sharing a handler would put that difference behind a parameter.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('cell configuration (section 10)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;
  let ben: TestPerson;
  let benCell: TestCell;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    const adminPerson = await createPerson(db, { firstName: 'Admin', network: 'MENS' });
    await assignTo(db, adminPerson.id, root.id);
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    markCell = await createCell(db, { leader: mark });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    // A sibling branch: Ben is under the root rather than under Mark, so his Cell is
    // outside Mark's subtree and inside Admin's Whole Church scope.
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, ben.id, root.id);
    benCell = await createCell(db, { leader: ben });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const changeCategory = (actor: TestAccount, cellUuid: string, category: string) =>
    request(app.getHttpServer())
      .put(`/api/v1/cells/${cellUuid}/category`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ category });

  const changeSchedule = (
    actor: TestAccount,
    cellUuid: string,
    dayOfWeek: number,
    timeOfDay: string,
  ) =>
    request(app.getHttpServer())
      .put(`/api/v1/cells/${cellUuid}/schedule`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ day_of_week: dayOfWeek, time_of_day: timeOfDay });

  const closeCellDirectly = (cellUuid: string) =>
    db.transaction().execute(async (trx) => {
      const at = (await sql<{ now: Date }>`SELECT now() AS now`.execute(trx)).rows[0].now;

      await trx
        .updateTable('cells')
        .set({ state: 'CLOSED', closed_at: at, closure_reason: 'MEMBERS_DISPERSED' })
        .where('id', '=', cellUuid)
        .execute();
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: at })
        .where('cell_id', '=', cellUuid)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .updateTable('cell_categories')
        .set({ ended_at: at })
        .where('cell_id', '=', cellUuid)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .updateTable('cell_schedules')
        .set({ ended_at: at })
        .where('cell_id', '=', cellUuid)
        .where('ended_at', 'is', null)
        .execute();
    });

  const categoryRows = (cellUuid: string) =>
    db
      .selectFrom('cell_categories')
      .select(['category', 'started_at', 'ended_at', 'actor_id'])
      .where('cell_id', '=', cellUuid)
      .orderBy('started_at', 'asc')
      .execute();

  const scheduleRows = (cellUuid: string) =>
    db
      .selectFrom('cell_schedules')
      .select(['day_of_week', 'time_of_day', 'started_at', 'ended_at', 'actor_id'])
      .where('cell_id', '=', cellUuid)
      .orderBy('started_at', 'asc')
      .execute();

  describe('category (takes effect the day it is made)', () => {
    it('closes the open row and opens the new one at the same instant', async () => {
      const response = await changeCategory(admin, markCell.id, 'YOUNG_PRO').expect(200);

      expect(response.body).toMatchObject({
        cell_id: markCell.cellId,
        cell_uuid: markCell.id,
        category: 'YOUNG_PRO',
      });

      const rows = await categoryRows(markCell.id);
      expect(rows).toHaveLength(2);

      // Section 10 preserves category history with effective dates, and the two rows
      // must meet exactly: a gap would leave an instant at which the Cell had no
      // category, which `assert_active_cell_is_configured` exists to prevent.
      expect(rows[0].ended_at?.toISOString()).toBe(rows[1].started_at.toISOString());
      expect(rows[1].category).toBe('YOUNG_PRO');
      expect(rows[1].ended_at).toBeNull();
    });

    it('records the actor on the row it opens', async () => {
      // Section 10 gives `cell_categories` an `actor_id`, and migration 0009's header
      // says a null there is for a system action. An endpoint has an authenticated
      // actor in hand, so leaving it null would be recording one thing as another —
      // the defect slice 2 shipped and had to correct.
      await changeCategory(admin, markCell.id, 'COUPLE').expect(200);

      const rows = await categoryRows(markCell.id);
      expect(rows[1].actor_id).toBe(admin.id);
    });

    it('refuses a change to the category the Cell already has', async () => {
      const response = await changeCategory(admin, markCell.id, markCell.category).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      // Nothing was written: the refusal exists to keep a boundary out of the
      // history where nothing happened, so a second row would defeat it.
      expect(await categoryRows(markCell.id)).toHaveLength(1);
    });

    it('refuses a closed Cell, for being closed', async () => {
      await closeCellDirectly(markCell.id);

      const response = await changeCategory(admin, markCell.id, 'YOUNG_PRO').expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      // **The message, not only the code**, and a mutation is what forced it.
      // `closeCellDirectly` ends the category row too, so deleting the closed-Cell
      // refusal entirely leaves this passing through the "no open category row"
      // branch — the same code for a different reason. Two branches, one assertion,
      // neither pinned.
      expect(response.body.error.message).toMatch(/closed/i);
    });

    it('writes one audit entry naming the Cell', async () => {
      await changeCategory(admin, markCell.id, 'YOUNG_PRO').expect(200);

      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'target_type', 'target_id', 'before', 'after'])
        .where('action', '=', 'cell_category.changed')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].target_type).toBe('cell');
      expect(entries[0].target_id).toBe(markCell.id);
      expect(entries[0].before).toMatchObject({ category: markCell.category });
      expect(entries[0].after).toMatchObject({ category: 'YOUNG_PRO' });
    });
  });

  describe('schedule (takes effect at the start of the following month)', () => {
    it('opens the new row at Manila midnight on the first of next month', async () => {
      const response = await changeSchedule(admin, markCell.id, 7, '16:00').expect(200);

      // The expected instant is computed the same way the service computes it, which
      // would make this vacuous on its own — so the assertions below check the
      // *properties* section 10 states rather than only the equality: the instant is
      // a Manila month boundary, and it is in the future.
      const expected = startOfManilaDay(startOfNextManilaMonth(new Date()));
      expect(response.body.effective_from).toBe(expected.toISOString());

      // Manila is UTC+8 with no daylight saving, so a Manila month boundary is 16:00
      // UTC on the last day of the previous month. Section 10 says exactly this, and
      // it is what `cell_schedules_start_is_legal` checks against — so a UTC-derived
      // month would fail here rather than silently.
      expect(expected.getUTCHours()).toBe(16);
      expect(expected.getUTCMinutes()).toBe(0);
      expect(expected.getTime()).toBeGreaterThan(Date.now());

      const rows = await scheduleRows(markCell.id);
      expect(rows).toHaveLength(2);
      expect(rows[0].ended_at?.toISOString()).toBe(expected.toISOString());
      expect(rows[1].started_at.toISOString()).toBe(expected.toISOString());
      expect(rows[1].day_of_week).toBe(7);
      expect(rows[1].ended_at).toBeNull();
    });

    it('does not take effect immediately, which is the whole of the rule', async () => {
      // The distinguishing assertion against the category rule. If a schedule change
      // took effect now, the outgoing row would end in the past and the month would
      // hold two schedules — which is what section 10 says silently rewrites every
      // earlier coverage figure.
      await changeSchedule(admin, markCell.id, 7, '16:00').expect(200);

      const rows = await scheduleRows(markCell.id);
      expect(rows[1].started_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('refuses a second change while one is already pending', async () => {
      await changeSchedule(admin, markCell.id, 7, '16:00').expect(200);

      // Both changes resolve to the same instant, so the second would close the first
      // at its own `started_at` — the zero-length row section 5 makes inert, which
      // would remove the Cell's schedule from every as-of query with nothing raised.
      const response = await changeSchedule(admin, markCell.id, 6, '10:00').expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      const rows = await scheduleRows(markCell.id);
      expect(rows).toHaveLength(2);
      expect(rows[1].day_of_week).toBe(7);
    });

    it('refuses a change to the day and time the Cell already has', async () => {
      const response = await changeSchedule(
        admin,
        markCell.id,
        markCell.dayOfWeek,
        markCell.timeOfDay,
      ).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await scheduleRows(markCell.id)).toHaveLength(1);
    });

    it('accepts a change to the time alone', async () => {
      // The no-op refusal compares both fields, so a change to one of them is a real
      // change. Pinned because a refusal keyed on the day alone would look correct
      // and would block a Cell moving from 16:00 to 19:00.
      await changeSchedule(admin, markCell.id, markCell.dayOfWeek, '19:30').expect(200);

      const rows = await scheduleRows(markCell.id);
      expect(rows).toHaveLength(2);
      expect(rows[1].day_of_week).toBe(markCell.dayOfWeek);
      expect(rows[1].time_of_day).toMatch(/^19:30/);
    });

    it('refuses a closed Cell, for being closed', async () => {
      await closeCellDirectly(markCell.id);

      const response = await changeSchedule(admin, markCell.id, 7, '16:00').expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/closed/i);
    });

    it('refuses a day outside the ISO range as VALIDATION_FAILED', async () => {
      // Section 20's day numbering is 1..7. The database refuses it too; this is here
      // so a bad value is an answer rather than a constraint violation.
      const response = await changeSchedule(admin, markCell.id, 0, '16:00').expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('scope (section 7 resolves a Cell through its leader)', () => {
    it('lets a leader configure their own Cell', async () => {
      // `cell.manage_configuration` is own/subtree for a LEADER, and a Cell resolves
      // through its leader — so Mark reaches his own Cell without section 10's list
      // of holders being restated anywhere in the service.
      await changeCategory(markAccount, markCell.id, 'YOUNG_PRO').expect(200);
    });

    it("refuses a leader on a sibling branch's Cell", async () => {
      // Ben is under the root rather than under Mark, so his Cell is outside Mark's
      // subtree. Without this, `cell.manage_configuration` at own/subtree would reach
      // every Cell in the church.
      const response = await changeCategory(markAccount, benCell.id, 'YOUNG_PRO').expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses in the transaction too, not only at the guard', async () => {
      // **Every case above passes if *either* the guard or the in-transaction
      // re-check is present**, so together they pin the disjunction and neither
      // member. Deleting `assertStillInScopeWithin` left all seventeen green, which
      // is the fault this repository keeps recording — a check with nothing able to
      // fail on it.
      //
      // The re-check exists for a window no request can stage: a handover committing
      // between the guard's answer on the pool and the transaction opening. So it is
      // called directly, bypassing the guard, which is what the 2026-08-23 identifier
      // ruling prescribes for exactly this shape.
      const service = app.get(CellsConfigurationService);

      await expect(
        service.changeCategory(
          benCell.id,
          'YOUNG_PRO',
          { accountId: markAccount.id, personId: mark.id },
          { accountId: markAccount.id, key: randomUUID(), claimId: randomUUID() },
        ),
      ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });

      // And nothing was written by the attempt.
      expect(await categoryRows(benCell.id)).toHaveLength(1);
    });

    it('answers SCOPE_DENIED rather than NOT_FOUND for a Cell that does not exist', async () => {
      // Section 22, as amended on 2026-08-29: an actor whose scope does not cover a
      // Cell cannot distinguish an absent one from one they may not see. Both answer
      // `SCOPE_DENIED`, in one message with one details payload.
      const absent = await changeCategory(markAccount, randomUUID(), 'YOUNG_PRO').expect(403);
      const outOfScope = await changeCategory(markAccount, benCell.id, 'YOUNG_PRO').expect(403);

      expect(absent.body.error.code).toBe('SCOPE_DENIED');
      expect(absent.body.error.message).toBe(outOfScope.body.error.message);
      expect(absent.body.error.details).toEqual(outOfScope.body.error.details);
    });

    it('answers NOT_FOUND for an absent Cell where the scope would have covered it', async () => {
      // Admin holds Whole Church, so absence is genuinely absence for them — which is
      // the other half of section 22's rule, and the half that keeps the answer
      // truthful for the actor who can see everything.
      const response = await changeCategory(admin, randomUUID(), 'YOUNG_PRO').expect(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('idempotency (section 22)', () => {
    it('replays the stored response rather than changing the category twice', async () => {
      const key = randomUUID();
      const send = () =>
        request(app.getHttpServer())
          .put(`/api/v1/cells/${markCell.id}/category`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('Idempotency-Key', key)
          .send({ category: 'YOUNG_PRO' });

      const first = await send().expect(200);
      const replay = await send().expect(200);

      expect(replay.body).toEqual(first.body);

      // The replay must not have opened a third row. Without `completeWithin` inside
      // the transaction the second request would run the write again and leave the
      // history with a boundary nobody asked for.
      expect(await categoryRows(markCell.id)).toHaveLength(2);
    });
  });
});
