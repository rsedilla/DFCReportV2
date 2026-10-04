import request from 'supertest';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * Both My 12 answers carry the DCC calendar's first Sunday (decision 0310), which a leader's
 * screen floors their Quarterly and Year at. Additive (section 22): `null` until the calendar
 * has one, then the setting's date, on both tabs and for every reader the route admits.
 *
 * The answers carry it and refuse nothing by it: decision 0310 is the screens' rule, and the
 * routes still answer any period that has begun (decision 0216). Names are invented
 * (CLAUDE.md, Secrets).
 */
describe('My 12 answers carry the DCC calendar start (decision 0310)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let admin: TestAccount;
  let leader: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    await assignTo(db, manuel.id, raymond.id);
    const adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });
    leader = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const twelve = (tab: 'cells' | 'dcc', account: TestAccount, scope: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/reports/${tab}/twelve?kind=QUARTER&start=2020-04-01&period=2020-06-01&${scope}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const readers = () =>
    [
      ['the whole church', admin, 'scope=WHOLE_CHURCH'],
      ['a leader', leader, `scope=LEADER&leader_id=${manuel.id}`],
    ] as const;

  it.each(['cells', 'dcc'] as const)(
    '%s: null while the calendar has no first Sunday',
    async (tab) => {
      for (const [name, account, scope] of readers()) {
        const response = await twelve(tab, account, scope);
        expect({ name, status: response.status }).toEqual({ name, status: 200 });
        expect(response.body).toHaveProperty('calendar_start', null);
      }
    },
  );

  it.each(['cells', 'dcc'] as const)(
    '%s: the first Sunday once set, and the period is still answered',
    async (tab) => {
      await db
        .updateTable('settings')
        .set({ value: sql`to_jsonb('2020-09-06'::text)` })
        .where('key', '=', 'dcc_calendar_start')
        .execute();

      for (const [name, account, scope] of readers()) {
        const response = await twelve(tab, account, scope);
        // A quarter that ended before the calendar began is still answered: the floor is
        // the screen's, never the route's (decision 0310, clause 5).
        expect({ name, status: response.status }).toEqual({ name, status: 200 });
        expect(response.body.calendar_start).toBe('2020-09-06');
      }
    },
  );
});
