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

    // Moving it back to before he joined is refused: his mark, and any absence it replaced in an
    // earlier class, would be lost with nothing saying so (architecture-guardian, fourth review).
    const back = await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: nearLesson8(0),
      came: [ids.get('Ben'), ids.get('Carlo')],
      version: 3,
    }).expect(409);
    expect((back.body as { error: { details: { field: string } } }).error.details.field).toBe(
      'held_on',
    );
    r = await read(teacher);
    expect(eli().marks).toEqual([
      expect.objectContaining({ lesson: 8, came: true, before_joining: false }),
    ]);
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
    // And the database refuses the second mark outright (one per student per lesson number).
    const bLesson9 = await db
      .selectFrom('equipping_lessons')
      .select('id')
      .where('class_id', '=', classB)
      .where('lesson', '=', 9)
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('equipping_marks')
        .values({
          lesson_id: bLesson9.id,
          enrollment_id: carlo.enrollment_id,
          came: false,
          recorded_by: teacher.id,
        })
        .execute(),
    ).rejects.toThrow(/one mark for a lesson/);

    // Dino missed lesson 9 in A and was not ticked in B, so A's absence stood. He came to B's
    // lesson 9 after all: that replaces A's absence, which is closed and kept (owner, 2026-11-21).
    await post(teacher, `equipping/classes/${classB}/lessons/9`, {
      held_on: today,
      came: [dino.enrollment_id],
      version: 1,
    }).expect(200);
    const after = (await get(teacher, `equipping/classes/${classB}/attendance`).expect(200))
      .body as Read & {
      students: {
        person: { full_name: string };
        marks: { lesson: number; came: boolean; from_class: { name: string } | null }[];
      }[];
    };
    expect(
      after.students
        .find((s) => s.person.full_name.startsWith('Dino'))!
        .marks.find((m) => m.lesson === 9),
    ).toMatchObject({ came: true, from_class: null });
    const dinoNine = await db
      .selectFrom('equipping_marks as m')
      .innerJoin('equipping_lessons as l', 'l.id', 'm.lesson_id')
      .innerJoin('equipping_enrollments as e', 'e.id', 'm.enrollment_id')
      .select(['l.class_id', 'm.came', 'm.superseded_at'])
      .where('l.lesson', '=', 9)
      .where(
        'e.registration_id',
        '=',
        (
          await db
            .selectFrom('equipping_enrollments')
            .select('registration_id')
            .where('id', '=', dino.enrollment_id)
            .executeTakeFirstOrThrow()
        ).registration_id,
      )
      .execute();
    // A's absence kept, closed; B's came current.
    expect(dinoNine.filter((m) => m.superseded_at === null)).toEqual([
      expect.objectContaining({ class_id: classB, came: true }),
    ]);
    expect(dinoNine).toContainEqual(expect.objectContaining({ class_id: classId, came: false }));
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
