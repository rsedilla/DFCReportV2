import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { Client } from 'pg';

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
 * `GET /api/v1/cells/people/membership` — a page of people's Cells at once (checklist row
 * perf-people-list-cells), under decision 0248's rule: `cell.view_subtree` against each
 * person.
 *
 * The People list asked `GET /cells/people/{id}/membership` once per row. This answers
 * the page in one request, and each person's entry must be exactly what that route
 * answers for them; a person outside the reader's scope, or an identifier naming nobody,
 * is left out.
 *
 * Counted on `pg`'s `Client.prototype.query`. Fixture names are invented (CLAUDE.md,
 * Secrets).
 */
describe('a page of people’s Cells at once (perf-people-list-cells)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let raymondAccount: TestAccount;
  let ours: TestCell;
  let disciples: TestPerson[];
  let outsider: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    // Men's: Oriel -> Raymond -> ten disciples, and Oriel -> Rico -> one Raymond does not
    // oversee. Raymond leads one Cell, and every other disciple belongs to it.
    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, rico.id, oriel.id);

    ours = await createCell(db, { leader: raymond, category: 'YOUNG_PRO', dayOfWeek: 6 });
    const theirs = await createCell(db, { leader: rico, category: 'COUPLE', dayOfWeek: 3 });

    disciples = [];
    for (let i = 0; i < 10; i += 1) {
      const person = await createPerson(db, { firstName: `Disciple${i}`, network: 'MENS' });
      await assignTo(db, person.id, raymond.id);
      if (i % 2 === 0) {
        await join(person, ours);
      }
      disciples.push(person);
    }

    outsider = await createPerson(db, { firstName: 'Outsider', network: 'MENS' });
    await assignTo(db, outsider.id, rico.id);
    await join(outsider, theirs);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function join(person: TestPerson, cell: TestCell): Promise<void> {
    await db
      .insertInto('cell_memberships')
      .values({ person_id: person.id, cell_id: cell.id, started_at: new Date() })
      .execute();
  }

  function batch(ids: string[], account: TestAccount = raymondAccount): request.Test {
    const query = ids.map((id) => `person_id=${id}`).join('&');
    return request(app.getHttpServer())
      .get(`/api/v1/cells/people/membership?${query}`)
      .set('Authorization', `Bearer ${account.accessToken}`);
  }

  function single(id: string, account: TestAccount = raymondAccount): request.Test {
    return request(app.getHttpServer())
      .get(`/api/v1/cells/people/${id}/membership`)
      .set('Authorization', `Bearer ${account.accessToken}`);
  }

  async function queriesOf(send: () => Promise<unknown>): Promise<number> {
    const spy = jest.spyOn(Client.prototype, 'query');
    await send();
    const count = spy.mock.calls.length;
    spy.mockRestore();
    return count;
  }

  it('answers each person exactly as the single route does', async () => {
    const ids = [raymond.id, ...disciples.map((person) => person.id)];

    const response = await batch(ids);

    expect(response.status).toBe(200);
    const byPerson = new Map(
      (response.body.data as { person_id: string }[]).map((entry) => [entry.person_id, entry]),
    );
    expect([...byPerson.keys()].sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(byPerson.get(id)).toEqual((await single(id).expect(200)).body);
    }
    // The leader's own entry carries the Cell they lead, and a member's names its leader.
    expect(byPerson.get(raymond.id)).toMatchObject({
      membership: null,
      leads: [{ id: ours.id, category: 'YOUNG_PRO', day_of_week: 6 }],
    });
    expect(byPerson.get(disciples[0].id)).toMatchObject({
      membership: { id: ours.id, leader: { person_id: raymond.id } },
      leads: [],
    });
    expect(byPerson.get(disciples[1].id)).toMatchObject({ membership: null, leads: [] });
  });

  it('leaves out a person outside the reader’s scope, and an identifier naming nobody', async () => {
    // The single route refuses the outsider; the batch answers nothing about them.
    expect((await single(outsider.id)).status).toBe(403);

    const response = await batch([disciples[0].id, outsider.id, randomUUID()]);

    expect(response.status).toBe(200);
    expect((response.body.data as { person_id: string }[]).map((entry) => entry.person_id)).toEqual(
      [disciples[0].id],
    );
  });

  it('answers an administrator for anyone in the church', async () => {
    const admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    const response = await batch([outsider.id, randomUUID()], admin);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([(await single(outsider.id, admin).expect(200)).body]);
  });

  it('refuses no identifiers, more than fifty, and one that is not an identifier', async () => {
    const none = await request(app.getHttpServer())
      .get('/api/v1/cells/people/membership')
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
    expect(none.status).toBe(422);

    const tooMany = await batch(Array.from({ length: 51 }, () => randomUUID()));
    expect(tooMany.status).toBe(422);

    const malformed = await batch([disciples[0].id, 'not-an-identifier']);
    expect(malformed.status).toBe(422);
  });

  it('costs the same for two people as for ten', async () => {
    // Unmeasured: builds the in-memory tree (decision 0321), so both counts below start warm.
    await batch(disciples.slice(0, 2).map((person) => person.id)).expect(200);
    const two = await queriesOf(() =>
      batch(disciples.slice(0, 2).map((person) => person.id)).expect(200),
    );
    const ten = await queriesOf(() => batch(disciples.map((person) => person.id)).expect(200));

    expect(ten).toBe(two);
  });
});
