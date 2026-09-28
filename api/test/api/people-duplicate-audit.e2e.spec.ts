import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * A duplicate check that shows somebody outside the searcher's scope is recorded
 * (SKILL.md sections 3 and 21, decision 0304): who looked, the names typed and the
 * people shown, never the birthday or mobile number typed. A check that shows nobody
 * outside the scope writes nothing.
 *
 * Fixture names, dates and numbers are invented (CLAUDE.md, Secrets).
 */
describe('a duplicate check showing somebody outside the branch is recorded (decision 0304)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Men's: Oriel -> Mark -> Pedro, and a sibling branch Oriel -> Manuel -> Juan that
  // Mark does not oversee.
  let markPerson: TestPerson;
  let manuel: TestPerson;
  let pedro: TestPerson;
  let juan: TestPerson;
  let mark: TestAccount;
  let admin: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    markPerson = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    pedro = await createPerson(db, { firstName: 'Pedro', lastName: 'Dizon', network: 'MENS' });
    juan = await createPerson(db, { firstName: 'Juan', lastName: 'Dizon', network: 'MENS' });

    await assignTo(db, oriel.id, null);
    await assignTo(db, markPerson.id, oriel.id);
    await assignTo(db, manuel.id, oriel.id);
    await assignTo(db, pedro.id, markPerson.id);
    await assignTo(db, juan.id, manuel.id);

    mark = await createAccount(app, db, { person: markPerson, roles: ['LEADER'] });
    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const check = (actor: TestAccount, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get('/api/v1/people/duplicate-candidates')
      .query(query)
      .set('Authorization', `Bearer ${actor.accessToken}`);

  const entries = () =>
    db
      .selectFrom('audit_log')
      .select(['actor_id', 'target_type', 'target_id', 'after'])
      .where('action', '=', 'directory.matched')
      .execute();

  it('records who looked, the names typed and who outside the branch was shown', async () => {
    const response = await check(mark, {
      first_name: 'Juan',
      last_name: 'Dizon',
      birth_date: '1990-02-14',
      mobile_number: '09170000000',
    });

    expect(response.status).toBe(200);
    expect((response.body.data as { id: string }[]).map((row) => row.id)).toEqual([juan.id]);

    const written = await entries();
    expect(written).toEqual([
      {
        actor_id: mark.id,
        target_type: 'account',
        target_id: mark.id,
        after: { first_name: 'Juan', last_name: 'Dizon', shown: [juan.id] },
      },
    ]);
    // The birthday and mobile number typed describe the person being added.
    expect(JSON.stringify(written)).not.toContain('1990-02-14');
    expect(JSON.stringify(written)).not.toContain('0917');
  });

  it('writes one entry per check', async () => {
    await check(mark, { first_name: 'Juan', last_name: 'Dizon' }).expect(200);
    await check(mark, { first_name: 'Juan', last_name: 'Dizon' }).expect(200);

    expect(await entries()).toHaveLength(2);
  });

  it('records everybody outside the branch it showed in one entry, and nobody inside it', async () => {
    // A second Juan Dizon outside the branch, and one inside it.
    const juanElsewhere = await createPerson(db, {
      firstName: 'Juan',
      lastName: 'Dizon',
      network: 'MENS',
      birthDate: '1972-11-03',
    });
    await assignTo(db, juanElsewhere.id, manuel.id);
    const juanInside = await createPerson(db, {
      firstName: 'Juan',
      lastName: 'Dizon',
      network: 'MENS',
      birthDate: '2001-04-21',
    });
    await assignTo(db, juanInside.id, markPerson.id);

    const response = await check(mark, { first_name: 'Juan', last_name: 'Dizon' });
    expect((response.body.data as { id: string }[]).map((row) => row.id).sort()).toEqual(
      [juan.id, juanElsewhere.id, juanInside.id].sort(),
    );

    const written = await entries();
    expect(written).toHaveLength(1);
    expect((written[0].after as { shown: string[] }).shown.sort()).toEqual(
      [juan.id, juanElsewhere.id].sort(),
    );
  });

  it('records only the people the page showed', async () => {
    // Somebody inside the branch comes first, so a page of one shows only them.
    const juanInside = await createPerson(db, {
      firstName: 'Juan',
      lastName: 'Dizon',
      network: 'MENS',
      birthDate: '2001-04-21',
    });
    await assignTo(db, juanInside.id, markPerson.id);

    const response = await check(mark, { first_name: 'Juan', last_name: 'Dizon', limit: '1' });
    expect((response.body.data as { id: string }[]).map((row) => row.id)).toEqual([juanInside.id]);
    expect(await entries()).toEqual([]);
  });

  it('writes nothing when the check shows only people inside the branch', async () => {
    const response = await check(mark, { first_name: 'Pedro', last_name: 'Dizon' });

    expect((response.body.data as { id: string }[]).map((row) => row.id)).toEqual([pedro.id]);
    expect(await entries()).toEqual([]);
  });

  it('writes nothing when the check shows nobody', async () => {
    const response = await check(mark, { first_name: 'Nobodyhere', last_name: 'Dizon' });

    expect(response.body.data).toEqual([]);
    expect(await entries()).toEqual([]);
  });

  it('writes nothing for a searcher whose scope is the whole church', async () => {
    const response = await check(admin, { first_name: 'Juan', last_name: 'Dizon' });

    expect((response.body.data as { id: string }[]).map((row) => row.id)).toEqual([juan.id]);
    expect(await entries()).toEqual([]);
  });
});
