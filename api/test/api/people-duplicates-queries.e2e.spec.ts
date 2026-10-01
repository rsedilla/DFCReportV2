import request from 'supertest';
import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/people/duplicate-candidates` costs the same number of database queries
 * however many candidates match (checklist row perf-duplicate-check).
 *
 * Add a Person calls it as a name is typed. It read the population twice, once for the
 * full match and once for the match a viewer outside scope may be told (section 3), and
 * then checked each candidate's scope one at a time.
 *
 * Counted on `pg`'s `Client.prototype.query`, which every pooled query passes through.
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('duplicate check queries do not grow with the candidates (perf-duplicate-check)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let raymond: TestPerson;
  let rico: TestPerson;
  let raymondAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    // Men's: Oriel -> Raymond, and a sibling branch Oriel -> Rico Raymond does not oversee.
    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, rico.id, oriel.id);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** `count` people named Juan Dupfixture, alternately in and out of Raymond's scope. */
  async function seedCandidates(count: number): Promise<{ mine: string[]; theirs: string[] }> {
    const mine: string[] = [];
    const theirs: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const person = await createPerson(db, {
        firstName: 'Juan',
        middleName: `M${String(i).padStart(2, '0')}`,
        lastName: 'Dupfixture',
        network: 'MENS',
      });
      const ours = i % 2 === 0;
      await assignTo(db, person.id, ours ? raymond.id : rico.id);
      (ours ? mine : theirs).push(person.id);
    }
    return { mine, theirs };
  }

  async function counted(): Promise<{ queries: number; rows: Record<string, unknown>[] }> {
    const spy = jest.spyOn(Client.prototype, 'query');
    const response = await request(app.getHttpServer())
      .get('/api/v1/people/duplicate-candidates')
      .query({ first_name: 'Juan', last_name: 'Dupfixture', sex: 'MALE' })
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
    const queries = spy.mock.calls.length;
    spy.mockRestore();

    expect(response.status).toBe(200);
    return { queries, rows: response.body.data as Record<string, unknown>[] };
  }

  it('a check matching ten candidates costs what one matching two does', async () => {
    await seedCandidates(2);
    const few = await counted();
    expect(few.rows).toHaveLength(2);

    await truncateAll(db);
    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, rico.id, oriel.id);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    await seedCandidates(10);
    const many = await counted();
    expect(many.rows).toHaveLength(10);

    expect(many.queries).toBe(few.queries);
  });

  it('never shows an out-of-scope candidate the names alone did not reach', async () => {
    // Reached only by the birthday: the surname's leading hyphen keeps the SQL's
    // surname-initial branch from matching, and "Mary-Ann" is not "Mary Ann" there. The
    // matcher's comparison key ignores both, so scored on names alone this person would
    // match. Section 3 shows an out-of-scope candidate only if the names reach them.
    const hidden = await createPerson(db, {
      firstName: 'Mary-Ann',
      lastName: '-Dupfixture',
      network: 'MENS',
      birthDate: '1990-03-14',
    });
    await assignTo(db, hidden.id, rico.id);

    const response = await request(app.getHttpServer())
      .get('/api/v1/people/duplicate-candidates')
      .query({ first_name: 'Mary Ann', last_name: 'Dupfixture', birth_date: '1990-03-14' })
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);

    expect(response.status).toBe(200);
    expect((response.body.data as { id: string }[]).map((row) => row.id)).not.toContain(hidden.id);
  });

  it('still tells each candidate apart by scope, in scope first', async () => {
    const { mine, theirs } = await seedCandidates(6);
    const { rows } = await counted();

    // In scope first, then withheld ones in name order (section 3), which the middle
    // names make the order they were created in. Within one tier the in-scope order is
    // not fixed (CLAUDE.md, Open), so those are compared as a set.
    const ids = rows.map((row) => row.id as string);
    expect(ids.slice(0, mine.length).sort()).toEqual([...mine].sort());
    expect(ids.slice(mine.length)).toEqual(theirs);
    for (const row of rows.slice(0, mine.length)) {
      expect(row).toMatchObject({ tier: expect.any(Number), reasons: expect.any(Array) });
      expect(row).not.toHaveProperty('possible_match');
    }
    for (const row of rows.slice(mine.length)) {
      expect(row).toMatchObject({ possible_match: true });
      expect(row).not.toHaveProperty('tier');
      expect(row).not.toHaveProperty('reasons');
    }
  });
});
