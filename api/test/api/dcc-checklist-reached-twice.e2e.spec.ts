import request from 'supertest';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * The DCC checklist walk refuses a person it reaches twice (checklist row
 * later-repeat-guard-test).
 *
 * `checklist()` in `dcc-attendance.service.ts` keeps a visited set so a cycle cannot
 * make the walk run for ever (section 5), and throws when a person comes round again.
 * Nothing pinned it, so a tidy-up could remove the set and only a corrupt tree would
 * notice. The case built here is the one its docblock names as reachable: two closed
 * rows for one person overlapping at the event's instant, which
 * `pastoral_assignments_one_active` does not refuse because it is partial on open rows.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('a DCC checklist that reaches a person twice is refused (later-repeat-guard-test)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymondAccount: TestAccount;
  let manuelId: string;
  let markId: string;
  let ninoId: string;
  let eventId: string;

  const HISTORY_START = new Date('2020-01-05T00:00:00Z');

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    const nino = await createPerson(db, { firstName: 'Nino', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    // Neither holds an account, so the walk continues through both to their disciples.
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, raymond.id);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    manuelId = manuel.id;
    markId = mark.id;
    ninoId = nino.id;

    // The most recent Sunday before today, whose Manila day has begun.
    const today = (
      await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
      `.execute(db)
    ).rows[0].today;
    const [y, m, d] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const sunday = new Date(Date.UTC(y, m - 1, d - (weekday === 0 ? 7 : weekday)))
      .toISOString()
      .slice(0, 10);
    eventId = (
      await db
        .insertInto('dcc_events')
        .values({ event_date: sunday })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** A closed row in force at the event: it ends now, after the Sunday's Manila day. */
  async function closedRowUnder(leaderId: string): Promise<void> {
    await db
      .insertInto('pastoral_assignments')
      .values({
        person_id: ninoId,
        leader_id: leaderId,
        root_network: null,
        started_at: HISTORY_START,
        ended_at: new Date(),
      })
      .execute();
  }

  function roster() {
    return request(app.getHttpServer())
      .get(`/api/v1/dcc/events/${eventId}/roster?limit=200`)
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
  }

  it('lists the person once when one row places them, so the walk reaches them', async () => {
    await closedRowUnder(manuelId);

    const response = await roster().expect(200);

    const ids = (response.body.data as { person_id: string }[]).map((line) => line.person_id);
    expect(ids.filter((id) => id === ninoId)).toHaveLength(1);
  });

  it('refuses the checklist when two overlapping rows place them under two leaders', async () => {
    await closedRowUnder(manuelId);
    await closedRowUnder(markId);

    const response = await roster().expect(409);

    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(response.body.error.message).toMatch(/reaches this person twice/);
    expect(response.body.error.details.person_id).toBe(ninoId);
  });
});
