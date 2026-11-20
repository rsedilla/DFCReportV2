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
    // Twenty weeks ago, so lesson 1's week (and lesson 9's) closed long since.
    const back = new Date(`${today}T00:00:00Z`);
    back.setUTCDate(back.getUTCDate() - 140);
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
    expect(carlo.marks).toEqual([{ lesson: 9, came: false, made_up_on: null }]);
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
      { lesson: 9, came: false, made_up_on: today },
    ]);
    expect(r.owed.map((o) => o.enrollment_id)).toEqual([ids.get('Dino')]);

    await post(teacher, `equipping/classes/${classId}/lessons/9`, {
      held_on: today,
      came: [ids.get('Ben'), ids.get('Carlo')],
      version: 1,
    }).expect(200);
    r = await read(teacher);
    expect(r.students.find((s) => s.enrollment_id === ids.get('Carlo'))!.marks).toEqual([
      { lesson: 9, came: true, made_up_on: null },
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
  });
});
