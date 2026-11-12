import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  addCellMember,
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { AuditAction, Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * The Network Admin records on a leader's behalf, and the limits (SKILL.md sections 7, 9 and
 * 14, decision 0469, point 5): DCC and Cell meetings of their own Network while the week is
 * open, a root's 12 and a root's Cell included. A Network root's own DCC line and every
 * closed week stay with the Admin. Every name is invented (CLAUDE.md, Secrets).
 *
 * The tree: Wilma (Women's root, no account) -> Wanda (Leader account, a Cell) -> Winnie,
 * and Wilma -> Wendy (no account). Mario (Men's root) -> Manny (Leader account, a Cell) ->
 * Milo. Nora is the Women's Network Admin and Ada the Admin, both outside the tree.
 */
describe('the Network Admin records on a leader’s behalf (decision 0469)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let networkAdmin: TestAccount;
  let womensRoot: TestPerson;
  let mensRoot: TestPerson;
  let wanda: TestPerson;
  let wandaAccount: TestAccount;
  let wendy: TestPerson;
  let winnie: TestPerson;
  let manny: TestPerson;
  let milo: TestPerson;

  let today: string;
  /** The most recent Sunday before today, whose week is open. */
  let eventId: string;
  /** A Sunday long past, whose week is closed. */
  let closedEventId: string;

  const previous = process.env.WEEKLY_DEADLINE_FROM;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.WEEKLY_DEADLINE_FROM;
    } else {
      process.env.WEEKLY_DEADLINE_FROM = previous;
    }
    await app.close();
    await db.destroy();
  });

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  /** ISO 8601: 1 is Monday, 7 is Sunday. */
  const isoWeekday = (day: string): number => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();

    return weekday === 0 ? 7 : weekday;
  };

  const sundayEvent = async (date: string): Promise<string> =>
    (
      await db
        .insertInto('dcc_events')
        .values({ event_date: date })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  beforeEach(async () => {
    await truncateAll(db);
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';

    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ada', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    womensRoot = await createPerson(db, { firstName: 'Wilma', network: 'WOMENS' });
    await assignTo(db, womensRoot.id, null);
    mensRoot = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mensRoot.id, null);

    wanda = await createPerson(db, { firstName: 'Wanda', network: 'WOMENS' });
    await assignTo(db, wanda.id, womensRoot.id);
    wendy = await createPerson(db, { firstName: 'Wendy', network: 'WOMENS' });
    await assignTo(db, wendy.id, womensRoot.id);
    winnie = await createPerson(db, { firstName: 'Winnie', network: 'WOMENS' });
    await assignTo(db, winnie.id, wanda.id);

    manny = await createPerson(db, { firstName: 'Manny', network: 'MENS' });
    await assignTo(db, manny.id, mensRoot.id);
    milo = await createPerson(db, { firstName: 'Milo', network: 'MENS' });
    await assignTo(db, milo.id, manny.id);

    today = (
      await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
      `.execute(db)
    ).rows[0].today;
    const lastSunday = shift(today, -(isoWeekday(today) % 7 === 0 ? 7 : isoWeekday(today)));
    eventId = await sundayEvent(lastSunday);
    closedEventId = await sundayEvent(shift(lastSunday, -70));

    // Accounts older than both Sundays, so each leader owed them (decision 0403).
    const longAgo = new Date(`${shift(today, -365)}T02:00:00Z`);
    wandaAccount = await createAccount(app, db, {
      person: wanda,
      roles: ['LEADER'],
      createdAt: longAgo,
    });
    await createAccount(app, db, { person: manny, roles: ['LEADER'], createdAt: longAgo });

    networkAdmin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['NETWORK_ADMIN'],
    });
  });

  const post = (account: TestAccount, path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const refused = (response: request.Response): [number, string] => [
    response.status,
    (response.body.error?.code ?? response.body.code) as string,
  ];

  const mark = (
    account: TestAccount,
    person: TestPerson,
    extra: Record<string, unknown> = {},
    event = eventId,
  ) =>
    post(account, `/dcc/events/${event}/submit`, {
      records: [{ person_id: person.id, present: true, version: null }],
      ...extra,
    });

  const auditOf = (action: AuditAction, targetId: string) =>
    db
      .selectFrom('audit_log')
      .select(['actor_id'])
      .where('action', '=', action)
      .where('target_id', '=', targetId)
      .execute();

  describe('DCC', () => {
    it('records a leader’s disciple, as on behalf', async () => {
      expect((await mark(networkAdmin, winnie)).status).toBe(201);

      expect(await auditOf('dcc_attendance.submitted_on_behalf', winnie.id)).toEqual([
        { actor_id: networkAdmin.id },
      ]);
    });

    it('corrects a line a leader recorded', async () => {
      expect((await mark(wandaAccount, winnie)).status).toBe(201);

      const response = await post(networkAdmin, `/dcc/events/${eventId}/submit`, {
        records: [
          { person_id: winnie.id, present: false, version: 1, correction_reason: 'She was away.' },
        ],
      });

      expect({ status: response.status, body: response.body }).toMatchObject({
        status: 201,
        body: { corrected: 1 },
      });
    });

    it('reads and records a root’s 12 where the root holds no account', async () => {
      const roster = await get(
        networkAdmin,
        `/dcc/events/${eventId}/leaders/${womensRoot.id}/roster?limit=200`,
      ).expect(200);

      // Wanda holds an account, so Winnie is hers; Wendy holds none and has nobody.
      expect(
        (roster.body.data as { person_id: string }[]).map((line) => line.person_id).sort(),
      ).toEqual([wanda.id, wendy.id].sort());
      expect((await mark(networkAdmin, wendy)).status).toBe(201);
    });

    it('is offered Record on that root’s row of Pending DCC Records, and on no Men’s row', async () => {
      const response = await get(networkAdmin, '/dcc/pending-leaders').expect(200);
      const rows = response.body.data as {
        leader: { person_id: string };
        may_record: boolean;
        record_for: string | null;
        recorded_by_administrator: boolean;
      }[];

      expect(rows.find((row) => row.leader.person_id === womensRoot.id)).toMatchObject({
        may_record: true,
        record_for: womensRoot.id,
        recorded_by_administrator: true,
      });
      expect(rows.find((row) => row.leader.person_id === wanda.id)).toMatchObject({
        may_record: true,
        record_for: wanda.id,
      });
      expect(rows.some((row) => [mensRoot.id, manny.id].includes(row.leader.person_id))).toBe(
        false,
      );
    });

    it('is refused a Network root’s own line, which the Admin records', async () => {
      expect(refused(await mark(networkAdmin, womensRoot))).toEqual([403, 'SCOPE_DENIED']);
      expect(await db.selectFrom('dcc_attendance').select('id').execute()).toEqual([]);

      expect((await mark(admin, womensRoot)).status).toBe(201);
    });

    it('is not shown a root’s own line on the checklist of a root who records it', async () => {
      // Wilma as a Senior Pastor, whose Whole Church grant puts both roots on her checklist.
      nameSeniorPastors(app, [womensRoot.id, mensRoot.id]);
      await createAccount(app, db, {
        person: womensRoot,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
        createdAt: new Date(`${shift(today, -365)}T02:00:00Z`),
      });
      const linesFor = async (reader: TestAccount): Promise<string[]> =>
        (
          (
            await get(
              reader,
              `/dcc/events/${eventId}/leaders/${womensRoot.id}/roster?limit=200`,
            ).expect(200)
          ).body.data as { person_id: string }[]
        ).map((line) => line.person_id);

      const own = await linesFor(networkAdmin);
      expect(own).toEqual(expect.arrayContaining([wanda.id, wendy.id]));
      expect(own).not.toContain(womensRoot.id);
      expect(own).not.toContain(mensRoot.id);
      expect(await linesFor(admin)).toEqual(expect.arrayContaining([womensRoot.id, mensRoot.id]));
    });

    it('records nobody of the other Network, and reads no checklist there', async () => {
      const inScope = await mark(networkAdmin, milo);
      const root = await mark(networkAdmin, mensRoot);

      expect(refused(inScope)).toEqual([403, 'SCOPE_DENIED']);
      // The other Network's root is refused as anybody there is, in the same words.
      expect(root.body).toEqual({
        ...inScope.body,
        error: {
          ...inScope.body.error,
          details: { ...inScope.body.error.details, person_id: mensRoot.id },
        },
      });
      expect(
        refused(await get(networkAdmin, `/dcc/events/${eventId}/leaders/${manny.id}/roster`)),
      ).toEqual([403, 'SCOPE_DENIED']);
    });

    it('is refused a closed week, with or without an amendment', async () => {
      expect(refused(await mark(networkAdmin, winnie, {}, closedEventId))).toEqual([
        409,
        'PERIOD_CLOSED',
      ]);
      expect(
        refused(
          await mark(networkAdmin, winnie, { amendment: { reason: 'Missed.' } }, closedEventId),
        ),
      ).toEqual([403, 'CAPABILITY_DENIED']);

      expect(
        (await mark(admin, winnie, { amendment: { reason: 'Missed.' } }, closedEventId)).status,
      ).toBe(201);
    });

    it('is told whose checklist a person’s Sunday is on', async () => {
      await mark(wandaAccount, winnie).expect(201);

      const response = await get(networkAdmin, `/dcc/people/${winnie.id}/attendance`).expect(200);

      expect(response.body.data[0]).toMatchObject({ event_id: eventId, checklist_of: wanda.id });
    });

    describe('somebody moved to the other Network since the Sunday', () => {
      beforeEach(async () => {
        // Wendy and Winnie are recorded, then the Admin corrects their sex: each is now in
        // the Men's Network, beneath Manny.
        await mark(admin, wendy).expect(201);
        await mark(wandaAccount, winnie).expect(201);
        for (const person of [wendy, winnie]) {
          await request(app.getHttpServer())
            .put(`/api/v1/people/${person.id}/sex`)
            .set('Authorization', `Bearer ${admin.accessToken}`)
            .set('Idempotency-Key', randomUUID())
            .send({ sex: 'MALE', reason: 'Entered in error.', pastoral_leader_id: manny.id })
            .expect(200);
        }
      });

      it('leaves them off the checklist of a root who holds no account', async () => {
        const linesFor = async (reader: TestAccount): Promise<string[]> =>
          (
            (
              await get(
                reader,
                `/dcc/events/${eventId}/leaders/${womensRoot.id}/roster?limit=200`,
              ).expect(200)
            ).body.data as { person_id: string }[]
          ).map((line) => line.person_id);

        expect(await linesFor(networkAdmin)).toEqual([wanda.id]);
        // As of the Sunday she was the root's, and the Admin still reads her there.
        expect(await linesFor(admin)).toEqual(expect.arrayContaining([wanda.id, wendy.id]));
      });

      it('does not name the Women’s leader whose checklist their Sunday was on to the Men’s Network Admin', async () => {
        const mensAdmin = await createAccount(app, db, {
          person: await createPerson(db, { firstName: 'Noel', network: 'MENS' }),
          roles: ['NETWORK_ADMIN'],
        });

        const own = await get(mensAdmin, `/dcc/people/${winnie.id}/attendance`).expect(200);
        const all = await get(admin, `/dcc/people/${winnie.id}/attendance`).expect(200);

        expect(own.body.data[0]).toMatchObject({ event_id: eventId, checklist_of: null });
        expect(all.body.data[0]).toMatchObject({ event_id: eventId, checklist_of: wanda.id });
      });

      it('is recorded for that Sunday by the Network Admin of the Network they are in now (decision 0474)', async () => {
        const moved = await createPerson(db, { firstName: 'Willa', network: 'WOMENS' });
        await assignTo(db, moved.id, wanda.id);
        await request(app.getHttpServer())
          .put(`/api/v1/people/${moved.id}/sex`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('Idempotency-Key', randomUUID())
          .send({ sex: 'MALE', reason: 'Entered in error.', pastoral_leader_id: manny.id })
          .expect(200);
        const mensAdmin = await createAccount(app, db, {
          person: await createPerson(db, { firstName: 'Noel', network: 'MENS' }),
          roles: ['NETWORK_ADMIN'],
        });

        expect(refused(await mark(networkAdmin, moved))).toEqual([403, 'SCOPE_DENIED']);
        await mark(mensAdmin, moved).expect(201);
      });
    });

    it('records the line of somebody in a leader’s 12 who holds an Admin account (decision 0475)', async () => {
      const wynn = await createPerson(db, { firstName: 'Wynn', network: 'WOMENS' });
      await assignTo(db, wynn.id, wanda.id);
      await createAccount(app, db, { person: wynn, roles: ['ADMIN'] });

      await mark(networkAdmin, wynn).expect(201);
    });

    it('still refuses a Leader anybody off their own checklist', async () => {
      expect(refused(await mark(wandaAccount, wendy))).toEqual([403, 'SCOPE_DENIED']);
    });
  });

  describe('Cell meetings', () => {
    let wandaCell: TestCell;
    let rootCell: TestCell;
    let mannyCell: TestCell;
    let wandaMember: TestPerson;
    let rootMember: TestPerson;
    let mannyMember: TestPerson;

    beforeEach(async () => {
      // Cells that have met on today's weekday for a year, each with one member.
      const createdAt = new Date(`${shift(today, -365)}T02:00:00Z`);
      const dayOfWeek = isoWeekday(today);
      wandaCell = await createCell(db, { leader: wanda, dayOfWeek, createdAt });
      rootCell = await createCell(db, { leader: womensRoot, dayOfWeek, createdAt });
      mannyCell = await createCell(db, { leader: manny, dayOfWeek, createdAt });
      wandaMember = await addCellMember(db, wandaCell);
      rootMember = await addCellMember(db, rootCell);
      mannyMember = await addCellMember(db, mannyCell);
    });

    const held = (account: TestAccount, cell: TestCell, member: TestPerson, date = today) =>
      post(account, `/cells/${cell.id}/meetings/${date}/submit`, {
        status: 'HELD',
        attendance: [{ person_id: member.id, present: true }],
      });

    it('records a leader’s meeting, as on behalf', async () => {
      const response = await held(networkAdmin, wandaCell, wandaMember);

      expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
      expect(await auditOf('cell_attendance.submitted_on_behalf', wandaCell.id)).toEqual([
        { actor_id: networkAdmin.id },
      ]);
    });

    it('corrects a meeting a leader recorded', async () => {
      expect((await held(wandaAccount, wandaCell, wandaMember)).status).toBe(201);

      const response = await post(networkAdmin, `/cells/${wandaCell.id}/meetings/${today}/submit`, {
        status: 'HELD',
        attendance: [{ person_id: wandaMember.id, present: false }],
        version: 1,
        correction_reason: 'She was away.',
      });

      expect({ status: response.status, body: response.body }).toMatchObject({
        status: 201,
        body: { corrected: 1 },
      });
    });

    it('records the meeting of a Cell a Network root leads', async () => {
      expect((await held(networkAdmin, rootCell, rootMember)).status).toBe(201);
    });

    it('is offered Record on Pending CG Records for its own Network’s Cells alone', async () => {
      const response = await get(networkAdmin, '/cells/meetings/pending').expect(200);
      const rows = response.body.data as { cell: { id: string }; may_record: boolean }[];

      expect(rows.find((row) => row.cell.id === wandaCell.id)).toMatchObject({ may_record: true });
      expect(rows.find((row) => row.cell.id === rootCell.id)).toMatchObject({ may_record: true });
      expect(rows.some((row) => row.cell.id === mannyCell.id)).toBe(false);
    });

    it('reads and records no meeting of the other Network', async () => {
      expect(refused(await held(networkAdmin, mannyCell, mannyMember))).toEqual([
        403,
        'SCOPE_DENIED',
      ]);
      expect(
        refused(await get(networkAdmin, `/cells/${mannyCell.id}/meetings/${today}/roster`)),
      ).toEqual([403, 'SCOPE_DENIED']);
    });

    it('is refused a closed week, with or without an amendment', async () => {
      const closed = shift(today, -70);

      expect(refused(await held(networkAdmin, wandaCell, wandaMember, closed))).toEqual([
        409,
        'PERIOD_CLOSED',
      ]);
      const amended = await post(networkAdmin, `/cells/${wandaCell.id}/meetings/${closed}/submit`, {
        status: 'HELD',
        attendance: [{ person_id: wandaMember.id, present: true }],
        amendment: { reason: 'Missed.' },
      });
      expect(refused(amended)).toEqual([403, 'CAPABILITY_DENIED']);
      expect(await db.selectFrom('cell_meetings').select('id').execute()).toEqual([]);
    });

    it('still refuses a Leader another leader’s meeting', async () => {
      expect(refused(await held(wandaAccount, rootCell, rootMember))).toEqual([
        403,
        'SCOPE_DENIED',
      ]);
    });
  });
});
