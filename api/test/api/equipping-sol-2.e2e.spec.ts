import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * SOL 2 joins the school (SKILL.md sections 7 and 29, decisions 0501 and 0516), the first step:
 * its Coordinator, its classes, its registration and its Guides.
 *
 * What is pinned, each from the ruling rather than from the service:
 *
 *   - **a level is carried on the tick**: a SOL 1 Coordinator cannot list or open SOL 2's
 *     classes, and a SOL 2 Coordinator cannot open SOL 1's; the tick needs Full view, in the
 *     database too, and only the Admin gives it;
 *   - SOL 2's requirements: SOL 1 passed and the leadership of an `ACTIVE` Cell now, read from
 *     the records, and the SOL 2 book, each warning rather than refusing, the reason then
 *     required; a Cell closed, `CREATED_IN_ERROR` included, leads nothing;
 *   - **no SOL 2 class opens before step 2** (decision 0516, point 4), the Admin included, a
 *     Coordinator of another level being refused for the level first;
 *   - a SOL 2 Guide has passed SOL 3, one level ahead, and SOL 2 is not enough;
 *   - the Admin's Coordinators list names SOL 2's Coordinators.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 *
 *   Ramon (Men's root) -> Wil, who leads a Cell; Gil, passed SOL 2; Tess, passed SOL 3
 *   Uno: SOL 1 Coordinator; Duo: SOL 2 Coordinator; Ada: an administrator; Eva: a Registrar
 */
describe('SOL 2 in the school (section 29, decision 0516)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let sol1Coordinator: TestAccount;
  let sol2Coordinator: TestAccount;
  let ramon: TestPerson;
  let wil: TestPerson;
  let gil: TestPerson;
  let tess: TestPerson;
  let wilsCell: string;

  const SOL2 = { level: 'SOL_2', term_year: 2027, term_number: 1 };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    // No birthday: SOL has no Encounter, so none is needed to enroll.
    wil = await createPerson(db, { firstName: 'Wil', network: 'MENS', birthDate: null });
    await assignTo(db, wil.id, ramon.id);
    wilsCell = (await createCell(db, { leader: wil, dayOfWeek: 2, timeOfDay: '19:30' })).id;
    gil = await createPerson(db, { firstName: 'Gil', network: 'MENS' });
    await assignTo(db, gil.id, ramon.id);
    tess = await createPerson(db, { firstName: 'Tess', network: 'MENS' });
    await assignTo(db, tess.id, ramon.id);
    const uno = await createPerson(db, { firstName: 'Uno', network: 'MENS' });
    await assignTo(db, uno.id, ramon.id);
    const duo = await createPerson(db, { firstName: 'Duo', network: 'MENS' });
    await assignTo(db, duo.id, ramon.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    sol1Coordinator = await createAccount(app, db, { person: uno, roles: ['LEADER'] });
    sol2Coordinator = await createAccount(app, db, { person: duo, roles: ['LEADER'] });

    await post(admin, `accounts/${sol1Coordinator.id}/coordinates-sol-1`, {
      coordinates_sol_1: true,
    }).expect(200);
    await post(admin, `accounts/${sol2Coordinator.id}/coordinates-sol-2`, {
      coordinates_sol_2: true,
    }).expect(200);

    for (const [person, program] of [
      [gil, 'SOL_2'],
      [tess, 'SOL_3'],
    ] as const) {
      await graduate(person, program);
    }
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const post = (account: TestAccount, path: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const graduate = (person: TestPerson, program: 'SOL_1' | 'SOL_2' | 'SOL_3') =>
    db
      .insertInto('training_graduations')
      .values({
        person_id: person.id,
        program,
        graduated_on: '2025-06-01',
        confirmed_by: ramon.id,
        recorded_by: admin.id,
      })
      .execute();

  const openSol2 = (as: TestAccount, extra: object = {}) =>
    post(as, 'equipping/classes', {
      ...SOL2,
      name: 'SOL 2 A',
      day_of_week: 4,
      time_of_day: '19:00',
      place: 'Room 4',
      first_lesson_on: '2027-01-14',
      ...extra,
    });

  const errorCode = (response: request.Response) =>
    (response.body as { error: { code: string } }).error.code;

  describe('the SOL 2 Coordinator tick', () => {
    it('is the Admin’s, audited, needs Full view, and the database refuses it without', async () => {
      const audit = await db
        .selectFrom('audit_log')
        .select('target_id')
        .where('action', '=', 'account.coordinates_sol_2_changed')
        .execute();
      expect(audit.map((row) => row.target_id)).toEqual([sol2Coordinator.id]);

      await expect(
        sql`UPDATE accounts SET full_view = false, coordinates_sol_1 = false,
              coordinates_sol_2 = true WHERE id = ${sol1Coordinator.id}`.execute(db),
      ).rejects.toThrow(/accounts_coordinates_sol_2_needs_full_view/);

      // Only the Admin gives it.
      await post(sol2Coordinator, `accounts/${sol1Coordinator.id}/coordinates-sol-2`, {
        coordinates_sol_2: true,
      }).expect(403);
    });

    it('is cleared with Full view, as the other ticks are', async () => {
      await post(admin, `accounts/${sol2Coordinator.id}/full-view`, { full_view: false }).expect(
        200,
      );
      const row = await db
        .selectFrom('accounts')
        .select(['full_view', 'coordinates_sol_2'])
        .where('id', '=', sol2Coordinator.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ full_view: false, coordinates_sol_2: false });
    });
  });

  describe('a level is carried on the tick, at the API', () => {
    it('lets the SOL 2 Coordinator list SOL 2 only, and the SOL 1 one not SOL 2', async () => {
      await get(
        sol2Coordinator,
        'equipping/coordinate/classes?level=SOL_2&term_year=2027&term_number=1',
      ).expect(200);
      const levels = await get(sol2Coordinator, 'equipping/coordinate/levels').expect(200);
      expect((levels.body as { data: string[] }).data).toEqual(['SOL_2']);
      const refusedOpen = await post(sol2Coordinator, 'equipping/classes', {
        level: 'SOL_1',
        term_year: 2027,
        term_number: 1,
        name: 'SOL 1 A',
        day_of_week: 3,
        time_of_day: '19:00',
        place: 'Room 3',
        first_lesson_on: '2027-01-13',
      }).expect(403);
      expect(errorCode(refusedOpen)).toBe('SCOPE_DENIED');

      const refused = await get(
        sol1Coordinator,
        'equipping/coordinate/classes?level=SOL_2&term_year=2027&term_number=1',
      ).expect(403);
      expect(errorCode(refused)).toBe('SCOPE_DENIED');
      // The level gate answers first: SOL 1's Coordinator learns nothing about SOL 2's classes.
      expect(errorCode(await openSol2(sol1Coordinator).expect(403))).toBe('SCOPE_DENIED');
    });

    it('lists SOL 2’s Coordinators to the Admin', async () => {
      const read = await get(admin, 'accounts/coordinators').expect(200);
      const levels = (read.body as { data: { level: string; people: { account_id: string }[] }[] })
        .data;
      expect(levels.map((each) => each.level)).toEqual(['LIFE_CLASS', 'SOL_1', 'SOL_2']);
      expect(levels[2].people.map((each) => each.account_id)).toEqual([sol2Coordinator.id]);
    });
  });

  describe('a SOL 2 class', () => {
    it('is not opened before step 2, by its Coordinator or the Admin (decision 0516, point 4)', async () => {
      for (const as of [sol2Coordinator, admin]) {
        const refused = await openSol2(as).expect(409);
        expect(errorCode(refused)).toBe('INVARIANT_VIOLATION');
        expect((refused.body as { error: { message: string } }).error.message).toBe(
          'A SOL 2 class can be opened once DREAMS has SOL 2’s register and final grades.',
        );
      }
      const classes = await db.selectFrom('equipping_classes').select('id').execute();
      expect(classes).toEqual([]);
    });

    it('is refused by the database too, until step 2 widens it', async () => {
      await expect(
        sql`INSERT INTO equipping_classes (level, term_year, term_number, name, day_of_week,
              time_of_day, first_lesson_on, created_by)
            VALUES ('SOL_2', 2027, 1, 'SOL 2 A', 4, '19:00', '2027-01-14', ${admin.id})`.execute(
          db,
        ),
      ).rejects.toThrow(/equipping_classes_level/);
    });

    it('is to be guided by somebody who has passed SOL 3, and SOL 2 is not enough', async () => {
      // The Guide search reads the rule now; naming a Guide waits for a SOL 2 class (step 2).
      const search = await get(sol2Coordinator, 'equipping/guides?q=Tess&level=SOL_2').expect(200);
      expect((search.body as { data: { qualifies: string }[] }).data).toEqual([
        expect.objectContaining({ qualifies: 'Passed SOL 3' }),
      ]);
      const none = await get(sol2Coordinator, 'equipping/guides?q=Gil&level=SOL_2').expect(200);
      expect((none.body as { data: unknown[] }).data).toEqual([]);
    });
  });

  describe('registering for SOL 2', () => {
    const register = (body: object) =>
      post(registrar, 'equipping/registrations', { ...SOL2, person_id: wil.id, ...body });

    const requirements = async () =>
      (
        (await get(registrar, `equipping/people/${wil.id}?level=SOL_2`).expect(200)).body as {
          requirements: unknown[];
        }
      ).requirements;

    it('shows SOL 1 passed and the Cell they lead, each read from the records', async () => {
      expect(await requirements()).toEqual([
        { code: 'SOL_1_PASSED', met: false, detail: 'SOL 1 not passed yet' },
        { code: 'LEADS_A_CELL', met: true, detail: expect.stringMatching(/^Leads CELL-/) },
      ]);
      await graduate(wil, 'SOL_1');
      expect(await requirements()).toEqual([
        { code: 'SOL_1_PASSED', met: true, detail: 'SOL 1 passed' },
        expect.objectContaining({ code: 'LEADS_A_CELL', met: true }),
      ]);
    });

    it.each(['LEADER_STEPPED_DOWN', 'CREATED_IN_ERROR'] as const)(
      'is not met by a Cell closed %s',
      async (reason) => {
        await closeCellDirectly(db, wilsCell, { reason });
        expect(await requirements()).toEqual([
          expect.objectContaining({ code: 'SOL_1_PASSED' }),
          { code: 'LEADS_A_CELL', met: false, detail: 'leads no Cell now' },
        ]);
      },
    );

    it('warns rather than refuses: a requirement not met, the book included, needs a reason', async () => {
      await closeCellDirectly(db, wilsCell, { reason: 'LEADER_STEPPED_DOWN' });
      const refused = await register({ manual_confirmed: false }).expect(422);
      expect(
        (refused.body as { error: { details: { unmet: string[] } } }).error.details.unmet,
      ).toEqual(['SOL_1_PASSED', 'LEADS_A_CELL', 'SOL_2_BOOK']);

      const registered = await register({
        manual_confirmed: false,
        exception_reason: 'Their leader confirms the book is coming.',
      }).expect(201);
      expect(registered.body).toEqual(
        expect.objectContaining({
          status: 'REGISTERED_WITH_EXCEPTION',
          unmet: ['SOL_1_PASSED', 'LEADS_A_CELL', 'SOL_2_BOOK'],
        }),
      );
      const row = await db
        .selectFrom('equipping_registrations')
        .select(['level', 'bible_confirmed', 'manual_confirmed'])
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ level: 'SOL_2', bible_confirmed: false, manual_confirmed: false });
    });

    it('registers with no exception once all three are met, and asks for no Bible', async () => {
      await graduate(wil, 'SOL_1');
      const registered = await register({ manual_confirmed: true }).expect(201);
      expect(registered.body).toEqual(expect.objectContaining({ status: 'REGISTERED', unmet: [] }));
      const counts = await get(
        registrar,
        'equipping/registrations/counts?term_year=2027&term_number=1',
      ).expect(200);
      expect(counts.body).toEqual(expect.objectContaining({ SOL_2: 1 }));
    });

    it('keeps each level’s codes in the database, and a book not ticked named in them', async () => {
      await graduate(wil, 'SOL_1');
      await register({ manual_confirmed: true }).expect(201);
      await expect(
        sql`UPDATE equipping_registrations SET unmet = ARRAY['SOL_1_MANUAL'],
              exception_reason = 'x'`.execute(db),
      ).rejects.toThrow(/equipping_registrations_unmet_known/);
      await expect(
        sql`UPDATE equipping_registrations SET manual_confirmed = false`.execute(db),
      ).rejects.toThrow(/equipping_registrations_sol_2_book_unmet/);
    });
  });
});
