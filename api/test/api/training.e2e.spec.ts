import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
import { countWhileInFlight, track } from '../setup/concurrency';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database, TrainingProgram } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * Training graduations at the API (SKILL.md section 28; decisions 0278 to 0282).
 *
 * Fixture names are invented (CLAUDE.md, Secrets). The tree is the example one:
 *
 *   Raymond (Men's root) -> Manuel -> { Mark -> { Timothy, Silas (archived) }, Nathan }
 *   Grace (Women's root)
 *   Adele: an administrator outside the pastoral tree
 */
describe('Training (section 28)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let timothy: TestPerson;
  let silas: TestPerson;
  let nathan: TestPerson;
  let grace: TestPerson;

  let admin: TestAccount;
  let raymondAccount: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

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
    timothy = await createPerson(db, { firstName: 'Timothy', network: 'MENS' });
    await assignTo(db, timothy.id, mark.id);
    silas = await createPerson(db, { firstName: 'Silas', network: 'MENS', archived: true });
    await assignTo(db, silas.id, mark.id);
    nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
    await assignTo(db, grace.id, null);

    const adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });

    raymondAccount = await createAccount(app, db, {
      person: raymond,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    nameSeniorPastors(app, [raymond.id]);

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  interface Change {
    person_id: string;
    program: TrainingProgram;
    graduated: boolean;
    graduated_on?: string | null;
    seen_id?: string | null;
    reason?: string;
  }

  const submit = (account: TestAccount, changes: Change[], key: string = randomUUID()) =>
    request(app.getHttpServer())
      .post('/api/v1/training/submit')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ changes });

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/training/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const graduate = (personId: string, program: TrainingProgram, graduatedOn?: string): Change => ({
    person_id: personId,
    program,
    graduated: true,
    ...(graduatedOn === undefined ? {} : { graduated_on: graduatedOn }),
  });

  const allRows = () => db.selectFrom('training_graduations').selectAll().orderBy('id').execute();

  const currentRow = (personId: string, program: TrainingProgram) =>
    db
      .selectFrom('training_graduations')
      .selectAll()
      .where('person_id', '=', personId)
      .where('program', '=', program)
      .where('superseded_at', 'is', null)
      .executeTakeFirstOrThrow();

  const currentCount = async (personId: string, program: TrainingProgram) =>
    (
      await db
        .selectFrom('training_graduations')
        .select('id')
        .where('person_id', '=', personId)
        .where('program', '=', program)
        .where('superseded_at', 'is', null)
        .execute()
    ).length;

  const auditOf = (action: string) =>
    db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action as never)
      .execute();

  const allAudit = () => db.selectFrom('audit_log').selectAll().execute();

  /**
   * Moves a person under another leader by closing and opening the rows directly, both
   * ends from one host `Date` (fixtures.ts, *Never take the two ends ... from different
   * clocks*), as `reports-by-leader.e2e.spec.ts` does.
   */
  const reassign = async (personId: string, leaderId: string): Promise<void> => {
    await db.transaction().execute(async (trx) => {
      const at = new Date();
      await trx
        .updateTable('pastoral_assignments')
        .set({ ended_at: at })
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('pastoral_assignments')
        .values({ person_id: personId, leader_id: leaderId, started_at: at })
        .execute();
    });
  };

  const today = async (): Promise<string> => manilaDayOf(await databaseNow(db));

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  const allPages = async (account: TestAccount, query: string) => {
    const rows: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const response = await get(account, `people?${query}${suffix}`);
      expect(response.status).toBe(200);
      rows.push(...response.body.data);
      cursor = response.body.next_cursor;
      pages += 1;
      expect(pages).toBeLessThan(50);
    } while (cursor !== null);

    return rows;
  };

  const idsOf = (rows: Array<Record<string, unknown>>) => rows.map((row) => row.person_id);

  // ---------------------------------------------------------------------------
  // Filing
  // ---------------------------------------------------------------------------

  describe('filing', () => {
    it('records a graduation for a direct disciple, with a date or without one', async () => {
      const response = await submit(markAccount, [
        graduate(timothy.id, 'ENCOUNTER', '2019-03-10'),
        graduate(timothy.id, 'LIFE_CLASS'),
      ]);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 2, corrected: 0, unchanged: 0 });

      const encounter = await currentRow(timothy.id, 'ENCOUNTER');
      expect(encounter.graduated_on).toBe('2019-03-10');
      expect(encounter.confirmed_by).toBe(mark.id);
      expect(encounter.recorded_by).toBe(markAccount.id);

      // Section 28: a date where the leader knows it, and none where they do not.
      expect((await currentRow(timothy.id, 'LIFE_CLASS')).graduated_on).toBeNull();

      const entries = await auditOf('training_graduation.confirmed');
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        expect(entry.target_type).toBe('person');
        expect(entry.target_id).toBe(timothy.id);
        expect(entry.after).toMatchObject({ confirmed_by: mark.id, on_behalf: false });
      }
    });

    it("records an upline filing for a downline leader's disciple as on behalf", async () => {
      const response = await submit(manuelAccount, [graduate(timothy.id, 'SOL_1')]);

      expect(response.status).toBe(201);
      const row = await currentRow(timothy.id, 'SOL_1');
      expect(row.confirmed_by).toBe(mark.id);
      expect(row.recorded_by).toBe(manuelAccount.id);

      const [entry] = await auditOf('training_graduation.confirmed');
      expect(entry.actor_id).toBe(manuelAccount.id);
      expect(entry.after).toMatchObject({
        program: 'SOL_1',
        confirmed_by: mark.id,
        on_behalf: true,
      });
    });

    it('accepts today as a graduation date and refuses tomorrow', async () => {
      const now = await today();

      const onToday = await submit(markAccount, [graduate(timothy.id, 'ENCOUNTER', now)]);
      expect(onToday.status).toBe(201);

      const tomorrow = await submit(markAccount, [graduate(timothy.id, 'SOL_2', shift(now, 1))]);
      expect(tomorrow.status).toBe(422);
      expect(tomorrow.body.error.code).toBe('VALIDATION_FAILED');
      expect(tomorrow.body.error.details.field).toBe('graduated_on');
      expect(await currentCount(timothy.id, 'SOL_2')).toBe(0);
    });

    it('refuses a date that does not exist', async () => {
      const response = await submit(markAccount, [graduate(timothy.id, 'ENCOUNTER', '2019-02-30')]);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await allRows()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Refusals
  // ---------------------------------------------------------------------------

  describe('refusals', () => {
    it('refuses a person outside scope, and writes nothing from the batch', async () => {
      const response = await submit(markAccount, [
        graduate(timothy.id, 'ENCOUNTER'),
        graduate(nathan.id, 'ENCOUNTER'),
      ]);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await allRows()).toHaveLength(0);
      expect(await allAudit()).toHaveLength(0);
    });

    it('refuses anybody filing for themselves, whatever their grant (decision 0280)', async () => {
      for (const account of [markAccount, raymondAccount, admin]) {
        const response = await submit(account, [graduate(account.personId, 'ENCOUNTER')]);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
      }

      expect(await allRows()).toHaveLength(0);
    });

    it('refuses an archived person (decision 0279)', async () => {
      const response = await submit(admin, [graduate(silas.id, 'ENCOUNTER')]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await allRows()).toHaveLength(0);
    });

    it('files a Network root for a Whole Church holder with no confirming leader, and refuses a leader', async () => {
      const byLeader = await submit(manuelAccount, [graduate(raymond.id, 'SOL_3')]);
      expect(byLeader.status).toBe(403);
      expect(byLeader.body.error.code).toBe('SCOPE_DENIED');

      const bySeniorPastor = await submit(raymondAccount, [graduate(grace.id, 'SOL_3')]);
      expect(bySeniorPastor.status).toBe(201);
      expect((await currentRow(grace.id, 'SOL_3')).confirmed_by).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Correcting (section 28; decision 0282)
  // ---------------------------------------------------------------------------

  describe('correcting', () => {
    it("names the withdrawn row's confirming leader, not the person's leader now", async () => {
      await submit(markAccount, [graduate(timothy.id, 'SOL_1', '2021-02-14')]);
      const row = await currentRow(timothy.id, 'SOL_1');
      expect(row.confirmed_by).toBe(mark.id);

      await reassign(timothy.id, manuel.id);

      const response = await submit(manuelAccount, [
        {
          person_id: timothy.id,
          program: 'SOL_1',
          graduated: false,
          seen_id: row.id,
          reason: 'He did not finish.',
        },
      ]);
      expect(response.status).toBe(201);

      const [entry] = await auditOf('training_graduation.corrected');
      expect(entry.actor_id).toBe(manuelAccount.id);
      expect(entry.before).toMatchObject({ confirmed_by: mark.id });
      expect(entry.after).toMatchObject({
        withdrawn: true,
        confirmed_by: mark.id,
        on_behalf: true,
      });
    });

    it("on a date change names the old row's confirmer before and the new row's after", async () => {
      await submit(markAccount, [graduate(timothy.id, 'SOL_1', '2021-02-14')]);
      const row = await currentRow(timothy.id, 'SOL_1');

      await reassign(timothy.id, manuel.id);

      const response = await submit(manuelAccount, [
        { ...graduate(timothy.id, 'SOL_1', '2021-02-21'), seen_id: row.id, reason: 'Wrong week.' },
      ]);
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });

      // The replacement is Manuel's own statement now: he is Timothy's direct leader.
      const replacement = await currentRow(timothy.id, 'SOL_1');
      expect(replacement.confirmed_by).toBe(manuel.id);

      const entries = await auditOf('training_graduation.corrected');
      expect(entries).toHaveLength(1);
      expect(entries[0].before).toMatchObject({
        confirmed_by: mark.id,
        graduated_on: '2021-02-14',
      });
      expect(entries[0].after).toMatchObject({
        confirmed_by: manuel.id,
        graduated_on: '2021-02-21',
      });
    });

    it('changes a date by superseding the row and inserting a new one, audited once', async () => {
      await submit(markAccount, [graduate(timothy.id, 'ENCOUNTER', '2019-03-10')]);
      const seen = await currentRow(timothy.id, 'ENCOUNTER');

      const response = await submit(markAccount, [
        {
          ...graduate(timothy.id, 'ENCOUNTER', '2019-03-17'),
          seen_id: seen.id,
          reason: 'Retreat was the following weekend.',
        },
      ]);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });

      const old = await db
        .selectFrom('training_graduations')
        .selectAll()
        .where('id', '=', seen.id)
        .executeTakeFirstOrThrow();
      expect(old.superseded_at).not.toBeNull();
      expect(old.corrected_by).toBe(markAccount.id);
      expect(old.correction_reason).toBe('Retreat was the following weekend.');
      expect(old.graduated_on).toBe('2019-03-10');

      const replacement = await currentRow(timothy.id, 'ENCOUNTER');
      expect(replacement.id).not.toBe(seen.id);
      expect(replacement.graduated_on).toBe('2019-03-17');
      expect(replacement.confirmed_by).toBe(mark.id);

      expect(await allRows()).toHaveLength(2);

      const entries = await auditOf('training_graduation.corrected');
      expect(entries).toHaveLength(1);
      expect(entries[0].reason).toBe('Retreat was the following weekend.');
      expect(entries[0].before).toMatchObject({ graduated_on: '2019-03-10' });
      expect(entries[0].after).toMatchObject({ graduated_on: '2019-03-17' });
      // One `.corrected` entry and no second `.confirmed` for the replacement.
      expect(await auditOf('training_graduation.confirmed')).toHaveLength(1);
    });

    it('refuses a date change with no reason', async () => {
      await submit(markAccount, [graduate(timothy.id, 'ENCOUNTER', '2019-03-10')]);
      const seen = await currentRow(timothy.id, 'ENCOUNTER');

      const response = await submit(markAccount, [
        { ...graduate(timothy.id, 'ENCOUNTER', '2019-03-17'), seen_id: seen.id },
      ]);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('reason');
      expect(await allRows()).toHaveLength(1);
    });

    it('refuses a date change that names no row it was made against', async () => {
      // The client says it saw nothing, and something stands (decision 0282).
      await submit(markAccount, [graduate(timothy.id, 'ENCOUNTER', '2019-03-10')]);
      const stored = await currentRow(timothy.id, 'ENCOUNTER');
      const before = await allRows();

      const response = await submit(markAccount, [graduate(timothy.id, 'ENCOUNTER', '2019-03-17')]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('VERSION_CONFLICT');
      expect(response.body.error.details.submitted_row).toBeNull();
      expect(response.body.error.details.current_row).toBe(stored.id);
      expect(await allRows()).toEqual(before);
    });

    it('refuses a first graduation carrying a reason', async () => {
      const response = await submit(markAccount, [
        { ...graduate(timothy.id, 'ENCOUNTER'), reason: 'Nothing to correct.' },
      ]);

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('reason');
      expect(await allRows()).toHaveLength(0);
    });

    it('withdraws a graduation with a reason, leaving no current row', async () => {
      await submit(markAccount, [graduate(timothy.id, 'SOL_1')]);
      const seen = await currentRow(timothy.id, 'SOL_1');

      const response = await submit(markAccount, [
        {
          person_id: timothy.id,
          program: 'SOL_1',
          graduated: false,
          seen_id: seen.id,
          reason: 'He attended but did not finish.',
        },
      ]);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });
      expect(await currentCount(timothy.id, 'SOL_1')).toBe(0);

      const [entry] = await auditOf('training_graduation.corrected');
      expect(entry.reason).toBe('He attended but did not finish.');
      expect(entry.after).toMatchObject({ withdrawn: true });
    });

    it('refuses a withdrawal naming a row that has since been replaced', async () => {
      await submit(markAccount, [graduate(timothy.id, 'ENCOUNTER', '2019-03-10')]);
      const seen = await currentRow(timothy.id, 'ENCOUNTER');

      await submit(manuelAccount, [
        { ...graduate(timothy.id, 'ENCOUNTER', '2019-03-17'), seen_id: seen.id, reason: 'Date.' },
      ]);
      const replacement = await currentRow(timothy.id, 'ENCOUNTER');
      const before = await allRows();
      const auditBefore = await allAudit();

      const response = await submit(markAccount, [
        {
          person_id: timothy.id,
          program: 'ENCOUNTER',
          graduated: false,
          seen_id: seen.id,
          reason: 'Written about the 10th.',
        },
      ]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('VERSION_CONFLICT');
      expect(response.body.error.details.submitted_row).toBe(seen.id);
      expect(response.body.error.details.current_row).toBe(replacement.id);
      expect(response.body.error.details.current).toMatchObject({
        graduated: true,
        graduated_on: '2019-03-17',
      });
      expect(response.body.error.details).toHaveProperty('submitted');
      expect(await allRows()).toEqual(before);
      expect(await allAudit()).toHaveLength(auditBefore.length);
    });

    it('answers a graduation somebody else already recorded, same date, as unchanged', async () => {
      await submit(manuelAccount, [graduate(timothy.id, 'LIFE_CLASS', '2020-05-01')]);

      const response = await submit(markAccount, [
        graduate(timothy.id, 'LIFE_CLASS', '2020-05-01'),
      ]);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 0, corrected: 0, unchanged: 1 });
      expect(await allRows()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrency
  // ---------------------------------------------------------------------------

  describe('concurrent first graduations', () => {
    it('loses to an uncommitted one without a 500 or a second current row', async () => {
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      let response: request.Response;
      try {
        await holder.query('BEGIN');
        await holder.query(
          `INSERT INTO training_graduations (person_id, program, confirmed_by, recorded_by)
           VALUES ($1, 'ENCOUNTER', $2, $3)`,
          [timothy.id, mark.id, manuelAccount.id],
        );

        const attempt = submit(markAccount, [graduate(timothy.id, 'ENCOUNTER')]);
        const inFlight = track(attempt);

        const waiters = await countWhileInFlight(
          async () => {
            const { rows } = await holder.query<{ count: string }>(
              `SELECT count(*) AS count FROM pg_locks
                WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
            );
            return Number(rows[0].count);
          },
          inFlight,
          'the graduation to block on training_graduations_one_current_per_program',
        );
        expect(waiters).toBeGreaterThan(0);

        await holder.query('COMMIT');
        response = await attempt;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }

      expect(response.status).not.toBe(500);
      if (response.status !== 201) {
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');
      }
      expect(await currentCount(timothy.id, 'ENCOUNTER')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Counts and the list (decision 0281)
  // ---------------------------------------------------------------------------

  describe('counts and the list', () => {
    beforeEach(async () => {
      const seed = async (personId: string, program: TrainingProgram) =>
        db
          .insertInto('training_graduations')
          .values({ person_id: personId, program, confirmed_by: null, recorded_by: admin.id })
          .execute();

      await seed(timothy.id, 'ENCOUNTER');
      await seed(timothy.id, 'LIFE_CLASS');
      await seed(nathan.id, 'ENCOUNTER');
      // Archived: kept, and neither listed nor counted (decision 0279).
      await seed(silas.id, 'ENCOUNTER');
    });

    it('counts per school and those with none, over current people only', async () => {
      const response = await get(manuelAccount, 'counts');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        people: 4,
        not_started: 2,
        encounter: 2,
        life_class: 1,
        sol_1: 0,
        sol_2: 0,
        sol_3: 0,
      });

      const listed = await allPages(manuelAccount, 'limit=200');
      expect(listed).toHaveLength(response.body.people);
      expect(idsOf(listed)).not.toContain(silas.id);
    });

    it('each card narrows the list to exactly its count', async () => {
      const counts = (await get(manuelAccount, 'counts')).body;

      const encounter = await allPages(manuelAccount, 'step=ENCOUNTER');
      const lifeClass = await allPages(manuelAccount, 'step=LIFE_CLASS');
      const notStarted = await allPages(manuelAccount, 'step=NOT_STARTED');
      const sol3 = await allPages(manuelAccount, 'step=SOL_3');

      expect(new Set(idsOf(encounter))).toEqual(new Set([timothy.id, nathan.id]));
      expect(idsOf(lifeClass)).toEqual([timothy.id]);
      expect(new Set(idsOf(notStarted))).toEqual(new Set([manuel.id, mark.id]));
      expect(sol3).toHaveLength(0);

      expect(encounter).toHaveLength(counts.encounter);
      expect(lifeClass).toHaveLength(counts.life_class);
      expect(notStarted).toHaveLength(counts.not_started);
    });

    it('carries each row’s graduations and may_file, and pages every person once', async () => {
      const rows = await allPages(manuelAccount, 'limit=1');
      const byId = new Map(rows.map((row) => [row.person_id, row]));

      expect(rows).toHaveLength(4);
      expect(byId.size).toBe(4);
      expect(byId.get(manuel.id)?.may_file).toBe(false);
      expect(byId.get(mark.id)?.may_file).toBe(true);
      expect(byId.get(timothy.id)?.may_file).toBe(true);
      expect(
        (byId.get(timothy.id)?.graduations as Array<{ program: string }>).map((g) => g.program),
      ).toEqual(['ENCOUNTER', 'LIFE_CLASS']);

      const mine = await allPages(manuelAccount, 'mine=true');
      expect(new Set(idsOf(mine))).toEqual(new Set([mark.id, nathan.id]));
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency (section 22)
  // ---------------------------------------------------------------------------

  describe('idempotency', () => {
    it('replays the stored response and writes nothing twice', async () => {
      const key = randomUUID();
      const changes = [graduate(timothy.id, 'ENCOUNTER', '2019-03-10')];

      const first = await submit(markAccount, changes, key);
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ created: 1, corrected: 0, unchanged: 0 });

      const replay = await submit(markAccount, changes, key);
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);

      expect(await allRows()).toHaveLength(1);
      expect(await auditOf('training_graduation.confirmed')).toHaveLength(1);
    });
  });
});
