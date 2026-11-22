import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { expectedOn } from '../../src/equipping/equipping-attendance.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The Encounter's enrollment and attendance at the API (SKILL.md section 29, decisions 0501 and
 * 0507).
 *
 * What is pinned, each from the rulings:
 *
 *   - after lesson 4 each student reads Cleared, Needs make-up or Can't go: lessons 1 to 4 each
 *     came or made up with at most two missed, and three or more missed means they repeat;
 *   - a class whose lesson 4 is not saved lists nobody and waits;
 *   - the Registrar enrolls only cleared students, all or nobody, before the weekend begins;
 *   - from the weekend's first day the Registrar records who came, the rest not attended, and a
 *     change keeps what it changes (principle 12); it is the register's ENC column;
 *   - a student who missed it is listed for a later weekend;
 *   - nobody but the Registrar and the Admin reaches any of it.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('The Encounter (section 29, decisions 0501 and 0507)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let teacher: TestAccount;
  let ramon: TestPerson;
  let mario: TestPerson;
  let seasonId: string;
  let classId: string;
  let firstLesson: string;
  let today: string;
  const enrollmentOf = new Map<string, string>();

  const TERM = { level: 'LIFE_CLASS' as const, term_year: 2026, term_number: 3 };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
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

  interface List {
    season: { id: string; weekend_on: string } | null;
    phase: string;
    students: {
      enrollment_id: string;
      person: { full_name: string };
      status: string;
      reasons: string[];
      lessons: string[];
      missed_weekend_on: string | null;
    }[];
    waiting: { class: { name: string }; lesson_4_on: string }[];
    enrolled: {
      encounter_enrollment_id: string;
      person: { full_name: string };
      came: boolean | null;
    }[];
  }

  const list = async (account: TestAccount = registrar, season = seasonId) =>
    (await get(account, `equipping/encounter?network=MENS&season_id=${season}`).expect(200))
      .body as List;

  const first = (name: string) => (s: { person: { full_name: string } }) =>
    s.person.full_name.startsWith(name);

  const plusDays = (day: string, days: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  /** A season whose Men's weekend falls on `on`. */
  const season = async (on: string) =>
    (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: plusDays(on, -35),
          mens_encounter_on: on,
          womens_lc_party_on: plusDays(on, -28),
          womens_encounter_on: plusDays(on, 7),
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** Moves the season's Men's weekend, as an administrator correcting its date would. */
  const weekendOn = async (id: string, on: string) => {
    await db
      .updateTable('encounter_seasons')
      .set({ mens_encounter_on: on, mens_lc_party_on: plusDays(on, -35) })
      .where('id', '=', id)
      .execute();
  };

  /** One lesson saved, as the Teacher's save writes it, absences listed and made up where named. */
  const lesson = async (n: number, absent: string[], madeUp: string[] = []) => {
    const heldOn = expectedOn(firstLesson, n);
    const id = (
      await db
        .insertInto('equipping_lessons')
        .values({ class_id: classId, lesson: n, held_on: heldOn, recorded_by: teacher.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    for (const [name, enrollmentId] of enrollmentOf) {
      await db
        .insertInto('equipping_marks')
        .values({
          lesson_id: id,
          enrollment_id: enrollmentId,
          came: !absent.includes(name),
          recorded_by: teacher.id,
        })
        .execute();
    }
    for (const name of madeUp) {
      await db
        .insertInto('equipping_make_ups')
        .values({
          lesson_id: id,
          enrollment_id: enrollmentOf.get(name)!,
          made_up_on: heldOn,
          recorded_by: teacher.id,
        })
        .execute();
    }
  };

  /** Ben came to all four, Carlo owes L2, Dino missed three, Eli made L3 up. */
  const fourLessons = async () => {
    await lesson(1, ['Dino']);
    await lesson(2, ['Carlo', 'Dino']);
    await lesson(3, ['Dino', 'Eli'], ['Eli']);
    await lesson(4, []);
  };

  beforeEach(async () => {
    await truncateAll(db);
    enrollmentOf.clear();
    today = (
      await sql<{ d: string }>`SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text AS d`.execute(
        db,
      )
    ).rows[0].d;
    firstLesson = plusDays(today, -28);

    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    mario = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mario.id, ramon.id);
    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    teacher = await createAccount(app, db, { person: mario, roles: ['LEADER'] });

    seasonId = await season(plusDays(today, 14));
    classId = (
      await db
        .insertInto('equipping_classes')
        .values({
          ...TERM,
          name: 'Life Class A',
          day_of_week: 2,
          time_of_day: '19:00',
          first_lesson_on: firstLesson,
          teacher_person_id: mario.id,
          encounter_season_id: seasonId,
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    for (const name of ['Ben', 'Carlo', 'Dino', 'Eli']) {
      const person = await createPerson(db, {
        firstName: name,
        network: 'MENS',
        birthDate: '1999-02-01',
      });
      await assignTo(db, person.id, ramon.id);
      const reg = await post(registrar, 'equipping/registrations', {
        ...TERM,
        person_id: person.id,
        bible_confirmed: true,
        manual_confirmed: true,
        exception_reason: 'Their leader confirms they attend.',
      }).expect(201);
      const enrolled = await post(admin, `equipping/classes/${classId}/enrollments`, {
        registration_ids: [(reg.body as { id: string }).id],
      }).expect(201);
      enrollmentOf.set(
        name,
        (enrolled.body as { enrolled: { enrollment_id: string }[] }).enrolled[0].enrollment_id,
      );
    }
  });

  it('waits for lesson 4 before listing a class', async () => {
    await lesson(1, []);
    const r = await list();
    expect(r.students).toEqual([]);
    expect(r.waiting).toEqual([
      {
        class: expect.objectContaining({ name: 'Life Class A' }),
        lesson_4_on: expectedOn(firstLesson, 4),
      },
    ]);
    expect(r.phase).toBe('ENROLLING');
  });

  it('reads each student Cleared, Needs make-up or Can’t go after lesson 4', async () => {
    await fourLessons();
    const r = await list();
    expect(r.waiting).toEqual([]);
    expect(r.students.find(first('Ben'))).toMatchObject({
      status: 'CLEARED',
      lessons: ['CAME', 'CAME', 'CAME', 'CAME'],
    });
    expect(r.students.find(first('Eli'))).toMatchObject({
      status: 'CLEARED',
      lessons: ['CAME', 'CAME', 'MADE_UP', 'CAME'],
    });
    expect(r.students.find(first('Carlo'))).toMatchObject({
      status: 'NEEDS_MAKE_UP',
      reasons: ['L2 not made up yet.'],
    });
    expect(r.students.find(first('Dino'))).toMatchObject({
      status: 'CANT_GO',
      reasons: ['3 absences in lessons 1 to 4. Repeats Life Class.'],
    });
  });

  it('enrolls cleared students only, all or nobody, and lists them as enrolled', async () => {
    await fourLessons();
    const refused = await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben'), enrollmentOf.get('Carlo')],
    }).expect(409);
    expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
    expect((await list()).enrolled).toEqual([]);

    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben'), enrollmentOf.get('Eli')],
    }).expect(201);
    const r = await list();
    expect(r.enrolled.map((e) => e.person.full_name.split(' ')[0])).toEqual(['Ben', 'Eli']);
    expect(r.students.map((s) => s.person.full_name.split(' ')[0]).sort()).toEqual([
      'Carlo',
      'Dino',
    ]);
    const audit = await db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'equipping_encounter_enrollment.created')
      .execute();
    expect(audit).toHaveLength(2);
  });

  it('closes enrolling when the weekend begins, and opens who came', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben'), enrollmentOf.get('Eli')],
    }).expect(201);
    const early = await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [],
    }).expect(409);
    expect(early.body.error.code).toBe('INVARIANT_VIOLATION');

    await weekendOn(seasonId, today);
    expect((await list()).phase).toBe('RECORDING');
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Carlo')],
    }).expect(409);
  });

  it('records who came, the rest not attended, as the register’s ENC, and keeps a correction', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben'), enrollmentOf.get('Eli')],
    }).expect(201);
    await weekendOn(seasonId, today);
    const ids = new Map(
      (await list()).enrolled.map((e) => [
        e.person.full_name.split(' ')[0],
        e.encounter_enrollment_id,
      ]),
    );
    const saved = await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [ids.get('Ben')],
    }).expect(200);
    expect(saved.body).toMatchObject({ came: 1, did_not: 1, changed: 2 });

    const register = (await get(teacher, `equipping/classes/${classId}/attendance`).expect(200))
      .body as { students: { person: { full_name: string }; encounter: string | null }[] };
    expect(register.students.find(first('Ben'))!.encounter).toBe('CAME');
    expect(register.students.find(first('Eli'))!.encounter).toBe('MISSED');
    expect(register.students.find(first('Carlo'))!.encounter).toBeNull();

    // Eli did come after all: corrected, the first row kept and closed.
    await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [ids.get('Ben'), ids.get('Eli')],
    }).expect(200);
    const rows = await db
      .selectFrom('equipping_encounter_attendance')
      .select(['came', 'superseded_at'])
      .where('encounter_enrollment_id', '=', ids.get('Eli')!)
      .orderBy('recorded_at')
      .execute();
    expect(rows.map((row) => [row.came, row.superseded_at !== null])).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it('files the Encounter from the school, dated the weekend, and a correction withdraws it (decision 0509)', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben'), enrollmentOf.get('Eli')],
    }).expect(201);
    await weekendOn(seasonId, today);
    const listed = (await list()).enrolled;
    const ids = new Map(
      listed.map((e) => [e.person.full_name.split(' ')[0], e.encounter_enrollment_id]),
    );
    const personOf = async (encounterEnrollmentId: string) =>
      (
        await db
          .selectFrom('equipping_encounter_enrollments')
          .select('person_id')
          .where('id', '=', encounterEnrollmentId)
          .executeTakeFirstOrThrow()
      ).person_id;
    const ben = await personOf(ids.get('Ben')!);
    const eli = await personOf(ids.get('Eli')!);
    const encounterOf = (personId: string) =>
      db
        .selectFrom('training_graduations')
        .select(['graduated_on', 'from_school', 'superseded_at', 'correction_reason'])
        .where('person_id', '=', personId)
        .where('program', '=', 'ENCOUNTER')
        .orderBy('confirmed_at')
        .execute();

    await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [ids.get('Ben')],
    }).expect(200);
    expect(await encounterOf(ben)).toEqual([
      expect.objectContaining({ graduated_on: today, from_school: true, superseded_at: null }),
    ]);
    expect(await encounterOf(eli)).toEqual([]);

    // Ben did not come after all: the school's Encounter is withdrawn and kept.
    await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [],
    }).expect(200);
    const after = await encounterOf(ben);
    expect(after).toHaveLength(1);
    expect(after[0].superseded_at).not.toBeNull();
    expect(after[0].correction_reason).toMatch(/not attended/);
  });

  it('leaves a tick from before the school as it is (decision 0509)', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben')],
    }).expect(201);
    await weekendOn(seasonId, today);
    const id = (await list()).enrolled[0].encounter_enrollment_id;
    const ben = (
      await db
        .selectFrom('equipping_encounter_enrollments')
        .select('person_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).person_id;
    await db
      .insertInto('training_graduations')
      .values({
        person_id: ben,
        program: 'ENCOUNTER',
        graduated_on: '2019-03-10',
        confirmed_by: null,
        recorded_by: admin.id,
      })
      .execute();

    for (const came of [[id], []]) {
      await post(registrar, 'equipping/encounter/attendance', {
        season_id: seasonId,
        network: 'MENS',
        came,
      }).expect(200);
    }
    const rows = await db
      .selectFrom('training_graduations')
      .select(['graduated_on', 'from_school', 'superseded_at'])
      .where('person_id', '=', ben)
      .execute();
    expect(rows).toEqual([{ graduated_on: '2019-03-10', from_school: false, superseded_at: null }]);
  });

  it('saves only the students it lists, and leaves one withdrawn since as recorded', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben'), enrollmentOf.get('Eli')],
    }).expect(201);
    await weekendOn(seasonId, today);
    const ids = new Map(
      (await list()).enrolled.map((e) => [
        e.person.full_name.split(' ')[0],
        e.encounter_enrollment_id,
      ]),
    );
    await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [ids.get('Ben'), ids.get('Eli')],
    }).expect(200);
    await post(registrar, `equipping/enrollments/${enrollmentOf.get('Eli')}/withdraw`, {
      reason: 'Moved to another city.',
    }).expect(200);

    expect((await list()).enrolled.map((e) => e.person.full_name.split(' ')[0])).toEqual(['Ben']);
    const saved = await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [],
    }).expect(200);
    expect(saved.body).toMatchObject({ came: 0, did_not: 1, changed: 1 });
    const eli = await db
      .selectFrom('equipping_encounter_attendance')
      .select(['came'])
      .where('encounter_enrollment_id', '=', ids.get('Eli')!)
      .where('superseded_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(eli.came).toBe(true);
  });

  it('refuses ticking somebody already recorded at another weekend, in words', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Eli')],
    }).expect(201);
    await weekendOn(seasonId, today);
    const first = (await list()).enrolled[0].encounter_enrollment_id;
    await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [],
    }).expect(200);
    // Eli went to the next weekend instead, and came.
    const later = await season(plusDays(today, -1 + 120));
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: later,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Eli')],
    }).expect(201);
    await weekendOn(later, plusDays(today, -1));
    await weekendOn(seasonId, plusDays(today, -60));
    const second = (await list(registrar, later)).enrolled[0].encounter_enrollment_id;
    await post(registrar, 'equipping/encounter/attendance', {
      season_id: later,
      network: 'MENS',
      came: [second],
    }).expect(200);

    const refused = await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [first],
    }).expect(409);
    expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(refused.body.error.message).toMatch(/Already recorded at another Encounter: Eli/);
  });

  it('carries a student who left the weekend’s list before who came was saved', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Eli')],
    }).expect(201);
    // Eli moves to a class of a later season before the weekend's attendance is saved.
    const later = await season(plusDays(today, 120));
    const classB = (
      await db
        .insertInto('equipping_classes')
        .values({
          ...TERM,
          name: 'Life Class B',
          day_of_week: 4,
          time_of_day: '19:00',
          first_lesson_on: firstLesson,
          teacher_person_id: mario.id,
          encounter_season_id: later,
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto('equipping_lessons')
      .values({
        class_id: classB,
        lesson: 4,
        held_on: expectedOn(firstLesson, 4),
        recorded_by: teacher.id,
      })
      .execute();
    await post(registrar, `equipping/enrollments/${enrollmentOf.get('Eli')}/move`, {
      class_id: classB,
    }).expect(200);

    expect((await list()).enrolled).toEqual([]);
    const carried = (await list(registrar, later)).students.find(first('Eli'));
    expect(carried).toMatchObject({ status: 'CLEARED' });
  });

  it('lists nobody for a season they already have a weekend row in, of either Network', async () => {
    await fourLessons();
    // Eli was enrolled in this season's Women's weekend before a sex correction made him a man.
    const row = await db
      .selectFrom('equipping_enrollments as e')
      .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
      .select(['e.id', 'r.person_id'])
      .where('e.id', '=', enrollmentOf.get('Eli')!)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('equipping_encounter_enrollments')
      .values({
        enrollment_id: row.id,
        person_id: row.person_id,
        encounter_season_id: seasonId,
        network: 'WOMENS',
        enrolled_by: registrar.id,
      })
      .execute();
    expect((await list()).students.find(first('Eli'))).toBeUndefined();
    const later = await season(plusDays(today, 120));
    expect((await list(registrar, later)).students.find(first('Eli'))).toBeDefined();
  });

  it('lists a student who missed it for a later weekend', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben'), enrollmentOf.get('Eli')],
    }).expect(201);
    await weekendOn(seasonId, today);
    const ids = new Map(
      (await list()).enrolled.map((e) => [
        e.person.full_name.split(' ')[0],
        e.encounter_enrollment_id,
      ]),
    );
    await post(registrar, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [ids.get('Ben')],
    }).expect(200);

    const later = await season(plusDays(today, 120));
    const r = await list(registrar, later);
    const eli = r.students.find(first('Eli'));
    expect(eli).toMatchObject({ status: 'CLEARED', missed_weekend_on: today });
    // Ben went, so he is on no later list.
    expect(r.students.find(first('Ben'))).toBeUndefined();
  });

  it('is the Registrar’s and the Admin’s alone', async () => {
    await get(teacher, `equipping/encounter?network=MENS&season_id=${seasonId}`).expect(403);
    await post(teacher, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben')],
    }).expect(403);
    await post(teacher, 'equipping/encounter/attendance', {
      season_id: seasonId,
      network: 'MENS',
      came: [],
    }).expect(403);
    await get(admin, `equipping/encounter?network=MENS&season_id=${seasonId}`).expect(200);
  });

  it('refuses a deletion, a rewrite, and a second Encounter attended, in the database', async () => {
    await fourLessons();
    await post(registrar, 'equipping/encounter/enrollments', {
      season_id: seasonId,
      network: 'MENS',
      enrollment_ids: [enrollmentOf.get('Ben')],
    }).expect(201);
    const row = await db
      .selectFrom('equipping_encounter_enrollments')
      .selectAll()
      .executeTakeFirstOrThrow();
    await expect(
      db.deleteFrom('equipping_encounter_enrollments').where('id', '=', row.id).execute(),
    ).rejects.toThrow(/never deleted/);
    await expect(
      db
        .updateTable('equipping_encounter_enrollments')
        .set({ network: 'WOMENS' })
        .where('id', '=', row.id)
        .execute(),
    ).rejects.toThrow(/keeps what it says/);

    await db
      .insertInto('equipping_encounter_attendance')
      .values({ encounter_enrollment_id: row.id, came: true, recorded_by: registrar.id })
      .execute();
    const later = await season(plusDays(today, 120));
    const second = (
      await db
        .insertInto('equipping_encounter_enrollments')
        .values({
          enrollment_id: row.enrollment_id,
          person_id: row.person_id,
          encounter_season_id: later,
          network: 'MENS',
          enrolled_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await expect(
      db
        .insertInto('equipping_encounter_attendance')
        .values({ encounter_enrollment_id: second, came: true, recorded_by: registrar.id })
        .execute(),
    ).rejects.toThrow(/attends one Encounter/);
  });
});
