import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

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
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * SOL 1 joins the school (SKILL.md sections 7 and 29, decisions 0501 and 0514), the first step:
 * its Coordinator, its classes, its registration and its enrollment.
 *
 * What is pinned, each from the ruling rather than from the service:
 *
 *   - **a level is carried on the tick**: a Life Class Coordinator cannot list or open SOL 1's
 *     classes, nor act on one, and a SOL 1 Coordinator the same the other way; one person may
 *     hold both ticks, and a level may have several Coordinators, each named to the others;
 *   - a SOL 1 class names no Encounter weekend, which the database holds too;
 *   - SOL 1's requirements: Life Class passed, Win 3 as Conquest derives it or three direct
 *     disciples now, and the manual, each warning rather than refusing, the reason then required;
 *   - SOL has no Encounter, so a birthday not recorded stops nobody enrolling;
 *   - a SOL 1 Guide has passed SOL 2, one level ahead, and SOL 1 is not enough;
 *   - the Admin's Coordinators list names each level's Coordinators, and is the Admin's alone.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 *
 *   Ramon (Men's root) -> Mario, who leads a Cell; Wil, with disciples Dan and Den (Don is
 *   added by the tests that need a third)
 *   Lito: Life Class Coordinator; Sol: SOL 1 Coordinator; Bea: both; Ada: an administrator
 *   Eva: a Registrar; Gil: passed SOL 2; Pia: passed SOL 1 only
 */
