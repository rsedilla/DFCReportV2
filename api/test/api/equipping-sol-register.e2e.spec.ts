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
 * SOL 1's register (SKILL.md section 29, decision 0514, points 8 to 10, and the owner's rulings
 * of 2026-11-26), at the API.
 *
 * What is pinned, each from the ruling:
 *
 *   - a SOL lesson ticks the memory verse and the devotional of whoever came, and never of
 *     somebody absent, whose two are ticked at the make-up; Life Class ticks neither;
 *   - *Verses and devotionals still owed* lists what is owed from a lesson whose week has closed,
 *     or from a make-up recorded without it, and a tick there counts as an on-time one and is
 *     unticked when made by mistake, kept and owed again;
 *   - the quiz's number of items is entered once, fixed once a score reads against it; a score is
 *     at most the items; a retake follows a failed try only, never past the third and none after
 *     a pass; any try's score is corrected, the score it replaces kept, and a try corrected to a
 *     pass leaves every later try kept and not counted;
 *   - *Book read* is recorded and corrected, each correction kept;
 *   - only the class's Teacher records any of it, and a Life Class records none.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('SOL 1’s register (section 29, decision 0514)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let teacher: TestAccount;
  let guide: TestAccount;
  let ramon: TestPerson;
  let mario: TestPerson;
  let classId: string;
  let today: string;
  /** Eight weeks ago, so lesson 1's week has closed and lesson 8's, a week ago, is open. */
  let firstLesson: string;
  let ids: Map<string, string>;

  const SOL = { level: 'SOL_1', term_year: 2026, term_number: 3 };

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

  const errorOf = (response: request.Response) =>
    (response.body as { error: { code: string; details?: { field?: string } } }).error;

  const plusDays = (day: string, days: number) => {
    const at = new Date(`${day}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
  };

  interface Mark {
    lesson: number;
    came: boolean;
    made_up_on: string | null;
    verse: boolean | null;
    devotional: boolean | null;
    verse_brought_on: string | null;
    devotional_brought_on: string | null;
  }
  interface Student {
    enrollment_id: string;
    person: { full_name: string };
    marks: Mark[];
    quiz: {
      tries: {
        try: number;
        score: number;
        corrected_from?: number;
        corrected_by?: { account_id: string; full_name: string | null };
        corrected_on?: string;
      }[];
      not_counted: { try: number; score: number }[];
      passed: boolean;
      retakes_left: number;
      may_add_try: boolean;
    };
    book_read: boolean;
    brought_late: {
      lesson: number;
      item: string;
      brought_on: string;
      ticked_by: { account_id: string; full_name: string | null } | null;
    }[];
    verses: number;
    devotionals: number;
    still_missing: {
      make_ups: number[];
      verses: number[];
      devotionals: number[];
      quiz: boolean;
      book: boolean;
    };
  }
  interface Read {
    lessons: { lesson: number; version: number | null }[];
    students: Student[];
    quiz: { items: number | null };
    owed_items: {
      enrollment_id: string;
      lessons: { lesson: number; items: string[]; owed_since: string; made_up: boolean }[];
    }[];
  }

  const read = async () =>
    (await get(teacher, `equipping/classes/${classId}/attendance`).expect(200)).body as Read;
  const student = (r: Read, name: string) =>
    r.students.find((s) => s.person.full_name.startsWith(name))!;
  const mark = (r: Read, name: string, lesson: number) =>
    student(r, name).marks.find((m) => m.lesson === lesson)!;

  beforeEach(async () => {
    await truncateAll(db);
    today = (
      await sql<{ d: string }>`SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text AS d`.execute(
        db,
      )
    ).rows[0].d;
    firstLesson = plusDays(today, -56);

    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    mario = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mario.id, ramon.id);
    await createCell(db, { leader: mario });
    const pedro = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
    await assignTo(db, pedro.id, ramon.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    teacher = await createAccount(app, db, { person: mario, roles: ['LEADER'] });
    guide = await createAccount(app, db, { person: pedro, roles: ['LEADER'] });
    // A SOL 1 Guide has passed SOL 2 (decision 0501, point 4).
    await db
      .insertInto('training_graduations')
      .values({
        person_id: pedro.id,
        program: 'SOL_2',
        graduated_on: '2025-06-01',
        confirmed_by: ramon.id,
        recorded_by: admin.id,
      })
      .execute();

    classId = (
      (
        await post(admin, 'equipping/classes', {
          ...SOL,
          name: 'SOL 1 A',
          day_of_week: 2,
          time_of_day: '19:00',
          first_lesson_on: firstLesson,
          teacher_person_id: mario.id,
        }).expect(201)
      ).body as { id: string }
    ).id;

    const registrations: string[] = [];
    for (const name of ['Ben', 'Carlo', 'Dino']) {
      const person = await createPerson(db, { firstName: name, network: 'MENS' });
      await assignTo(db, person.id, ramon.id);
      const reg = await post(registrar, 'equipping/registrations', {
        ...SOL,
        person_id: person.id,
        manual_confirmed: true,
        exception_reason: 'Their leader confirms they finished Life Class before the school.',
      }).expect(201);
      registrations.push((reg.body as { id: string }).id);
    }
    await post(admin, `equipping/classes/${classId}/enrollments`, {
      registration_ids: registrations,
    }).expect(201);
    await post(admin, `equipping/classes/${classId}/guides`, { person_id: pedro.id }).expect(201);
    // Enrolled before the first lesson, as a class's students are (the attendance suite's
    // fixture does the same, for the same reason: no route backdates an enrollment).
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
    const r = await read();
    ids = new Map(r.students.map((s) => [s.person.full_name.split(' ')[0], s.enrollment_id]));
  });

  const id = (name: string) => ids.get(name)!;
  const lesson8 = () => plusDays(firstLesson, 49);

  it('reads ten lessons, with no Encounter among them', async () => {
    const r = await read();
    expect(r.lessons.map((l) => l.lesson)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.quiz).toEqual({ items: null });
  });

  it('ticks the memory verse and devotional of whoever came, and reads them back', async () => {
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: lesson8(),
      came: [id('Ben'), id('Carlo')],
      verse: [id('Ben')],
      devotional: [id('Ben'), id('Carlo')],
    }).expect(200);
    let r = await read();
    expect(mark(r, 'Ben', 8)).toMatchObject({ came: true, verse: true, devotional: true });
    expect(mark(r, 'Carlo', 8)).toMatchObject({ came: true, verse: false, devotional: true });
    expect(mark(r, 'Dino', 8)).toMatchObject({ came: false, verse: null, devotional: null });
    expect(student(r, 'Ben')).toMatchObject({ verses: 1, devotionals: 1 });
    // Lesson 8's week is open, so Carlo's verse is ticked on its tab, not on the card.
    expect(r.owed_items).toEqual([]);
    expect(student(r, 'Carlo').still_missing.verses).toEqual([8]);

    // A tick that changes only Carlo's verse is a correction, the mark it replaces kept.
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: lesson8(),
      version: 1,
      came: [id('Ben'), id('Carlo')],
      verse: [id('Ben'), id('Carlo')],
      devotional: [id('Ben'), id('Carlo')],
    }).expect(200);
    r = await read();
    expect(mark(r, 'Carlo', 8).verse).toBe(true);
    expect(r.lessons.find((l) => l.lesson === 8)!.version).toBe(2);
    const carloMarks = await db
      .selectFrom('equipping_marks')
      .select('verse')
      .where('enrollment_id', '=', id('Carlo'))
      .orderBy('recorded_at')
      .execute();
    expect(carloMarks.map((m) => m.verse)).toEqual([false, true]);
  });

  it('refuses a verse or devotional for somebody not ticked as came', async () => {
    const refused = await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: lesson8(),
      came: [id('Ben')],
      verse: [id('Dino')],
      devotional: [],
    }).expect(422);
    expect(errorOf(refused)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'verse' },
    });
    expect(await db.selectFrom('equipping_lessons').select('id').execute()).toEqual([]);
    // The database holds it too: an absent mark carries neither tick.
    const lessonId = (
      await db
        .insertInto('equipping_lessons')
        .values({
          class_id: classId,
          lesson: 2,
          held_on: plusDays(firstLesson, 7),
          recorded_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await expect(
      db
        .insertInto('equipping_marks')
        .values({
          lesson_id: lessonId,
          enrollment_id: id('Dino'),
          came: false,
          verse: true,
          devotional: true,
          recorded_by: admin.id,
        })
        .execute(),
    ).rejects.toThrow(/ticks the memory verse and devotional of whoever came/);
  });

  it('refuses a SOL lesson save that leaves out the verse or devotional list', async () => {
    // An absent list would read as nobody, and untick everyone already ticked.
    const refused = await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: lesson8(),
      came: [id('Ben')],
      verse: [id('Ben')],
    }).expect(422);
    expect(errorOf(refused)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'devotional' },
    });
    expect(await db.selectFrom('equipping_lessons').select('id').execute()).toEqual([]);
  });

  it('ticks an absent student’s two at the make-up, and the card lists what it left owed', async () => {
    await post(teacher, `equipping/classes/${classId}/lessons/8`, {
      held_on: lesson8(),
      came: [id('Ben'), id('Carlo')],
      verse: [id('Ben'), id('Carlo')],
      devotional: [id('Ben'), id('Carlo')],
    }).expect(200);
    const missing = await post(teacher, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: id('Dino'),
      lesson: 8,
      made_up_on: today,
    }).expect(422);
    expect(errorOf(missing).details?.field).toBe('verse');

    await post(teacher, `equipping/classes/${classId}/make-ups`, {
      enrollment_id: id('Dino'),
      lesson: 8,
      made_up_on: today,
      verse: true,
      devotional: false,
    }).expect(201);
    let r = await read();
    expect(mark(r, 'Dino', 8)).toMatchObject({ made_up_on: today, verse: true, devotional: false });
    // A make-up recorded without the devotional goes on the card at once.
    expect(r.owed_items).toEqual([
      {
        enrollment_id: id('Dino'),
        person: expect.anything(),
        cell_leader: null,
        lessons: [{ lesson: 8, items: ['DEVOTIONAL'], owed_since: today, made_up: true }],
      },
    ]);

    await post(teacher, `equipping/classes/${classId}/items-brought`, {
      enrollment_id: id('Dino'),
      lesson: 8,
      items: ['DEVOTIONAL'],
      brought_on: today,
    }).expect(201);
    r = await read();
    expect(r.owed_items).toEqual([]);
    expect(mark(r, 'Dino', 8).devotional_brought_on).toBe(today);
    // It counts as an on-time one.
    expect(student(r, 'Dino')).toMatchObject({ verses: 1, devotionals: 1 });

    const again = await post(teacher, `equipping/classes/${classId}/items-brought`, {
      enrollment_id: id('Dino'),
      lesson: 8,
      items: ['DEVOTIONAL'],
      brought_on: today,
    }).expect(409);
    expect(errorOf(again).code).toBe('INVARIANT_VIOLATION');

    // A tick made by mistake is unticked, kept, and owed again (owner, 2026-11-26).
    expect(student(r, 'Dino').brought_late).toEqual([
      {
        lesson: 8,
        item: 'DEVOTIONAL',
        brought_on: today,
        ticked_by: { account_id: teacher.id, full_name: expect.stringContaining('Mario') },
      },
    ]);
    const untick = `equipping/classes/${classId}/items-brought/untick`;
    expect(
      errorOf(
        await post(guide, untick, {
          enrollment_id: id('Dino'),
          lesson: 8,
          item: 'DEVOTIONAL',
        }).expect(403),
      ).code,
    ).toBe('SCOPE_DENIED');
    await post(teacher, untick, {
      enrollment_id: id('Dino'),
      lesson: 8,
      item: 'DEVOTIONAL',
    }).expect(200);
    r = await read();
    expect(student(r, 'Dino')).toMatchObject({ brought_late: [], devotionals: 0 });
    expect(r.owed_items).toEqual([
      expect.objectContaining({
        enrollment_id: id('Dino'),
        lessons: [expect.objectContaining({ lesson: 8, items: ['DEVOTIONAL'] })],
      }),
    ]);
    const history = await db
      .selectFrom('equipping_items_brought')
      .select('superseded_at')
      .where('enrollment_id', '=', id('Dino'))
      .execute();
    expect(history.map((h) => h.superseded_at === null)).toEqual([false]);
    // Nothing left to untick.
    expect(
      errorOf(
        await post(teacher, untick, {
          enrollment_id: id('Dino'),
          lesson: 8,
          item: 'DEVOTIONAL',
        }).expect(409),
      ).details?.field,
    ).toBe('item');
  });

  it('lists what a closed week left owed, and refuses a tick for a lesson still to make up', async () => {
    // Lesson 1's week has closed: only the Admin records it, with a reason.
    await post(admin, `equipping/classes/${classId}/lessons/1`, {
      held_on: firstLesson,
      came: [id('Ben')],
      verse: [],
      devotional: [id('Ben')],
      correction_reason: 'The Teacher’s paper register, entered late.',
    }).expect(200);
    const r = await read();
    expect(r.owed_items).toEqual([
      expect.objectContaining({
        enrollment_id: id('Ben'),
        lessons: [{ lesson: 1, items: ['VERSE'], owed_since: firstLesson, made_up: false }],
      }),
    ]);
    // Carlo was absent and has not made it up: his two are ticked at the make-up.
    const refused = await post(teacher, `equipping/classes/${classId}/items-brought`, {
      enrollment_id: id('Carlo'),
      lesson: 1,
      items: ['VERSE'],
      brought_on: today,
    }).expect(409);
    expect(errorOf(refused).details?.field).toBe('lesson');
  });

  it('keeps the quiz’s rules: items first, retakes after a failed try, any try corrected', async () => {
    const quiz = `equipping/classes/${classId}/quiz`;
    const tries = `equipping/classes/${classId}/quiz-tries`;
    const early = await post(teacher, tries, {
      enrollment_id: id('Ben'),
      try: 1,
      score: 10,
    }).expect(409);
    expect(errorOf(early).code).toBe('INVARIANT_VIOLATION');

    await post(teacher, quiz, { items: 20 }).expect(200);
    expect(
      errorOf(
        await post(teacher, tries, { enrollment_id: id('Ben'), try: 1, score: 21 }).expect(422),
      ).details?.field,
    ).toBe('score');
    await post(teacher, tries, { enrollment_id: id('Ben'), try: 1, score: 12 }).expect(201);
    let ben = student(await read(), 'Ben');
    expect(ben.quiz).toEqual({
      tries: [{ try: 1, score: 12 }],
      not_counted: [],
      passed: false,
      retakes_left: 2,
      may_add_try: true,
    });

    // Tries are taken in order, and the number of items stays once a score reads against it.
    await post(teacher, tries, { enrollment_id: id('Ben'), try: 3, score: 15 }).expect(422);
    expect(errorOf(await post(teacher, quiz, { items: 25 }).expect(409)).code).toBe(
      'INVARIANT_VIOLATION',
    );

    await post(teacher, tries, { enrollment_id: id('Ben'), try: 2, score: 14 }).expect(201);
    ben = student(await read(), 'Ben');
    expect(ben.quiz).toMatchObject({ passed: true, retakes_left: 0, may_add_try: false });
    // No retake after a pass. Any try is corrected, an earlier one included, and a correction
    // that still fails leaves the later try standing (owner, 2026-11-26).
    await post(teacher, tries, { enrollment_id: id('Ben'), try: 3, score: 18 }).expect(409);
    await post(teacher, tries, { enrollment_id: id('Ben'), try: 1, score: 13 }).expect(201);
    ben = student(await read(), 'Ben');
    expect(ben.quiz.tries).toEqual([
      {
        try: 1,
        score: 13,
        corrected_from: 12,
        corrected_by: { account_id: teacher.id, full_name: expect.stringContaining('Mario') },
        corrected_on: today,
      },
      { try: 2, score: 14 },
    ]);
    expect(ben.quiz.not_counted).toEqual([]);

    // A try corrected to a pass leaves the later try kept and not counted.
    const corrected = await post(teacher, tries, {
      enrollment_id: id('Ben'),
      try: 1,
      score: 15,
    }).expect(201);
    expect(corrected.body).toMatchObject({ passed: true, not_counted: [2] });
    ben = student(await read(), 'Ben');
    expect(ben.quiz).toMatchObject({
      tries: [expect.objectContaining({ try: 1, score: 15, corrected_from: 13 })],
      not_counted: [{ try: 2, score: 14 }],
      passed: true,
      may_add_try: false,
    });
    const kept = await db
      .selectFrom('equipping_quiz_tries')
      .select(['try', 'score', 'superseded_at'])
      .where('enrollment_id', '=', id('Ben'))
      .orderBy('recorded_at')
      .execute();
    expect(kept.map((t) => [t.try, t.score, t.superseded_at === null])).toEqual([
      [1, 12, false],
      [2, 14, false],
      [1, 13, false],
      [1, 15, true],
    ]);
    // Corrected back to a fail, the later try stays closed and the retake is entered again.
    await post(teacher, tries, { enrollment_id: id('Ben'), try: 1, score: 12 }).expect(201);
    ben = student(await read(), 'Ben');
    expect(ben.quiz).toMatchObject({ not_counted: [{ try: 2, score: 14 }], may_add_try: true });
    await post(teacher, tries, { enrollment_id: id('Ben'), try: 2, score: 14 }).expect(201);
    ben = student(await read(), 'Ben');
    expect(ben.quiz).toMatchObject({ not_counted: [], passed: true });
    // Entered again, the retake is no correction of the one closed as not counted.
    expect(ben.quiz.tries[1]).toEqual({ try: 2, score: 14 });
    // The database refuses a later try written after a pass, whoever writes it.
    await expect(
      db
        .insertInto('equipping_quiz_tries')
        .values({ enrollment_id: id('Ben'), try: 3, score: 18, recorded_by: admin.id })
        .execute(),
    ).rejects.toThrow(/a retake follows a failed try/);
  });

  it('records the book, each correction kept', async () => {
    await post(teacher, `equipping/classes/${classId}/books`, {
      enrollment_id: id('Carlo'),
      read: true,
    }).expect(200);
    expect(student(await read(), 'Carlo')).toMatchObject({
      book_read: true,
      still_missing: expect.objectContaining({ book: false }),
    });
    await post(teacher, `equipping/classes/${classId}/books`, {
      enrollment_id: id('Carlo'),
      read: false,
    }).expect(200);
    expect(student(await read(), 'Carlo').book_read).toBe(false);
    const rows = await db
      .selectFrom('equipping_books')
      .select('read')
      .where('enrollment_id', '=', id('Carlo'))
      .orderBy('recorded_at')
      .execute();
    expect(rows.map((b) => b.read)).toEqual([true, false]);
  });

  it('is the Teacher’s alone, and a Life Class records none of it', async () => {
    const byGuide = await post(guide, `equipping/classes/${classId}/books`, {
      enrollment_id: id('Ben'),
      read: true,
    }).expect(403);
    expect(errorOf(byGuide).code).toBe('SCOPE_DENIED');
    // Neither a Guide nor the Registrar records the quiz, a score or a late tick: the Guide is
    // outside the class's Teacher, and the Registrar holds no class capability at all.
    const writes: [string, object][] = [
      ['quiz', { items: 20 }],
      ['quiz-tries', { enrollment_id: id('Ben'), try: 1, score: 15 }],
      ['books', { enrollment_id: id('Ben'), read: true }],
      [
        'items-brought',
        { enrollment_id: id('Ben'), lesson: 1, items: ['VERSE'], brought_on: today },
      ],
    ];
    const refusals: [TestAccount, string][] = [
      [guide, 'SCOPE_DENIED'],
      [registrar, 'CAPABILITY_DENIED'],
    ];
    for (const [account, code] of refusals) {
      for (const [route, body] of writes) {
        const refused = await post(account, `equipping/classes/${classId}/${route}`, body).expect(
          403,
        );
        expect(errorOf(refused).code).toBe(code);
      }
    }

    const season = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: plusDays(today, 30),
          mens_encounter_on: plusDays(today, 65),
          womens_lc_party_on: plusDays(today, 37),
          womens_encounter_on: plusDays(today, 72),
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const life = (
      (
        await post(admin, 'equipping/classes', {
          level: 'LIFE_CLASS',
          term_year: 2026,
          term_number: 3,
          name: 'Life Class A',
          day_of_week: 3,
          time_of_day: '19:00',
          first_lesson_on: plusDays(firstLesson, 1),
          encounter_season_id: season,
          teacher_person_id: mario.id,
        }).expect(201)
      ).body as { id: string }
    ).id;
    expect(
      errorOf(await post(teacher, `equipping/classes/${life}/quiz`, { items: 20 }).expect(409))
        .code,
    ).toBe('INVARIANT_VIOLATION');
    await expect(
      db
        .insertInto('equipping_quizzes')
        .values({ class_id: life, items: 20, set_by: admin.id })
        .execute(),
    ).rejects.toThrow(/are SOL's/);
    expect(
      errorOf(
        await post(teacher, `equipping/classes/${life}/lessons/1`, {
          held_on: plusDays(firstLesson, 1),
          came: [],
          verse: [id('Ben')],
        }).expect(409),
      ).details?.field,
    ).toBe('verse');
    expect(
      errorOf(
        await post(teacher, `equipping/classes/${life}/lessons/10`, {
          held_on: plusDays(firstLesson, 1),
          came: [],
        }).expect(422),
      ).details?.field,
    ).toBe('lesson');
  });
});
