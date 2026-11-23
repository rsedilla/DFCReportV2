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
 * A class's final grades at the API (SKILL.md section 29, decisions 0501 and 0508).
 *
 * What is pinned, each from the rulings:
 *
 *   - the grade is worked out from the register: Passed, Not passed with the reason, or Not yet
 *     for a student still to attend the Encounter (0501, points 13 to 15; 0508);
 *   - the Coordinator checks a class once every lesson is recorded, the Admin checking the
 *     Coordinator's own disciples, and a register changed since makes the check stale (point 16);
 *   - the Registrar posts only a checked class, once, which records each grade and ends the
 *     enrollments that finished; a Not yet stays enrolled;
 *   - each route is its holder's alone.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('Final grades (section 29, decisions 0501 and 0508)', () => {
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

  interface Read {
    status: { phase: string; missing_lessons: number[]; disciples_for_admin: number };
    students: {
      enrollment_id: string;
      person: { full_name: string };
      grade: string;
      reason: string;
      lessons_kept: number;
      lessons_made_up: number;
      your_disciple: boolean;
    }[];
  }

  const read = async (account: TestAccount = registrar) =>
    (await get(account, `equipping/final-grades/classes/${classId}`).expect(200)).body as Read;

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

  it('is not ready, and is refused a check, until every lesson is recorded', async () => {
    await lesson(1);
    const r = await read();
    expect(r.status.phase).toBe('NOT_READY');
    expect(r.status.missing_lessons).toEqual([2, 3, 4, 6, 7, 8, 9]);
    const refused = await check(coordinator, 409);
    expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('works out each grade from the register', async () => {
    await term();
    const r = await read();
    expect(r.status.phase).toBe('WAITING_COORDINATOR');
    expect(r.students.find(first('Ben'))).toMatchObject({
      grade: 'PASSED',
      reason: 'Every lesson done.',
      lessons_kept: 9,
    });
    expect(r.students.find(first('Carlo'))).toMatchObject({
      grade: 'NOT_PASSED',
      reason: 'L7 not made up.',
    });
    expect(r.students.find(first('Dino'))).toMatchObject({
      grade: 'NOT_YET',
      reason: 'Encounter not attended. Passes after a later one.',
      lessons_kept: 8,
    });
    expect(r.students.find(first('Eli'))).toMatchObject({
      grade: 'NOT_PASSED',
      reason: '4 absences, over the 3 allowed. Joins a later class at lesson 6.',
      lessons_made_up: 4,
    });
  });

  it('posts a checked class once, ending the finished enrollments and keeping a Not yet', async () => {
    await term();
    await post(registrar, `equipping/final-grades/classes/${classId}/post`).expect(409);
    await check(coordinator);
    expect((await read()).status.phase).toBe('READY');

    const posted = await post(registrar, `equipping/final-grades/classes/${classId}/post`).expect(
      200,
    );
    expect(posted.body).toMatchObject({ passed: 1, not_passed: 2, not_yet: 1 });
    const enrollments = await db
      .selectFrom('equipping_enrollments')
      .select(['id', 'end_reason'])
      .execute();
    const reasonOf = new Map(enrollments.map((row) => [row.id, row.end_reason]));
    expect(reasonOf.get(enrollmentOf.get('Ben')!)).toBe('COMPLETED');
    expect(reasonOf.get(enrollmentOf.get('Carlo')!)).toBe('COMPLETED');
    expect(reasonOf.get(enrollmentOf.get('Dino')!)).toBeNull();

    const after = await read();
    expect(after.status.phase).toBe('POSTED');
    expect(after.students).toHaveLength(4);
    await post(registrar, `equipping/final-grades/classes/${classId}/post`).expect(409);
    const audit = await db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'equipping_final_grade.posted')
      .execute();
    expect(audit).toHaveLength(4);
  });

  it('waits for the Admin when a student is the Coordinator’s own disciple', async () => {
    await term();
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: sql`now()` })
      .where('person_id', '=', personOf.get('Ben')!)
      .where('ended_at', 'is', null)
      .execute();
    await assignTo(db, personOf.get('Ben')!, lito.id);

    const seen = (
      await get(coordinator, `equipping/coordinate/classes/${classId}/grades`).expect(200)
    ).body as Read;
    expect(seen.students.find(first('Ben'))!.your_disciple).toBe(true);
    await check(coordinator);
    expect((await read()).status).toMatchObject({ phase: 'WAITING_ADMIN', disciples_for_admin: 1 });
    await check(admin);
    expect((await read()).status.phase).toBe('READY');
  });

  it('needs checking again once the register changes after a check', async () => {
    const nine = await term();
    await check(coordinator);
    expect((await read()).status.phase).toBe('READY');
    // The Teacher records Carlo's make-up of lesson 7 after the check.
    const seven = await db
      .selectFrom('equipping_lessons')
      .select('id')
      .where('class_id', '=', classId)
      .where('lesson', '=', 7)
      .executeTakeFirstOrThrow();
    await makeUp(seven.id, 'Carlo', nine.heldOn);
    const r = await read();
    expect(r.status.phase).toBe('WAITING_COORDINATOR');
    expect(r.students.find(first('Carlo'))!.grade).toBe('PASSED');
  });

  it('fails three of lessons 1 to 4 missed, made up or not', async () => {
    await lesson(1, ['Ben'], ['Ben']);
    await lesson(2, ['Ben'], ['Ben']);
    await lesson(3, ['Ben'], ['Ben']);
    await lesson(4);
    await lesson(6);
    await lesson(7);
    await lesson(8);
    await lesson(9);
    expect((await read()).students.find(first('Ben'))).toMatchObject({
      grade: 'NOT_PASSED',
      reason: '3 absences in lessons 1 to 4. Repeats Life Class.',
    });
  });

  it('refuses a check of a register changed since it was read', async () => {
    const nine = await term();
    const seen = (
      await get(coordinator, `equipping/coordinate/classes/${classId}/grades`).expect(200)
    ).body as { fingerprint: string };
    const seven = await db
      .selectFrom('equipping_lessons')
      .select('id')
      .where('class_id', '=', classId)
      .where('lesson', '=', 7)
      .executeTakeFirstOrThrow();
    await makeUp(seven.id, 'Carlo', nine.heldOn);
    const refused = await post(coordinator, `equipping/coordinate/classes/${classId}/check`, {
      fingerprint: seen.fingerprint,
    }).expect(409);
    expect(refused.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('keeps a posted class final: no lesson saved, and nobody joins it', async () => {
    await term();
    await check(coordinator);
    await post(registrar, `equipping/final-grades/classes/${classId}/post`).expect(200);
    const saved = await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: expectedOn(firstLesson, 9),
      came: [],
      version: 1,
    }).expect(409);
    expect(saved.body.error.message).toMatch(/posted/);
    const fred = await createPerson(db, {
      firstName: 'Fred',
      network: 'MENS',
      birthDate: '1990-02-01',
    });
    const reg = (
      await db
        .insertInto('equipping_registrations')
        .values({
          ...TERM,
          person_id: fred.id,
          bible_confirmed: true,
          manual_confirmed: true,
          registered_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const refused = await post(registrar, `equipping/classes/${classId}/enrollments`, {
      registration_ids: [reg],
    }).expect(409);
    expect(refused.body.error.message).toMatch(/posted/);
    const ended = await db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'equipping_enrollment.ended')
      .execute();
    expect(ended).toHaveLength(3);
  });

  it('lets a student posted Not yet be withdrawn, and nobody else', async () => {
    await term();
    await check(coordinator);
    await post(registrar, `equipping/final-grades/classes/${classId}/post`).expect(200);
    await post(registrar, `equipping/enrollments/${enrollmentOf.get('Dino')}/withdraw`, {
      reason: 'Moved abroad before a later Encounter.',
    }).expect(200);
  });

  it('gives each route to its holder alone', async () => {
    await term();
    await get(teacher, `equipping/final-grades/classes/${classId}`).expect(403);
    await post(registrar, `equipping/coordinate/classes/${classId}/check`).expect(403);
    await post(coordinator, `equipping/final-grades/classes/${classId}/post`).expect(403);
    await get(
      registrar,
      `equipping/final-grades?${new URLSearchParams({
        level: 'LIFE_CLASS',
        term_year: '2026',
        term_number: '3',
      }).toString()}`,
    ).expect(200);
  });

  it('refuses a rewrite of a posted grade, in the database', async () => {
    await term();
    await check(coordinator);
    await post(registrar, `equipping/final-grades/classes/${classId}/post`).expect(200);
    await expect(
      db.updateTable('equipping_final_grades').set({ grade: 'PASSED' }).execute(),
    ).rejects.toThrow(/kept as written/);
    await expect(db.deleteFrom('equipping_class_postings').execute()).rejects.toThrow(
      /kept as written/,
    );
  });
});
