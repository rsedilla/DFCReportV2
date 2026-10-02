import request from 'supertest';
import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * What a person's page costs, which should not grow with the reader's scope (checklist row
 * perf-person-page).
 *
 * The page reads one person's SUYNL lessons and Training graduations through the Growth
 * lists, and the month's Sundays through the DCC calendar. The lists worked out every
 * person's progress across the reader's whole scope, used only to filter by a step the page
 * never asks for; the calendar worked out coverage across the reader's branch, which the
 * page never shows.
 *
 * Measured as rows fetched, summed over every query on `pg`'s `Client.prototype.query`.
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('a person’s page reads only what it shows (perf-person-page)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let raymondAccount: TestAccount;
  let admin: TestAccount;
  let disciples: TestPerson[];

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
    disciples = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** `count` more disciples of Raymond's, each with a lesson and a graduation. */
  async function addDisciples(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const person = await createPerson(db, {
        firstName: `Disciple${disciples.length}`,
        network: 'MENS',
      });
      await assignTo(db, person.id, raymond.id);
      await db
        .insertInto('suynl_lessons')
        .values({
          person_id: person.id,
          lesson: 1,
          confirmed_by: raymond.id,
          recorded_by: raymondAccount.id,
        })
        .execute();
      await db
        .insertInto('training_graduations')
        .values({
          person_id: person.id,
          program: 'LIFE_CLASS',
          graduated_on: null,
          confirmed_by: raymond.id,
          recorded_by: raymondAccount.id,
        })
        .execute();
      disciples.push(person);
    }
  }

  async function fetched(
    account: TestAccount,
    path: string,
  ): Promise<{ rows: number; body: Record<string, unknown> }> {
    const spy = jest.spyOn(Client.prototype, 'query');
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${account.accessToken}`);
    const results = await Promise.all(
      spy.mock.results.map((result) =>
        Promise.resolve(result.value as unknown).then(
          (value) => (value as { rows?: unknown[] } | undefined)?.rows?.length ?? 0,
          () => 0,
        ),
      ),
    );
    spy.mockRestore();

    expect(response.status).toBe(200);
    return { rows: results.reduce((sum, rows) => sum + rows, 0), body: response.body };
  }

  it.each([['suynl'], ['training']])(
    'the %s row for one person costs the same in a small church and a large one',
    async (tab) => {
      await addDisciples(3);
      const memberId = (
        await db
          .selectFrom('persons')
          .select('member_id')
          .where('id', '=', disciples[0].id)
          .executeTakeFirstOrThrow()
      ).member_id;
      const path = `/api/v1/${tab}/people?q=${memberId}&limit=1`;

      const small = await fetched(admin, path);
      await addDisciples(30);
      const large = await fetched(admin, path);

      expect((large.body.data as { person_id: string }[]).map((row) => row.person_id)).toEqual([
        disciples[0].id,
      ]);
      expect(large.rows).toBe(small.rows);
    },
  );

  it('a step filter still narrows the list', async () => {
    await addDisciples(3);

    const graduated = await fetched(admin, '/api/v1/suynl/people?step=GRADUATED&limit=50');
    expect(graduated.body.data).toEqual([]);

    const inProgress = await fetched(admin, '/api/v1/suynl/people?step=IN_PROGRESS&limit=50');
    expect(
      (inProgress.body.data as { person_id: string }[]).map((row) => row.person_id).sort(),
    ).toEqual(disciples.map((person) => person.id).sort());
  });

  it('the month’s Sundays without coverage cost the same however many leaders there are', async () => {
    await db
      .insertInto('dcc_events')
      .values([{ event_date: '2026-06-07' }, { event_date: '2026-06-14' }])
      .execute();
    const path = '/api/v1/dcc/events?month=2026-06-01&coverage=false';

    const small = await fetched(admin, path);
    await addDisciples(30);
    const large = await fetched(admin, path);

    expect(large.rows).toBe(small.rows);
    const full = await fetched(admin, '/api/v1/dcc/events?month=2026-06-01');
    // The same Sundays and the same flags, less the coverage line.
    expect(large.body).toEqual({
      ...full.body,
      data: (full.body.data as Record<string, unknown>[]).map((event) => ({
        ...event,
        coverage: null,
      })),
    });
  });

  it('refuses a coverage flag that is neither true nor false', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dcc/events?month=2026-06-01&coverage=banana')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(response.status).toBe(422);
  });
});
