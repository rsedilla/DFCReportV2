import { sql } from 'kysely';
import request from 'supertest';

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
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

interface Row {
  account_id: string;
  person_id: string;
  name: string;
  status: string;
  roles: string[];
  paused_until: string | null;
  second_step: { required: boolean; set_up_at: string | null };
}

/**
 * The Admin area's Accounts list and its counts (SKILL.md sections 19 and 22, decision 0419).
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('the Admin area’s accounts list (decision 0419)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let adele: TestPerson;
  let bruno: TestPerson;
  let carla: TestPerson;
  let dario: TestPerson;
  let elisa: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    adele = await createPerson(db, { firstName: 'Adele', lastName: 'Ocampo', network: 'WOMENS' });
    bruno = await createPerson(db, { firstName: 'Bruno', lastName: 'Lacson', network: 'MENS' });
    carla = await createPerson(db, { firstName: 'Carla', lastName: 'Mendez', network: 'WOMENS' });
    dario = await createPerson(db, { firstName: 'Dario', lastName: 'Navarro', network: 'MENS' });
    elisa = await createPerson(db, { firstName: 'Elisa', lastName: 'Pineda', network: 'WOMENS' });
    await assignTo(db, bruno.id, null);
    await assignTo(db, carla.id, null);
    await assignTo(db, dario.id, bruno.id);
    await assignTo(db, elisa.id, carla.id);

    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const get = (reader: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/accounts${path}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);

  async function names(path = ''): Promise<string[]> {
    const response = await get(admin, path).expect(200);
    return (response.body.data as Row[]).map((row) => row.name);
  }

  async function leader(person: TestPerson): Promise<TestAccount> {
    return createAccount(app, db, { person, roles: ['LEADER'] });
  }

  it('lists every account in first-name order', async () => {
    await leader(elisa);
    await leader(dario);
    await leader(bruno);

    expect(await names()).toEqual([
      'Adele Ocampo',
      'Bruno Lacson',
      'Dario Navarro',
      'Elisa Pineda',
    ]);
  });

  it('pages by the cursor it hands back, skipping and repeating nobody', async () => {
    await leader(elisa);
    await leader(dario);
    await leader(bruno);

    const first = await get(admin, '?limit=3').expect(200);
    expect((first.body.data as Row[]).map((row) => row.name)).toEqual([
      'Adele Ocampo',
      'Bruno Lacson',
      'Dario Navarro',
    ]);
    const second = await get(admin, `?limit=3&cursor=${first.body.next_cursor}`).expect(200);
    expect((second.body.data as Row[]).map((row) => row.name)).toEqual(['Elisa Pineda']);
    expect(second.body.next_cursor).toBeNull();
  });

  it('finds an account by name, username or email', async () => {
    const brunoAccount = await leader(bruno);
    await leader(dario);
    await db
      .updateTable('accounts')
      .set({ username: 'darnav' })
      .where('person_id', '=', dario.id)
      .execute();

    expect(await names('?q=lacs')).toEqual(['Bruno Lacson']);
    expect(await names('?q=darnav')).toEqual(['Dario Navarro']);
    expect(await names(`?q=${brunoAccount.email.slice(0, 8)}`)).toEqual(['Bruno Lacson']);
  });

  it('filters by state, and each count matches its filter', async () => {
    await leader(bruno);
    const darioAccount = await leader(dario);
    const elisaAccount = await leader(elisa);
    await db
      .updateTable('accounts')
      .set({ status: 'PENDING_ACTIVATION', password_hash: null })
      .where('id', '=', darioAccount.id)
      .execute();
    await db
      .updateTable('accounts')
      .set({ status: 'DISABLED' })
      .where('id', '=', elisaAccount.id)
      .execute();
    // Bruno's sign-in paused after ten wrong passwords (decision 0413), and an earlier pause
    // that has ended on Elisa's, which counts for nobody.
    const bruno_ = await db
      .selectFrom('accounts')
      .select('email_normalized')
      .where('person_id', '=', bruno.id)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('sign_in_pauses')
      .values([
        {
          identifier: `email:${bruno_.email_normalized}`,
          paused_until: new Date(Date.now() + 60 * 60 * 1000),
        },
        {
          identifier: `email:${elisaAccount.email}`,
          paused_until: new Date(Date.now() - 60 * 1000),
        },
      ])
      .execute();
    // Carla is a second administrator who has not set up her second step.
    await createAccount(app, db, { person: carla, roles: ['ADMIN'], secondStep: false });

    expect(await names('?filter=ACTIVE')).toEqual(['Adele Ocampo', 'Bruno Lacson', 'Carla Mendez']);
    expect(await names('?filter=PENDING_ACTIVATION')).toEqual(['Dario Navarro']);
    expect(await names('?filter=DISABLED')).toEqual(['Elisa Pineda']);
    expect(await names('?filter=PAUSED')).toEqual(['Bruno Lacson']);
    expect(await names('?filter=NO_SECOND_STEP')).toEqual(['Carla Mendez']);

    const counts = await get(admin, '/counts').expect(200);
    expect(counts.body).toEqual({
      all: 5,
      active: 3,
      pending_activation: 1,
      paused: 1,
      no_second_step: 1,
      disabled: 1,
    });

    const row = (await get(admin, '?q=lacson').expect(200)).body.data[0] as Row;
    expect(row.paused_until).not.toBeNull();
    expect(row.roles).toEqual(['LEADER']);
    expect(row.second_step).toEqual({ required: false, set_up_at: null });
  });

  it('leaves an administrator waiting for activation off Second step not set up', async () => {
    // The step is set up on the first sign-in, so only an account in use can be missing it.
    const waiting = await createAccount(app, db, {
      person: carla,
      roles: ['ADMIN'],
      secondStep: false,
    });
    await db
      .updateTable('accounts')
      .set({ status: 'PENDING_ACTIVATION', password_hash: null })
      .where('id', '=', waiting.id)
      .execute();

    expect(await names('?filter=NO_SECOND_STEP')).toEqual([]);
    expect((await get(admin, '/counts').expect(200)).body.no_second_step).toBe(0);
  });

  it('finds a sign-in paused under the username as well as the email address', async () => {
    const account = await leader(bruno);
    await db
      .updateTable('accounts')
      .set({ username: 'brunol' })
      .where('id', '=', account.id)
      .execute();
    await db
      .insertInto('sign_in_pauses')
      .values({
        identifier: 'username:brunol',
        paused_until: new Date(Date.now() + 60 * 60 * 1000),
      })
      .execute();

    expect(await names('?filter=PAUSED')).toEqual(['Bruno Lacson']);
  });

  it('reads a second step that was reset as not set up, and a revoked role as not held', async () => {
    // Carla's second step was reset (decision 0302), so she owes one again.
    const carlaAccount = await createAccount(app, db, { person: carla, roles: ['ADMIN'] });
    await db
      .updateTable('second_steps')
      .set({ revoked_at: new Date() })
      .where('account_id', '=', carlaAccount.id)
      .execute();
    // Dario held ADMIN once and is a Leader now, so he owes no second step.
    const darioAccount = await leader(dario);
    await db
      .insertInto('account_roles')
      .values({
        account_id: darioAccount.id,
        role: 'ADMIN',
        granted_by: admin.id,
      })
      .execute();
    await db
      .updateTable('account_roles')
      .set({ revoked_at: sql`granted_at + interval '1 second'` })
      .where('account_id', '=', darioAccount.id)
      .where('role', '=', 'ADMIN')
      .execute();

    expect(await names('?filter=NO_SECOND_STEP')).toEqual(['Carla Mendez']);
    const rows = (await get(admin, '').expect(200)).body.data as Row[];
    const carlaRow = rows.find((row) => row.name === 'Carla Mendez');
    const darioRow = rows.find((row) => row.name === 'Dario Navarro');
    expect(carlaRow?.second_step).toEqual({ required: true, set_up_at: null });
    expect(darioRow?.roles).toEqual(['LEADER']);
    expect(darioRow?.second_step.required).toBe(false);
  });

  it('pages between two people of one first name by their last name', async () => {
    const other = await createPerson(db, {
      firstName: 'Bruno',
      lastName: 'Abella',
      network: 'MENS',
    });
    await assignTo(db, other.id, bruno.id);
    await leader(other);
    await leader(bruno);

    const first = await get(admin, '?limit=2').expect(200);
    expect((first.body.data as Row[]).map((row) => row.name)).toEqual([
      'Adele Ocampo',
      'Bruno Abella',
    ]);
    const second = await get(admin, `?limit=2&cursor=${first.body.next_cursor}`).expect(200);
    expect((second.body.data as Row[]).map((row) => row.name)).toEqual(['Bruno Lacson']);
  });

  it('refuses an unknown filter', async () => {
    await get(admin, '?filter=EVERYONE').expect(422);
  });

  describe('who may read it', () => {
    it('refuses a Leader', async () => {
      const reader = await leader(bruno);
      await get(reader, '').expect(403);
      await get(reader, '/counts').expect(403);
    });

    it('refuses a Senior Pastor', async () => {
      nameSeniorPastors(app, [bruno.id, carla.id]);
      const pastor = await createAccount(app, db, {
        person: bruno,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });
      await get(pastor, '').expect(403);
      await get(pastor, '/counts').expect(403);
    });

    it('refuses a grant of accounts.manage narrower than Whole Church', async () => {
      const reader = await leader(bruno);
      await db
        .insertInto('capability_grants')
        .values({
          account_id: reader.id,
          capability: 'accounts.manage',
          scope_type: 'OWN_SUBTREE',
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();
      await get(reader, '').expect(403);
      await get(reader, '/counts').expect(403);
    });

    it('refuses a request with no session', async () => {
      await request(app.getHttpServer()).get('/api/v1/accounts').expect(401);
    });
  });
});
