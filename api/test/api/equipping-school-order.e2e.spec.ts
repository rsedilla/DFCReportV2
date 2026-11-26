import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The school's lists are in last-name order, each name shown last name first (SKILL.md
 * section 29, decision 0515), at the API.
 *
 * What is pinned, each from the ruling:
 *
 *   - the Registrar's *Registration* list, paged by the database, runs by last name, then first
 *     name, then Member ID, and its cursor walks it in that order; a cursor it never gave is
 *     refused;
 *   - a class's enrolled students and *Ready to enroll*, and the Coordinator's students of a
 *     class, run in the same order;
 *   - each student carries `list_name`, last name first, the middle name as its initial and a
 *     title before the given name, beside `full_name`, which is unchanged.
 *
 * The four students are named so that first-name order and last-name order differ: by first
 * name they read Abel, Ana, Mila, Zoe; by last name Aquino, Cruz, Reyes, Zamora.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('The school’s lists in last-name order (section 29, decision 0515)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let registrar: TestAccount;
  let coordinator: TestAccount;
  let zoe: TestPerson;
  let mila: TestPerson;
  let ana: TestPerson;
  let abel: TestPerson;

  const SOL = { level: 'SOL_1', term_year: 2027, term_number: 1 };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    const student = async (firstName: string, lastName: string, middleName?: string) => {
      const person = await createPerson(db, { firstName, lastName, middleName, network: 'MENS' });
      await assignTo(db, person.id, ramon.id);
      return person;
    };
    abel = await student('Abel', 'Zamora');
    ana = await student('Ana', 'Reyes');
    mila = await student('Mila', 'Cruz', 'Diaz');
    zoe = await student('Zoe', 'Aquino');
    // A title sits before the given name and is never compared (decision 0271).
    await db.updateTable('persons').set({ title: 'Ptr.' }).where('id', '=', ana.id).execute();

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    const sol = await createPerson(db, { firstName: 'Sol', network: 'MENS' });
    await assignTo(db, sol.id, ramon.id);
    coordinator = await createAccount(app, db, { person: sol, roles: ['LEADER'] });
    const admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ike', network: 'MENS' }),
      roles: ['ADMIN'],
    });
    await request(app.getHttpServer())
      .post(`/api/v1/accounts/${coordinator.id}/coordinates-sol-1`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ coordinates_sol_1: true })
      .expect(200);

    // Registered in an order matching neither: newest first would read Mila, Zoe, Abel, Ana.
    for (const person of [ana, abel, zoe, mila]) {
      await post(registrar, 'equipping/registrations', {
        ...SOL,
        person_id: person.id,
        manual_confirmed: true,
        exception_reason: 'Their leader confirms they finished Life Class before the school.',
      }).expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  function post(account: TestAccount, path: string, body: object) {
    return request(app.getHttpServer())
      .post(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const LAST_NAME_ORDER = () => [zoe.id, mila.id, ana.id, abel.id];

  type Row = { person: { id: string; full_name: string; list_name: string } };

  it('runs Registration by last name, a page at a time, each name last name first', async () => {
    const query = `level=SOL_1&term_year=2027&term_number=1`;
    const whole = (await get(registrar, `equipping/registrations?${query}`).expect(200)).body as {
      data: Row[];
    };
    expect(whole.data.map((row) => row.person.id)).toEqual(LAST_NAME_ORDER());
    expect(whole.data.map((row) => row.person.list_name)).toEqual([
      'Aquino, Zoe',
      'Cruz, Mila D.',
      'Reyes, Ptr. Ana',
      'Zamora, Abel',
    ]);
    // `full_name` reads as it does everywhere else.
    expect(whole.data.map((row) => row.person.full_name)).toEqual([
      'Zoe Aquino',
      'Mila D. Cruz',
      'Ptr. Ana Reyes',
      'Abel Zamora',
    ]);

    // One at a time, the cursor carries the key, so the pages walk the same order.
    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (
        await get(
          registrar,
          `equipping/registrations?${query}&limit=1${cursor === null ? '' : `&cursor=${cursor}`}`,
        ).expect(200)
      ).body as { data: Row[]; next_cursor: string | null };
      walked.push(...page.data.map((row) => row.person.id));
      cursor = page.next_cursor;
    } while (cursor !== null);
    expect(walked).toEqual(LAST_NAME_ORDER());
  });

  it('refuses a cursor the list never gave, the newest-first shape included', async () => {
    const old = Buffer.from(JSON.stringify([new Date().toISOString(), randomUUID()])).toString(
      'base64url',
    );
    const refused = await get(
      registrar,
      `equipping/registrations?level=SOL_1&term_year=2027&term_number=1&cursor=${old}`,
    ).expect(422);
    expect((refused.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('runs a class’s students, Ready to enroll and the Coordinator’s list by last name', async () => {
    const opened = (
      await post(coordinator, 'equipping/classes', {
        ...SOL,
        name: 'SOL 1 A',
        day_of_week: 3,
        time_of_day: '19:00',
        place: 'Room 3',
        first_lesson_on: '2027-01-13',
      }).expect(201)
    ).body as { id: string };

    const ready = (await get(registrar, `equipping/classes/${opened.id}`).expect(200)).body as {
      ready: (Row & { registration_id: string })[];
    };
    expect(ready.ready.map((row) => row.person.id)).toEqual(LAST_NAME_ORDER());
    expect(ready.ready[1].person.list_name).toBe('Cruz, Mila D.');

    // Enrolled in an order matching neither.
    await post(registrar, `equipping/classes/${opened.id}/enrollments`, {
      registration_ids: [ready.ready[2], ready.ready[0], ready.ready[3], ready.ready[1]].map(
        (row) => row.registration_id,
      ),
    }).expect(201);

    const after = (await get(registrar, `equipping/classes/${opened.id}`).expect(200)).body as {
      enrolled: Row[];
    };
    expect(after.enrolled.map((row) => row.person.id)).toEqual(LAST_NAME_ORDER());

    const students = (
      await get(coordinator, `equipping/coordinate/classes/${opened.id}/students`).expect(200)
    ).body as { data: Row[] };
    expect(students.data.map((row) => row.person.id)).toEqual(LAST_NAME_ORDER());
    expect(students.data.map((row) => row.person.list_name)).toEqual([
      'Aquino, Zoe',
      'Cruz, Mila D.',
      'Reyes, Ptr. Ana',
      'Zamora, Abel',
    ]);
  });
});
