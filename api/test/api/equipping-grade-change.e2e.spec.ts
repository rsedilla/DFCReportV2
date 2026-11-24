import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { expectedOn } from '../../src/equipping/equipping-attendance.service';
import { SchoolEvidenceAdapter } from '../../src/equipping/school-evidence.adapter';
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
    changeable: {
      lessons: { lesson: number; sign: string; recorded_in?: string | null; kept?: boolean }[];
      why: string | null;
    };
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

  /** The Encounter corrected after posting, as the Registrar corrects it. */
  const correctEncounter = async (name: string, came: boolean) => {
    const row = await db
      .selectFrom('equipping_encounter_attendance as a')
      .innerJoin('equipping_encounter_enrollments as e', 'e.id', 'a.encounter_enrollment_id')
      .select(['a.id', 'a.encounter_enrollment_id'])
      .where('e.person_id', '=', personOf.get(name)!)
      .where('a.superseded_at', 'is', null)
      .executeTakeFirstOrThrow();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('equipping_encounter_attendance')
        .set({ superseded_at: new Date(), superseded_by: registrar.id })
        .where('id', '=', row.id)
        .execute();
      await trx
        .insertInto('equipping_encounter_attendance')
        .values({
          encounter_enrollment_id: row.encounter_enrollment_id,
          came,
          recorded_by: registrar.id,
        })
        .execute();
    });
  };

  /** A later weekend, today, at which the Registrar records `name` as having come (decision 0509). */
  const passAtLaterEncounter = async (name: string) => {
    const today = await manilaToday();
    const later = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: plusDays(today, -35),
          mens_encounter_on: today,
          womens_lc_party_on: plusDays(today, -28),
          womens_encounter_on: plusDays(today, 7),
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const ee = (
      await db
        .insertInto('equipping_encounter_enrollments')
        .values({
          enrollment_id: enrollmentOf.get(name)!,
          person_id: personOf.get(name)!,
          encounter_season_id: later,
          network: 'MENS',
          enrolled_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await post(registrar, 'equipping/encounter/attendance', {
      season_id: later,
      network: 'MENS',
      came: [ee],
    }).expect(200);
    return today;
  };

  /** A registration for the level, at the term given, for one person. */
  const register = async (personId: string, term: { term_year: number; term_number: number }) =>
    (
      await db
        .insertInto('equipping_registrations')
        .values({
          level: 'LIFE_CLASS',
          ...term,
          person_id: personId,
          bible_confirmed: true,
          manual_confirmed: true,
          registered_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** Moves an enrollment's start to before a given day, as a class's students start (0503). */
  const startBefore = async (enrollmentId: string, day: string) => {
    await db.transaction().execute(async (trx) => {
      await sql`ALTER TABLE equipping_enrollments DISABLE TRIGGER equipping_enrollments_history_kept`.execute(
        trx,
      );
      await sql`
        UPDATE equipping_enrollments
           SET started_at = (${day}::date - 1)::timestamp AT TIME ZONE 'Asia/Manila'
         WHERE id = ${enrollmentId}`.execute(trx);
      await sql`ALTER TABLE equipping_enrollments ENABLE TRIGGER equipping_enrollments_history_kept`.execute(
        trx,
      );
    });
  };

  /** A second class of the level, its first lesson on the day given. */
  const otherClass = async (
    name: string,
    term: { term_year: number; term_number: number },
    firstOn: string,
  ) =>
    (
      await db
        .insertInto('equipping_classes')
        .values({
          level: 'LIFE_CLASS',
          ...term,
          name,
          day_of_week: 4,
          time_of_day: '19:00',
          first_lesson_on: firstOn,
          teacher_person_id: teacher.personId,
          encounter_season_id: seasonId,
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** One lesson of another class, saved with the given students marked as having come. */
  const lessonOf = async (cls: string, firstOn: string, n: number, came: string[]) => {
    const id = (
      await db
        .insertInto('equipping_lessons')
        .values({
          class_id: cls,
          lesson: n,
          held_on: expectedOn(firstOn, n),
          recorded_by: teacher.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    for (const enrollmentId of came) {
      await db
        .insertInto('equipping_marks')
        .values({ lesson_id: id, enrollment_id: enrollmentId, came: true, recorded_by: teacher.id })
        .execute();
    }
    return id;
  };

  const currentMarkOf = (lessonId: string, enrollmentId: string) =>
    db
      .selectFrom('equipping_marks')
      .select('came')
      .where('lesson_id', '=', lessonId)
      .where('enrollment_id', '=', enrollmentId)
      .where('superseded_at', 'is', null)
      .executeTakeFirst();

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

  it('ends a Not yet made Not passed, as posting ends any other (point 10)', async () => {
    await posted();
    const { student: dino } = await studentOf('Dino');
    const preview = await get(
      admin,
      `equipping/final-grades/grades/${dino.final_grade_id}/change-preview?lesson=3&to=ABSENT`,
    ).expect(200);
    expect(preview.body).toMatchObject({
      grade_before: 'NOT_YET',
      grade_after: 'NOT_PASSED',
      enrollment: 'ENDS',
      encounter_change: null,
    });
    await change(
      admin,
      dino,
      { lesson: 3, to: 'ABSENT' },
      { why: 'RECORDED_WRONGLY', details: 'He was away that week.' },
    ).expect(201);
    expect((await studentOf('Dino')).student).toMatchObject({
      grade: 'NOT_PASSED',
      reason: 'L3 not made up.',
    });
    const enrollment = await db
      .selectFrom('equipping_enrollments')
      .select(['ended_at', 'end_reason'])
      .where('id', '=', enrollmentOf.get('Dino')!)
      .executeTakeFirstOrThrow();
    expect(enrollment.end_reason).toBe('COMPLETED');
    const row = await db
      .selectFrom('equipping_grade_changes')
      .select(['enrollment_effect', 'grade_before', 'grade_after'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      enrollment_effect: 'ENDS',
      grade_before: 'NOT_YET',
      grade_after: 'NOT_PASSED',
    });
    const audit = await db
      .selectFrom('audit_log')
      .select('target_id')
      .where('action', '=', 'equipping_enrollment.ended')
      .where('target_id', '=', personOf.get('Dino')!)
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('reopens a finished student made Not yet, who then passes at a later Encounter (points 10 and 14)', async () => {
    await posted();
    // Carlo is posted Not passed, L7 not made up, his Encounter attended; corrected since to not
    // attended. Making L7 up makes him Not yet, worked from the Encounter as it stands.
    await correctEncounter('Carlo', false);
    const { student: carlo } = await studentOf('Carlo');
    expect((carlo as unknown as { encounter_change: unknown }).encounter_change).toEqual({
      before: 'CAME',
      now: 'MISSED',
    });
    const today = await manilaToday();
    const preview = await get(
      admin,
      `equipping/final-grades/grades/${carlo.final_grade_id}/change-preview?lesson=7&to=MADE_UP&made_up_on=${today}`,
    ).expect(200);
    expect(preview.body).toMatchObject({
      grade_before: 'NOT_PASSED',
      grade_after: 'NOT_YET',
      enrollment: 'REOPENS',
      encounter_change: { before: 'CAME', now: 'MISSED' },
      training: null,
    });
    await change(admin, carlo, { lesson: 7, to: 'MADE_UP', made_up_on: today }).expect(201);
    const enrollment = await db
      .selectFrom('equipping_enrollments')
      .select(['ended_at', 'end_reason'])
      .where('id', '=', enrollmentOf.get('Carlo')!)
      .executeTakeFirstOrThrow();
    expect(enrollment).toEqual({ ended_at: null, end_reason: null });
    const after = (await studentOf('Carlo')).student as unknown as Student & {
      history: { encounter_change: unknown; enrollment: unknown }[];
    };
    expect(after.grade).toBe('NOT_YET');
    expect(after.history[0]).toMatchObject({
      encounter_change: { before: 'CAME', now: 'MISSED' },
      enrollment: 'REOPENS',
    });
    expect(
      await db
        .selectFrom('audit_log')
        .select('action')
        .where('action', '=', 'equipping_enrollment.reopened')
        .execute(),
    ).toHaveLength(1);
    // Reopened, he passes at a later weekend as any Not yet does (decision 0509).
    const weekend = await passAtLaterEncounter('Carlo');
    expect(await lifeClassOf('Carlo')).toEqual([
      { graduated_on: weekend, from_school: true, superseded_at: null },
    ]);
    const passed = await db
      .selectFrom('equipping_final_grades')
      .select('passed_later_at')
      .where('id', '=', carlo.final_grade_id)
      .executeTakeFirstOrThrow();
    expect(passed.passed_later_at).not.toBeNull();
  });

  it('lets the Registrar withdraw one reopened as Not yet, as any Not yet', async () => {
    await posted();
    await correctEncounter('Carlo', false);
    const { student: carlo } = await studentOf('Carlo');
    await change(admin, carlo, {
      lesson: 7,
      to: 'MADE_UP',
      made_up_on: await manilaToday(),
    }).expect(201);
    // Recorded before the reopening: the end it cleared is kept in the audit entry.
    const reopened = await db
      .selectFrom('audit_log')
      .select('before')
      .where('action', '=', 'equipping_enrollment.reopened')
      .executeTakeFirstOrThrow();
    expect(reopened.before).toMatchObject({ end_reason: 'COMPLETED' });
    await post(registrar, `equipping/enrollments/${enrollmentOf.get('Carlo')!}/withdraw`, {
      reason: 'Moved to another church.',
    }).expect(200);
  });

  it('changes one who passed at a later Encounter, withdrawing the Life Class it filed (point 10)', async () => {
    await posted();
    const weekend = await passAtLaterEncounter('Dino');
    const { student: dino } = await studentOf('Dino');
    const preview = await get(
      admin,
      `equipping/final-grades/grades/${dino.final_grade_id}/change-preview?lesson=8&to=ABSENT`,
    ).expect(200);
    expect(preview.body).toMatchObject({
      grade_before: 'NOT_YET',
      grade_after: 'NOT_PASSED',
      training: 'WITHDRAWS',
      enrollment: null,
      encounter_change: { before: 'NOT_CAME', now: 'CAME' },
    });
    await change(
      admin,
      dino,
      { lesson: 8, to: 'ABSENT' },
      { why: 'RECORDED_WRONGLY', details: 'He was away at L8.' },
    ).expect(201);
    expect((await studentOf('Dino')).student.grade).toBe('NOT_PASSED');
    const rows = await lifeClassOf('Dino');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ graduated_on: weekend, from_school: true });
    expect(rows[0].superseded_at).not.toBeNull();
    // Training's evidence names nothing for a pass changed away, so a withdrawn tick is not
    // replaced by it (decision 0509, point 8).
    const evidence = await db
      .transaction()
      .execute((trx) =>
        app.get(SchoolEvidenceAdapter).evidenceWithin(trx, [personOf.get('Dino')!], 'LIFE_CLASS'),
      );
    expect(evidence).toEqual([]);
  });

  it('withdraws the weekend’s Life Class after a pass kept by one change and lost by the next', async () => {
    await posted();
    const weekend = await passAtLaterEncounter('Dino');
    // A make-up's day noted for one who passed later keeps him passing, now as Passed.
    const first = (await studentOf('Dino')).student;
    await change(
      admin,
      first,
      { lesson: 3, to: 'MADE_UP', made_up_on: await manilaToday() },
      { why: 'RECORDED_WRONGLY', details: 'Watched L3 later.' },
    ).expect(201);
    const second = (await studentOf('Dino')).student;
    expect(second.grade).toBe('PASSED');
    expect(await lifeClassOf('Dino')).toEqual([
      { graduated_on: weekend, from_school: true, superseded_at: null },
    ]);
    await change(
      admin,
      second,
      { lesson: 8, to: 'ABSENT' },
      { why: 'RECORDED_WRONGLY', details: 'Away at L8.' },
    ).expect(201);
    const rows = await lifeClassOf('Dino');
    expect(rows).toHaveLength(1);
    expect(rows[0].superseded_at).not.toBeNull();
  });

  it('leaves a Not yet withdrawn since posting withdrawn, whatever is changed (point 10)', async () => {
    await posted();
    await post(registrar, `equipping/enrollments/${enrollmentOf.get('Dino')!}/withdraw`, {
      reason: 'Moving abroad.',
    }).expect(200);
    const { student: dino } = await studentOf('Dino');
    await change(
      admin,
      dino,
      { lesson: 3, to: 'MADE_UP', made_up_on: await manilaToday() },
      { why: 'RECORDED_WRONGLY', details: 'Watched L3 later.' },
    ).expect(201);
    expect((await studentOf('Dino')).student.grade).toBe('NOT_YET');
    const enrollment = await db
      .selectFrom('equipping_enrollments')
      .select(['end_reason', 'withdraw_note'])
      .where('id', '=', enrollmentOf.get('Dino')!)
      .executeTakeFirstOrThrow();
    expect(enrollment).toEqual({ end_reason: 'WITHDRAWN', withdraw_note: 'Moving abroad.' });
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
    // Registered for the level in a later term, which rests on this grade: refused first.
    expect(refused.body.error.message).toContain('later term');
    expect((await studentOf('Eli')).student.changeable.why).toContain('later term');
    // The database keeps the flag of a grade a later class carries from, whatever the route.
    const current = await db
      .selectFrom('equipping_current_grades')
      .select(['grade', 'reason'])
      .where('final_grade_id', '=', eli.final_grade_id)
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('equipping_grade_changes')
        .values({
          final_grade_id: eli.final_grade_id,
          lesson: 7,
          sign_before: 'MADE_UP',
          made_up_on_before: firstLesson,
          sign_after: 'CAME',
          made_up_on_after: null,
          why: 'RECORDED_WRONGLY',
          details: 'He came to L7.',
          grade_before: current.grade,
          reason_before: current.reason,
          grade_after: 'PASSED',
          reason_after: 'Every lesson done.',
          lessons_kept_after: 9,
          lessons_made_up_after: 3,
          joins_at_lesson_6_after: false,
          encounter_before: 'CAME',
          encounter_after: 'CAME',
          changed_by: admin.id,
        })
        .execute(),
    ).rejects.toThrow(/joined a later class at Lesson 6/);
  });

  it('refuses a change once the person has registered for the level in a later term', async () => {
    await posted();
    await db
      .insertInto('equipping_registrations')
      .values({
        level: 'LIFE_CLASS',
        term_year: 2027,
        term_number: 1,
        person_id: personOf.get('Carlo')!,
        bible_confirmed: true,
        manual_confirmed: true,
        registered_by: registrar.id,
      })
      .execute();
    const { student: carlo } = await studentOf('Carlo');
    expect(carlo.changeable.lessons).toEqual([]);
    const refused = await change(admin, carlo, { lesson: 7, to: 'CAME' }).expect(409);
    expect(refused.body.error.message).toContain('later term');
    expect(refused.body.error.message).toContain('Cancel that registration first');
  });

  it('counts a merged record’s later registration, and changes once it is cancelled (point 15)', async () => {
    await posted();
    // Carlo was also recorded as Carlito, who registered for next term; the two are merged.
    const carlito = await createPerson(db, { firstName: 'Carlito', network: 'MENS' });
    const later = await register(carlito.id, { term_year: 2027, term_number: 1 });
    await db
      .updateTable('persons')
      .set({
        merged_into_id: personOf.get('Carlo')!,
        merged_at: new Date(),
        merge_reason: 'Recorded twice',
      })
      .where('id', '=', carlito.id)
      .execute();
    const { student: carlo } = await studentOf('Carlo');
    expect(carlo.changeable.why).toContain('later term');
    await change(admin, carlo, { lesson: 7, to: 'CAME' }).expect(409);
    await db
      .updateTable('equipping_registrations')
      .set({
        cancelled_at: new Date(),
        cancelled_by: registrar.id,
        cancel_reason: 'Passed after all',
      })
      .where('id', '=', later)
      .execute();
    await change(admin, carlo, { lesson: 7, to: 'CAME' }).expect(201);
  });

  it('gives the history to the Registrar and the Admin, not the Coordinator', async () => {
    await posted();
    const { student: carlo } = await studentOf('Carlo');
    await change(admin, carlo, { lesson: 7, to: 'CAME' }).expect(201);
    expect((await studentOf('Carlo', registrar)).student.history).toHaveLength(1);
    const coordinatorRead = (
      await get(coordinator, `equipping/coordinate/classes/${classId}/grades`).expect(200)
    ).body as { may_change: boolean; students: Student[] };
    expect(coordinatorRead.may_change).toBe(false);
    const coordinatorCarlo = coordinatorRead.students.find(first('Carlo'))!;
    expect(coordinatorCarlo.history).toBeUndefined();
    expect(coordinatorCarlo.changes_seen).toBeUndefined();
  });

  it('works from an Encounter corrected after posting, and says so (point 14)', async () => {
    await posted();
    const { student: ben } = await studentOf('Ben');
    // Ben's Encounter corrected to not attended after posting: his grade stands Passed.
    await correctEncounter('Ben', false);
    await change(
      admin,
      ben,
      { lesson: 3, to: 'ABSENT' },
      { why: 'RECORDED_WRONGLY', details: 'Ticked by mistake.' },
    ).expect(201);
    const after = (await studentOf('Ben')).student as unknown as Student & {
      history: { encounter_change: unknown }[];
    };
    expect(after.grade).toBe('NOT_PASSED');
    expect(after.history[0].encounter_change).toEqual({ before: 'CAME', now: 'MISSED' });
    const rows = await lifeClassOf('Ben');
    expect(rows[0].superseded_at).not.toBeNull();
  });

  it('admits a register write in a posted class for a student its posting did not grade', async () => {
    // Fidel was in the class and left it before posting, as a moved student does: the posting
    // graded nobody under his enrollment, so a make-up of a lesson he missed there is recorded
    // from his new class without any grade change (decision 0512).
    const fidel = await createPerson(db, {
      firstName: 'Fidel',
      network: 'MENS',
      birthDate: '1990-02-01',
    });
    await assignTo(db, fidel.id, ramon.id);
    const reg = (
      await db
        .insertInto('equipping_registrations')
        .values({
          ...TERM,
          person_id: fidel.id,
          bible_confirmed: true,
          manual_confirmed: true,
          registered_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const fidelEnrollment = (
      await db
        .insertInto('equipping_enrollments')
        .values({ registration_id: reg, class_id: classId, started_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    enrollmentOf.set('Fidel', fidelEnrollment);
    await term();
    enrollmentOf.delete('Fidel');
    await db
      .updateTable('equipping_enrollments')
      .set({ ended_at: new Date(), ended_by: registrar.id, end_reason: 'MOVED' })
      .where('id', '=', fidelEnrollment)
      .execute();
    await check(coordinator);
    await post(registrar, `equipping/final-grades/classes/${classId}/post`).expect(200);

    const lessonSeven = await db
      .selectFrom('equipping_lessons')
      .select('id')
      .where('class_id', '=', classId)
      .where('lesson', '=', 7)
      .executeTakeFirstOrThrow();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('equipping_marks')
        .set({ superseded_at: new Date(), superseded_by: admin.id })
        .where('lesson_id', '=', lessonSeven.id)
        .where('enrollment_id', '=', fidelEnrollment)
        .where('superseded_at', 'is', null)
        .execute();
      await trx
        .insertInto('equipping_marks')
        .values({
          lesson_id: lessonSeven.id,
          enrollment_id: fidelEnrollment,
          came: false,
          recorded_by: admin.id,
        })
        .execute();
      await trx
        .insertInto('equipping_make_ups')
        .values({
          lesson_id: lessonSeven.id,
          enrollment_id: fidelEnrollment,
          made_up_on: await manilaToday(),
          recorded_by: admin.id,
        })
        .execute();
    });
  });

  it('changes a lesson recorded in a class the student left this term, in that class (point 11)', async () => {
    // Fidel starts in Life Class A, is moved to Life Class B after L4, and B is posted.
    const fidel = await createPerson(db, {
      firstName: 'Fidel',
      network: 'MENS',
      birthDate: '1990-02-01',
    });
    await assignTo(db, fidel.id, ramon.id);
    personOf.set('Fidel', fidel.id);
    const reg = await register(fidel.id, TERM);
    const inA = (
      await db
        .insertInto('equipping_enrollments')
        .values({ registration_id: reg, class_id: classId, started_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await startBefore(inA, firstLesson);
    enrollmentOf.set('Fidel', inA);
    await lesson(1);
    const lessonTwoOfA = (await lesson(2)).id;
    await lesson(3);
    await lesson(4);
    enrollmentOf.delete('Fidel');
    await db
      .updateTable('equipping_enrollments')
      .set({ ended_at: new Date(), ended_by: registrar.id, end_reason: 'MOVED' })
      .where('id', '=', inA)
      .execute();
    const classB = await otherClass('Life Class B', TERM, firstLesson);
    const inB = (
      await db
        .insertInto('equipping_enrollments')
        .values({ registration_id: reg, class_id: classB, started_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await startBefore(inB, expectedOn(firstLesson, 6));
    for (const n of [1, 2, 3, 4]) {
      await lessonOf(classB, firstLesson, n, []);
    }
    for (const n of [6, 7, 8, 9]) {
      await lessonOf(classB, firstLesson, n, [inB]);
    }
    enrollmentOf.set('Fidel', inB);
    await attended('Fidel');
    classId = classB;
    await check(coordinator);
    await post(registrar, `equipping/final-grades/classes/${classB}/post`).expect(200);

    const { student } = await studentOf('Fidel');
    expect(student.grade).toBe('PASSED');
    const two = student.changeable.lessons.find((l) => l.lesson === 2)!;
    expect(two).toMatchObject({ recorded_in: 'Life Class A', kept: false });
    await change(
      admin,
      student,
      { lesson: 2, to: 'ABSENT' },
      { why: 'RECORDED_WRONGLY', details: 'Away at L2 in Life Class A.' },
    ).expect(201);
    expect((await studentOf('Fidel')).student).toMatchObject({
      grade: 'NOT_PASSED',
      reason: 'L2 not made up.',
    });
    // Written in Life Class A's register, under the enrollment there.
    expect(await currentMarkOf(lessonTwoOfA, inA)).toEqual({ came: false });
  });

  it('changes a lesson kept from an earlier term only where lessons 1 to 4 stay done (point 12)', async () => {
    await posted();
    // Eli is posted Not passed, joining a later class at Lesson 6 with lessons 1 to 4 kept, L1
    // and L2 made up. He joins Life Class B next term, which is posted Passed.
    const reg = await register(personOf.get('Eli')!, { term_year: 2027, term_number: 1 });
    const later = { term_year: 2027, term_number: 1 };
    const classB = await otherClass('Life Class B', later, firstLesson);
    const inB = (
      await db
        .insertInto('equipping_enrollments')
        .values({
          registration_id: reg,
          class_id: classB,
          started_by: registrar.id,
          carried_from_enrollment_id: enrollmentOf.get('Eli')!,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await startBefore(inB, firstLesson);
    for (const n of [1, 2, 3, 4]) {
      await lessonOf(classB, firstLesson, n, []);
    }
    for (const n of [6, 7, 8, 9]) {
      await lessonOf(classB, firstLesson, n, [inB]);
    }
    const inA = enrollmentOf.get('Eli')!;
    const classA = classId;
    classId = classB;
    await check(coordinator);
    await post(registrar, `equipping/final-grades/classes/${classB}/post`).expect(200);

    const { student: eli } = await studentOf('Eli');
    expect(eli.grade).toBe('PASSED');
    const three = eli.changeable.lessons.find((l) => l.lesson === 3)!;
    expect(three.kept).toBe(true);
    // Absent would undo what let him join at Lesson 6: refused.
    const absent = await change(
      admin,
      eli,
      { lesson: 4, to: 'ABSENT' },
      { why: 'RECORDED_WRONGLY', details: 'Away at L4.' },
    ).expect(409);
    expect(absent.body.error.message).toContain('undo that join');
    // So would a third of lessons 1 to 4 missed, made up or not: L1 and L2 already are.
    const today = await manilaToday();
    const third = await change(
      admin,
      eli,
      { lesson: 3, to: 'MADE_UP', made_up_on: today },
      { why: 'RECORDED_WRONGLY', details: 'Watched L3 later, not in the room.' },
    ).expect(409);
    expect(third.body.error.message).toContain('undo that join');
    // Came rather than made up would leave last term with three absences, passing: refused too.
    const passing = await change(
      admin,
      eli,
      { lesson: 1, to: 'CAME' },
      { why: 'RECORDED_WRONGLY', details: 'He was there for L1.' },
    ).expect(409);
    expect(passing.body.error.message).toContain('undo that join');
    // A make-up's day corrected keeps it: written in Life Class A's register, still Passed.
    const lessonOneOfA = await db
      .selectFrom('equipping_lessons')
      .select('id')
      .where('class_id', '=', classA)
      .where('lesson', '=', 1)
      .executeTakeFirstOrThrow();
    await change(
      admin,
      eli,
      { lesson: 1, to: 'MADE_UP', made_up_on: today },
      { why: 'RECORDED_WRONGLY', details: 'Made up later than recorded.' },
    ).expect(201);
    expect((await studentOf('Eli')).student.grade).toBe('PASSED');
    const madeUp = await db
      .selectFrom('equipping_make_ups')
      .select('made_up_on')
      .where('lesson_id', '=', lessonOneOfA.id)
      .where('enrollment_id', '=', inA)
      .where('superseded_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(String(madeUp.made_up_on)).toBe(today);
  });

  it('does not enroll a registration graded Passed or Not passed again (point 16)', async () => {
    await posted();
    const benReg = await db
      .selectFrom('equipping_enrollments')
      .select('registration_id')
      .where('id', '=', enrollmentOf.get('Ben')!)
      .executeTakeFirstOrThrow();
    const classC = await otherClass('Life Class C', TERM, plusDays(await manilaToday(), 7));
    const refused = await post(admin, `equipping/classes/${classC}/enrollments`, {
      registration_ids: [benReg.registration_id],
    }).expect(409);
    expect(JSON.stringify(refused.body)).toContain('already graded');
    await expect(
      db
        .insertInto('equipping_enrollments')
        .values({
          registration_id: benReg.registration_id,
          class_id: classC,
          started_by: registrar.id,
        })
        .execute(),
    ).rejects.toThrow(/not enrolled again/);
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
