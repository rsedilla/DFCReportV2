import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { expectedOn } from '../../src/equipping/equipping-attendance.service';
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
 * A class's attendance and make-ups at the API (SKILL.md section 29, decisions 0501 and 0503).
 *
 * What is pinned, each from the rulings:
 *
 *   - the Teacher ticks who came; anyone enrolled and not ticked is saved Absent (0501, point 10);
 *   - lessons are 1 to 4 and 6 to 9, expected weekly from the first lesson, and the Teacher may
 *     record one on another day, never one still to come (0503);
 *   - the Teacher corrects while the week is open; after it closes only the Admin does, with a
 *     reason (0501, point 11); a correction keeps what it corrects (principle 12);
 *   - a make-up is of a missed lesson, recorded as M with its date (0501, point 12);
 *   - a Guide sees their own students and records nothing; the Coordinator sees the whole class.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('Class attendance (section 29, decisions 0501 and 0503)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let coordinator: TestAccount;
  let teacher: TestAccount;
  let guide: TestAccount;
  let bystander: TestAccount;
  let ramon: TestPerson;
  let mario: TestPerson;
  let pedro: TestPerson;
  let seasonId: string;
  let classId: string;
  let today: string;
  /** A first lesson long enough ago that lesson 1's week has closed. */
  let firstLesson: string;

  const TERM = { level: 'LIFE_CLASS', term_year: 2026, term_number: 3 };

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

  interface Read {
    role: string;
    may_record: boolean;
    lessons: {
      lesson: number;
      expected_on: string;
      held_on: string | null;
      version: number | null;
      state: string;
      open: boolean;
    }[];
    students: {
      enrollment_id: string;
      person: { full_name: string };
      cell_leader: { full_name: string } | null;
      guide: { full_name: string } | null;
      marks: { lesson: number; came: boolean; made_up_on: string | null }[];
    }[];
    owed: { enrollment_id: string; lesson: number }[];
  }

  const read = async (account: TestAccount) =>
    (await get(account, `equipping/classes/${classId}/attendance`).expect(200)).body as Read;

  /** Registered and enrolled into the class, each under Ramon with a birthday. */
  const enrol = async (names: string[]) => {
    const ids: string[] = [];
    for (const name of names) {
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
      ids.push((reg.body as { id: string }).id);
    }
    await post(admin, `equipping/classes/${classId}/enrollments`, { registration_ids: ids }).expect(
      201,
    );
  };

  const idsByName = async () => {
    const r = await read(teacher);
    return new Map(r.students.map((s) => [s.person.full_name.split(' ')[0], s.enrollment_id]));
  };

  beforeEach(async () => {
    await truncateAll(db);
    today = (
      await sql<{ d: string }>`SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text AS d`.execute(
        db,
      )
    ).rows[0].d;
    // Eight weeks ago, so lesson 9 is expected today and its week is open, while lesson 1's
    // week closed long since (decision 0503: a lesson's week is first its expected date's).
    const back = new Date(`${today}T00:00:00Z`);
    back.setUTCDate(back.getUTCDate() - 56);
    firstLesson = back.toISOString().slice(0, 10);

    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    mario = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mario.id, ramon.id);
    await createCell(db, { leader: mario });
    pedro = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
    await assignTo(db, pedro.id, ramon.id);
    const lito = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
    await assignTo(db, lito.id, ramon.id);
    const nico = await createPerson(db, { firstName: 'Nico', network: 'MENS' });
    await assignTo(db, nico.id, ramon.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    coordinator = await createAccount(app, db, { person: lito, roles: ['LEADER'] });
    await post(admin, `accounts/${coordinator.id}/coordinates-life-class`, {
      coordinates_life_class: true,
    }).expect(200);
    teacher = await createAccount(app, db, { person: mario, roles: ['LEADER'] });
    guide = await createAccount(app, db, { person: pedro, roles: ['LEADER'] });
    bystander = await createAccount(app, db, { person: nico, roles: ['LEADER'] });

    await db
      .insertInto('training_graduations')
      .values({
        person_id: pedro.id,
        program: 'SOL_1',
        graduated_on: '2025-06-01',
        confirmed_by: ramon.id,
        recorded_by: admin.id,
      })
      .execute();
    seasonId = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: '2026-12-05',
          mens_encounter_on: '2027-01-09',
          womens_lc_party_on: '2026-12-12',
          womens_encounter_on: '2027-01-16',
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    classId = (
      (
        await post(coordinator, 'equipping/classes', {
          ...TERM,
          name: 'Life Class A',
          day_of_week: 2,
          time_of_day: '19:00',
          first_lesson_on: firstLesson,
          encounter_season_id: seasonId,
          teacher_person_id: mario.id,
        }).expect(201)
      ).body as { id: string }
    ).id;
    await enrol(['Ben', 'Carlo', 'Dino']);
    // Enrolled before the first lesson, as a class's students are: a student who joined after a
    // lesson is not marked for it (decision 0503), which the case below that enrols Eli pins.
    // No route backdates an enrollment and the history trigger refuses it, so the fixture lifts
    // the trigger inside one transaction, which restores it whatever happens.
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

  it('expects one lesson a week from the first, the Encounter taking lesson 5', () => {
    expect([1, 2, 4, 6, 9].map((n) => expectedOn('2027-01-05', n))).toEqual([
      '2027-01-05',
      '2027-01-12',
      '2027-01-26',
      '2027-02-09',
      '2027-03-02',
    ]);
  });

  it('saves who came, the rest Absent, and lists the class for its Teacher', async () => {
    const ids = await idsByName();
    const saved = await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben'), ids.get('Dino')],
    }).expect(200);
    expect(saved.body).toMatchObject({ lesson: 9, held_on: today, version: 1, came: 2, absent: 1 });

    const r = await read(teacher);
    expect(r.role).toBe('TEACHER');
    expect(r.may_record).toBe(true);
    const carlo = r.students.find((s) => s.person.full_name.startsWith('Carlo'))!;
    expect(carlo.marks).toEqual([
      expect.objectContaining({ lesson: 9, came: false, made_up_on: null }),
    ]);
    expect(r.owed).toEqual([
      expect.objectContaining({ enrollment_id: carlo.enrollment_id, lesson: 9 }),
    ]);
    expect(r.lessons.find((l) => l.lesson === 9)).toMatchObject({ state: 'SAVED', held_on: today });
    // Lesson 1's week closed long ago, and nobody recorded it.
    expect(r.lessons.find((l) => l.lesson === 1)).toMatchObject({
      state: 'NOT_RECORDED',
      open: false,
    });

    const mine = (await get(teacher, 'equipping/my-classes').expect(200)).body as {
      data: { id: string; role: string }[];
    };
    expect(mine.data).toEqual([expect.objectContaining({ id: classId, role: 'TEACHER' })]);
  });

  it('refuses lesson 5, a day still to come, a day before the first lesson, and a stranger ticked', async () => {
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await post(teacher, `equipping/classes/${classId}/lessons/5`, {
      held_on: today,
      came: [],
    }).expect(422);
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: tomorrow.toISOString().slice(0, 10),
      came: [],
    }).expect(422);
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: '2020-01-07',
      came: [],
    }).expect(422);
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [randomUUID()],
    }).expect(422);
  });

  it('corrects an open week against its version, keeping the mark it corrects', async () => {
    const ids = await idsByName();
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben')],
    }).expect(200);
    // A save without the version, or with a stale one, is refused.
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben'), ids.get('Carlo')],
    }).expect(409);
    const fixed = await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben'), ids.get('Carlo')],
      version: 1,
    }).expect(200);
    expect(fixed.body).toMatchObject({ version: 2, came: 2, absent: 1 });

    const carloMarks = await db
      .selectFrom('equipping_marks')
      .select(['came', 'superseded_at'])
      .where('enrollment_id', '=', ids.get('Carlo')!)
      .orderBy('recorded_at')
      .execute();
    expect(carloMarks.map((m) => [m.came, m.superseded_at !== null])).toEqual([
      [false, true],
      [true, false],
    ]);
    const entry = await db
      .selectFrom('audit_log')
      .select(['before', 'after'])
      .where('action', '=', 'equipping_lesson.corrected')
      .executeTakeFirstOrThrow();
    expect(entry.after).toMatchObject({ lesson: 9, marks: [{ came: true }] });

    // A save that changes nothing writes nothing, and keeps the version.
    const same = await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben'), ids.get('Carlo')],
      version: 2,
    }).expect(200);
    expect(same.body).toMatchObject({ version: 2 });
  });

  it('refuses the Teacher a closed week, and lets the Admin correct it with a reason', async () => {
    const ids = await idsByName();
    const lesson1 = expectedOn(firstLesson, 1);
    const closed = await post(teacher, `equipping/classes/${classId}/lessons/1`, {
      held_on: lesson1,
      came: [ids.get('Ben')],
    }).expect(409);
    expect((closed.body as { error: { code: string } }).error.code).toBe('PERIOD_CLOSED');
    await post(admin, `equipping/classes/${classId}/lessons/1`, {
      held_on: lesson1,
      came: [ids.get('Ben')],
    }).expect(422);
    await post(admin, `equipping/classes/${classId}/lessons/1`, {
      held_on: lesson1,
      came: [ids.get('Ben')],
      correction_reason: 'Recorded on paper; the Teacher had no phone that week.',
    }).expect(200);
    // An open week refuses a reason nobody asked for.
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [],
      correction_reason: 'Not needed.',
    }).expect(409);
  });

  it('does not reopen a closed week by dating a never-recorded lesson today, and keeps the Admin’s reason', async () => {
    const ids = await idsByName();
    // Lesson 1 was never recorded and its expected week has closed (decision 0503, point 1).
    const reopened = await post(teacher, `equipping/classes/${classId}/lessons/1`, {
      held_on: today,
      came: [ids.get('Ben')],
    }).expect(409);
    expect((reopened.body as { error: { code: string } }).error.code).toBe('PERIOD_CLOSED');

    const reason = 'Recorded on paper; the Teacher had no phone that week.';
    await post(admin, `equipping/classes/${classId}/lessons/1`, {
      held_on: expectedOn(firstLesson, 1),
      came: [ids.get('Ben')],
      correction_reason: reason,
    }).expect(200);
    // The reason is kept on every mark the first save wrote, and in its audit entry.
    const marks = await db
      .selectFrom('equipping_marks')
      .select('correction_reason')
      .where('superseded_at', 'is', null)
      .execute();
    expect(marks).toHaveLength(3);
    expect(marks.every((m) => m.correction_reason === reason)).toBe(true);
    const entry = await db
      .selectFrom('audit_log')
      .select('after')
      .where('action', '=', 'equipping_lesson.recorded')
      .executeTakeFirstOrThrow();
    expect(entry.after).toMatchObject({ lesson: 1, reason });
  });

  it('keeps a changed date, and refuses moving a lesson past a make-up already recorded', async () => {
    const ids = await idsByName();
    const day = (offset: number) => {
      const d = new Date(`${expectedOn(firstLesson, 8)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: day(0),
      came: [ids.get('Ben')],
    }).expect(200);
    await post(teacher, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: ids.get('Carlo'),
      lesson: 8,
      made_up_on: day(1),
    }).expect(201);
    const past = await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: day(2),
      came: [ids.get('Ben')],
      version: 1,
    }).expect(409);
    expect((past.body as { error: { details: { field: string } } }).error.details.field).toBe(
      'held_on',
    );
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: day(1),
      came: [ids.get('Ben')],
      version: 1,
    }).expect(200);
    const changes = await db
      .selectFrom('equipping_lesson_date_changes')
      .select(['held_on_before', 'held_on_after', 'reason'])
      .execute();
    expect(
      changes.map((c) => [String(c.held_on_before), String(c.held_on_after), c.reason]),
    ).toEqual([[day(0), day(1), null]]);
    await expect(sql`DELETE FROM equipping_lesson_date_changes`.execute(db)).rejects.toThrow(
      /kept as written/,
    );
  });

  it('refuses at the database a mark saying the student came while a make-up of it stands', async () => {
    const ids = await idsByName();
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben')],
    }).expect(200);
    await post(teacher, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: ids.get('Carlo'),
      lesson: 9,
      made_up_on: today,
    }).expect(201);
    const absent = await db
      .selectFrom('equipping_marks')
      .select(['id', 'lesson_id'])
      .where('enrollment_id', '=', ids.get('Carlo')!)
      .where('superseded_at', 'is', null)
      .executeTakeFirstOrThrow();
    // Recorded outside the transaction, so a database that admits the row fails the case rather
    // than having the failure swallowed with the rollback.
    let refusal: unknown = null;
    await db
      .transaction()
      .execute(async (trx) => {
        await trx
          .updateTable('equipping_marks')
          .set({ superseded_at: new Date(), superseded_by: teacher.id })
          .where('id', '=', absent.id)
          .execute();
        try {
          await trx
            .insertInto('equipping_marks')
            .values({
              lesson_id: absent.lesson_id,
              enrollment_id: ids.get('Carlo')!,
              came: true,
              recorded_by: teacher.id,
            })
            .execute();
        } catch (error) {
          refusal = error;
          throw error;
        }
      })
      .catch(() => undefined);
    expect(String(refusal)).toMatch(/not also attended/);
  });

  /** A day relative to lesson 8's expected day, which is a week ago and whose week is open. */
  const nearLesson8 = (offset: number) => {
    const d = new Date(`${expectedOn(firstLesson, 8)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  it('does not save Absent somebody who joined after a lesson, and owes it as a make-up', async () => {
    let ids = await idsByName();
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: nearLesson8(0),
      came: [ids.get('Ben')],
    }).expect(200);
    // Eli joins today, after lesson 8 was held (owner ruling of 2026-11-20).
    await enrol(['Eli']);
    ids = await idsByName();
    let r = await read(teacher);
    const eli = () => r.students.find((s) => s.enrollment_id === ids.get('Eli'))!;
    expect(eli().marks).toEqual([
      expect.objectContaining({ lesson: 8, came: false, made_up_on: null, before_joining: true }),
    ]);
    expect(r.owed).toContainEqual(
      expect.objectContaining({ enrollment_id: ids.get('Eli'), lesson: 8, before_joining: true }),
    );
    // A correction of lesson 8 leaves Eli unmarked, and refuses ticking him.
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: nearLesson8(0),
      came: [ids.get('Ben'), ids.get('Carlo')],
      version: 1,
    }).expect(200);
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: nearLesson8(0),
      came: [ids.get('Ben'), ids.get('Eli')],
      version: 2,
    }).expect(422);
    const eliMarks = await db
      .selectFrom('equipping_marks')
      .select('id')
      .where('enrollment_id', '=', ids.get('Eli')!)
      .execute();
    expect(eliMarks).toEqual([]);
    // Made up, with no absence behind it: the database admits it for a lesson before joining.
    await post(teacher, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: ids.get('Eli'),
      lesson: 8,
      made_up_on: today,
    }).expect(201);
    r = await read(teacher);
    expect(eli().marks).toEqual([
      expect.objectContaining({ lesson: 8, made_up_on: today, before_joining: true }),
    ]);

    // The class actually met today, the day he joined: he is ticked as having come, and the
    // make-up he no longer owes is closed rather than blocking the save.
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: today,
      came: [ids.get('Ben'), ids.get('Carlo'), ids.get('Eli')],
      version: 2,
    }).expect(200);
    r = await read(teacher);
    expect(eli().marks).toEqual([
      expect.objectContaining({ lesson: 8, came: true, made_up_on: null, before_joining: false }),
    ]);

    // Corrected back to before he joined: his mark is removed (closed and kept), and the lesson is
    // before joining again, not an absence (owner, 2026-11-21).
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: nearLesson8(0),
      came: [ids.get('Ben'), ids.get('Carlo')],
      version: 3,
    }).expect(200);
    r = await read(teacher);
    expect(eli().marks).toEqual([
      expect.objectContaining({ lesson: 8, came: false, made_up_on: null, before_joining: true }),
    ]);
    const removed = await db
      .selectFrom('audit_log')
      .select('after')
      .where('action', '=', 'equipping_lesson.corrected')
      .orderBy('occurred_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(removed.after).toMatchObject({ marks_removed: [expect.any(String)] });
  });

  it('carries a moved student’s marks, and makes up in the new class a lesson missed in the old', async () => {
    const ids = await idsByName();
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: nearLesson8(0),
      came: [ids.get('Ben'), ids.get('Carlo')],
    }).expect(200);
    // Lesson 9 today in A, before the move, which Carlo came to.
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben'), ids.get('Carlo')],
    }).expect(200);
    const classB = (
      (
        await post(coordinator, 'equipping/classes', {
          ...TERM,
          name: 'Life Class B',
          day_of_week: 4,
          time_of_day: '19:00',
          first_lesson_on: firstLesson,
          encounter_season_id: seasonId,
          teacher_person_id: mario.id,
        }).expect(201)
      ).body as { id: string }
    ).id;
    // Carlo came to lesson 8 in A; Dino missed it. Both move to B.
    const moved = new Map<string, string>();
    for (const name of ['Carlo', 'Dino']) {
      const res = await post(registrar, `equipping/enrollments/${ids.get(name)}/move`, {
        class_id: classB,
      }).expect(200);
      moved.set(
        name,
        (res.body as { enrollment_id?: string; id?: string }).enrollment_id ??
          (res.body as { id: string }).id,
      );
    }
    const inB = (await get(teacher, `equipping/classes/${classB}/attendance`).expect(200))
      .body as Read & {
      students: {
        person: { full_name: string };
        enrollment_id: string;
        marks: { from_class: { name: string } | null }[];
      }[];
    };
    const carlo = inB.students.find((s) => s.person.full_name.startsWith('Carlo'))!;
    const dino = inB.students.find((s) => s.person.full_name.startsWith('Dino'))!;
    expect(carlo.marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lesson: 8,
          came: true,
          from_class: expect.objectContaining({ name: 'Life Class A' }),
        }),
      ]),
    );
    expect(dino.marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lesson: 8,
          came: false,
          from_class: expect.objectContaining({ name: 'Life Class A' }),
        }),
      ]),
    );
    await post(teacher, `equipping/classes/${classB}/make-ups`, {
      enrollment_id: dino.enrollment_id,
      lesson: 8,
      made_up_on: today,
    }).expect(201);
    // Recorded against lesson 8 in A, where it was missed.
    const makeUp = await db
      .selectFrom('equipping_make_ups as u')
      .innerJoin('equipping_lessons as l', 'l.id', 'u.lesson_id')
      .select('l.class_id')
      .where('u.superseded_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(makeUp.class_id).toBe(classId);

    // B holds lesson 9 later the same day, after they joined. Carlo's mark from A stands, so B
    // neither marks him absent nor lets him be ticked again.
    const saved = await post(teacher, `equipping/classes/${classB}/lessons/9`, {
      held_on: today,
      came: [],
    }).expect(200);
    expect(saved.body).toMatchObject({ came: 0 });
    const carloInB = (await get(teacher, `equipping/classes/${classB}/attendance`).expect(200))
      .body as Read & {
      students: {
        person: { full_name: string };
        marks: { lesson: number; came: boolean; from_class: { name: string } | null }[];
      }[];
    };
    expect(
      carloInB.students
        .find((s) => s.person.full_name.startsWith('Carlo'))!
        .marks.find((m) => m.lesson === 9),
    ).toMatchObject({ came: true, from_class: { name: 'Life Class A' } });
    await post(teacher, `equipping/classes/${classB}/lessons/9`, {
      held_on: today,
      came: [carlo.enrollment_id],
      version: 1,
    }).expect(422);

    // One class at a time (owner, 2026-11-21). Dino missed lesson 9 in A and was not ticked in B,
    // so B wrote nothing for him and A's absence reads. He makes it up from B, against A's lesson.
    await post(teacher, `equipping/classes/${classB}/make-ups`, {
      enrollment_id: dino.enrollment_id,
      lesson: 9,
      made_up_on: today,
    }).expect(201);
    // He came to B's lesson 9 after all: B's mark reads first, and A's records are left as they were.
    await post(teacher, `equipping/classes/${classB}/lessons/9`, {
      held_on: today,
      came: [dino.enrollment_id],
      version: 1,
    }).expect(200);
    type Register = {
      students: {
        person: { full_name: string };
        marks: {
          lesson: number;
          came: boolean;
          made_up_on: string | null;
          from_class: { name: string } | null;
        }[];
      }[];
    };
    const dinoNine = async () =>
      (
        (await get(teacher, `equipping/classes/${classB}/attendance`).expect(200)).body as Register
      ).students
        .find((s) => s.person.full_name.startsWith('Dino'))!
        .marks.find((m) => m.lesson === 9);
    expect(await dinoNine()).toMatchObject({ came: true, from_class: null });
    const dinoReg = (
      await db
        .selectFrom('equipping_enrollments')
        .select('registration_id')
        .where('id', '=', dino.enrollment_id)
        .executeTakeFirstOrThrow()
    ).registration_id;
    const currentInA = await db
      .selectFrom('equipping_marks as m')
      .innerJoin('equipping_lessons as l', 'l.id', 'm.lesson_id')
      .innerJoin('equipping_enrollments as e', 'e.id', 'm.enrollment_id')
      .select(['m.came'])
      .where('l.lesson', '=', 9)
      .where('l.class_id', '=', classId)
      .where('e.registration_id', '=', dinoReg)
      .where('m.superseded_at', 'is', null)
      .execute();
    expect(currentInA).toEqual([{ came: false }]);

    // B's lesson 9 corrected to yesterday, before Dino joined B: B's mark is removed, and A's
    // lesson 9 reads again with the make-up he did, so nothing he did is lost.
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await post(teacher, `equipping/classes/${classB}/lessons/9`, {
      held_on: yesterday.toISOString().slice(0, 10),
      came: [],
      version: 2,
    }).expect(200);
    expect(await dinoNine()).toMatchObject({
      came: false,
      made_up_on: today,
      from_class: { name: 'Life Class A' },
    });
  });

  it('carries a make-up of a lesson held before they joined, and reads the class moved from last', async () => {
    type Register = Read & {
      students: {
        person: { full_name: string };
        enrollment_id: string;
        marks: {
          lesson: number;
          came: boolean;
          made_up_on: string | null;
          before_joining: boolean;
          from_class: { name: string } | null;
        }[];
      }[];
    };
    const yesterdayDate = new Date(`${today}T00:00:00Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);
    let ids = await idsByName();
    // A holds lessons 8 and 9 before Eli joins it. Dino misses lesson 9 there.
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: nearLesson8(0),
      came: [ids.get('Ben'), ids.get('Carlo'), ids.get('Dino')],
    }).expect(200);
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: nearLesson8(1),
      came: [ids.get('Ben'), ids.get('Carlo')],
    }).expect(200);
    await enrol(['Eli']);
    ids = await idsByName();
    // Eli joined A after both lessons, three days after lesson 8. No route backdates an
    // enrollment, so the fixture lifts the history trigger as `beforeEach` does.
    await db.transaction().execute(async (trx) => {
      await sql`ALTER TABLE equipping_enrollments DISABLE TRIGGER equipping_enrollments_history_kept`.execute(
        trx,
      );
      await sql`
        UPDATE equipping_enrollments
           SET started_at = ${nearLesson8(3)}::date::timestamp AT TIME ZONE 'Asia/Manila'
         WHERE id = ${ids.get('Eli')!}`.execute(trx);
      await sql`ALTER TABLE equipping_enrollments ENABLE TRIGGER equipping_enrollments_history_kept`.execute(
        trx,
      );
    });
    for (const lesson of [8, 9]) {
      await post(teacher, `equipping/classes/${classId}/make-ups`, {
        enrollment_id: ids.get('Eli'),
        lesson,
        made_up_on: today,
      }).expect(201);
    }
    const newClass = async (name: string) =>
      (
        (
          await post(coordinator, 'equipping/classes', {
            ...TERM,
            name,
            day_of_week: 4,
            time_of_day: '19:00',
            first_lesson_on: firstLesson,
            encounter_season_id: seasonId,
            teacher_person_id: mario.id,
          }).expect(201)
        ).body as { id: string }
      ).id;
    const classB = await newClass('Life Class B');
    const classA2 = await newClass('Life Class A2');
    // B holds lesson 8 before Eli joins it.
    await post(teacher, `equipping/classes/${classB}/lessons/8`, {
      held_on: nearLesson8(0),
      came: [],
    }).expect(200);
    const move = async (enrollmentId: string, to: string) => {
      const res = await post(registrar, `equipping/enrollments/${enrollmentId}/move`, {
        class_id: to,
      }).expect(200);
      return (
        (res.body as { enrollment_id?: string; id?: string }).enrollment_id ??
        (res.body as { id: string }).id
      );
    };
    const eliInB = await move(ids.get('Eli')!, classB);
    const registerOf = async (cls: string, enrollmentId: string) => {
      const r = (await get(teacher, `equipping/classes/${cls}/attendance`).expect(200))
        .body as Register;
      return { r, student: r.students.find((s) => s.enrollment_id === enrollmentId)! };
    };

    // **The make-up carries** (owner, 2026-11-21): lesson 8 reads made up from A, not owed again.
    let { r, student } = await registerOf(classB, eliInB);
    expect(student.marks.find((m) => m.lesson === 8)).toMatchObject({
      came: false,
      made_up_on: today,
      before_joining: true,
      from_class: { name: 'Life Class A' },
    });
    expect(r.owed.filter((o) => o.enrollment_id === eliInB)).toEqual([]);
    // Recorded again from B with another date, it corrects the one made in A rather than adding
    // a second, and the database admits the replacement; then back to today.
    for (const madeUpOn of [yesterday, today]) {
      await post(teacher, `equipping/classes/${classB}/make-ups`, {
        enrollment_id: eliInB,
        lesson: 8,
        made_up_on: madeUpOn,
      }).expect(201);
    }
    const corrected = await db
      .selectFrom('audit_log')
      .select(['before', 'after'])
      .where('action', '=', 'equipping_make_up.recorded')
      .orderBy('occurred_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(corrected.before).toMatchObject({ class_id: classId, lesson: 8, made_up_on: yesterday });
    expect(corrected.after).toMatchObject({ made_up_on: today, before_joining: true });
    const eliReg = (
      await db
        .selectFrom('equipping_enrollments')
        .select('registration_id')
        .where('id', '=', eliInB)
        .executeTakeFirstOrThrow()
    ).registration_id;
    const currentMakeUps = await db
      .selectFrom('equipping_make_ups as u')
      .innerJoin('equipping_enrollments as e', 'e.id', 'u.enrollment_id')
      .select('u.id')
      .where('e.registration_id', '=', eliReg)
      .where('u.superseded_at', 'is', null)
      .execute();
    expect(currentMakeUps).toHaveLength(2);

    // B holds lesson 9 today, after he joined, and does not tick him: he is not saved Absent,
    // and A's make-up reads.
    await post(teacher, `equipping/classes/${classB}/lessons/9`, {
      held_on: today,
      came: [],
    }).expect(200);
    const eliMarksInB = await db
      .selectFrom('equipping_marks')
      .select('id')
      .where('enrollment_id', '=', eliInB)
      .execute();
    expect(eliMarksInB).toEqual([]);
    ({ student } = await registerOf(classB, eliInB));
    expect(student.marks.find((m) => m.lesson === 9)).toMatchObject({
      made_up_on: today,
      from_class: { name: 'Life Class A' },
    });

    // A moves its lesson 8 to after the day Eli joined A. **The make-up stands as A recorded it**
    // (owner, 2026-11-21): B still reads it as made up, and changing it from B is refused cleanly
    // where the database would refuse the replacement.
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: nearLesson8(4),
      came: [ids.get('Ben'), ids.get('Carlo'), ids.get('Dino')],
      version: 1,
    }).expect(200);
    ({ student } = await registerOf(classB, eliInB));
    expect(student.marks.find((m) => m.lesson === 8)).toMatchObject({ made_up_on: today });
    const refused = await post(teacher, `equipping/classes/${classB}/make-ups`, {
      enrollment_id: eliInB,
      lesson: 8,
      made_up_on: yesterday,
    }).expect(409);
    expect(refused.body).toMatchObject({ error: { code: 'INVARIANT_VIOLATION' } });

    // Back in A, the class he left: his earlier enrollment there is earlier, its make-ups read,
    // and it is named, so the screen does not take it for one saved under his enrollment now.
    const eliBackInA = await move(eliInB, classId);
    ({ r, student } = await registerOf(classId, eliBackInA));
    expect(student.marks.find((m) => m.lesson === 9)).toMatchObject({
      made_up_on: today,
      before_joining: true,
      from_class: { name: 'Life Class A' },
    });
    expect(r.owed.filter((o) => o.enrollment_id === eliBackInA)).toEqual([]);

    // Moved twice: Dino missed lesson 9 in A and came to it in A2, then moves to B. B reads A2,
    // the class he moved from last, and the save takes the same one and refuses ticking him.
    const dinoInA2 = await move(ids.get('Dino')!, classA2);
    await post(teacher, `equipping/classes/${classA2}/lessons/9`, {
      held_on: today,
      came: [dinoInA2],
    }).expect(200);
    const dinoInB = await move(dinoInA2, classB);
    ({ student } = await registerOf(classB, dinoInB));
    expect(student.marks.find((m) => m.lesson === 9)).toMatchObject({
      came: true,
      from_class: { name: 'Life Class A2' },
    });
    await post(teacher, `equipping/classes/${classB}/lessons/9`, {
      held_on: today,
      came: [dinoInB],
      version: 1,
    }).expect(422);
  });

  it('tells the Coordinator when a Teacher has no account to record with', async () => {
    const rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    await assignTo(db, rico.id, ramon.id);
    await createCell(db, { leader: rico });
    const none = await get(
      coordinator,
      `equipping/coordinate/classes/${classId}/clash?person_id=${rico.id}`,
    ).expect(200);
    expect(none.body).toMatchObject({ account: 'NONE' });
    const active = await get(
      coordinator,
      `equipping/coordinate/classes/${classId}/clash?person_id=${mario.id}`,
    ).expect(200);
    expect(active.body).toMatchObject({ account: 'ACTIVE' });
  });

  it('records a make-up of a missed lesson, and a lesson later marked as came drops it', async () => {
    const ids = await idsByName();
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben')],
    }).expect(200);
    // Ben came: nothing to make up.
    await post(teacher, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: ids.get('Ben'),
      lesson: 9,
      made_up_on: today,
    }).expect(409);
    // Lesson 8 was never recorded.
    await post(teacher, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: ids.get('Carlo'),
      lesson: 8,
      made_up_on: today,
    }).expect(404);
    await post(teacher, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: ids.get('Carlo'),
      lesson: 9,
      made_up_on: today,
    }).expect(201);
    let r = await read(teacher);
    expect(r.students.find((s) => s.enrollment_id === ids.get('Carlo'))!.marks).toEqual([
      expect.objectContaining({ lesson: 9, came: false, made_up_on: today }),
    ]);
    expect(r.owed.map((o) => o.enrollment_id)).toEqual([ids.get('Dino')]);

    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben'), ids.get('Carlo')],
      version: 1,
    }).expect(200);
    r = await read(teacher);
    expect(r.students.find((s) => s.enrollment_id === ids.get('Carlo'))!.marks).toEqual([
      expect.objectContaining({ lesson: 9, came: true, made_up_on: null }),
    ]);
  });

  it('shows a Guide their own students and nothing else, records nothing for them, and refuses others', async () => {
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: pedro.id }).expect(
      201,
    );
    const asGuide = await read(guide);
    expect(asGuide.role).toBe('GUIDE');
    expect(asGuide.may_record).toBe(false);
    // Pedro guides all three, the class's only Guide; the coordinator sees the same three.
    expect(asGuide.students).toHaveLength(3);
    expect((await read(coordinator)).role).toBe('COORDINATOR');
    const ids = await idsByName();
    await post(guide, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben')],
    }).expect(403);
    await get(bystander, `equipping/classes/${classId}/attendance`).expect(403);
    // A Registrar holds no `equipping.class`.
    await get(registrar, `equipping/classes/${classId}/attendance`).expect(403);
    const guideClasses = (await get(guide, 'equipping/my-classes').expect(200)).body as {
      data: { role: string }[];
    };
    expect(guideClasses.data.map((c) => c.role)).toEqual(['GUIDE']);
  });

  it('keeps every record: nothing is deleted, and a corrected mark cannot be rewritten', async () => {
    const ids = await idsByName();
    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben')],
    }).expect(200);
    await expect(sql`DELETE FROM equipping_marks`.execute(db)).rejects.toThrow(/never deleted/);
    await expect(sql`DELETE FROM equipping_lessons`.execute(db)).rejects.toThrow(/never deleted/);
    await expect(sql`UPDATE equipping_marks SET came = NOT came`.execute(db)).rejects.toThrow(
      /keeps what it says/,
    );
    await expect(sql`UPDATE equipping_lessons SET lesson = 8`.execute(db)).rejects.toThrow(
      /keeps its class and number/,
    );
    // A date changed with no record of the date it changed from is refused (decision 0503).
    await expect(
      sql`UPDATE equipping_lessons SET held_on = held_on - 1`.execute(db),
    ).rejects.toThrow(/record of the date it changed from/);
    // And a make-up dated before its lesson.
    const absent = await db
      .selectFrom('equipping_marks')
      .select(['lesson_id', 'enrollment_id'])
      .where('came', '=', false)
      .where('superseded_at', 'is', null)
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('equipping_make_ups')
        .values({
          lesson_id: absent.lesson_id,
          enrollment_id: absent.enrollment_id,
          made_up_on: '2020-01-01',
          recorded_by: teacher.id,
        })
        .execute(),
    ).rejects.toThrow(/on or after the lesson/);
  });
});