describe('SOL 1 in the school (section 29, decision 0514)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let lifeClassCoordinator: TestAccount;
  let solCoordinator: TestAccount;
  let bothCoordinator: TestAccount;
  let ramon: TestPerson;
  let wil: TestPerson;
  let disciples: TestPerson[];
  let gil: TestPerson;
  let pia: TestPerson;
  let seasonId: string;

  const SOL = { level: 'SOL_1', term_year: 2027, term_number: 1 };
  const LIFE = { level: 'LIFE_CLASS', term_year: 2027, term_number: 1 };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    const mario = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mario.id, ramon.id);
    await createCell(db, { leader: mario, dayOfWeek: 2, timeOfDay: '19:30' });
    // No birthday: SOL has no Encounter, so none is needed to enroll.
    wil = await createPerson(db, { firstName: 'Wil', network: 'MENS', birthDate: null });
    await assignTo(db, wil.id, ramon.id);
    disciples = [];
    for (const name of ['Dan', 'Den']) {
      const disciple = await createPerson(db, { firstName: name, network: 'MENS' });
      await assignTo(db, disciple.id, wil.id);
      disciples.push(disciple);
    }
    gil = await createPerson(db, { firstName: 'Gil', network: 'MENS' });
    await assignTo(db, gil.id, ramon.id);
    pia = await createPerson(db, { firstName: 'Pia', network: 'MENS' });
    await assignTo(db, pia.id, ramon.id);
    const lito = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
    await assignTo(db, lito.id, ramon.id);
    const sol = await createPerson(db, { firstName: 'Sol', network: 'MENS' });
    await assignTo(db, sol.id, ramon.id);
    const bea = await createPerson(db, { firstName: 'Bea', network: 'MENS' });
    await assignTo(db, bea.id, ramon.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    lifeClassCoordinator = await createAccount(app, db, { person: lito, roles: ['LEADER'] });
    solCoordinator = await createAccount(app, db, { person: sol, roles: ['LEADER'] });
    bothCoordinator = await createAccount(app, db, { person: bea, roles: ['LEADER'] });

    await tick(lifeClassCoordinator, 'coordinates-life-class', true).expect(200);
    await tick(solCoordinator, 'coordinates-sol-1', true).expect(200);
    await tick(bothCoordinator, 'coordinates-life-class', true).expect(200);
    await tick(bothCoordinator, 'coordinates-sol-1', true).expect(200);

    for (const [person, program] of [
      [gil, 'SOL_2'],
      [pia, 'SOL_1'],
    ] as const) {
      await db
        .insertInto('training_graduations')
        .values({
          person_id: person.id,
          program,
          graduated_on: '2025-06-01',
          confirmed_by: ramon.id,
          recorded_by: admin.id,
        })
        .execute();
    }

    seasonId = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: '2027-01-30',
          mens_encounter_on: '2027-03-06',
          womens_lc_party_on: '2027-02-06',
          womens_encounter_on: '2027-03-13',
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
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

  function tick(account: TestAccount, route: string, value: boolean) {
    const field = route === 'coordinates-sol-1' ? 'coordinates_sol_1' : 'coordinates_life_class';
    return post(admin, `accounts/${account.id}/${route}`, { [field]: value });
  }

  const openSol = (as: TestAccount, extra: object = {}) =>
    post(as, 'equipping/classes', {
      ...SOL,
      name: 'SOL 1 A',
      day_of_week: 3,
      time_of_day: '19:00',
      place: 'Room 3',
      first_lesson_on: '2027-01-13',
      ...extra,
    });

  const openLife = (as: TestAccount) =>
    post(as, 'equipping/classes', {
      ...LIFE,
      name: 'Life Class A',
      day_of_week: 2,
      time_of_day: '19:00',
      place: 'Room 2',
      first_lesson_on: '2027-01-12',
      encounter_season_id: seasonId,
    });

  const errorCode = (response: request.Response) =>
    (response.body as { error: { code: string } }).error.code;

  /** Wil gains a third direct disciple, Don, with no SUYNL lesson. */
  const giveThirdDisciple = async () => {
    const don = await createPerson(db, { firstName: 'Don', network: 'MENS' });
    await assignTo(db, don.id, wil.id);
    disciples.push(don);
  };

  /** Wil reaches Win 3: each of his three disciples has three SUYNL lessons, filed at `filedAt`. */
  const giveWinThree = async (filedAt?: Date) => {
    if (disciples.length < 3) {
      await giveThirdDisciple();
    }
    for (const disciple of disciples) {
      for (const lesson of [1, 2, 3]) {
        await db
          .insertInto('suynl_lessons')
          .values({
            person_id: disciple.id,
            lesson,
            confirmed_by: wil.id,
            recorded_by: admin.id,
            ...(filedAt === undefined ? {} : { confirmed_at: filedAt }),
          })
          .execute();
      }
    }
  };

  const giveLifeClass = (person: TestPerson) =>
    db
      .insertInto('training_graduations')
      .values({
        person_id: person.id,
        program: 'LIFE_CLASS',
        graduated_on: '2026-06-01',
        confirmed_by: ramon.id,
        recorded_by: admin.id,
      })
      .execute();

  describe('the SOL 1 Coordinator tick', () => {
    it('is the Admin’s, audited, needs Full view, and the database refuses it without', async () => {
      const audit = await db
        .selectFrom('audit_log')
        .select('target_id')
        .where('action', '=', 'account.coordinates_sol_1_changed')
        .execute();
      expect(audit.map((row) => row.target_id).sort()).toEqual(
        [solCoordinator.id, bothCoordinator.id].sort(),
      );

      await db
        .updateTable('accounts')
        .set({ full_view: false })
        .where('id', '=', lifeClassCoordinator.id)
        .execute()
        .catch(() => undefined);
      await expect(
        sql`UPDATE accounts SET full_view = false, coordinates_life_class = false,
              coordinates_sol_1 = true WHERE id = ${lifeClassCoordinator.id}`.execute(db),
      ).rejects.toThrow(/accounts_coordinates_sol_1_needs_full_view/);

      // Only the Admin gives it.
      await post(solCoordinator, `accounts/${lifeClassCoordinator.id}/coordinates-sol-1`, {
        coordinates_sol_1: true,
      }).expect(403);
    });
  });

  describe('a level is carried on the tick, at the API', () => {
    it('lets each Coordinator list and open their own level only, and one holding both, both', async () => {
      await get(
        lifeClassCoordinator,
        'equipping/coordinate/classes?level=LIFE_CLASS&term_year=2027&term_number=1',
      ).expect(200);
      const refused = await get(
        lifeClassCoordinator,
        'equipping/coordinate/classes?level=SOL_1&term_year=2027&term_number=1',
      ).expect(403);
      expect(errorCode(refused)).toBe('SCOPE_DENIED');
      expect(errorCode(await openSol(lifeClassCoordinator).expect(403))).toBe('SCOPE_DENIED');

      await get(
        solCoordinator,
        'equipping/coordinate/classes?level=SOL_1&term_year=2027&term_number=1',
      ).expect(200);
      expect(errorCode(await openLife(solCoordinator).expect(403))).toBe('SCOPE_DENIED');

      await openSol(bothCoordinator).expect(201);
      await openLife(bothCoordinator).expect(201);
      // The Admin keeps every Coordinator step at every level (decision 0501, point 2).
      await openSol(admin, { name: 'SOL 1 B' }).expect(201);
    });

    it('answers a class of another level as no such class, on every route that names one', async () => {
      const id = ((await openSol(solCoordinator).expect(201)).body as { id: string }).id;
      const reads = [
        `equipping/coordinate/classes/${id}/students`,
        `equipping/coordinate/classes/${id}/clash?person_id=${wil.id}`,
      ];
      for (const path of reads) {
        expect(errorCode(await get(lifeClassCoordinator, path).expect(404))).toBe('NOT_FOUND');
        await get(solCoordinator, path).expect(200);
      }
      const writes: [string, object][] = [
        [`equipping/classes/${id}/teacher`, { teacher_person_id: wil.id }],
        [`equipping/classes/${id}/guides`, { person_id: gil.id }],
        [`equipping/classes/${id}/cancel`, { reason: 'Not needed' }],
        [
          `equipping/classes/${id}/correction`,
          { day_of_week: 4, time_of_day: '19:00', first_lesson_on: '2027-01-14' },
        ],
      ];
      for (const [path, body] of writes) {
        expect(errorCode(await post(lifeClassCoordinator, path, body).expect(404))).toBe(
          'NOT_FOUND',
        );
      }
    });

    it('names a level’s other Coordinators to each, and never the reader', async () => {
      const read = await get(
        solCoordinator,
        'equipping/coordinate/classes?level=SOL_1&term_year=2027&term_number=1',
      ).expect(200);
      expect((read.body as { other_coordinators: string[] }).other_coordinators).toEqual([
        expect.stringContaining('Bea'),
      ]);
    });

    it('lists each level’s Coordinators to the Admin, and to nobody else', async () => {
      const read = await get(admin, 'accounts/coordinators').expect(200);
      const levels = (read.body as { data: { level: string; people: { account_id: string }[] }[] })
        .data;
      expect(levels.map((each) => each.level)).toEqual(['LIFE_CLASS', 'SOL_1', 'SOL_2']);
      expect(levels[0].people.map((each) => each.account_id).sort()).toEqual(
        [lifeClassCoordinator.id, bothCoordinator.id].sort(),
      );
      expect(levels[1].people.map((each) => each.account_id).sort()).toEqual(
        [solCoordinator.id, bothCoordinator.id].sort(),
      );
      await get(solCoordinator, 'accounts/coordinators').expect(403);
      await get(registrar, 'accounts/coordinators').expect(403);
    });
  });

  describe('a SOL 1 class', () => {
    it('names no Encounter weekend, and the database holds it', async () => {
      const refused = await openSol(solCoordinator, { encounter_season_id: seasonId }).expect(422);
      expect(errorCode(refused)).toBe('VALIDATION_FAILED');
      const opened = await openSol(solCoordinator).expect(201);
      expect((opened.body as { encounter_season_id: unknown }).encounter_season_id).toBeNull();

      await expect(
        sql`UPDATE equipping_classes SET encounter_season_id = ${seasonId}
            WHERE level = 'SOL_1'`.execute(db),
      ).rejects.toThrow(/equipping_classes_encounter_by_level/);
    });

    it('is guided by somebody who has passed SOL 2, and SOL 1 is not enough', async () => {
      const id = ((await openSol(solCoordinator).expect(201)).body as { id: string }).id;
      await post(solCoordinator, `equipping/classes/${id}/guides`, { person_id: gil.id }).expect(
        201,
      );
      const refused = await post(solCoordinator, `equipping/classes/${id}/guides`, {
        person_id: pia.id,
      }).expect(409);
      expect(errorCode(refused)).toBe('INVARIANT_VIOLATION');
      expect((refused.body as { error: { message: string } }).error.message).toContain(
        'A SOL 1 Guide has passed SOL 2',
      );

      const search = await get(solCoordinator, 'equipping/guides?q=Gil&level=SOL_1').expect(200);
      expect((search.body as { data: { qualifies: string }[] }).data).toEqual([
        expect.objectContaining({ qualifies: 'Passed SOL 2' }),
      ]);
      const none = await get(solCoordinator, 'equipping/guides?q=Pia&level=SOL_1').expect(200);
      expect((none.body as { data: unknown[] }).data).toEqual([]);
    });
  });

  describe('registering for SOL 1', () => {
    const register = (body: object) =>
      post(registrar, 'equipping/registrations', { ...SOL, person_id: wil.id, ...body });

    const requirements = async () =>
      (
        (await get(registrar, `equipping/people/${wil.id}?level=SOL_1`).expect(200)).body as {
          requirements: unknown[];
        }
      ).requirements;

    it('shows Life Class passed and Win 3, each read from the records', async () => {
      // Two disciples and no lessons: neither way is met, and neither count is shown (owner
      // rulings of 2026-11-25, decision 0514 point 5).
      expect(await requirements()).toEqual([
        { code: 'LIFE_CLASS_PASSED', met: false, detail: 'Life Class not passed yet' },
        {
          code: 'WIN_3',
          met: false,
          detail: 'needs Win 3, or 3 disciples under them in DREAMS',
        },
      ]);

      await giveLifeClass(wil);
      await giveWinThree();
      expect(await requirements()).toEqual([
        expect.objectContaining({ code: 'LIFE_CLASS_PASSED', met: true }),
        { code: 'WIN_3', met: true, detail: 'Win 3 reached' },
      ]);
    });

    it('meets Win 3 by three direct disciples now, with no SUYNL lesson recorded', async () => {
      await giveThirdDisciple();
      expect(await requirements()).toEqual([
        expect.objectContaining({ code: 'LIFE_CLASS_PASSED' }),
        { code: 'WIN_3', met: true, detail: '3 disciples under them in DREAMS' },
      ]);
      await giveLifeClass(wil);
      const registered = await register({ manual_confirmed: true }).expect(201);
      expect(registered.body).toEqual(expect.objectContaining({ status: 'REGISTERED', unmet: [] }));
    });

    it('meets it by Win 3 reached, after a disciple has left', async () => {
      // Filed a day before the disciple leaves, so Win 3 is reached first whatever the clock.
      await giveWinThree(new Date(Date.now() - 24 * 60 * 60 * 1000));
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: sql`now()` })
        .where('person_id', '=', disciples[2].id)
        .where('ended_at', 'is', null)
        .execute();
      // A disciple who leaves still counts toward a Win 3 already reached (section 27).
      expect(await requirements()).toEqual([
        expect.objectContaining({ code: 'LIFE_CLASS_PASSED' }),
        { code: 'WIN_3', met: true, detail: 'Win 3 reached' },
      ]);
    });

    it('counts only disciples under them now: an ended assignment is not one', async () => {
      await giveThirdDisciple();
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: new Date() })
        .where('person_id', '=', disciples[2].id)
        .where('ended_at', 'is', null)
        .execute();
      expect(await requirements()).toEqual([
        expect.objectContaining({ code: 'LIFE_CLASS_PASSED' }),
        expect.objectContaining({ code: 'WIN_3', met: false }),
      ]);
    });

    it('warns rather than refuses: a requirement not met, the manual included, needs a reason', async () => {
      const refused = await register({ manual_confirmed: false }).expect(422);
      expect(
        (refused.body as { error: { details: { unmet: string[] } } }).error.details.unmet,
      ).toEqual(['LIFE_CLASS_PASSED', 'WIN_3', 'SOL_1_MANUAL']);

      const registered = await register({
        manual_confirmed: false,
        exception_reason: 'Their leader confirms the book is coming.',
      }).expect(201);
      expect(registered.body).toEqual(
        expect.objectContaining({
          status: 'REGISTERED_WITH_EXCEPTION',
          unmet: ['LIFE_CLASS_PASSED', 'WIN_3', 'SOL_1_MANUAL'],
        }),
      );
      const row = await db
        .selectFrom('equipping_registrations')
        .select(['bible_confirmed', 'manual_confirmed'])
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ bible_confirmed: false, manual_confirmed: false });
    });

    it('registers with no exception once all three are met, and asks for no Bible', async () => {
      await giveLifeClass(wil);
      await giveWinThree();
      const registered = await register({ manual_confirmed: true }).expect(201);
      expect(registered.body).toEqual(expect.objectContaining({ status: 'REGISTERED', unmet: [] }));
    });

    it('keeps each level’s codes in the database, and a manual not ticked named in them', async () => {
      await giveLifeClass(wil);
      await giveWinThree();
      await register({ manual_confirmed: true }).expect(201);
      await expect(
        sql`UPDATE equipping_registrations SET unmet = ARRAY['HAS_LEADER'],
              exception_reason = 'x'`.execute(db),
      ).rejects.toThrow(/equipping_registrations_unmet_known/);
      await expect(
        sql`UPDATE equipping_registrations SET manual_confirmed = false`.execute(db),
      ).rejects.toThrow(/equipping_registrations_sol_1_manual_unmet/);
    });
  });

  describe('enrolling in SOL 1', () => {
    it('needs no birthday, SOL having no Encounter', async () => {
      await giveLifeClass(wil);
      await giveWinThree();
      const registration = (
        await post(registrar, 'equipping/registrations', {
          ...SOL,
          person_id: wil.id,
          manual_confirmed: true,
        }).expect(201)
      ).body as { id: string };
      const id = ((await openSol(solCoordinator).expect(201)).body as { id: string }).id;
      const birthday = await db
        .selectFrom('persons')
        .select('birth_date')
        .where('id', '=', wil.id)
        .executeTakeFirstOrThrow();
      expect(birthday.birth_date).toBeNull();

      await post(registrar, `equipping/classes/${id}/enrollments`, {
        registration_ids: [registration.id],
      }).expect(201);
    });
  });

  /** Wil registered and enrolled in a SOL 1 class, Gil its Guide: the ids the routes name. */
  const solClassWithStudent = async () => {
    await giveLifeClass(wil);
    await giveWinThree();
    const registration = (
      await post(registrar, 'equipping/registrations', {
        ...SOL,
        person_id: wil.id,
        manual_confirmed: true,
      }).expect(201)
    ).body as { id: string };
    const classId = ((await openSol(solCoordinator).expect(201)).body as { id: string }).id;
    await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration.id],
    }).expect(201);
    await post(solCoordinator, `equipping/classes/${classId}/guides`, { person_id: gil.id }).expect(
      201,
    );
    const guide = await db
      .selectFrom('equipping_class_guides')
      .select('id')
      .where('class_id', '=', classId)
      .executeTakeFirstOrThrow();
    const enrollment = await db
      .selectFrom('equipping_enrollments')
      .select('id')
      .where('class_id', '=', classId)
      .executeTakeFirstOrThrow();
    return { classId, guideId: guide.id, enrollmentId: enrollment.id };
  };

  describe('the rest of the level gate (review of 2026-11-24)', () => {
    it('refuses another level’s Guide removal, check and swap, and its Guide search', async () => {
      const { classId, guideId, enrollmentId } = await solClassWithStudent();
      const as = lifeClassCoordinator;
      expect(
        errorCode(
          await post(as, `equipping/classes/${classId}/guides/${guideId}/remove`, {}).expect(404),
        ),
      ).toBe('NOT_FOUND');
      expect(
        errorCode(
          await post(as, `equipping/coordinate/classes/${classId}/check`, {
            fingerprint: 'a'.repeat(64),
          }).expect(404),
        ),
      ).toBe('NOT_FOUND');
      expect(
        errorCode(
          await post(as, `equipping/enrollments/${enrollmentId}/guide`, {
            guide_id: guideId,
          }).expect(404),
        ),
      ).toBe('NOT_FOUND');
      expect(
        errorCode(await get(as, `equipping/coordinate/classes/${classId}/grades`).expect(404)),
      ).toBe('NOT_FOUND');
      expect(errorCode(await get(as, 'equipping/guides?q=Gil&level=SOL_1').expect(403))).toBe(
        'SCOPE_DENIED',
      );
      // The guide is still named: nothing was removed by the refused call.
      const still = await db
        .selectFrom('equipping_class_guides')
        .select('removed_at')
        .where('id', '=', guideId)
        .executeTakeFirstOrThrow();
      expect(still.removed_at).toBeNull();
    });

    it('shows a register’s whole class to a Coordinator of its level only', async () => {
      const life = ((await openLife(lifeClassCoordinator).expect(201)).body as { id: string }).id;
      await get(lifeClassCoordinator, `equipping/classes/${life}/attendance`).expect(200);
      expect(
        errorCode(await get(solCoordinator, `equipping/classes/${life}/attendance`).expect(403)),
      ).toBe('SCOPE_DENIED');
    });

    it('a Registrar coordinates no level, though it holds equipping.manage', async () => {
      await get(registrar, 'equipping/coordinate/levels').expect(403);
      const admin_ = await get(admin, 'equipping/coordinate/levels').expect(200);
      expect((admin_.body as { data: string[] }).data).toEqual(['LIFE_CLASS', 'SOL_1', 'SOL_2']);
      const sol = await get(solCoordinator, 'equipping/coordinate/levels').expect(200);
      expect((sol.body as { data: string[] }).data).toEqual(['SOL_1']);
    });

    it('lists no disabled account among a level’s Coordinators', async () => {
      await db
        .updateTable('accounts')
        .set({ status: 'DISABLED' })
        .where('id', '=', bothCoordinator.id)
        .execute();
      const read = await get(admin, 'accounts/coordinators').expect(200);
      const levels = (read.body as { data: { people: { account_id: string }[] }[] }).data;
      expect(levels.flatMap((each) => each.people.map((p) => p.account_id))).not.toContain(
        bothCoordinator.id,
      );
    });
  });

  describe('SOL 1’s grades (decision 0514, points 11 to 13)', () => {
    describe('Training once a SOL 1 class opens (owner, 2026-11-26, "When a class opens")', () => {
      const tick = (as: TestAccount, personId: string) =>
        post(as, 'training/submit', {
          changes: [{ person_id: personId, program: 'SOL_1', graduated: true }],
        });
      const schoolPrograms = async (as: TestAccount) =>
        ((await get(as, 'training/people').expect(200)).body as { school_programs: string[] })
          .school_programs;

      it('lets a leader tick SOL 1 until a SOL 1 class opens, then only the Admin', async () => {
        const ramonAccount = await createAccount(app, db, { person: ramon, roles: ['LEADER'] });
        expect(await schoolPrograms(ramonAccount)).toEqual(['ENCOUNTER', 'LIFE_CLASS']);
        await tick(ramonAccount, disciples[0].id).expect(201);

        await openSol(solCoordinator).expect(201);
        expect(await schoolPrograms(ramonAccount)).toEqual(['ENCOUNTER', 'LIFE_CLASS', 'SOL_1']);
        const refused = await tick(ramonAccount, disciples[1].id).expect(403);
        expect(errorCode(refused)).toBe('SCOPE_DENIED');
        // The Admin ticks it for somebody who finished before the school.
        await tick(admin, disciples[1].id).expect(201);
      });

      it('counts a cancelled SOL 1 class as never opened', async () => {
        const ramonAccount = await createAccount(app, db, { person: ramon, roles: ['LEADER'] });
        const classId = ((await openSol(solCoordinator).expect(201)).body as { id: string }).id;
        await post(solCoordinator, `equipping/classes/${classId}/cancel`, {
          reason: 'The Teacher moved to another Network',
        }).expect(200);
        expect(await schoolPrograms(ramonAccount)).toEqual(['ENCOUNTER', 'LIFE_CLASS']);
        await tick(ramonAccount, disciples[0].id).expect(201);
      });
    });

    it('refuses posting a SOL 1 class whose lessons are not recorded, and files nothing', async () => {
      const { classId } = await solClassWithStudent();
      expect(
        errorCode(
          await post(registrar, `equipping/final-grades/classes/${classId}/post`, {}).expect(409),
        ),
      ).toBe('INVARIANT_VIOLATION');
      expect(await db.selectFrom('equipping_class_postings').select('id').execute()).toEqual([]);
      expect(
        await db
          .selectFrom('training_graduations')
          .select('id')
          .where('person_id', '=', wil.id)
          .where('program', '=', 'SOL_1')
          .execute(),
      ).toEqual([]);
    });

    it('lists a SOL 1 class among a Guide’s classes, and a leader’s SOL 1 card without the quiz score', async () => {
      const { classId } = await solClassWithStudent();
      const gilAccount = await createAccount(app, db, { person: gil, roles: ['LEADER'] });
      const mine = await get(gilAccount, 'equipping/my-classes').expect(200);
      expect((mine.body as { data: { id: string; level: string }[] }).data).toContainEqual(
        expect.objectContaining({ id: classId, level: 'SOL_1' }),
      );
      // **A leader's SOL 1 card** (decision 0514, point 14): what is still missing, the checklist,
      // and the quiz as passed or not, never its score.
      const ramonAccount = await createAccount(app, db, { person: ramon, roles: ['LEADER'] });
      const people = await get(ramonAccount, 'equipping/my-people').expect(200);
      const card = (
        people.body as {
          data: { person: { id: string }; level: string; encounter: unknown; sol: unknown }[];
        }
      ).data.find((each) => each.person.id === wil.id);
      expect(card).toMatchObject({
        level: 'SOL_1',
        encounter: null,
        sol: { verses: 0, devotionals: 0, quiz: 'NOT_TAKEN', book: false, still_missing: [] },
      });
      expect(JSON.stringify(card)).not.toMatch(/score/);
    });

    it('counts registrations for each level', async () => {
      await solClassWithStudent();
      const counts = await get(
        registrar,
        'equipping/registrations/counts?term_year=2027&term_number=1',
      ).expect(200);
      expect(counts.body).toEqual({ LIFE_CLASS: 0, SOL_1: 1, SOL_2: 0 });
    });

    it('opens a SOL 1 class’s register, and lists it on Final Grades, not ready', async () => {
      const { classId } = await solClassWithStudent();
      const register = await get(solCoordinator, `equipping/classes/${classId}/attendance`).expect(
        200,
      );
      expect(
        (register.body as { lessons: { lesson: number }[] }).lessons.map((l) => l.lesson),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const grades = await get(registrar, `equipping/final-grades/classes/${classId}`).expect(200);
      expect(
        (grades.body as { status: { phase: string; missing_lessons: number[] } }).status,
      ).toMatchObject({
        phase: 'NOT_READY',
        missing_lessons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      });
      // Not every lesson is recorded, so it cannot be checked.
      expect(
        errorCode(
          await post(solCoordinator, `equipping/coordinate/classes/${classId}/check`, {
            fingerprint: 'a'.repeat(64),
          }).expect(409),
        ),
      ).toBe('INVARIANT_VIOLATION');
      const list = await get(
        registrar,
        'equipping/final-grades?level=SOL_1&term_year=2027&term_number=1',
      ).expect(200);
      expect((list.body as { data: { id: string }[] }).data).toEqual([
        expect.objectContaining({ id: classId }),
      ]);
      const lessons = await db.selectFrom('equipping_lessons').select('id').execute();
      expect(lessons).toEqual([]);
    });
  });
});
