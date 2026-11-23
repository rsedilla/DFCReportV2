import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * Joining a later class at Lesson 6 (SKILL.md section 29, decisions 0508 and 0512).
 *
 *   - a person whose latest posted grade joins at Lesson 6 is enrolled carrying the enrollment
 *     where lessons 1 to 4 were kept, unless started from Lesson 1;
 *   - only a class whose Lesson 6 has not been reached takes them so;
 *   - the register reads lessons 1 to 4 from there, and a save never marks them for those;
 *   - the database holds the kept enrollment to the same person, level and an earlier term,
 *     posted as joining, and never lets it change.
 *
 * Fixture names are invented (CLAUDE.md, Secrets). Pablo kept lessons 1 to 4 and the Encounter in
 * Life Class B, Term 1 of 2027, and was posted Not passed for absences after it.
 */
describe('Joining a later class at Lesson 6 (section 29, decision 0512)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let pablo: TestPerson;
  let seasonId: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    pablo = await createPerson(db, {
      firstName: 'Pablo',
      network: 'MENS',
      birthDate: '1995-04-02',
    });
    await assignTo(db, pablo.id, ramon.id);
    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    seasonId = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: '2099-10-02',
          mens_encounter_on: '2099-11-06',
          womens_lc_party_on: '2099-10-09',
          womens_encounter_on: '2099-11-13',
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
  const code = (res: request.Response) => (res.body as { error: { code: string } }).error.code;

  const classIn = async (
    termYear: number,
    termNumber: number,
    name: string,
    firstLessonOn: string,
  ) =>
    (
      await db
        .insertInto('equipping_classes')
        .values({
          level: 'LIFE_CLASS',
          term_year: termYear,
          term_number: termNumber,
          name,
          day_of_week: 2,
          time_of_day: '19:00',
          first_lesson_on: firstLessonOn,
          teacher_person_id: admin.personId,
          encounter_season_id: seasonId,
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const register = async (person: TestPerson, termYear: number, termNumber: number) =>
    (
      await db
        .insertInto('equipping_registrations')
        .values({
          level: 'LIFE_CLASS',
          term_year: termYear,
          term_number: termNumber,
          person_id: person.id,
          bible_confirmed: true,
          manual_confirmed: true,
          registered_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /**
   * Life Class B in Term 1 of 2027: lessons 1 to 4 kept (lesson 3 made up) and posted Not passed,
   * joining at Lesson 6 when `joins`.
   */
  const keptInB = async (person: TestPerson, joins = true) => {
    const classId = await classIn(2027, 1, 'Life Class B', '2027-01-05');
    const registration = await register(person, 2027, 1);
    const enrollment = (
      await db
        .insertInto('equipping_enrollments')
        .values({ registration_id: registration, class_id: classId, started_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    for (const lesson of [1, 2, 3, 4]) {
      const lessonId = (
        await db
          .insertInto('equipping_lessons')
          .values({
            class_id: classId,
            lesson,
            held_on: `2027-01-${String(lesson * 7 - 2).padStart(2, '0')}`,
            recorded_by: admin.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await db
        .insertInto('equipping_marks')
        .values({
          lesson_id: lessonId,
          enrollment_id: enrollment,
          came: lesson !== 3,
          recorded_by: admin.id,
        })
        .execute();
      if (lesson === 3) {
        await db
          .insertInto('equipping_make_ups')
          .values({
            lesson_id: lessonId,
            enrollment_id: enrollment,
            made_up_on: '2027-01-30',
            recorded_by: admin.id,
          })
          .execute();
      }
    }
    const check = (
      await db
        .insertInto('equipping_class_checks')
        .values({
          class_id: classId,
          checked_by: admin.id,
          by_admin: true,
          fingerprint: 'a'.repeat(64),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const posting = (
      await db
        .insertInto('equipping_class_postings')
        .values({ class_id: classId, check_id: check, posted_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto('equipping_final_grades')
      .values({
        posting_id: posting,
        enrollment_id: enrollment,
        grade: 'NOT_PASSED',
        reason: `4 absences, over the 3 allowed. ${joins ? 'Joins a later class at lesson 6.' : 'Repeats Life Class.'}`,
        lessons_kept: 5,
        lessons_made_up: 1,
        joins_at_lesson_6: joins,
      })
      .execute();
    return enrollment;
  };

  // A class of Term 3, 2099 starting well ahead, so its Lesson 6 has not been reached.
  const laterClass = (name = 'Life Class C', first = '2099-08-04') => classIn(2099, 3, name, first);

  it('enrolls them carrying lessons 1 to 4, and the register reads them from there', async () => {
    const kept = await keptInB(pablo);
    const registration = await register(pablo, 2099, 3);
    const classId = await laterClass();

    const detail = await get(registrar, `equipping/classes/${classId}`).expect(200);
    const body = detail.body as {
      class: { lesson_6: { on: string; open: boolean } };
      ready: { joins_at_lesson_6: unknown }[];
    };
    expect(body.class.lesson_6).toEqual({ on: '2099-09-08', open: true });
    expect(body.ready[0].joins_at_lesson_6).toEqual({
      class_name: 'Life Class B',
      term_year: 2027,
      term_number: 1,
    });

    const res = await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
    }).expect(201);
    expect(
      (res.body as { enrolled: { joins_at_lesson_6: boolean }[] }).enrolled[0].joins_at_lesson_6,
    ).toBe(true);
    const enrolled = await db
      .selectFrom('equipping_enrollments')
      .select(['id', 'carried_from_enrollment_id'])
      .where('registration_id', '=', registration)
      .executeTakeFirstOrThrow();
    expect(enrolled.carried_from_enrollment_id).toBe(kept);

    const register_ = await get(admin, `equipping/classes/${classId}/attendance`).expect(200);
    const student = (
      register_.body as {
        students: {
          carried: unknown;
          marks: { lesson: number; came: boolean; made_up_on: string | null }[];
        }[];
      }
    ).students[0];
    expect(student.carried).toEqual({
      class_name: 'Life Class B',
      term_year: 2027,
      term_number: 1,
    });
    expect(student.marks.map((m) => [m.lesson, m.came, m.made_up_on])).toEqual([
      [1, true, null],
      [2, true, null],
      [3, false, '2027-01-30'],
      [4, true, null],
    ]);
  });

  it('starts them from Lesson 1 when the Registrar asks', async () => {
    await keptInB(pablo);
    const registration = await register(pablo, 2099, 3);
    const classId = await laterClass();
    const res = await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
      start_from_lesson_1: [registration],
    }).expect(201);
    expect(
      (res.body as { enrolled: { joins_at_lesson_6: boolean }[] }).enrolled[0].joins_at_lesson_6,
    ).toBe(false);
  });

  it('carries nothing when the latest grade repeats Life Class', async () => {
    await keptInB(pablo, false);
    const registration = await register(pablo, 2099, 3);
    const classId = await laterClass();
    const detail = await get(registrar, `equipping/classes/${classId}`).expect(200);
    expect(
      (detail.body as { ready: { joins_at_lesson_6: unknown }[] }).ready[0].joins_at_lesson_6,
    ).toBeNull();
    const res = await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
    }).expect(201);
    expect(
      (res.body as { enrolled: { joins_at_lesson_6: boolean }[] }).enrolled[0].joins_at_lesson_6,
    ).toBe(false);
  });

  it('refuses a class past its Lesson 6, by the API and the database', async () => {
    const kept = await keptInB(pablo);
    const registration = await register(pablo, 2099, 3);
    // Started long ago: its Lesson 6 has passed.
    const classId = await classIn(2099, 3, 'Life Class D', '2020-01-07');
    const refused = await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
    }).expect(409);
    expect(code(refused)).toBe('INVARIANT_VIOLATION');
    expect(JSON.stringify(refused.body)).toContain('start them from Lesson 1');

    // A class with a lesson from 6 saved is refused by the database.
    const later = await laterClass('Life Class E');
    await db
      .insertInto('equipping_lessons')
      .values({ class_id: later, lesson: 6, held_on: '2099-09-08', recorded_by: admin.id })
      .execute();
    await expect(
      db
        .insertInto('equipping_enrollments')
        .values({
          registration_id: registration,
          class_id: later,
          started_by: registrar.id,
          carried_from_enrollment_id: kept,
        })
        .execute(),
    ).rejects.toThrow(/has not reached it/);
  });

  it('holds the kept enrollment to the same person, posted as joining, and never changes it', async () => {
    const kept = await keptInB(pablo);
    const other = await createPerson(db, { firstName: 'Quintin', network: 'MENS' });
    const classId = await laterClass();
    const theirs = await register(other, 2099, 3);
    await expect(
      db
        .insertInto('equipping_enrollments')
        .values({
          registration_id: theirs,
          class_id: classId,
          started_by: registrar.id,
          carried_from_enrollment_id: kept,
        })
        .execute(),
    ).rejects.toThrow(/only from their own class/);

    const registration = await register(pablo, 2099, 3);
    await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
    }).expect(201);
    await expect(
      sql`UPDATE equipping_enrollments SET carried_from_enrollment_id = NULL WHERE registration_id = ${registration}`.execute(
        db,
      ),
    ).rejects.toThrow(/keeps the lessons it carried from/);
  });

  it('never marks them for lessons 1 to 4, and refuses a tick', async () => {
    await keptInB(pablo);
    const registration = await register(pablo, 2099, 3);
    // Begun two weeks ago, lesson 3 held today, the day they join, and Lesson 6 three weeks away.
    // Lesson 3 is the one made up in Life Class B, so neither a moved student's rule nor a late
    // joiner's refuses a tick for it: only the Lesson 6 rule does.
    const first = new Date(Date.now() - 14 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10);
    const third = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    const classId = await classIn(2099, 3, 'Life Class F', first);
    await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
    }).expect(201);
    const enrollment = (
      await db
        .selectFrom('equipping_enrollments')
        .select('id')
        .where('registration_id', '=', registration)
        .executeTakeFirstOrThrow()
    ).id;

    const ticked = await post(admin, `equipping/classes/${classId}/lessons/3`, {
      held_on: third,
      came: [enrollment],
    }).expect(422);
    expect(code(ticked)).toBe('VALIDATION_FAILED');

    await post(admin, `equipping/classes/${classId}/lessons/3`, {
      held_on: third,
      came: [],
    }).expect(200);
    const marks = await db
      .selectFrom('equipping_marks')
      .select('id')
      .where('enrollment_id', '=', enrollment)
      .execute();
    expect(marks).toHaveLength(0);
  });

  it('refuses at the database a mark of lessons 1 to 4 for one joined at Lesson 6', async () => {
    await keptInB(pablo);
    const registration = await register(pablo, 2099, 3);
    const classId = await laterClass();
    await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
    }).expect(201);
    const enrollment = (
      await db
        .selectFrom('equipping_enrollments')
        .select('id')
        .where('registration_id', '=', registration)
        .executeTakeFirstOrThrow()
    ).id;
    const lessonId = (
      await db
        .insertInto('equipping_lessons')
        .values({ class_id: classId, lesson: 2, held_on: '2099-08-11', recorded_by: admin.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await expect(
      db
        .insertInto('equipping_marks')
        .values({
          lesson_id: lessonId,
          enrollment_id: enrollment,
          came: false,
          recorded_by: admin.id,
        })
        .execute(),
    ).rejects.toThrow(/keeps lessons 1 to 4/);
  });

  it('reads lessons kept before a move in the earlier term', async () => {
    // Pablo began Life Class B1, moved to B2 after lesson 2, and was graded there.
    const b1 = await classIn(2027, 1, 'Life Class B1', '2027-01-05');
    const b2 = await classIn(2027, 1, 'Life Class B2', '2027-01-05');
    const registration = await register(pablo, 2027, 1);
    const first = (
      await db
        .insertInto('equipping_enrollments')
        .values({ registration_id: registration, class_id: b1, started_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const saveMark = async (classId: string, enrollmentId: string, lesson: number) => {
      const lessonId = (
        await db
          .insertInto('equipping_lessons')
          .values({
            class_id: classId,
            lesson,
            held_on: `2027-01-${String(lesson * 7 - 2).padStart(2, '0')}`,
            recorded_by: admin.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await db
        .insertInto('equipping_marks')
        .values({
          lesson_id: lessonId,
          enrollment_id: enrollmentId,
          came: true,
          recorded_by: admin.id,
        })
        .execute();
    };
    await saveMark(b1, first, 1);
    await saveMark(b1, first, 2);
    await db
      .updateTable('equipping_enrollments')
      .set({ ended_at: new Date(), ended_by: registrar.id, end_reason: 'MOVED' })
      .where('id', '=', first)
      .execute();
    const second = (
      await db
        .insertInto('equipping_enrollments')
        .values({ registration_id: registration, class_id: b2, started_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await saveMark(b2, second, 3);
    await saveMark(b2, second, 4);
    const check = (
      await db
        .insertInto('equipping_class_checks')
        .values({ class_id: b2, checked_by: admin.id, by_admin: true, fingerprint: 'a'.repeat(64) })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const posting = (
      await db
        .insertInto('equipping_class_postings')
        .values({ class_id: b2, check_id: check, posted_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto('equipping_final_grades')
      .values({
        posting_id: posting,
        enrollment_id: second,
        grade: 'NOT_PASSED',
        reason: 'x',
        lessons_kept: 5,
        lessons_made_up: 0,
        joins_at_lesson_6: true,
      })
      .execute();

    const later = await register(pablo, 2099, 3);
    const classId = await laterClass();
    await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [later],
    }).expect(201);
    const res = await get(admin, `equipping/classes/${classId}/attendance`).expect(200);
    const marks = (res.body as { students: { marks: { lesson: number }[] }[] }).students[0].marks;
    expect(marks.map((m) => m.lesson)).toEqual([1, 2, 3, 4]);
  });

  it('reads the Encounter of a record merged into the person (decision 0408)', async () => {
    const duplicate = await createPerson(db, { firstName: 'Pablito', network: 'MENS' });
    const kept = await keptInB(duplicate);
    const ee = (
      await db
        .insertInto('equipping_encounter_enrollments')
        .values({
          enrollment_id: kept,
          person_id: duplicate.id,
          encounter_season_id: seasonId,
          network: 'MENS',
          enrolled_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto('equipping_encounter_attendance')
      .values({ encounter_enrollment_id: ee, came: true, recorded_by: registrar.id })
      .execute();
    await db
      .updateTable('persons')
      .set({ merged_into_id: pablo.id, merged_at: new Date(), merge_reason: 'Recorded twice' })
      .where('id', '=', duplicate.id)
      .execute();

    const registration = await register(pablo, 2099, 3);
    const classId = await laterClass();
    const enrolled = await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
    }).expect(201);
    expect(
      (enrolled.body as { enrolled: { joins_at_lesson_6: boolean }[] }).enrolled[0]
        .joins_at_lesson_6,
    ).toBe(true);
    const res = await get(admin, `equipping/classes/${classId}/attendance`).expect(200);
    expect((res.body as { students: { encounter: string | null }[] }).students[0].encounter).toBe(
      'CAME',
    );
  });

  it('records no make-up of lessons 1 to 4 for them, here or in the posted class', async () => {
    const kept = await keptInB(pablo);
    const registration = await register(pablo, 2099, 3);
    const first = new Date(Date.now() - 14 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10);
    const classId = await classIn(2099, 3, 'Life Class G', first);
    await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [registration],
    }).expect(201);
    const enrollment = (
      await db
        .selectFrom('equipping_enrollments')
        .select('id')
        .where('registration_id', '=', registration)
        .executeTakeFirstOrThrow()
    ).id;
    // Lesson 3, made up in Life Class B: a Teacher's make-up here is refused.
    const refused = await post(admin, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: enrollment,
      lesson: 3,
      made_up_on: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10),
    }).expect(409);
    expect(code(refused)).toBe('INVARIANT_VIOLATION');
    // And nothing is written into Life Class B's posted register at the database either.
    const lesson3 = (
      await db
        .selectFrom('equipping_lessons as l')
        .innerJoin('equipping_enrollments as e', 'e.class_id', 'l.class_id')
        .select('l.id')
        .where('e.id', '=', kept)
        .where('l.lesson', '=', 3)
        .executeTakeFirstOrThrow()
    ).id;
    await expect(
      db
        .insertInto('equipping_make_ups')
        .values({
          lesson_id: lesson3,
          enrollment_id: kept,
          made_up_on: '2027-02-01',
          recorded_by: admin.id,
        })
        .execute(),
    ).rejects.toThrow(/kept as recorded/);
  });

  it('still admits a make-up in a posted class for somebody nobody carries from', async () => {
    // A moved student's make-up of a lesson missed in a class since posted is not 0512's rule.
    const kept = await keptInB(pablo, false);
    const lesson3 = (
      await db
        .selectFrom('equipping_lessons as l')
        .innerJoin('equipping_enrollments as e', 'e.class_id', 'l.class_id')
        .select('l.id')
        .where('e.id', '=', kept)
        .where('l.lesson', '=', 3)
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .updateTable('equipping_make_ups')
      .set({ superseded_at: new Date(), superseded_by: admin.id })
      .where('lesson_id', '=', lesson3)
      .execute();
    await expect(
      db
        .insertInto('equipping_make_ups')
        .values({
          lesson_id: lesson3,
          enrollment_id: kept,
          made_up_on: '2027-02-02',
          recorded_by: admin.id,
        })
        .execute(),
    ).resolves.toBeDefined();
  });
});
