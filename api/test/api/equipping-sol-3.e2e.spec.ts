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
 * SOL 3 joins the school in one step (SKILL.md sections 7 and 29, decisions 0501 and 0517): its
 * Coordinator, its classes, its registration, its Guides and Training. Its register, quiz, book
 * and final grades are pinned with SOL 1's and SOL 2's in `equipping-sol-register.e2e.spec.ts`.
 *
 * What is pinned, each from the ruling rather than from the service:
 *
 *   - **a level is carried on the tick**: a SOL 2 Coordinator cannot list or open SOL 3's
 *     classes; the SOL 3 tick needs Full view, in the database too, and only the Admin gives it;
 *   - SOL 3's requirements: SOL 2 passed, the leadership of an `ACTIVE` Cell now and twelve direct
 *     disciples now, read from the records and never shown as a count, and the SOL 3 book, each
 *     warning rather than refusing, the reason then required;
 *   - a SOL 3 Guide has passed SOL 3 **and** has three of their own direct disciples each leading
 *     an `ACTIVE` Cell now: SOL 3 alone, or two such disciples, is not enough;
 *   - once a SOL 3 class opens, only the Admin ticks SOL 3 in Training (point 1).
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 *
 *   Ramon (Men's root) -> Wil, who leads a Cell; Tess, passed SOL 3, with three disciples each
 *   leading a Cell; Sam, passed SOL 3, with two; Gil, passed SOL 2
 *   Duo: SOL 2 Coordinator; Tri: SOL 3 Coordinator; Ada: an administrator; Eva: a Registrar
 */
describe('SOL 3 in the school (section 29, decision 0517)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let sol2Coordinator: TestAccount;
  let sol3Coordinator: TestAccount;
  let ramon: TestPerson;
  let wil: TestPerson;
  let tess: TestPerson;
  let sam: TestPerson;
  let gil: TestPerson;

  const SOL3 = { level: 'SOL_3', term_year: 2027, term_number: 1 };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  /** `count` people under `leader`, each leading a Cell of their own when `leadCells` is set. */
  const disciplesOf = async (leader: TestPerson, count: number, leadCells: boolean) => {
    for (let n = 0; n < count; n += 1) {
      const disciple = await createPerson(db, {
        firstName: `D${leader.id.slice(0, 4)}${n}`,
        network: 'MENS',
      });
      await assignTo(db, disciple.id, leader.id);
      if (leadCells) {
        await createCell(db, {
          leader: disciple,
          dayOfWeek: 1 + (n % 6),
          timeOfDay: `1${n % 9}:00`,
        });
      }
    }
  };

  beforeEach(async () => {
    await truncateAll(db);

    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    // No birthday: SOL has no Encounter, so none is needed to enroll.
    wil = await createPerson(db, { firstName: 'Wil', network: 'MENS', birthDate: null });
    await assignTo(db, wil.id, ramon.id);
    await createCell(db, { leader: wil, dayOfWeek: 2, timeOfDay: '19:30' });
    tess = await createPerson(db, { firstName: 'Tess', network: 'MENS' });
    await assignTo(db, tess.id, ramon.id);
    await disciplesOf(tess, 3, true);
    sam = await createPerson(db, { firstName: 'Sam', network: 'MENS' });
    await assignTo(db, sam.id, ramon.id);
    await disciplesOf(sam, 2, true);
    gil = await createPerson(db, { firstName: 'Gil', network: 'MENS' });
    await assignTo(db, gil.id, ramon.id);
    const duo = await createPerson(db, { firstName: 'Duo', network: 'MENS' });
    await assignTo(db, duo.id, ramon.id);
    const tri = await createPerson(db, { firstName: 'Tri', network: 'MENS' });
    await assignTo(db, tri.id, ramon.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    sol2Coordinator = await createAccount(app, db, { person: duo, roles: ['LEADER'] });
    sol3Coordinator = await createAccount(app, db, { person: tri, roles: ['LEADER'] });

    await post(admin, `accounts/${sol2Coordinator.id}/coordinates-sol-2`, {
      coordinates_sol_2: true,
    }).expect(200);
    await post(admin, `accounts/${sol3Coordinator.id}/coordinates-sol-3`, {
      coordinates_sol_3: true,
    }).expect(200);

    for (const [person, program] of [
      [tess, 'SOL_3'],
      [sam, 'SOL_3'],
      [gil, 'SOL_2'],
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

  const openSol3 = (as: TestAccount, extra: object = {}) =>
    post(as, 'equipping/classes', {
      ...SOL3,
      name: 'SOL 3 A',
      day_of_week: 5,
      time_of_day: '19:00',
      place: 'Room 5',
      first_lesson_on: '2027-01-15',
      ...extra,
    });

  const errorCode = (response: request.Response) =>
    (response.body as { error: { code: string } }).error.code;

  describe('the SOL 3 Coordinator tick', () => {
    it('is the Admin’s, audited, needs Full view, and the database refuses it without', async () => {
      const audit = await db
        .selectFrom('audit_log')
        .select('target_id')
        .where('action', '=', 'account.coordinates_sol_3_changed')
        .execute();
      expect(audit.map((row) => row.target_id)).toEqual([sol3Coordinator.id]);

      await expect(
        sql`UPDATE accounts SET full_view = false, coordinates_sol_2 = false,
              coordinates_sol_3 = true WHERE id = ${sol2Coordinator.id}`.execute(db),
      ).rejects.toThrow(/accounts_coordinates_sol_3_needs_full_view/);

      await post(sol3Coordinator, `accounts/${sol2Coordinator.id}/coordinates-sol-3`, {
        coordinates_sol_3: true,
      }).expect(403);

      // Nor a Network Admin: the tick needs `roles.manage` at Whole Church (section 7).
      const nora = await createPerson(db, { firstName: 'Nora', network: 'MENS' });
      const networkAdmin = await createAccount(app, db, { person: nora, roles: ['NETWORK_ADMIN'] });
      const refused = await post(networkAdmin, `accounts/${sol2Coordinator.id}/coordinates-sol-3`, {
        coordinates_sol_3: true,
      }).expect(403);
      expect(errorCode(refused)).toBe('SCOPE_DENIED');
      expect((refused.body as { error: { message: string } }).error.message).toBe(
        'Only the Admin gives or removes this tick.',
      );
    });

    it('is cleared with Full view, and lists among the Admin’s Coordinators', async () => {
      const read = await get(admin, 'accounts/coordinators').expect(200);
      const levels = (read.body as { data: { level: string; people: { account_id: string }[] }[] })
        .data;
      expect(levels.map((each) => each.level)).toEqual(['LIFE_CLASS', 'SOL_1', 'SOL_2', 'SOL_3']);
      expect(levels[3].people.map((each) => each.account_id)).toEqual([sol3Coordinator.id]);

      await post(admin, `accounts/${sol3Coordinator.id}/full-view`, { full_view: false }).expect(
        200,
      );
      const row = await db
        .selectFrom('accounts')
        .select(['full_view', 'coordinates_sol_3'])
        .where('id', '=', sol3Coordinator.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ full_view: false, coordinates_sol_3: false });
    });

    it('opens SOL 3 classes only, and a SOL 2 Coordinator none of them', async () => {
      const levels = await get(sol3Coordinator, 'equipping/coordinate/levels').expect(200);
      expect((levels.body as { data: string[] }).data).toEqual(['SOL_3']);
      const opened = await openSol3(sol3Coordinator).expect(201);
      expect((opened.body as { encounter_season_id: unknown }).encounter_season_id).toBeNull();
      expect(errorCode(await openSol3(sol2Coordinator).expect(403))).toBe('SCOPE_DENIED');
      await openSol3(admin, { name: 'SOL 3 B' }).expect(201);
    });
  });

  describe('a SOL 3 Guide', () => {
    it('has passed SOL 3 and has three disciples each leading a Cell; less is refused', async () => {
      const id = ((await openSol3(sol3Coordinator).expect(201)).body as { id: string }).id;
      await post(sol3Coordinator, `equipping/classes/${id}/guides`, { person_id: tess.id }).expect(
        201,
      );
      for (const who of [sam, gil]) {
        const refused = await post(sol3Coordinator, `equipping/classes/${id}/guides`, {
          person_id: who.id,
        }).expect(409);
        expect(errorCode(refused)).toBe('INVARIANT_VIOLATION');
        expect((refused.body as { error: { message: string } }).error.message).toContain(
          'A SOL 3 Guide has passed SOL 3, has 3 of their own disciples each leading a Cell,',
        );
      }

      const search = await get(sol3Coordinator, 'equipping/guides?q=Tess&level=SOL_3').expect(200);
      expect((search.body as { data: { qualifies: string }[] }).data).toEqual([
        expect.objectContaining({ qualifies: 'Passed SOL 3, with 3 Cell Leaders under them' }),
      ]);
      for (const name of ['Sam', 'Gil']) {
        const none = await get(sol3Coordinator, `equipping/guides?q=${name}&level=SOL_3`).expect(
          200,
        );
        expect((none.body as { data: unknown[] }).data).toEqual([]);
      }
      // Sam still guides SOL 2, where SOL 3 alone is enough.
      const lower = await get(sol2Coordinator, 'equipping/guides?q=Sam&level=SOL_2').expect(200);
      expect((lower.body as { data: { qualifies: string }[] }).data).toEqual([
        expect.objectContaining({ qualifies: 'Passed SOL 3' }),
      ]);
    });

    it('counts only their own disciples, each leading an ACTIVE Cell now', async () => {
      // Kai: one disciple leading a Cell, who has two of their own leading Cells. Those two
      // are further down Kai's tree and do not count (section 29).
      const kai = await createPerson(db, { firstName: 'Kai', network: 'MENS' });
      await assignTo(db, kai.id, ramon.id);
      await graduate(kai, 'SOL_3');
      const kaiDisciple = await createPerson(db, { firstName: 'Kaid', network: 'MENS' });
      await assignTo(db, kaiDisciple.id, kai.id);
      await createCell(db, { leader: kaiDisciple, dayOfWeek: 3, timeOfDay: '18:00' });
      await disciplesOf(kaiDisciple, 2, true);

      // Lex: three disciples each leading a Cell, one of those Cells since closed.
      const lex = await createPerson(db, { firstName: 'Lex', network: 'MENS' });
      await assignTo(db, lex.id, ramon.id);
      await graduate(lex, 'SOL_3');
      for (let n = 0; n < 3; n += 1) {
        const disciple = await createPerson(db, { firstName: `Lexd${n}`, network: 'MENS' });
        await assignTo(db, disciple.id, lex.id);
        const cell = await createCell(db, {
          leader: disciple,
          dayOfWeek: 4,
          timeOfDay: `1${n}:00`,
        });
        if (n === 0) {
          await closeCellDirectly(db, cell.id, { reason: 'LEADER_STEPPED_DOWN' });
        }
      }

      const id = ((await openSol3(sol3Coordinator).expect(201)).body as { id: string }).id;
      for (const who of [kai, lex]) {
        const refused = await post(sol3Coordinator, `equipping/classes/${id}/guides`, {
          person_id: who.id,
        }).expect(409);
        expect(errorCode(refused)).toBe('INVARIANT_VIOLATION');
      }
      for (const name of ['Kai', 'Lex']) {
        const none = await get(sol3Coordinator, `equipping/guides?q=${name}&level=SOL_3`).expect(
          200,
        );
        expect((none.body as { data: unknown[] }).data).toEqual([]);
      }
    });
  });

  describe('Training once a SOL 3 class opens (decision 0517, point 1)', () => {
    it('lets a leader tick SOL 3 until a SOL 3 class opens, then only the Admin', async () => {
      const tick = (as: TestAccount, personId: string) =>
        post(as, 'training/submit', {
          changes: [{ person_id: personId, program: 'SOL_3', graduated: true }],
        });
      const schoolPrograms = async (as: TestAccount) =>
        ((await get(as, 'training/people').expect(200)).body as { school_programs: string[] })
          .school_programs;
      const ramonAccount = await createAccount(app, db, { person: ramon, roles: ['LEADER'] });
      expect(await schoolPrograms(ramonAccount)).toEqual(['ENCOUNTER', 'LIFE_CLASS']);
      await tick(ramonAccount, wil.id).expect(201);

      await openSol3(sol3Coordinator).expect(201);
      expect(await schoolPrograms(ramonAccount)).toEqual(['ENCOUNTER', 'LIFE_CLASS', 'SOL_3']);
      expect(errorCode(await tick(ramonAccount, gil.id).expect(403))).toBe('SCOPE_DENIED');
      await tick(admin, gil.id).expect(201);
    });
  });

  describe('registering for SOL 3', () => {
    const register = (body: object) =>
      post(registrar, 'equipping/registrations', { ...SOL3, person_id: wil.id, ...body });

    const requirements = async () =>
      (
        (await get(registrar, `equipping/people/${wil.id}?level=SOL_3`).expect(200)).body as {
          requirements: unknown[];
        }
      ).requirements;

    it('shows SOL 2 passed, the Cell they lead and the twelve, never as a count', async () => {
      await disciplesOf(wil, 11, false);
      expect(await requirements()).toEqual([
        { code: 'SOL_2_PASSED', met: false, detail: 'SOL 2 not passed yet' },
        { code: 'LEADS_A_CELL', met: true, detail: expect.stringMatching(/^Leads CELL-/) },
        {
          code: 'TWELVE_DISCIPLES',
          met: false,
          detail: 'needs 12 disciples under them in DREAMS',
        },
      ]);
      await graduate(wil, 'SOL_2');
      await disciplesOf(wil, 1, false);
      expect(await requirements()).toEqual([
        { code: 'SOL_2_PASSED', met: true, detail: 'SOL 2 passed' },
        expect.objectContaining({ code: 'LEADS_A_CELL', met: true }),
        { code: 'TWELVE_DISCIPLES', met: true, detail: '12 disciples under them in DREAMS' },
      ]);
    });

    it('counts only disciples under them now: not one who moved away, nor one further down', async () => {
      await disciplesOf(wil, 11, false);
      // A twelfth who was Wil's disciple and has since moved to Ramon.
      const moved = await createPerson(db, { firstName: 'Moved', network: 'MENS' });
      await assignTo(db, moved.id, wil.id);
      const at = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db)).rows[0]
        .now;
      await sql`UPDATE pastoral_assignments SET ended_at = ${at}
                 WHERE person_id = ${moved.id} AND ended_at IS NULL`.execute(db);
      await assignTo(db, moved.id, ramon.id, at);
      // And one under one of Wil's disciples, further down his tree.
      const disciple = await db
        .selectFrom('pastoral_assignments')
        .select('person_id')
        .where('leader_id', '=', wil.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      const below = await createPerson(db, { firstName: 'Below', network: 'MENS' });
      await assignTo(db, below.id, disciple.person_id);

      expect(await requirements()).toEqual(
        expect.arrayContaining([
          {
            code: 'TWELVE_DISCIPLES',
            met: false,
            detail: 'needs 12 disciples under them in DREAMS',
          },
        ]),
      );
    });

    it('warns rather than refuses: a requirement not met, the book included, needs a reason', async () => {
      const refused = await register({ manual_confirmed: false }).expect(422);
      expect(
        (refused.body as { error: { details: { unmet: string[] } } }).error.details.unmet,
      ).toEqual(['SOL_2_PASSED', 'TWELVE_DISCIPLES', 'SOL_3_BOOK']);
      const registered = await register({
        manual_confirmed: false,
        exception_reason: 'Their leader confirms the book is coming.',
      }).expect(201);
      expect(registered.body).toEqual(
        expect.objectContaining({
          status: 'REGISTERED_WITH_EXCEPTION',
          unmet: ['SOL_2_PASSED', 'TWELVE_DISCIPLES', 'SOL_3_BOOK'],
        }),
      );
    });

    it('registers with no exception once all four are met, and enrolls into a SOL 3 class', async () => {
      await graduate(wil, 'SOL_2');
      await disciplesOf(wil, 12, false);
      const registered = await register({ manual_confirmed: true }).expect(201);
      expect(registered.body).toEqual(expect.objectContaining({ status: 'REGISTERED', unmet: [] }));
      const counts = await get(
        registrar,
        'equipping/registrations/counts?term_year=2027&term_number=1',
      ).expect(200);
      expect(counts.body).toEqual(expect.objectContaining({ SOL_3: 1 }));

      const id = ((await openSol3(sol3Coordinator).expect(201)).body as { id: string }).id;
      await post(registrar, `equipping/classes/${id}/enrollments`, {
        registration_ids: [(registered.body as { id: string }).id],
      }).expect(201);
    });

    it('keeps each level’s codes in the database, and a book not ticked named in them', async () => {
      await graduate(wil, 'SOL_2');
      await disciplesOf(wil, 12, false);
      await register({ manual_confirmed: true }).expect(201);
      await expect(
        sql`UPDATE equipping_registrations SET unmet = ARRAY['SOL_2_BOOK'],
              exception_reason = 'x'`.execute(db),
      ).rejects.toThrow(/equipping_registrations_unmet_known/);
      await expect(
        sql`UPDATE equipping_registrations SET manual_confirmed = false`.execute(db),
      ).rejects.toThrow(/equipping_registrations_sol_3_book_unmet/);
    });
  });
});
