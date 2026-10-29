import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { Client } from 'pg';
import { sql } from 'kysely';

import { lastFinishedMonths } from '../../src/attendance/absent-people.service';
import { manilaDayOf } from '../../src/common/time/manila';
import { reportRangeGuardMonth } from '../../src/common/time/report-range';
import { countWhileInFlight, track } from '../setup/concurrency';
import { createTestDb, truncateAll } from '../setup/database';
import {
  EPOCH,
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * Person Merge (SKILL.md sections 3 and 20; decision 0408), asked of the API, because the API
 * is the sole authority for authorization (`CLAUDE.md`, Definition of Done).
 *
 * The tree is `CLAUDE.md`'s example: `Raymond (root) -> Manuel -> Mark -> Juan, Pedro`, Mark
 * leading the Cell Juan and Pedro are in, and Nestor a second leader under Raymond. **Juan is
 * recorded twice**: `juan` under Mark, and `juanAgain` under Nestor, both in Mark's Cell. The
 * merge joins `juanAgain` into `juan`.
 *
 * The reported month is fixed and in the past, so it is closed and storable (section 20), and
 * the reconciliation cases read it before the merge and again after it: the second read is
 * only right if the merge cleared the stored month.
 *
 * Fixture names, dates, mobile numbers and email addresses are invented (`CLAUDE.md`, Secrets).
 */
describe('Person Merge (section 3, decision 0408)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let nestor: TestPerson;
  let juan: TestPerson;
  let juanAgain: TestPerson;
  let pedro: TestPerson;
  let adele: TestPerson;
  let cell: TestCell;

  let admin: TestAccount;
  let manuelAccount: TestAccount;
  let juanAgainAccount: TestAccount;

  const JUNE = '2026-06-01';
  const SUNDAYS = ['2026-06-07', '2026-06-14', '2026-06-21', '2026-06-28'];
  const MEETINGS = ['2026-06-06', '2026-06-13'];

  const server = () => app.getHttpServer();

  const preview = (as: TestAccount, kept: TestPerson | string, duplicate: TestPerson | string) =>
    request(server())
      .get(`/api/v1/people/${idOf(kept)}/merge-preview?duplicate_id=${idOf(duplicate)}`)
      .set('Authorization', `Bearer ${as.accessToken}`);

  const merge = (
    as: TestAccount,
    kept: TestPerson | string,
    body: Record<string, unknown>,
    key: string = randomUUID(),
  ) =>
    request(server())
      .post(`/api/v1/people/${idOf(kept)}/merge`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);

  const mergeInto = (kept: TestPerson, duplicate: TestPerson) =>
    merge(admin, kept, { duplicate_id: duplicate.id, reason: 'Entered twice at the 2026 intake.' });

  const report = (domain: 'dcc' | 'cells', query: string) =>
    request(server())
      .get(`/api/v1/reports/${domain}/monthly?period=${JUNE}&${query}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

  /** The month a June range resolves at, which the client names as the My 12 tables do. */
  const guardMonth = () =>
    reportRangeGuardMonth(
      'MONTH',
      JUNE,
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()),
    );

  /** My 12 over June, which the Cell Groups and DCC screens read (decision 0293). */
  const twelve = (domain: 'dcc' | 'cells', as: TestAccount, query: Record<string, string>) =>
    request(server())
      .get(`/api/v1/reports/${domain}/twelve`)
      .query({ kind: 'MONTH', start: JUNE, period: guardMonth(), ...query })
      .set('Authorization', `Bearer ${as.accessToken}`);

  function idOf(person: TestPerson | string): string {
    return typeof person === 'string' ? person : person.id;
  }

  /** Section 20: each view of the month sums to the one unique-people total. */
  const expectReconciles = (body: {
    unique_people: number;
    classification: Record<string, number>;
    buckets?: { people: number }[];
  }) => {
    const classified = Object.values(body.classification).reduce((sum, value) => sum + value, 0);
    expect(classified).toBe(body.unique_people);
    if (body.buckets !== undefined) {
      const bucketed = body.buckets.reduce((sum, bucket) => sum + bucket.people, 0);
      expect(bucketed).toBe(body.unique_people);
    }
  };

  const meeting = async (cellId: string, day: string, leaderId: string): Promise<string> => {
    const rows = await sql<{ id: string }>`
      INSERT INTO cell_meetings (
        cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
        status, responsible_leader_id
      )
      VALUES (
        ${cellId}::uuid, ${day}::date, '19:00'::time,
        ${day}::date - ((EXTRACT(ISODOW FROM ${day}::date)::integer) - 1),
        date_trunc('month', ${day}::date)::date,
        'HELD'::cell_meeting_status, ${leaderId}::uuid
      )
      RETURNING id
    `.execute(db);
    return rows.rows[0].id;
  };

  const cellMark = (meetingId: string, person: TestPerson, present: boolean) =>
    db
      .insertInto('cell_attendance')
      .values({ cell_meeting_id: meetingId, person_id: person.id, present, recorded_by: admin.id })
      .execute();

  const dccMark = (eventId: string, person: TestPerson, present: boolean, leader: TestPerson) =>
    db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: person.id,
        present,
        responsible_leader_id: leader.id,
        recorded_by: admin.id,
      })
      .execute();

  const openRows = async (table: 'pastoral_assignments' | 'cell_memberships', person: TestPerson) =>
    db
      .selectFrom(table)
      .select('id')
      .where('person_id', '=', person.id)
      .where('ended_at', 'is', null)
      .execute();

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alvarez',
      network: 'MENS',
    });
    await assignTo(db, raymond.id, null);
    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Bautista', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);
    nestor = await createPerson(db, { firstName: 'Nestor', lastName: 'Dizon', network: 'MENS' });
    await assignTo(db, nestor.id, raymond.id);

    // The kept record has a mobile number and no birthday; the duplicate has both.
    juan = await createPerson(db, {
      firstName: 'Juan',
      lastName: 'Reyes',
      network: 'MENS',
      birthDate: null,
    });
    await assignTo(db, juan.id, mark.id);
    juanAgain = await createPerson(db, {
      firstName: 'Juan',
      lastName: 'Reyes',
      middleName: 'Santos',
      network: 'MENS',
      birthDate: '1990-02-03',
    });
    await assignTo(db, juanAgain.id, nestor.id);
    await db
      .updateTable('persons')
      .set({ mobile_number: '09170000001', mobile_number_normalized: '+639170000001' })
      .where('id', '=', juan.id)
      .execute();
    await db
      .updateTable('persons')
      .set({ mobile_number: '09170000002', mobile_number_normalized: '+639170000002' })
      .where('id', '=', juanAgain.id)
      .execute();

    pedro = await createPerson(db, { firstName: 'Pedro', lastName: 'Ocampo', network: 'MENS' });
    await assignTo(db, pedro.id, mark.id);

    cell = await createCell(db, { leader: mark, createdAt: EPOCH });
    for (const person of [juan, juanAgain, pedro]) {
      await db
        .insertInto('cell_memberships')
        .values({ person_id: person.id, cell_id: cell.id, started_at: EPOCH })
        .execute();
    }

    // The Admin's own record is outside the tree (section 6).
    adele = await createPerson(db, { firstName: 'Adele', lastName: 'Ferrer', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    juanAgainAccount = await createAccount(app, db, { person: juanAgain, roles: ['LEADER'] });
  });

  // ---------------------------------------------------------------------------
  // 1. A merge that is made
  // ---------------------------------------------------------------------------

  describe('a successful merge', () => {
    it('joins the duplicate in, ending its leader and Cell, and answers what it did', async () => {
      const response = await mergeInto(juan, juanAgain).expect(200);

      expect(response.body).toEqual({
        id: juanAgain.id,
        member_id: expect.stringMatching(/^M-\d{6}$/),
        merged_into: {
          id: juan.id,
          member_id: expect.stringMatching(/^M-\d{6}$/),
          full_name: 'Juan Reyes',
        },
        merged_at: expect.any(String),
        copied: ['birth_date'],
        account_disabled: true,
      });

      const absorbed = await db
        .selectFrom('persons')
        .select(['merged_into_id', 'merged_at', 'merged_by', 'merge_reason'])
        .where('id', '=', juanAgain.id)
        .executeTakeFirstOrThrow();
      expect(absorbed).toEqual({
        merged_into_id: juan.id,
        merged_at: new Date(response.body.merged_at),
        merged_by: admin.id,
        merge_reason: 'Entered twice at the 2026 intake.',
      });

      // Points 1 and 2: the duplicate's open edge and membership end; the kept record's stay.
      expect(await openRows('pastoral_assignments', juanAgain)).toEqual([]);
      expect(await openRows('cell_memberships', juanAgain)).toEqual([]);
      expect(await openRows('pastoral_assignments', juan)).toHaveLength(1);
      expect(await openRows('cell_memberships', juan)).toHaveLength(1);

      const ended = await db
        .selectFrom('pastoral_assignments')
        .select(['leader_id', 'ended_at'])
        .where('person_id', '=', juanAgain.id)
        .executeTakeFirstOrThrow();
      expect(ended).toEqual({ leader_id: nestor.id, ended_at: new Date(response.body.merged_at) });

      // Point 3: the birthday the kept record lacked is copied; its own mobile number stands.
      const kept = await db
        .selectFrom('persons')
        .select(['birth_date', 'mobile_number', 'mobile_number_normalized', 'merged_into_id'])
        .where('id', '=', juan.id)
        .executeTakeFirstOrThrow();
      expect(kept).toEqual({
        birth_date: '1990-02-03',
        mobile_number: '09170000001',
        mobile_number_normalized: '+639170000001',
        merged_into_id: null,
      });
    });

    it("copies a mobile number the kept record lacks, and keeps the kept record's birthday", async () => {
      await db
        .updateTable('persons')
        .set({ birth_date: '1991-04-05', mobile_number: null, mobile_number_normalized: null })
        .where('id', '=', juan.id)
        .execute();

      const response = await mergeInto(juan, juanAgain).expect(200);
      expect(response.body.copied).toEqual(['mobile_number']);

      const kept = await db
        .selectFrom('persons')
        .select(['birth_date', 'mobile_number', 'mobile_number_normalized'])
        .where('id', '=', juan.id)
        .executeTakeFirstOrThrow();
      expect(kept).toEqual({
        birth_date: '1991-04-05',
        mobile_number: '09170000002',
        mobile_number_normalized: '+639170000002',
      });
    });

    it("disables the duplicate's account and ends its sessions (section 3)", async () => {
      await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${juanAgainAccount.accessToken}`)
        .expect(200);

      await mergeInto(juan, juanAgain).expect(200);

      const account = await db
        .selectFrom('accounts')
        .select('status')
        .where('id', '=', juanAgainAccount.id)
        .executeTakeFirstOrThrow();
      expect(account.status).toBe('DISABLED');

      // No account is created for the kept record (section 3).
      const keptAccounts = await db
        .selectFrom('accounts')
        .select('id')
        .where('person_id', '=', juan.id)
        .execute();
      expect(keptAccounts).toEqual([]);

      const after = await request(server())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${juanAgainAccount.accessToken}`);
      expect(after.status).toBe(401);
    });

    it('answers account_disabled false where the duplicate holds no account', async () => {
      const pedroAgain = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });

      const response = await mergeInto(pedro, pedroAgain).expect(200);
      expect(response.body.account_disabled).toBe(false);
      expect(response.body.copied).toEqual([]);
    });

    it('writes one person.merged audit entry naming what moved', async () => {
      await mergeInto(juan, juanAgain).expect(200);

      const entries = await db
        .selectFrom('audit_log')
        .select(['actor_id', 'target_type', 'target_id', 'before', 'after'])
        .where('action', '=', 'person.merged')
        .execute();
      expect(entries).toEqual([
        {
          actor_id: admin.id,
          target_type: 'person',
          target_id: juanAgain.id,
          before: { pastoral_leader_id: nestor.id, cell_id: cell.cellId },
          after: expect.objectContaining({
            merged_into_id: juan.id,
            reason: 'Entered twice at the 2026 intake.',
            // The values written onto the record kept, which lacked them (point 3, section 21).
            copied_to_kept: { birth_date: '1990-02-03' },
            account_disabled: true,
          }),
        },
      ]);

      // The account change is audited too (section 3, section 21).
      const disabled = await db
        .selectFrom('audit_log')
        .select('target_id')
        .where('action', '=', 'account.disabled')
        .execute();
      expect(disabled).toEqual([{ target_id: juanAgainAccount.id }]);
    });

    it('replays the same answer for the same key and does not merge twice', async () => {
      const key = randomUUID();
      const body = { duplicate_id: juanAgain.id, reason: 'Entered twice at the 2026 intake.' };

      const first = await merge(admin, juan, body, key).expect(200);
      const second = await merge(admin, juan, body, key).expect(200);

      expect(second.body).toEqual(first.body);

      const entries = await db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'person.merged')
        .execute();
      expect(entries).toHaveLength(1);
    });

    it('trims the reason it stores', async () => {
      await merge(admin, juan, { duplicate_id: juanAgain.id, reason: '  Same person.  ' }).expect(
        200,
      );
      const row = await db
        .selectFrom('persons')
        .select('merge_reason')
        .where('id', '=', juanAgain.id)
        .executeTakeFirstOrThrow();
      expect(row.merge_reason).toBe('Same person.');
    });

    it('accepts an archived duplicate, joined in as it is (point 8)', async () => {
      const archivedAgain = await createPerson(db, {
        firstName: 'Pedro',
        lastName: 'Ocampo',
        network: 'MENS',
        archived: true,
      });

      const shown = await preview(admin, pedro, archivedAgain).expect(200);
      expect(shown.body).toEqual({ refusals: [] });

      await mergeInto(pedro, archivedAgain).expect(200);
    });

    it('lets a Network root be the record kept (point 7)', async () => {
      const raymondAgain = await createPerson(db, {
        firstName: 'Raymond',
        lastName: 'Alvarez',
        network: 'MENS',
      });

      await mergeInto(raymond, raymondAgain).expect(200);

      const seat = await db
        .selectFrom('pastoral_assignments')
        .select(['leader_id', 'root_network'])
        .where('person_id', '=', raymond.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(seat).toEqual({ leader_id: null, root_network: 'MENS' });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. What is refused
  // ---------------------------------------------------------------------------

  describe('refusals, from the preview and from the merge alike', () => {
    /** The preview's codes, and that the merge itself refuses with the same ones. */
    const expectRefused = async (
      kept: TestPerson | string,
      duplicate: TestPerson | string,
      codes: string[],
    ) => {
      const stateOf = () =>
        db
          .selectFrom('persons')
          .select(['id', 'merged_into_id', 'merged_at', 'birth_date', 'mobile_number'])
          .where('id', 'in', [idOf(kept), idOf(duplicate)])
          .orderBy('id')
          .execute();
      const edgesOf = () =>
        db
          .selectFrom('pastoral_assignments')
          .select(['id', 'ended_at'])
          .where('person_id', '=', idOf(duplicate))
          .orderBy('id')
          .execute();
      const beforeState = await stateOf();
      const beforeEdges = await edgesOf();

      const shown = await preview(admin, kept, duplicate).expect(200);
      expect(shown.body.refusals.map((refusal: { code: string }) => refusal.code)).toEqual(codes);
      for (const refusal of shown.body.refusals) {
        expect(refusal.message).toEqual(expect.any(String));
      }

      const refused = await merge(admin, kept, {
        duplicate_id: idOf(duplicate),
        reason: 'Same person.',
      }).expect(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(
        refused.body.error.details.refusals.map((refusal: { code: string }) => refusal.code),
      ).toEqual(codes);
      expect(refused.body.error.message).toBe(shown.body.refusals[0].message);

      // Nothing was written.
      expect(await stateOf()).toEqual(beforeState);
      expect(await edgesOf()).toEqual(beforeEdges);
    };

    it('offers the merge with nothing refused when nothing stands in the way', async () => {
      const shown = await preview(admin, juan, juanAgain).expect(200);
      expect(shown.body).toEqual({ refusals: [] });
    });

    it('refuses one record merged into itself', async () => {
      await expectRefused(juan, juan, ['SAME_PERSON']);
    });

    it('refuses a duplicate who pastors anyone (point 5)', async () => {
      // Manuel leads no Cell and pastors Mark.
      const manuelAgain = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      await expectRefused(manuelAgain, manuel, ['PASTORS_PEOPLE']);
      expect(await openRows('pastoral_assignments', mark)).toHaveLength(1);
    });

    it('refuses two records in different Networks (point 6)', async () => {
      const rosa = await createPerson(db, { firstName: 'Rosa', network: 'WOMENS' });
      await expectRefused(juan, rosa, ['DIFFERENT_NETWORKS']);
    });

    it('refuses absorbing a Network root, which also pastors people (point 7)', async () => {
      const raymondAgain = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
      await expectRefused(raymondAgain, raymond, ['DUPLICATE_IS_ROOT', 'PASTORS_PEOPLE']);
    });

    it('refuses keeping an archived record (point 8)', async () => {
      const archived = await createPerson(db, {
        firstName: 'Juan',
        lastName: 'Reyes',
        network: 'MENS',
        archived: true,
      });
      await expectRefused(archived, juanAgain, ['KEPT_ARCHIVED']);
    });

    it('refuses a duplicate who leads a Cell (section 3)', async () => {
      // Rico leads a Cell and pastors nobody, so only the Cell refuses.
      const rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      await assignTo(db, rico.id, manuel.id);
      await createCell(db, { leader: rico, createdAt: EPOCH });
      const ricoAgain = await createPerson(db, { firstName: 'Rico', network: 'MENS' });

      await expectRefused(ricoAgain, rico, ['LEADS_A_CELL']);
    });

    it("refuses absorbing the Admin's own record, and lets it be kept (point 9)", async () => {
      const adeleAgain = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
      await expectRefused(adeleAgain, adele, ['OWN_RECORD']);

      await mergeInto(adele, adeleAgain).expect(200);
    });

    it('refuses a record already merged away, on either side (section 3, point 9)', async () => {
      await mergeInto(juan, juanAgain).expect(200);

      await expectRefused(juan, juanAgain, ['ALREADY_MERGED']);
      await expectRefused(juanAgain, pedro, ['ALREADY_MERGED']);
    });

    it('refuses absorbing a record that has absorbed another, so merges never chain', async () => {
      await mergeInto(juan, juanAgain).expect(200);

      await expectRefused(pedro, juan, ['HAS_ABSORBED']);
    });

    it('answers NOT_FOUND for a record that does not exist', async () => {
      const unknown = randomUUID();
      const shown = await preview(admin, juan, unknown).expect(404);
      expect(shown.body.error.code).toBe('NOT_FOUND');

      const refused = await merge(admin, juan, {
        duplicate_id: unknown,
        reason: 'Same person.',
      }).expect(404);
      expect(refused.body.error.code).toBe('NOT_FOUND');
    });

    it('refuses a merge with no reason, or a reason of only spaces (section 3)', async () => {
      for (const body of [
        { duplicate_id: juanAgain.id },
        { duplicate_id: juanAgain.id, reason: '' },
        { duplicate_id: juanAgain.id, reason: '   ' },
      ]) {
        const refused = await merge(admin, juan, body).expect(422);
        expect(refused.body.error.code).toBe('VALIDATION_FAILED');
      }

      const row = await db
        .selectFrom('persons')
        .select('merged_into_id')
        .where('id', '=', juanAgain.id)
        .executeTakeFirstOrThrow();
      expect(row.merged_into_id).toBeNull();
    });

    it('refuses a duplicate_id that is not an identifier', async () => {
      const shown = await preview(admin, juan, 'not-an-id').expect(422);
      expect(shown.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('who may merge (section 3: people.merge, Admin only)', () => {
    it('refuses a Leader at the capability, through both routes', async () => {
      const shown = await preview(manuelAccount, juan, juanAgain).expect(403);
      expect(shown.body.error.code).toBe('CAPABILITY_DENIED');

      const refused = await merge(manuelAccount, juan, {
        duplicate_id: juanAgain.id,
        reason: 'Same person.',
      }).expect(403);
      expect(refused.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('refuses a Senior Pastor at the capability, through both routes', async () => {
      nameSeniorPastors(app, [raymond.id]);
      const pastor = await createAccount(app, db, {
        person: raymond,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });

      const shown = await preview(pastor, juan, juanAgain).expect(403);
      expect(shown.body.error.code).toBe('CAPABILITY_DENIED');

      const refused = await merge(pastor, juan, {
        duplicate_id: juanAgain.id,
        reason: 'Same person.',
      }).expect(403);
      expect(refused.body.error.code).toBe('CAPABILITY_DENIED');

      const row = await db
        .selectFrom('persons')
        .select('merged_into_id')
        .where('id', '=', juanAgain.id)
        .executeTakeFirstOrThrow();
      expect(row.merged_into_id).toBeNull();
    });

    it('lets one of two concurrent merges sharing a record succeed, never a chain', async () => {
      // Pedro into Juan, and Juan into Juan's duplicate record, at once: whichever commits
      // first, the other must not leave a record two steps from its survivor. Several rounds,
      // so the two genuinely overlap at least once, and the loser must be the service's own
      // refusal: without the lock the trigger refuses instead, which renders a 500.
      for (let round = 0; round < 6; round += 1) {
        const keep = await createPerson(db, { firstName: `Kept${round}`, network: 'MENS' });
        const middle = await createPerson(db, { firstName: `Middle${round}`, network: 'MENS' });
        const other = await createPerson(db, { firstName: `Other${round}`, network: 'MENS' });

        const [one, two] = await Promise.all([mergeInto(middle, other), mergeInto(keep, middle)]);

        expect([one.status, two.status].sort()).toEqual([200, 409]);
        const loser = one.status === 409 ? one : two;
        expect(loser.body.error.code).toBe('INVARIANT_VIOLATION');
        expect(loser.body.error.details.refusals).toEqual([
          expect.objectContaining({
            code: expect.stringMatching(/^(ALREADY_MERGED|HAS_ABSORBED)$/),
          }),
        ]);
      }

      const chained = await sql<{ n: string }>`
        SELECT count(*)::text AS n
          FROM persons a JOIN persons b ON b.id = a.merged_into_id
         WHERE b.merged_into_id IS NOT NULL
      `.execute(db);
      expect(chained.rows[0].n).toBe('0');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. The absorbed record's page (point 14)
  // ---------------------------------------------------------------------------

  describe("the absorbed record's page", () => {
    it('names the record kept, who merged it and when, and not why (point 18)', async () => {
      const merged = await mergeInto(juan, juanAgain).expect(200);

      const page = await request(server())
        .get(`/api/v1/people/${juanAgain.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(page.body).toEqual({
        id: juanAgain.id,
        member_id: merged.body.member_id,
        full_name: 'Juan S. Reyes',
        merged: {
          into: {
            id: juan.id,
            member_id: merged.body.merged_into.member_id,
            full_name: 'Juan Reyes',
          },
          merged_at: merged.body.merged_at,
          merged_by: 'Adele Ferrer',
        },
      });
      // The reason stays in the audit log (section 21).
      expect(page.body.merged).not.toHaveProperty('reason');
    });

    it('still answers NOT_FOUND for a record that never existed', async () => {
      const response = await request(server())
        .get(`/api/v1/people/${randomUUID()}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Reconciliation after a merge (section 20, Definition of Done)
  // ---------------------------------------------------------------------------

  describe('a merged pair is one person in every figure (points 10 to 13)', () => {
    let events: string[];

    beforeEach(async () => {
      events = [];
      for (const sunday of SUNDAYS) {
        const row = await db
          .insertInto('dcc_events')
          .values({ event_date: sunday })
          .returning('id')
          .executeTakeFirstOrThrow();
        events.push(row.id);
      }

      // DCC. The first Sunday is marked Present on both records; the second Absent on the
      // kept record and Present on the duplicate; the third on the duplicate alone. As one
      // person that is three Sundays (points 11 and 4). Mark came once.
      await dccMark(events[0], juan, true, mark);
      await dccMark(events[0], juanAgain, true, nestor);
      await dccMark(events[1], juan, false, mark);
      await dccMark(events[1], juanAgain, true, nestor);
      await dccMark(events[2], juanAgain, true, nestor);
      await dccMark(events[0], mark, true, manuel);

      // Cell. The first meeting is Absent on the kept record and Present on the duplicate;
      // the second Present on both. As one person that is both meetings. Pedro came once.
      const first = await meeting(cell.id, MEETINGS[0], mark.id);
      const second = await meeting(cell.id, MEETINGS[1], mark.id);
      await cellMark(first, juan, false);
      await cellMark(first, juanAgain, true);
      await cellMark(first, pedro, true);
      await cellMark(second, juan, true);
      await cellMark(second, juanAgain, true);
      await cellMark(second, pedro, false);
    });

    it('counts the pair once at Whole Church on the DCC report, Present winning', async () => {
      const before = (await report('dcc', 'scope=WHOLE_CHURCH').expect(200)).body;
      expect(before.unique_people).toBe(3);
      expectReconciles(before);

      await mergeInto(juan, juanAgain).expect(200);

      const after = (await report('dcc', 'scope=WHOLE_CHURCH').expect(200)).body;
      expect(after.unique_people).toBe(2);
      expectReconciles(after);
      // Juan three times, Mark once: section 3's worked example, one level down.
      expect(after.classification).toEqual({
        vip: 1,
        second_timer: 0,
        third_timer: 1,
        fourth_timer: 0,
        regular: 0,
      });
      expect(after.buckets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ times: 3, people: 1 }),
          expect.objectContaining({ times: 1, people: 1 }),
        ]),
      );
    });

    it("places the pair under the kept record's leader, and adds up at every leader (point 13)", async () => {
      await mergeInto(juan, juanAgain).expect(200);

      const underMark = (await report('dcc', `scope=LEADER&leader_id=${mark.id}`).expect(200)).body;
      const underNestor = (await report('dcc', `scope=LEADER&leader_id=${nestor.id}`).expect(200))
        .body;
      const underRaymond = (await report('dcc', `scope=LEADER&leader_id=${raymond.id}`).expect(200))
        .body;
      const mens = (await report('dcc', 'scope=NETWORK&network=MENS').expect(200)).body;

      for (const body of [underMark, underNestor, underRaymond, mens]) {
        expectReconciles(body);
      }

      // Juan is Mark's, with the duplicate's Sundays; Nestor has nobody now.
      expect(underMark.classification.third_timer).toBe(1);
      expect(underNestor.unique_people).toBe(0);
      // The root's total holds Juan and Mark once each, as the church's does.
      expect(underRaymond.unique_people).toBe(2);
      expect(mens.unique_people).toBe(2);
    });

    it("places the pair under the duplicate's leader in a month the kept record had none", async () => {
      // Lito's kept record is placed only from July; his duplicate was under Nestor all June.
      const lito = await createPerson(db, {
        firstName: 'Lito',
        lastName: 'Garcia',
        network: 'MENS',
      });
      await assignTo(db, lito.id, mark.id, new Date('2026-07-01T00:00:00+08:00'));
      const litoAgain = await createPerson(db, {
        firstName: 'Lito',
        lastName: 'Garcia',
        network: 'MENS',
      });
      await assignTo(db, litoAgain.id, nestor.id);

      await dccMark(events[3], lito, true, mark);
      await dccMark(events[3], litoAgain, true, nestor);
      await dccMark(events[2], litoAgain, true, nestor);

      const nestorBefore = (await report('dcc', `scope=LEADER&leader_id=${nestor.id}`).expect(200))
        .body;
      // Juan's duplicate and Lito's.
      expect(nestorBefore.unique_people).toBe(2);

      await mergeInto(juan, juanAgain).expect(200);
      await mergeInto(lito, litoAgain).expect(200);

      const underNestor = (await report('dcc', `scope=LEADER&leader_id=${nestor.id}`).expect(200))
        .body;
      const underMark = (await report('dcc', `scope=LEADER&leader_id=${mark.id}`).expect(200)).body;
      const church = (await report('dcc', 'scope=WHOLE_CHURCH').expect(200)).body;

      for (const body of [underNestor, underMark, church]) {
        expectReconciles(body);
      }
      // Lito once, under Nestor, with both records' Sundays: two.
      expect(underNestor.unique_people).toBe(1);
      expect(underNestor.classification.second_timer).toBe(1);
      // Mark's own scope holds Mark and Juan; Lito is not his for June.
      expect(underMark.unique_people).toBe(2);
      // Juan, Mark and Lito.
      expect(church.unique_people).toBe(3);
    });

    it('counts the pair once on the Cell report, a meeting on both records counting once', async () => {
      const before = (await report('cells', `scope=CELL&cell_id=${cell.id}`).expect(200)).body;
      expect(before.unique_people).toBe(3);
      expectReconciles(before);

      await mergeInto(juan, juanAgain).expect(200);

      const atCell = (await report('cells', `scope=CELL&cell_id=${cell.id}`).expect(200)).body;
      expect(atCell).toMatchObject({ n: 2, unique_people: 2 });
      expectReconciles(atCell);
      // Juan came to both meetings (Present wins the first), Pedro to one.
      expect(atCell.buckets).toEqual(
        expect.arrayContaining([
          { times: 2, people: 1, completed: true },
          { times: 1, people: 1, completed: false },
        ]),
      );
      expect(atCell.classification).toEqual({
        vip: 1,
        second_timer: 1,
        third_timer: 0,
        fourth_timer: 0,
        regular: 0,
      });

      const church = (await report('cells', 'scope=WHOLE_CHURCH').expect(200)).body;
      const underMark = (await report('cells', `scope=LEADER&leader_id=${mark.id}`).expect(200))
        .body;
      for (const body of [church, underMark]) {
        expect(body.unique_people).toBe(2);
        expectReconciles(body);
      }
    });

    it('shows a SUYNL lesson on both records once, on the earlier date (point 12)', async () => {
      const lesson = (person: TestPerson, number: number, at: string, by: TestPerson) =>
        db
          .insertInto('suynl_lessons')
          .values({
            person_id: person.id,
            lesson: number,
            confirmed_by: by.id,
            recorded_by: admin.id,
            confirmed_at: new Date(at),
          })
          .execute();
      await lesson(juan, 1, '2026-05-10T10:00:00+08:00', mark);
      await lesson(juanAgain, 1, '2026-04-01T10:00:00+08:00', nestor);
      await lesson(juanAgain, 2, '2026-05-01T10:00:00+08:00', nestor);

      const countsBefore = (
        await request(server())
          .get('/api/v1/suynl/counts')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200)
      ).body;

      await mergeInto(juan, juanAgain).expect(200);

      const listed = (
        await request(server())
          .get('/api/v1/suynl/people?limit=200')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200)
      ).body.data as { person_id: string; lessons: { lesson: number; filed_on: string }[] }[];

      expect(listed.map((row) => row.person_id)).not.toContain(juanAgain.id);
      const row = listed.find((entry) => entry.person_id === juan.id);
      expect(row?.lessons.map(({ lesson: number, filed_on }) => ({ number, filed_on }))).toEqual([
        { number: 1, filed_on: '2026-04-01' },
        { number: 2, filed_on: '2026-05-01' },
      ]);

      const countsAfter = (
        await request(server())
          .get('/api/v1/suynl/counts')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200)
      ).body;
      expect(countsAfter.people).toBe(countsBefore.people - 1);
      expect(countsAfter.in_progress).toBe(countsBefore.in_progress - 1);
    });

    it('shows a Training graduation on both records once, on the earlier date (point 12)', async () => {
      const graduate = (person: TestPerson, on: string) =>
        db
          .insertInto('training_graduations')
          .values({
            person_id: person.id,
            program: 'ENCOUNTER',
            graduated_on: on,
            confirmed_by: null,
            recorded_by: admin.id,
          })
          .execute();
      await graduate(juan, '2026-03-01');
      await graduate(juanAgain, '2026-02-01');

      await mergeInto(juan, juanAgain).expect(200);

      const listed = (
        await request(server())
          .get('/api/v1/training/people?limit=200')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200)
      ).body.data as {
        person_id: string;
        graduations: { program: string; graduated_on: string }[];
      }[];

      expect(listed.map((row) => row.person_id)).not.toContain(juanAgain.id);
      const row = listed.find((entry) => entry.person_id === juan.id);
      expect(
        row?.graduations.map(({ program, graduated_on }) => ({ program, graduated_on })),
      ).toEqual([{ program: 'ENCOUNTER', graduated_on: '2026-02-01' }]);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Points 15 and 16: where a merged pair, and the meetings it led, are placed
  // ---------------------------------------------------------------------------

  /** Hand a Cell to another leader at an instant, as a handover writes it (section 10). */
  const handOver = async (cellId: string, to: TestPerson, at: Date) => {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: at })
        .where('cell_id', '=', cellId)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('cell_leaderships')
        .values({ cell_id: cellId, person_id: to.id, started_at: at })
        .execute();
    });
  };

  /** A member of a Cell, placed under `under`, which a Cell figure does not read (section 20). */
  const attendee = async (firstName: string, under: TestPerson, cellId: string) => {
    const person = await createPerson(db, { firstName, lastName: 'Lorenzo', network: 'MENS' });
    await assignTo(db, person.id, under.id);
    await db
      .insertInto('cell_memberships')
      .values({ person_id: person.id, cell_id: cellId, started_at: EPOCH })
      .execute();
    return person;
  };

  /** After June, when a Cell a duplicate led in June is handed over before the merge. */
  const AFTER_JUNE = new Date('2026-07-10T09:00:00+08:00');

  describe('two duplicates under two leaders in a month the kept record had none (point 15)', () => {
    let lito: TestPerson;
    let litoNewer: TestPerson;
    let litoOlder: TestPerson;

    beforeEach(async () => {
      const events: string[] = [];
      for (const sunday of SUNDAYS) {
        const row = await db
          .insertInto('dcc_events')
          .values({ event_date: sunday })
          .returning('id')
          .executeTakeFirstOrThrow();
        events.push(row.id);
      }

      // The kept record is placed only from July.
      lito = await createPerson(db, { firstName: 'Lito', lastName: 'Garcia', network: 'MENS' });
      await assignTo(db, lito.id, mark.id, new Date('2026-07-01T00:00:00+08:00'));

      // **The newer duplicate is created first**, so it holds the lower Member ID: only its
      // `created_at` makes it the newer, which is the rule's first key (point 15).
      litoNewer = await createPerson(db, {
        firstName: 'Lito',
        lastName: 'Garcia',
        network: 'MENS',
      });
      await assignTo(db, litoNewer.id, nestor.id);
      litoOlder = await createPerson(db, {
        firstName: 'Lito',
        lastName: 'Garcia',
        network: 'MENS',
      });
      await assignTo(db, litoOlder.id, mark.id);
      await db
        .updateTable('persons')
        .set({ created_at: new Date('2025-06-01T09:00:00+08:00') })
        .where('id', '=', litoNewer.id)
        .execute();
      await db
        .updateTable('persons')
        .set({ created_at: new Date('2025-01-01T09:00:00+08:00') })
        .where('id', '=', litoOlder.id)
        .execute();

      // One June Sunday on each duplicate.
      await dccMark(events[0], litoNewer, true, nestor);
      await dccMark(events[1], litoOlder, true, mark);

      // The newer duplicate led a Cell in June and handed it over in July, so the merge is
      // not refused for leading one; Tomas came to its one June meeting.
      const litoCell = await createCell(db, { leader: litoNewer, createdAt: EPOCH });
      const tomas = await attendee('Tomas', nestor, litoCell.id);
      const held = await meeting(litoCell.id, MEETINGS[1], litoNewer.id);
      await cellMark(held, tomas, true);
      await handOver(litoCell.id, nestor, AFTER_JUNE);

      await mergeInto(lito, litoOlder).expect(200);
      await mergeInto(lito, litoNewer).expect(200);
    });

    it("counts the person under the newer duplicate's leader on the DCC report, every scope open", async () => {
      const underNestor = (await report('dcc', `scope=LEADER&leader_id=${nestor.id}`).expect(200))
        .body;
      const underMark = (await report('dcc', `scope=LEADER&leader_id=${mark.id}`).expect(200)).body;
      const underManuel = (await report('dcc', `scope=LEADER&leader_id=${manuel.id}`).expect(200))
        .body;
      const underRaymond = (await report('dcc', `scope=LEADER&leader_id=${raymond.id}`).expect(200))
        .body;
      const mens = (await report('dcc', 'scope=NETWORK&network=MENS').expect(200)).body;
      const church = (await report('dcc', 'scope=WHOLE_CHURCH').expect(200)).body;

      for (const body of [underNestor, underMark, underManuel, underRaymond, mens, church]) {
        expectReconciles(body);
      }

      // Lito once, under Nestor, with both duplicates' Sundays: two.
      expect(underNestor.unique_people).toBe(1);
      expect(underNestor.classification.second_timer).toBe(1);
      // Not under Mark, whose duplicate was the older.
      expect(underMark.unique_people).toBe(0);
      expect(underManuel.unique_people).toBe(0);
      // Once at every total above.
      expect(underRaymond.unique_people).toBe(1);
      expect(mens.unique_people).toBe(1);
      expect(church.unique_people).toBe(1);
    });

    it('places the meetings the newer duplicate led under its leader on the Cell report', async () => {
      const underNestor = (await report('cells', `scope=LEADER&leader_id=${nestor.id}`).expect(200))
        .body;
      const underMark = (await report('cells', `scope=LEADER&leader_id=${mark.id}`).expect(200))
        .body;
      const underRaymond = (
        await report('cells', `scope=LEADER&leader_id=${raymond.id}`).expect(200)
      ).body;
      const church = (await report('cells', 'scope=WHOLE_CHURCH').expect(200)).body;

      for (const body of [underNestor, underMark, underRaymond, church]) {
        expectReconciles(body);
      }

      // Tomas came to a meeting the newer duplicate led, which is Lito's, under Nestor.
      expect(underNestor.unique_people).toBe(1);
      expect(underMark.unique_people).toBe(0);
      expect(underRaymond.unique_people).toBe(1);
      expect(church.unique_people).toBe(1);
    });
  });

  describe('meetings a merged-away record led count where the kept record sits (point 16)', () => {
    let rico: TestPerson;
    let ricoAgain: TestPerson;

    beforeEach(async () => {
      // Rico's kept record is under Mark; his duplicate was under Nestor and led a Cell
      // through June, handed to Nestor in July, so the merge is not refused for it.
      rico = await createPerson(db, { firstName: 'Rico', lastName: 'Santos', network: 'MENS' });
      await assignTo(db, rico.id, mark.id);
      ricoAgain = await createPerson(db, {
        firstName: 'Rico',
        lastName: 'Santos',
        network: 'MENS',
      });
      await assignTo(db, ricoAgain.id, nestor.id);

      const ricoCell = await createCell(db, { leader: ricoAgain, createdAt: EPOCH });
      const tomas = await attendee('Tomas', nestor, ricoCell.id);
      const held = await meeting(ricoCell.id, MEETINGS[0], ricoAgain.id);
      await cellMark(held, tomas, true);
      await handOver(ricoCell.id, nestor, AFTER_JUNE);
    });

    it("counts the meeting's attendees in the kept record's branch, adding up to Whole Church", async () => {
      const before = (await report('cells', `scope=LEADER&leader_id=${nestor.id}`).expect(200))
        .body;
      expect(before.unique_people).toBe(1);

      await mergeInto(rico, ricoAgain).expect(200);

      const underMark = (await report('cells', `scope=LEADER&leader_id=${mark.id}`).expect(200))
        .body;
      const underManuel = (await report('cells', `scope=LEADER&leader_id=${manuel.id}`).expect(200))
        .body;
      const underNestor = (await report('cells', `scope=LEADER&leader_id=${nestor.id}`).expect(200))
        .body;
      const underRaymond = (
        await report('cells', `scope=LEADER&leader_id=${raymond.id}`).expect(200)
      ).body;
      const church = (await report('cells', 'scope=WHOLE_CHURCH').expect(200)).body;

      for (const body of [underMark, underManuel, underNestor, underRaymond, church]) {
        expectReconciles(body);
      }

      // The meeting was the duplicate's, which is Rico's now, under Mark.
      expect(underMark.unique_people).toBe(1);
      expect(underManuel.unique_people).toBe(1);
      expect(underNestor.unique_people).toBe(0);
      // Raymond's two rows add up to his total, and his total to the church's.
      expect(underManuel.unique_people + underNestor.unique_people).toBe(
        underRaymond.unique_people,
      );
      expect(underRaymond.unique_people).toBe(church.unique_people);
      expect(church.unique_people).toBe(1);
    });

    it("lists what the duplicate owed in the kept record's branch on Recording Status, not in Others", async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(
        new Date(),
      );
      const status = () =>
        request(server())
          .get('/api/v1/reports/recording-status')
          .query({
            kind: 'MONTH',
            start: JUNE,
            period: reportRangeGuardMonth('MONTH', JUNE, today),
          })
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200);
      type Row = { leader: { id: string }; cell: { owed: number } };
      const rowsOf = (body: { tables: { rows: Row[] }[] }) =>
        body.tables.flatMap((table) => table.rows);
      const rowOf = (body: { tables: { rows: Row[] }[] }, person: TestPerson) =>
        rowsOf(body).find((row) => row.leader.id === person.id);

      // Mark owes his Cell's June meetings and the duplicate owes its own: two leaders.
      const before = (await status()).body;
      expect(before.whole_church.cell.owed).toBe(2);
      expect(rowOf(before, manuel)?.cell.owed).toBe(1);
      expect(rowOf(before, nestor)?.cell.owed).toBe(1);

      await mergeInto(rico, ricoAgain).expect(200);

      const after = (await status()).body;
      // Rico is the leader who owed, in Manuel's branch; nothing is unplaced.
      expect(rowOf(after, manuel)?.cell.owed).toBe(2);
      expect(rowOf(after, nestor)?.cell.owed).toBe(0);
      expect(after.others.cell.owed).toBe(0);
      // What was owed is unchanged (point 19), and the rows add up to it.
      expect(after.whole_church.cell.owed).toBe(2);
      expect(
        rowsOf(after).reduce((sum, row) => sum + row.cell.owed, 0) + after.others.cell.owed,
      ).toBe(after.whole_church.cell.owed);
    });

    it("places the duplicate's scheduled meetings on the coverage line of the kept record's branch (point 21)", async () => {
      // June's Saturdays: four of Mark's Cell, none recorded, and four the duplicate led, one
      // recorded.
      const coverageOf = async (query: string) =>
        (await report('cells', query).expect(200)).body.coverage as {
          recorded: number;
          scheduled: number;
        };

      const churchBefore = await coverageOf('scope=WHOLE_CHURCH');
      expect(churchBefore).toEqual({ recorded: 1, scheduled: 8 });
      expect(await coverageOf(`scope=LEADER&leader_id=${manuel.id}`)).toEqual({
        recorded: 0,
        scheduled: 4,
      });
      expect(await coverageOf(`scope=LEADER&leader_id=${nestor.id}`)).toEqual({
        recorded: 1,
        scheduled: 4,
      });

      await mergeInto(rico, ricoAgain).expect(200);

      // One meeting in one branch: the kept record's, under Manuel, and not Nestor's.
      expect(await coverageOf(`scope=LEADER&leader_id=${manuel.id}`)).toEqual({
        recorded: 1,
        scheduled: 8,
      });
      expect(await coverageOf(`scope=LEADER&leader_id=${nestor.id}`)).toEqual({
        recorded: 0,
        scheduled: 0,
      });
      // The church total does not change.
      expect(await coverageOf('scope=WHOLE_CHURCH')).toEqual(churchBefore);
    });

    it("lists the duplicate's meetings under the kept record on the coverage rows by leader (point 21)", async () => {
      type Line = { leader: { id: string } | null; filed: number; owed: number };
      const byLeader = async () =>
        (
          await request(server())
            .get('/api/v1/reports/cells/monthly/by-leader')
            .query({ period: JUNE, scope: 'WHOLE_CHURCH', limit: 200 })
            .set('Authorization', `Bearer ${admin.accessToken}`)
            .expect(200)
        ).body as { data: Line[]; total: { filed: number; owed: number } };
      const lineOf = (body: { data: Line[] }, person: TestPerson) =>
        body.data.find((line) => line.leader?.id === person.id);

      const before = await byLeader();
      expect(lineOf(before, ricoAgain)).toMatchObject({ filed: 1, owed: 4 });

      await mergeInto(rico, ricoAgain).expect(200);

      const after = await byLeader();
      expect(lineOf(after, rico)).toMatchObject({ filed: 1, owed: 4 });
      expect(lineOf(after, ricoAgain)).toBeUndefined();
      expect(lineOf(after, mark)).toMatchObject({ filed: 0, owed: 4 });
      expect(after.total).toEqual(before.total);
    });

    it("places the duplicate's meetings in the kept record's branch on the Cell Groups screen's coverage (point 21)", async () => {
      // `cells/twelve` is what the Cell Groups screen reads; its coverage follows cells/monthly.
      const coverageOf = async (query: Record<string, string>) => {
        const body = (await twelve('cells', admin, query).expect(200)).body as {
          coverage: { recorded: number; scheduled: number };
        };
        return { recorded: body.coverage.recorded, scheduled: body.coverage.scheduled };
      };
      const church = { scope: 'WHOLE_CHURCH' };
      const underManuel = { scope: 'LEADER', leader_id: manuel.id };
      const underNestor = { scope: 'LEADER', leader_id: nestor.id };

      const churchBefore = await coverageOf(church);
      expect(churchBefore).toEqual({ recorded: 1, scheduled: 8 });
      expect(await coverageOf(underManuel)).toEqual({ recorded: 0, scheduled: 4 });
      expect(await coverageOf(underNestor)).toEqual({ recorded: 1, scheduled: 4 });

      await mergeInto(rico, ricoAgain).expect(200);

      expect(await coverageOf(underManuel)).toEqual({ recorded: 1, scheduled: 8 });
      expect(await coverageOf(underNestor)).toEqual({ recorded: 0, scheduled: 0 });
      expect(await coverageOf(church)).toEqual(churchBefore);
    });

    describe('a report naming the merged-away leader is the record kept’s (point 22)', () => {
      let nestorAccount: TestAccount;

      beforeEach(async () => {
        // Rico came to DCC in June, so his own figures are not all zero.
        const event = await db
          .insertInto('dcc_events')
          .values({ event_date: SUNDAYS[0] })
          .returning('id')
          .executeTakeFirstOrThrow();
        await dccMark(event.id, rico, true, mark);
        nestorAccount = await createAccount(app, db, { person: nestor, roles: ['LEADER'] });
        await mergeInto(rico, ricoAgain).expect(200);
      });

      /** Every leader-scoped report route a leader's saved link may name, for one leader. */
      const leaderRoutes = (leaderId: string): [string, Record<string, string>][] => {
        const leader = { scope: 'LEADER', leader_id: leaderId };
        const range = { kind: 'MONTH', start: JUNE, period: guardMonth() };
        return [
          ['/api/v1/reports/dcc/monthly', { period: JUNE, ...leader }],
          ['/api/v1/reports/cells/monthly', { period: JUNE, ...leader }],
          ['/api/v1/reports/dcc/twelve', { ...range, ...leader }],
          ['/api/v1/reports/cells/twelve', { ...range, ...leader }],
          ['/api/v1/reports/counts/branch', { period: JUNE, ...leader }],
          ['/api/v1/reports/people/branch', { period: JUNE, ...leader }],
          ['/api/v1/reports/trends/branch', { period: JUNE, figure: 'CELLS', ...leader }],
        ];
      };
      const read = (as: TestAccount, path: string, query: Record<string, string>) =>
        request(server()).get(path).query(query).set('Authorization', `Bearer ${as.accessToken}`);

      it('answers a Leader who reaches the record kept with the record kept’s figures', async () => {
        const absorbed = leaderRoutes(ricoAgain.id);
        const kept = leaderRoutes(rico.id);

        for (const [index, [path, query]] of absorbed.entries()) {
          const asAbsorbed = await read(manuelAccount, path, query);
          expect({ path, status: asAbsorbed.status }).toEqual({ path, status: 200 });
          const asKept = await read(manuelAccount, kept[index][0], kept[index][1]).expect(200);
          expect({ path, body: asAbsorbed.body }).toEqual({ path, body: asKept.body });
        }
      });

      it('refuses a Leader who cannot read the record kept’s report, the former leader included', async () => {
        // Nestor led the duplicate all June, and does not reach Rico.
        for (const [path, query] of leaderRoutes(ricoAgain.id)) {
          const refused = await read(nestorAccount, path, query);
          expect({ path, status: refused.status, code: refused.body.error?.code }).toEqual({
            path,
            status: 403,
            code: 'SCOPE_DENIED',
          });
        }
      });

      it('answers the church-wide trend for the merged-away leader as for the record kept', async () => {
        const asAbsorbed = await read(admin, '/api/v1/reports/trends', {
          figure: 'CELLS',
          leader_id: ricoAgain.id,
        }).expect(200);
        const asKept = await read(admin, '/api/v1/reports/trends', {
          figure: 'CELLS',
          leader_id: rico.id,
        }).expect(200);
        expect(asAbsorbed.body).toEqual(asKept.body);
      });

      it('still answers NOT_FOUND for a leader who never existed', async () => {
        for (const [path, query] of leaderRoutes(randomUUID())) {
          const missing = await read(admin, path, query);
          expect({ path, status: missing.status }).toEqual({ path, status: 404 });
        }
        const trend = await read(admin, '/api/v1/reports/trends', {
          figure: 'CELLS',
          leader_id: randomUUID(),
        });
        expect(trend.status).toBe(404);
      });
    });

    describe("the Senior Pastors' counts (decision 0408, point 16)", () => {
      type Counts = { cell_groups: number; cell_leaders: number };
      type CountRow = Counts & { leader: { id: string } };

      const churchCounts = async () =>
        (
          await request(server())
            .get('/api/v1/reports/church-counts')
            .query({ period: JUNE })
            .set('Authorization', `Bearer ${admin.accessToken}`)
            .expect(200)
        ).body as {
          whole_church: Counts;
          tables: { rows: CountRow[] }[];
          others: Counts;
        };
      const branchCounts = async (leader: TestPerson) =>
        (
          await request(server())
            .get('/api/v1/reports/counts/branch')
            .query({ period: JUNE, scope: 'LEADER', leader_id: leader.id })
            .set('Authorization', `Bearer ${admin.accessToken}`)
            .expect(200)
        ).body as { total: Counts; own: Counts; rows: CountRow[] };
      const rowOf = (body: { tables: { rows: CountRow[] }[] }, person: TestPerson) =>
        body.tables.flatMap((table) => table.rows).find((row) => row.leader.id === person.id);

      it("counts the Cell the duplicate led in the kept record's branch row, not in Others", async () => {
        const before = await churchCounts();
        expect(rowOf(before, nestor)).toMatchObject({ cell_groups: 1, cell_leaders: 1 });

        await mergeInto(rico, ricoAgain).expect(200);

        const after = await churchCounts();
        // Mark's Cell and the one the duplicate led, both in Manuel's branch.
        expect(rowOf(after, manuel)).toMatchObject({ cell_groups: 2, cell_leaders: 2 });
        expect(rowOf(after, nestor)).toMatchObject({ cell_groups: 0, cell_leaders: 0 });
        expect(after.others).toMatchObject({ cell_groups: 0, cell_leaders: 0 });
        expect(after.whole_church).toMatchObject({ cell_groups: 2, cell_leaders: 2 });

        const manuelBranch = await branchCounts(manuel);
        expect(manuelBranch.total).toMatchObject({ cell_groups: 2, cell_leaders: 2 });
        expect(manuelBranch.rows).toEqual([
          expect.objectContaining({ leader: expect.objectContaining({ id: mark.id }) }),
        ]);
        expect(manuelBranch.rows[0]).toMatchObject({ cell_groups: 2, cell_leaders: 2 });
        expect((await branchCounts(nestor)).total).toMatchObject({
          cell_groups: 0,
          cell_leaders: 0,
        });
      });

      it('counts the duplicate and the kept record as one Cell Leader where each led a Cell', async () => {
        await createCell(db, { leader: rico, createdAt: EPOCH });

        await mergeInto(rico, ricoAgain).expect(200);

        const after = await churchCounts();
        // Three Cells, led by Mark and by Rico, whichever of his records led it.
        expect(after.whole_church).toMatchObject({ cell_groups: 3, cell_leaders: 2 });
        expect(rowOf(after, manuel)).toMatchObject({ cell_groups: 3, cell_leaders: 2 });

        const markBranch = await branchCounts(mark);
        expect(markBranch.total).toMatchObject({ cell_groups: 3, cell_leaders: 2 });
        expect(markBranch.rows.find((row) => row.leader?.id === rico.id)).toMatchObject({
          cell_groups: 2,
          cell_leaders: 1,
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Point 17's derived paragraph: an account whose Person was merged away is not changed
  // ---------------------------------------------------------------------------

  describe("the merged-away record's account (point 17, decision 0408)", () => {
    const post = (path: string, body: Record<string, unknown> = {}) =>
      request(server())
        .post(`/api/v1/accounts/${path}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    const accountOf = (id: string) =>
      db
        .selectFrom('accounts')
        .select(['status', 'full_view', 'approves_cells', 'moves_people'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    it('refuses re-enabling it, and leaves it disabled', async () => {
      await mergeInto(juan, juanAgain).expect(200);

      const refused = await post(`${juanAgainAccount.id}/reactivate`).expect(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      expect((await accountOf(juanAgainAccount.id)).status).toBe('DISABLED');
    });

    it('refuses changing its Full view, Approves Cells or Moves people, and changes nothing', async () => {
      await mergeInto(juan, juanAgain).expect(200);
      const before = await accountOf(juanAgainAccount.id);
      expect(before.full_view).toBe(true);

      for (const [path, body] of [
        ['full-view', { full_view: false }],
        ['approves-cells', { approves_cells: true }],
        ['moves-people', { moves_people: true }],
      ] as const) {
        const refused = await post(`${juanAgainAccount.id}/${path}`, body).expect(409);
        expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      }

      expect(await accountOf(juanAgainAccount.id)).toEqual(before);
    });

    it('still re-enables an ordinary disabled account, and ticks it', async () => {
      await post(`${manuelAccount.id}/disable`).expect(200);
      expect((await accountOf(manuelAccount.id)).status).toBe('DISABLED');

      await post(`${manuelAccount.id}/reactivate`).expect(200);
      expect((await accountOf(manuelAccount.id)).status).toBe('ACTIVE');

      await post(`${manuelAccount.id}/moves-people`, { moves_people: true }).expect(200);
      expect((await accountOf(manuelAccount.id)).moves_people).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Absent 3+ Months (decision 0397) counts a merged pair as one person (point 11)
  // ---------------------------------------------------------------------------

  describe('Absent 3+ Months with a merged pair (decision 0397, point 11)', () => {
    // Whichever three months have finished when the suite runs, as absent-and-archive does.
    const months = lastFinishedMonths(manilaDayOf(new Date()), 3);
    const dayIn = (index: number, day: number): string =>
      `${months[index].first.slice(0, 8)}${String(day).padStart(2, '0')}`;
    /** A day `days` before the first of the three months. */
    const beforeWindow = (days: number): string => {
      const at = new Date(`${months[0].first}T00:00:00Z`);
      at.setUTCDate(at.getUTCDate() - days);
      return at.toISOString().slice(0, 10);
    };
    /** The first Sunday on or after a day. */
    const sundayFrom = (day: string): string => {
      const at = new Date(`${day}T00:00:00Z`);
      while (at.getUTCDay() !== 0) {
        at.setUTCDate(at.getUTCDate() + 1);
      }
      return at.toISOString().slice(0, 10);
    };

    const absentIds = async () =>
      (
        (
          await request(server())
            .get('/api/v1/people/absent')
            .set('Authorization', `Bearer ${admin.accessToken}`)
            .expect(200)
        ).body.data as { id: string; last_at_cell: string | null; last_at_dcc: string | null }[]
      ).map((row) => row);

    /** One meeting of Mark's Cell in each month, Juan and Pedro marked Absent at each. */
    const absentEveryMonth = async (): Promise<string[]> => {
      const meetings: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const id = await meeting(cell.id, dayIn(index, 10), mark.id);
        await cellMark(id, juan, false);
        await cellMark(id, pedro, false);
        meetings.push(id);
      }
      return meetings;
    };

    it('does not list the kept record where the duplicate was Present in one of the months', async () => {
      const meetings = await absentEveryMonth();
      await cellMark(meetings[1], juanAgain, true);

      expect((await absentIds()).map((row) => row.id)).toEqual(
        expect.arrayContaining([juan.id, pedro.id]),
      );

      await mergeInto(juan, juanAgain).expect(200);

      const ids = (await absentIds()).map((row) => row.id);
      expect(ids).toContain(pedro.id);
      expect(ids).not.toContain(juan.id);
    });

    it("gives the kept record the duplicate's later last-seen days", async () => {
      await absentEveryMonth();
      // Before the three months, the duplicate came to the Cell and to a DCC Sunday.
      const earlier = beforeWindow(20);
      const held = await meeting(cell.id, earlier, mark.id);
      await cellMark(held, juanAgain, true);
      const sunday = sundayFrom(beforeWindow(14));
      const event = await db
        .insertInto('dcc_events')
        .values({ event_date: sunday })
        .returning('id')
        .executeTakeFirstOrThrow();
      await dccMark(event.id, juanAgain, true, nestor);

      await mergeInto(juan, juanAgain).expect(200);

      const row = (await absentIds()).find((entry) => entry.id === juan.id);
      expect(row).toMatchObject({ last_at_cell: earlier, last_at_dcc: sunday });
    });

    it('does not list the kept record where the duplicate led a Cell that met in the months', async () => {
      await absentEveryMonth();
      // The duplicate led a Cell that met in the second month, and handed it over since.
      const ledCell = await createCell(db, { leader: juanAgain, createdAt: EPOCH });
      await meeting(ledCell.id, dayIn(1, 12), juanAgain.id);
      await handOver(ledCell.id, nestor, new Date(Date.now() - 60_000));

      expect((await absentIds()).map((row) => row.id)).toContain(juan.id);

      await mergeInto(juan, juanAgain).expect(200);

      const ids = (await absentIds()).map((row) => row.id);
      expect(ids).toContain(pedro.id);
      expect(ids).not.toContain(juan.id);
    });

    it('lists the kept record where the duplicate was the one on the roster in the first month', async () => {
      // The duplicate was in Mark's Cell and under Mark from the start; the kept record only
      // from the first day of the second month. Each was marked Absent while it was there.
      const second = new Date(`${months[1].first}T00:00:00+08:00`);
      const lito = await createPerson(db, {
        firstName: 'Lito',
        lastName: 'Garcia',
        network: 'MENS',
      });
      await assignTo(db, lito.id, mark.id, second);
      await db
        .insertInto('cell_memberships')
        .values({ person_id: lito.id, cell_id: cell.id, started_at: second })
        .execute();
      const litoAgain = await createPerson(db, {
        firstName: 'Lito',
        lastName: 'Garcia',
        network: 'MENS',
      });
      await assignTo(db, litoAgain.id, mark.id);
      await db
        .insertInto('cell_memberships')
        .values({ person_id: litoAgain.id, cell_id: cell.id, started_at: EPOCH })
        .execute();

      for (let index = 0; index < 3; index += 1) {
        const id = await meeting(cell.id, dayIn(index, 10), mark.id);
        await cellMark(id, index === 0 ? litoAgain : lito, false);
      }

      expect((await absentIds()).map((row) => row.id)).not.toContain(lito.id);

      await mergeInto(lito, litoAgain).expect(200);

      // One person, on the roster and under a leader the whole of every month, by one record
      // or the other, and Absent in each.
      expect((await absentIds()).map((row) => row.id)).toContain(lito.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Point 23: a meeting a duplicate led on a date the kept record had no leader
  // ---------------------------------------------------------------------------

  describe('a meeting the duplicate led while the kept record had no leader (point 23)', () => {
    let lito: TestPerson;
    let litoAgain: TestPerson;

    beforeEach(async () => {
      // Lito's kept record is placed only from July; his duplicate was under Nestor and led a
      // Cell through June, recording one meeting, and handed it to Nestor in July.
      lito = await createPerson(db, { firstName: 'Lito', lastName: 'Garcia', network: 'MENS' });
      await assignTo(db, lito.id, mark.id, new Date('2026-07-01T00:00:00+08:00'));
      litoAgain = await createPerson(db, {
        firstName: 'Lito',
        lastName: 'Garcia',
        network: 'MENS',
      });
      await assignTo(db, litoAgain.id, nestor.id);

      const litoCell = await createCell(db, { leader: litoAgain, createdAt: EPOCH });
      const tomas = await attendee('Tomas', nestor, litoCell.id);
      const held = await meeting(litoCell.id, MEETINGS[0], litoAgain.id);
      await cellMark(held, tomas, true);
      await handOver(litoCell.id, nestor, AFTER_JUNE);

      await mergeInto(lito, litoAgain).expect(200);
    });

    type Coverage = { recorded: number; scheduled: number };
    const monthly = async (query: string): Promise<Coverage> =>
      (await report('cells', query).expect(200)).body.coverage as Coverage;
    const ofTwelve = async (query: Record<string, string>): Promise<Coverage> => {
      const body = (await twelve('cells', admin, query).expect(200)).body as {
        coverage: Coverage;
      };
      return { recorded: body.coverage.recorded, scheduled: body.coverage.scheduled };
    };

    it("counts it in the duplicate's then-leader's branch on cells/monthly, the rows adding up", async () => {
      // Mark's Cell's four June Saturdays are Manuel's; the duplicate's four are Nestor's.
      const underManuel = await monthly(`scope=LEADER&leader_id=${manuel.id}`);
      const underNestor = await monthly(`scope=LEADER&leader_id=${nestor.id}`);
      const underRaymond = await monthly(`scope=LEADER&leader_id=${raymond.id}`);
      const church = await monthly('scope=WHOLE_CHURCH');

      expect(underNestor).toEqual({ recorded: 1, scheduled: 4 });
      expect(underManuel).toEqual({ recorded: 0, scheduled: 4 });
      // Raymond's two rows are his total, and his total the church's.
      expect({
        recorded: underManuel.recorded + underNestor.recorded,
        scheduled: underManuel.scheduled + underNestor.scheduled,
      }).toEqual(underRaymond);
      expect(underRaymond).toEqual(church);
      expect(church).toEqual({ recorded: 1, scheduled: 8 });
    });

    it('counts it the same way on cells/twelve', async () => {
      const underManuel = await ofTwelve({ scope: 'LEADER', leader_id: manuel.id });
      const underNestor = await ofTwelve({ scope: 'LEADER', leader_id: nestor.id });
      const underRaymond = await ofTwelve({ scope: 'LEADER', leader_id: raymond.id });
      const church = await ofTwelve({ scope: 'WHOLE_CHURCH' });

      expect(underNestor).toEqual({ recorded: 1, scheduled: 4 });
      expect(underManuel).toEqual({ recorded: 0, scheduled: 4 });
      expect({
        recorded: underManuel.recorded + underNestor.recorded,
        scheduled: underManuel.scheduled + underNestor.scheduled,
      }).toEqual(underRaymond);
      expect(underRaymond).toEqual(church);
    });

    it('names the line by the kept record on the coverage rows by leader', async () => {
      type Line = { leader: { id: string } | null; filed: number; owed: number };
      const body = (
        await request(server())
          .get('/api/v1/reports/cells/monthly/by-leader')
          .query({ period: JUNE, scope: 'LEADER', leader_id: nestor.id, limit: 200 })
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200)
      ).body as { data: Line[]; total: { filed: number; owed: number } };

      expect(body.data.find((line) => line.leader?.id === lito.id)).toMatchObject({
        filed: 1,
        owed: 4,
      });
      expect(body.data.find((line) => line.leader?.id === litoAgain.id)).toBeUndefined();
      expect(body.total).toEqual({ filed: 1, owed: 4 });
    });
  });

  // ---------------------------------------------------------------------------
  // The Network screen's Cell meetings behind (decision 0252) follow the kept record
  // ---------------------------------------------------------------------------

  describe("the Network screen's Cell meetings behind (point 16)", () => {
    it("counts a meeting the duplicate led and nobody recorded in the kept record's branch", async () => {
      // Today's meeting, on a Cell the duplicate led until today: its day has begun and its
      // week is open (decision 0335), and a handover on its own day leaves it with the
      // duplicate (decision 0187). Every date is the database's Manila day.
      const today = (
        await sql<{ today: string }>`
          SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
        `.execute(db)
      ).rows[0].today;
      const [y, m, d] = today.split('-').map(Number);
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;

      const rico = await createPerson(db, {
        firstName: 'Rico',
        lastName: 'Santos',
        network: 'MENS',
      });
      await assignTo(db, rico.id, mark.id);
      const ricoAgain = await createPerson(db, {
        firstName: 'Rico',
        lastName: 'Santos',
        network: 'MENS',
      });
      await assignTo(db, ricoAgain.id, nestor.id);
      const ricoCell = await createCell(db, {
        leader: ricoAgain,
        dayOfWeek: weekday,
        createdAt: new Date(Date.UTC(y - 1, 0, 1, 2)),
      });
      await handOver(ricoCell.id, nestor, new Date(`${today}T00:00:01+08:00`));

      const figures = async () =>
        (
          await request(server())
            .get(`/api/v1/leaders/${raymond.id}/cell-figures`)
            .set('Authorization', `Bearer ${admin.accessToken}`)
            .expect(200)
        ).body as {
          branch_meetings_behind: number;
          meetings_behind_by_child: Record<string, number>;
        };

      const before = await figures();
      // At least today's, all the duplicate's, in Nestor's row.
      const owed = before.meetings_behind_by_child[nestor.id];
      expect(owed).toBeGreaterThanOrEqual(1);

      await mergeInto(rico, ricoAgain).expect(200);

      const after = await figures();
      expect(after.meetings_behind_by_child).toEqual({
        [manuel.id]: before.meetings_behind_by_child[manuel.id] + owed,
        [nestor.id]: 0,
      });
      expect(after.branch_meetings_behind).toBe(before.branch_meetings_behind);
    });
  });

  // ---------------------------------------------------------------------------
  // A merge racing a re-enable of the duplicate's account (decision 0408, point 17)
  // ---------------------------------------------------------------------------

  describe("a merge racing a re-enable of the duplicate's account", () => {
    it('leaves the account disabled and the merge made, the re-enable having committed first', async () => {
      // The duplicate's account is disabled before the merge. A re-enable takes the account
      // row and checks the Person (not merged yet), then is held, still uncommitted, by a
      // session row another connection has locked. The merge must wait for that account row
      // rather than read it as still DISABLED and skip disabling it.
      const post = (path: string) =>
        request(server())
          .post(`/api/v1/accounts/${path}`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('Idempotency-Key', randomUUID());
      await post(`${juanAgainAccount.id}/disable`).expect(200);
      const session = await db
        .insertInto('refresh_tokens')
        .values({
          account_id: juanAgainAccount.id,
          token_hash: `held-${randomUUID()}`,
          issued_at: new Date(),
          expires_at: new Date(Date.now() + 86_400_000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      const waiters = async () => {
        const { rows } = await holder.query<{ count: string }>(
          `SELECT count(*) AS count FROM pg_locks
            WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
        );
        return Number(rows[0].count);
      };

      try {
        await holder.query('BEGIN');
        await holder.query('UPDATE refresh_tokens SET last_used_at = now() WHERE id = $1', [
          session.id,
        ]);

        const reenable = post(`${juanAgainAccount.id}/reactivate`).then((response) => response);
        expect(
          await countWhileInFlight(
            waiters,
            track(reenable),
            'the re-enable to wait on the session',
          ),
        ).toBe(1);

        const merged = mergeInto(juan, juanAgain).then((response) => response);
        const both = Promise.all([reenable, merged]);
        // The merge waits on the account row, or, where nothing makes it, finishes.
        await countWhileInFlight(
          async () => ((await waiters()) >= 2 ? 2 : 0),
          track(merged),
          'the merge to wait on the account row',
        );

        await holder.query('ROLLBACK');
        const [reenabled, merge] = await both;

        expect(reenabled.status).toBe(200);
        expect(merge.status).toBe(200);
        expect(merge.body.account_disabled).toBe(true);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }

      const account = await db
        .selectFrom('accounts')
        .select('status')
        .where('id', '=', juanAgainAccount.id)
        .executeTakeFirstOrThrow();
      expect(account.status).toBe('DISABLED');
      const absorbed = await db
        .selectFrom('persons')
        .select('merged_into_id')
        .where('id', '=', juanAgain.id)
        .executeTakeFirstOrThrow();
      expect(absorbed.merged_into_id).toBe(juan.id);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Point 17: the old page opens for whoever may open the record kept
  // ---------------------------------------------------------------------------

  describe("the absorbed record's page is authorized against the record kept (point 17)", () => {
    let nestorAccount: TestAccount;

    const page = (as: TestAccount, person: TestPerson) =>
      request(server())
        .get(`/api/v1/people/${person.id}`)
        .set('Authorization', `Bearer ${as.accessToken}`);

    beforeEach(async () => {
      nestorAccount = await createAccount(app, db, { person: nestor, roles: ['LEADER'] });
      // Manuel may move people, so a refused reassignment below is not the missing tick.
      await db
        .updateTable('accounts')
        .set({ moves_people: true })
        .where('id', '=', manuelAccount.id)
        .execute();
      await mergeInto(juan, juanAgain).expect(200);
    });

    it('opens for a Leader whose own subtree reaches the record kept', async () => {
      // Manuel reaches Juan through Mark; the duplicate, under Nestor, was never his.
      const response = await page(manuelAccount, juanAgain).expect(200);
      expect(response.body.merged.into.id).toBe(juan.id);
    });

    it('refuses a Leader who does not reach the record kept, its former leader included', async () => {
      // Nestor led the duplicate until the merge, and does not reach Juan.
      const response = await page(nestorAccount, juanAgain).expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('admits no write to the absorbed record by the Leader its page opens for', async () => {
      // Section 7 lends the kept record's scope to a read alone: a write resolves through the
      // absorbed record's own ended position, so the Leader is out of scope for it.
      const reassigned = await request(server())
        .put(`/api/v1/people/${juanAgain.id}/pastoral-leader`)
        .set('Authorization', `Bearer ${manuelAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ pastoral_leader_id: mark.id });
      expect(reassigned.status).toBe(403);
      expect(reassigned.body.error.code).toBe('SCOPE_DENIED');
      expect(await openRows('pastoral_assignments', juanAgain)).toEqual([]);

      // Section 3: the page stays read only. The record kept is acknowledged, so the refusal
      // is not the duplicate check's.
      const edited = await request(server())
        .patch(`/api/v1/people/${juanAgain.id}`)
        .set('Authorization', `Bearer ${manuelAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ mobile_number: '09170000009', acknowledged_duplicate_ids: [juan.id] });
      expect(edited.status).toBe(403);
      expect(edited.body.error.code).toBe('SCOPE_DENIED');
      const row = await db
        .selectFrom('persons')
        .select('mobile_number')
        .where('id', '=', juanAgain.id)
        .executeTakeFirstOrThrow();
      expect(row.mobile_number).toBe('09170000002');
    });

    it('refuses even the Admin an edit of the absorbed record (point 17)', async () => {
      const edited = await request(server())
        .patch(`/api/v1/people/${juanAgain.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ mobile_number: '09170000009', acknowledged_duplicate_ids: [juan.id] });
      expect(edited.status).toBe(409);
      expect(edited.body.error.code).toBe('INVARIANT_VIOLATION');
      const row = await db
        .selectFrom('persons')
        .select('mobile_number')
        .where('id', '=', juanAgain.id)
        .executeTakeFirstOrThrow();
      expect(row.mobile_number).toBe('09170000002');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Point 20: unticking reaches every record of the person
  // ---------------------------------------------------------------------------

  describe('unticking a lesson or graduation reaches both records (point 20)', () => {
    const lesson = async (person: TestPerson, number: number, at: string, by: TestPerson) =>
      (
        await db
          .insertInto('suynl_lessons')
          .values({
            person_id: person.id,
            lesson: number,
            confirmed_by: by.id,
            recorded_by: admin.id,
            confirmed_at: new Date(at),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

    const graduate = async (
      person: TestPerson,
      program: 'ENCOUNTER' | 'SOL_1',
      on: string,
      by: TestPerson,
    ) =>
      (
        await db
          .insertInto('training_graduations')
          .values({
            person_id: person.id,
            program,
            graduated_on: on,
            confirmed_by: by.id,
            recorded_by: admin.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

    const submit = (domain: 'suynl' | 'training', changes: Record<string, unknown>[]) =>
      request(server())
        .post(`/api/v1/${domain}/submit`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ changes });

    const juanLessons = async () => {
      const listed = (
        await request(server())
          .get('/api/v1/suynl/people?limit=200')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200)
      ).body.data as { person_id: string; lessons: { id: string; lesson: number }[] }[];
      return listed.find((row) => row.person_id === juan.id)?.lessons ?? [];
    };

    const juanGraduations = async () => {
      const listed = (
        await request(server())
          .get('/api/v1/training/people?limit=200')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200)
      ).body.data as {
        person_id: string;
        graduations: { id: string; program: string; graduated_on: string | null }[];
      }[];
      return listed.find((row) => row.person_id === juan.id)?.graduations ?? [];
    };

    const supersededOf = (table: 'suynl_lessons' | 'training_graduations', ids: string[]) =>
      db.selectFrom(table).select(['id', 'superseded_at']).where('id', 'in', ids).execute();

    const correctedTargets = async (
      action: 'suynl_lesson.corrected' | 'training_graduation.corrected',
    ) =>
      (await db.selectFrom('audit_log').select('target_id').where('action', '=', action).execute())
        .map((entry) => entry.target_id)
        .sort();

    it("withdraws a lesson shown from the duplicate, on the duplicate's row", async () => {
      await lesson(juan, 1, '2026-05-10T10:00:00+08:00', mark);
      const fromDuplicate = await lesson(juanAgain, 3, '2026-05-17T10:00:00+08:00', nestor);
      await mergeInto(juan, juanAgain).expect(200);

      const shown = (await juanLessons()).find((row) => row.lesson === 3);
      expect(shown?.id).toBe(fromDuplicate);

      const response = await submit('suynl', [
        { person_id: juan.id, lesson: 3, done: false, seen_id: shown?.id, reason: 'Not done.' },
      ]).expect(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });

      expect((await juanLessons()).map((row) => row.lesson)).toEqual([1]);
      const [row] = await supersededOf('suynl_lessons', [fromDuplicate]);
      expect(row.superseded_at).not.toBeNull();
    });

    it('withdraws a lesson held on both records from both, one audit entry for each', async () => {
      const kept = await lesson(juan, 2, '2026-05-10T10:00:00+08:00', mark);
      const duplicate = await lesson(juanAgain, 2, '2026-04-12T10:00:00+08:00', nestor);
      await mergeInto(juan, juanAgain).expect(200);

      // The earlier row is the one shown, and the one the untick is made against.
      const shown = (await juanLessons()).find((row) => row.lesson === 2);
      expect(shown?.id).toBe(duplicate);

      const response = await submit('suynl', [
        { person_id: juan.id, lesson: 2, done: false, seen_id: shown?.id, reason: 'Not done.' },
      ]).expect(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });

      expect(await juanLessons()).toEqual([]);
      const rows = await supersededOf('suynl_lessons', [kept, duplicate]);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.superseded_at).not.toBeNull();
      }
      // Each audited against the record it was on.
      expect(await correctedTargets('suynl_lesson.corrected')).toEqual(
        [juan.id, juanAgain.id].sort(),
      );
    });

    it("withdraws a graduation shown from the duplicate, on the duplicate's row", async () => {
      const fromDuplicate = await graduate(juanAgain, 'SOL_1', '2026-02-01', nestor);
      await mergeInto(juan, juanAgain).expect(200);

      const shown = (await juanGraduations()).find((row) => row.program === 'SOL_1');
      expect(shown?.id).toBe(fromDuplicate);

      const response = await submit('training', [
        {
          person_id: juan.id,
          program: 'SOL_1',
          graduated: false,
          seen_id: shown?.id,
          reason: 'He did not finish.',
        },
      ]).expect(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });

      expect(await juanGraduations()).toEqual([]);
      const [row] = await supersededOf('training_graduations', [fromDuplicate]);
      expect(row.superseded_at).not.toBeNull();
    });

    it('changes the date of a graduation on both records, leaving one row on the record kept', async () => {
      const kept = await graduate(juan, 'ENCOUNTER', '2026-03-01', mark);
      const duplicate = await graduate(juanAgain, 'ENCOUNTER', '2026-02-01', nestor);
      await mergeInto(juan, juanAgain).expect(200);

      const shown = (await juanGraduations()).find((row) => row.program === 'ENCOUNTER');
      expect(shown?.id).toBe(duplicate);

      const response = await submit('training', [
        {
          person_id: juan.id,
          program: 'ENCOUNTER',
          graduated: true,
          graduated_on: '2026-02-08',
          seen_id: shown?.id,
          reason: 'The weekend after.',
        },
      ]).expect(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });

      const rows = await supersededOf('training_graduations', [kept, duplicate]);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.superseded_at).not.toBeNull();
      }
      const current = await db
        .selectFrom('training_graduations')
        .select(['person_id', 'graduated_on'])
        .where('program', '=', 'ENCOUNTER')
        .where('superseded_at', 'is', null)
        .execute();
      expect(current).toEqual([{ person_id: juan.id, graduated_on: '2026-02-08' }]);

      expect(await correctedTargets('training_graduation.corrected')).toEqual(
        [juan.id, juanAgain.id].sort(),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 8. The constraints, written directly (migration 0033)
  // ---------------------------------------------------------------------------

  describe('migration 0033, bypassing the application', () => {
    const setMerge = (id: string, into: string | null) =>
      db
        .updateTable('persons')
        .set({
          merged_into_id: into,
          merged_at: into === null ? null : new Date(),
          merge_reason: into === null ? null : 'Written directly.',
          merged_by: null,
        })
        .where('id', '=', id)
        .execute();

    it('refuses moving or undoing a merge once made', async () => {
      await setMerge(juanAgain.id, juan.id);

      await expect(setMerge(juanAgain.id, pedro.id)).rejects.toThrow(
        /never undone, moved or rewritten/,
      );
      await expect(setMerge(juanAgain.id, null)).rejects.toThrow(
        /never undone, moved or rewritten/,
      );
    });

    it('refuses merging into a record merged away, or merging away one that absorbed another', async () => {
      await setMerge(juanAgain.id, juan.id);

      await expect(setMerge(pedro.id, juanAgain.id)).rejects.toThrow(/has itself been merged away/);
      await expect(setMerge(juan.id, pedro.id)).rejects.toThrow(/has absorbed another/);
    });

    it('refuses a merge with no time or no reason', async () => {
      await expect(
        db
          .updateTable('persons')
          .set({ merged_into_id: juan.id, merged_at: new Date(), merge_reason: '\t' })
          .where('id', '=', juanAgain.id)
          .execute(),
      ).rejects.toThrow(/persons_merge_is_whole/);
      await expect(
        db
          .updateTable('persons')
          .set({ merged_into_id: juan.id, merge_reason: 'Written directly.' })
          .where('id', '=', juanAgain.id)
          .execute(),
      ).rejects.toThrow(/persons_merge_is_whole/);
    });

    it('refuses a Person created merged', async () => {
      await expect(
        db
          .insertInto('persons')
          .values({
            id: randomUUID(),
            first_name: 'Juan',
            last_name: 'Reyes',
            sex: 'MALE',
            civil_status: 'SINGLE',
            merged_into_id: juan.id,
            merged_at: new Date(),
            merge_reason: 'Written directly.',
          })
          .execute(),
      ).rejects.toThrow(/never created merged/);
    });

    it('refuses rewriting when, by whom or why a merge was made', async () => {
      await setMerge(juanAgain.id, juan.id);

      for (const change of [
        { merged_at: new Date('2026-01-01T00:00:00Z') },
        { merged_by: admin.id },
        { merge_reason: 'Rewritten directly.' },
      ]) {
        await expect(
          db.updateTable('persons').set(change).where('id', '=', juanAgain.id).execute(),
        ).rejects.toThrow(/never undone, moved or rewritten/);
      }
    });
  });
});
