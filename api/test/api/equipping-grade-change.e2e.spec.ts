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
 * A lesson of a posted class changed by the Admin, and the grade worked out again, at the API
 * (SKILL.md section 29, decision 0513). The fixture is the final-grades suite's.
 *
 * What is pinned, each from the ruling:
 *
 *   - only the Admin changes a lesson after posting, with a reason, and the Registrar is refused;
 *   - the posted grade is kept as written and the change is a row of its own, the register and
 *     the grade read through it;
 *   - Training follows the grade: Life Class filed when it becomes Passed, withdrawn when a
 *     Passed is changed away;
 *   - a Not yet stays Not yet and nobody becomes it; a change made since the dialog opened is
 *     refused; and a posted class's register changes in the database only beside a grade change.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('A grade changed after posting (section 29, decision 0513)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let coordinator: TestAccount;
  let teacher: TestAccount;
  let ramon: TestPerson;
  let lito: TestPerson;
  let seasonId: string;
  let classId: string;
  let firstLesson: string;
  const enrollmentOf = new Map<string, string>();
  const personOf = new Map<string, string>();

  const TERM = { level: 'LIFE_CLASS' as const, term_year: 2026, term_number: 3 };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const post = (account: TestAccount, path: string, body: object = {}) =>
    request(app.getHttpServer())
      .post(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  /** *Mark as checked*, sending back the register's last change as the page read it. */
  const check = async (account: TestAccount, expected = 200) => {
    const seen = (await get(account, `equipping/coordinate/classes/${classId}/grades`).expect(200))
      .body as { fingerprint: string };
    return post(account, `equipping/coordinate/classes/${classId}/check`, {
      fingerprint: seen.fingerprint,
    }).expect(expected);
  };

  const first = (name: string) => (s: { person: { full_name: string } }) =>
    s.person.full_name.startsWith(name);

  const plusDays = (day: string, days: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  /** One lesson saved, as the Teacher's save writes it. */
  const lesson = async (n: number, absent: string[] = [], madeUp: string[] = []) => {
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
      await makeUp(id, name, heldOn);
    }
    return { id, heldOn };
  };

  const makeUp = async (lessonId: string, name: string, on: string) => {
    await db
      .insertInto('equipping_make_ups')
      .values({
        lesson_id: lessonId,
        enrollment_id: enrollmentOf.get(name)!,
        made_up_on: on,
        recorded_by: teacher.id,
      })
      .execute();
  };

  /** Attended the Encounter, as the Registrar records it. */
  const attended = async (name: string) => {
    const ee = (
      await db
        .insertInto('equipping_encounter_enrollments')
        .values({
          enrollment_id: enrollmentOf.get(name)!,
          person_id: personOf.get(name)!,
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
  };

  /**
   * Every lesson: Ben came to all; Carlo missed L7, not made up; Dino came to every lesson but
   * not the Encounter; Eli missed four, all made up, two of them after lesson 4.
   */
  const term = async () => {
    await lesson(1, ['Eli'], ['Eli']);
    await lesson(2, ['Eli'], ['Eli']);
    await lesson(3);
    await lesson(4);
    await lesson(6, ['Eli'], ['Eli']);
    await lesson(7, ['Carlo', 'Eli'], ['Eli']);
    await lesson(8);
    const nine = await lesson(9);
    for (const name of ['Ben', 'Carlo', 'Eli']) {
      await attended(name);
    }
    return nine;
  };

  beforeEach(async () => {
    await truncateAll(db);
    enrollmentOf.clear();
    personOf.clear();
    const today = (
      await sql<{ d: string }>`SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text AS d`.execute(
        db,
      )
    ).rows[0].d;
    firstLesson = plusDays(today, -70);

    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    const mario = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mario.id, ramon.id);
    lito = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
    await assignTo(db, lito.id, ramon.id);
    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    teacher = await createAccount(app, db, { person: mario, roles: ['LEADER'] });
    coordinator = await createAccount(app, db, { person: lito, roles: ['LEADER'] });
    await post(admin, `accounts/${coordinator.id}/full-view`, { full_view: true }).expect(200);
    await post(admin, `accounts/${coordinator.id}/coordinates-life-class`, {
      coordinates_life_class: true,
    }).expect(200);

    seasonId = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: plusDays(today, -63),
          mens_encounter_on: plusDays(today, -28),
          womens_lc_party_on: plusDays(today, -56),
          womens_encounter_on: plusDays(today, -21),
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
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
        birthDate: '1990-02-01',
      });
      await assignTo(db, person.id, ramon.id);
      personOf.set(name, person.id);
      const reg = (
        await db
          .insertInto('equipping_registrations')
          .values({
            ...TERM,
            person_id: person.id,
            bible_confirmed: true,
            manual_confirmed: true,
            registered_by: registrar.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const enrollment = (
        await db
          .insertInto('equipping_enrollments')
          .values({ registration_id: reg, class_id: classId, started_by: registrar.id })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      enrollmentOf.set(name, enrollment);
    }
    // Enrolled before the first lesson, as a class's students are (decision 0503).
    await db.transaction().execute(async (trx) => {
      await sql`ALTER TABLE equipping_enrollments DISABLE TRIGGER equipping_enrollments_history_kept`.execute(
        trx,
      );
      await sql`
        UPDATE equipping_enrollments
           SET started_at = (${firstLesson}::date - 1)::timestamp AT TIME ZONE 'Asia/Manila'`.execute(
        trx,
      );
      await sql`ALTER TABLE equipping_enrollments ENABLE TRIGGER equipping_enrollments_history_kept`.execute(
        trx,
      );
    });
  });

  const lifeClassOf = (name: string) =>
    db
      .selectFrom('training_graduations')
      .select(['graduated_on', 'from_school', 'superseded_at'])
      .where('person_id', '=', personOf.get(name)!)
      .where('program', '=', 'LIFE_CLASS')
      .execute();

  const manilaToday = async () =>
    (
      await sql<{ d: string }>`SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text AS d`.execute(
        db,
      )
    ).rows[0].d;

  interface Student {
    person: { full_name: string };
    grade: string;
    reason: string;
    lessons: string[];
    final_grade_id: string;
    changes_seen: number;
    changeable: { lessons: { lesson: number; sign: string }[]; why: string | null };
    history: {
      lesson: number;
      sign_before: string;
      sign_after: string;
      grade_before: string;
      grade_after: string;
      why: string;
      details: string;
    }[];
  }

  /** The term as the final-grades suite records it, checked and posted. */
  const posted = async () => {
    await term();
    await check(coordinator);
    await post(registrar, `equipping/final-grades/classes/${classId}/post`).expect(200);
  };

  const studentOf = async (name: string, account: TestAccount = admin) => {
    const body = (await get(account, `equipping/final-grades/classes/${classId}`).expect(200))
      .body as { may_change: boolean; students: Student[] };
    return { mayChange: body.may_change, student: body.students.find(first(name))! };
  };

  const change = (
    account: TestAccount,
    s: Student,
    body: { lesson: number; to: string; made_up_on?: string },
    extra: Partial<{ why: string; details: string; changes_seen: number }> = {},
  ) =>
    post(account, `equipping/final-grades/grades/${s.final_grade_id}/changes`, {
      why: 'MADE_UP_AFTER_POSTING',
      details: 'Made it up with the Teacher after the class was posted.',
      changes_seen: s.changes_seen,
      ...body,
      ...extra,
    });

  it('changes a lesson, works the grade out again, files Life Class and keeps the posted grade', async () => {
    await posted();
    const today = await manilaToday();
    const { mayChange, student: carlo } = await studentOf('Carlo');
    expect(mayChange).toBe(true);
    expect(carlo.changeable.lessons.map((l) => l.lesson)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);

    const preview = await get(
      admin,
      `equipping/final-grades/grades/${carlo.final_grade_id}/change-preview?lesson=7&to=MADE_UP&made_up_on=${today}`,
    ).expect(200);
    expect(preview.body).toMatchObject({
      sign_before: 'ABSENT',
      grade_before: 'NOT_PASSED',
      reason_before: 'L7 not made up.',
      grade_after: 'PASSED',
      reason_after: 'Every lesson done.',
      training: 'FILES',
    });
    // A preview writes nothing.
    expect(await db.selectFrom('equipping_grade_changes').selectAll().execute()).toEqual([]);

    const saved = await change(admin, carlo, {
      lesson: 7,
      to: 'MADE_UP',
      made_up_on: today,
    }).expect(201);
    expect(saved.body).toMatchObject({ grade: 'PASSED', changes_seen: 1 });

    const after = (await studentOf('Carlo')).student;
    expect(after).toMatchObject({ grade: 'PASSED', reason: 'Every lesson done.', changes_seen: 1 });
    expect(after.lessons[6]).toBe('MADE_UP');
    expect(after.history).toEqual([
      expect.objectContaining({
        lesson: 7,
        sign_before: 'ABSENT',
        sign_after: 'MADE_UP',
        grade_before: 'NOT_PASSED',
        grade_after: 'PASSED',
        why: 'MADE_UP_AFTER_POSTING',
      }),
    ]);
    // The posted grade is kept as written (principle 12).
    const postedRow = await db
      .selectFrom('equipping_final_grades')
      .select(['grade', 'reason'])
      .where('id', '=', carlo.final_grade_id)
      .executeTakeFirstOrThrow();
    expect(postedRow).toEqual({ grade: 'NOT_PASSED', reason: 'L7 not made up.' });
    expect(await lifeClassOf('Carlo')).toEqual([
      { graduated_on: today, from_school: true, superseded_at: null },
    ]);
    const audit = await db
      .selectFrom('audit_log')
      .select(['target_id', 'reason'])
      .where('action', '=', 'equipping_final_grade.changed')
      .execute();
    expect(audit).toEqual([
      {
        target_id: personOf.get('Carlo'),
        reason: 'Made it up with the Teacher after the class was posted.',
      },
    ]);
    // Not counted as a try any more: the grade stands Passed (decision 0511).
    const tries = await db
      .selectFrom('equipping_current_grades')
      .select('grade')
      .where('final_grade_id', '=', carlo.final_grade_id)
      .executeTakeFirstOrThrow();
    expect(tries.grade).toBe('PASSED');
  });

  it('withdraws the Life Class the school filed when a Passed is changed away', async () => {
    await posted();
    const { student: ben } = await studentOf('Ben');
    await change(
      admin,
      ben,
      { lesson: 3, to: 'ABSENT' },
      { why: 'RECORDED_WRONGLY', details: 'He was ticked by mistake; he was away that week.' },
    ).expect(201);
    expect((await studentOf('Ben')).student).toMatchObject({
      grade: 'NOT_PASSED',
      reason: 'L3 not made up.',
    });
    const rows = await lifeClassOf('Ben');
    expect(rows).toHaveLength(1);
    expect(rows[0].superseded_at).not.toBeNull();
  });

  it('is the Admin’s alone: the Registrar reads the history and changes nothing', async () => {
    await posted();
    const { mayChange, student: carlo } = await studentOf('Carlo', registrar);
    expect(mayChange).toBe(false);
    expect(carlo.changeable.lessons).toEqual([]);
    await get(
      registrar,
      `equipping/final-grades/grades/${carlo.final_grade_id}/change-preview?lesson=7&to=CAME`,
    ).expect(403);
    await change(registrar, carlo, { lesson: 7, to: 'CAME' }).expect(403);
    await change(teacher, carlo, { lesson: 7, to: 'CAME' }).expect(403);
  });

  it('keeps a Not yet Not yet, and makes nobody Not yet', async () => {
    await posted();
    const { student: dino } = await studentOf('Dino');
    const refused = await change(admin, dino, { lesson: 3, to: 'ABSENT' }).expect(409);
    expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(refused.body.error.message).toContain('Not yet');
    // Recorded wrongly, and still Not yet: admitted.
    await change(admin, dino, { lesson: 3, to: 'MADE_UP', made_up_on: await manilaToday() }).expect(
      201,
    );
    expect((await studentOf('Dino')).student).toMatchObject({ grade: 'NOT_YET', changes_seen: 1 });
  });

  it('refuses a change made since the dialog opened, and one that changes nothing', async () => {
    await posted();
    const { student: carlo } = await studentOf('Carlo');
    await change(admin, carlo, { lesson: 8, to: 'ABSENT' }).expect(201);
    const stale = await change(admin, carlo, { lesson: 7, to: 'CAME' }).expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const fresh = (await studentOf('Carlo')).student;
    const same = await change(admin, fresh, { lesson: 8, to: 'ABSENT' }).expect(409);
    expect(same.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('refuses the Encounter, a make-up with no date, and a make-up before the lesson', async () => {
    await posted();
    const { student: carlo } = await studentOf('Carlo');
    await change(admin, carlo, { lesson: 5, to: 'CAME' }).expect(422);
    await change(admin, carlo, { lesson: 7, to: 'MADE_UP' }).expect(422);
    await change(admin, carlo, { lesson: 7, to: 'MADE_UP', made_up_on: firstLesson }).expect(422);
    await change(admin, carlo, { lesson: 7, to: 'CAME', made_up_on: firstLesson }).expect(422);
    await change(admin, carlo, { lesson: 7, to: 'CAME' }, { details: '   ' }).expect(422);
  });

  it('does not take Lesson 6 from one who has joined a later class there', async () => {
    await posted();
    const { student: eli } = await studentOf('Eli');
    // Eli joins a later term's class at Lesson 6 (decision 0512).
    const laterClass = (
      await db
        .insertInto('equipping_classes')
        .values({
          level: 'LIFE_CLASS',
          term_year: 2027,
          term_number: 1,
          name: 'Life Class B',
          day_of_week: 3,
          time_of_day: '19:00',
          first_lesson_on: plusDays(await manilaToday(), 7),
          encounter_season_id: seasonId,
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const reg = (
      await db
        .insertInto('equipping_registrations')
        .values({
          level: 'LIFE_CLASS',
          term_year: 2027,
          term_number: 1,
          person_id: personOf.get('Eli')!,
          bible_confirmed: true,
          manual_confirmed: true,
          registered_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto('equipping_enrollments')
      .values({
        registration_id: reg,
        class_id: laterClass,
        started_by: registrar.id,
        carried_from_enrollment_id: enrollmentOf.get('Eli')!,
      })
      .execute();
    // Made up wrongly, and he came: three absences would make him Passed, not joining.
    const refused = await change(
      admin,
      eli,
      { lesson: 7, to: 'CAME' },
      { why: 'RECORDED_WRONGLY', details: 'He came to L7.' },
    ).expect(409);
    expect(refused.body.error.message).toContain('Lesson 6');
  });

  it('holds in the database that a posted register changes only beside a grade change', async () => {
    await posted();
    const lessonSeven = await db
      .selectFrom('equipping_lessons')
      .select('id')
      .where('class_id', '=', classId)
      .where('lesson', '=', 7)
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('equipping_make_ups')
        .values({
          lesson_id: lessonSeven.id,
          enrollment_id: enrollmentOf.get('Carlo')!,
          made_up_on: await manilaToday(),
          recorded_by: admin.id,
        })
        .execute(),
    ).rejects.toThrow(/posted class's register changes only/);
    await expect(
      db
        .updateTable('equipping_marks')
        .set({ superseded_at: new Date(), superseded_by: admin.id })
        .where('lesson_id', '=', lessonSeven.id)
        .where('enrollment_id', '=', enrollmentOf.get('Carlo')!)
        .where('superseded_at', 'is', null)
        .execute(),
    ).rejects.toThrow(/posted class's register changes only/);

    const { student: carlo } = await studentOf('Carlo');
    await change(admin, carlo, { lesson: 7, to: 'CAME' }).expect(201);
    await expect(
      db.updateTable('equipping_grade_changes').set({ details: 'rewritten' }).execute(),
    ).rejects.toThrow(/kept as written/);
    await expect(db.deleteFrom('equipping_grade_changes').execute()).rejects.toThrow(
      /kept as written/,
    );
  });
});
