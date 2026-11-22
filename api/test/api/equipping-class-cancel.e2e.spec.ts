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
 * A class corrected until its first lesson is saved, and cancelled while it has no students
 * (SKILL.md section 29, decision 0510), pinned at the API and at the database.
 *
 *   - the Coordinator corrects the day, time, place and first lesson, kept with what they were;
 *     a save that changes nothing writes nothing; a clash with the Teacher's Cell warns;
 *   - once a lesson is saved, a correction and a cancellation are refused;
 *   - a class is cancelled only while nobody is enrolled, a student who left not counting;
 *   - a cancelled class is final and listed only as *Cancelled*, and its name is free again;
 *   - each refusal is the database's too, a cancellation and an enrollment never both landing.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 *
 *   Ramon (Men's root) -> Mario, who leads a Cell on Tuesdays at 19:30, Nico, and Pablo
 *   Lito: the Coordinator; Ada: an administrator; Eva: a Registrar
 */
describe('Correcting and cancelling a class (section 29, decision 0510)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let coordinator: TestAccount;
  let plainLeader: TestAccount;
  let mario: TestPerson;
  let pablo: TestPerson;
  let seasonId: string;

  const TERM = { level: 'LIFE_CLASS' as const, term_year: 2027, term_number: 1 };
  const LIST = 'equipping/coordinate/classes?level=LIFE_CLASS&term_year=2027&term_number=1';
  const WHEN = {
    day_of_week: 2,
    time_of_day: '19:00',
    place: 'Room 2',
    first_lesson_on: '2027-01-12',
  };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    mario = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mario.id, ramon.id);
    await createCell(db, { leader: mario, dayOfWeek: 2, timeOfDay: '19:30' });
    const nico = await createPerson(db, { firstName: 'Nico', network: 'MENS' });
    await assignTo(db, nico.id, ramon.id);
    pablo = await createPerson(db, { firstName: 'Pablo', network: 'MENS' });
    await assignTo(db, pablo.id, ramon.id);
    const lito = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
    await assignTo(db, lito.id, ramon.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    coordinator = await createAccount(app, db, { person: lito, roles: ['LEADER'] });
    plainLeader = await createAccount(app, db, { person: nico, roles: ['LEADER'] });
    await post(admin, `accounts/${coordinator.id}/coordinates-life-class`, {
      coordinates_life_class: true,
    }).expect(200);

    seasonId = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: '2027-01-30',
          mens_encounter_on: '2027-03-06',
          womens_lc_party_on: '2027-02-06',
          womens_encounter_on: '2027-03-13',
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

  function post(account: TestAccount, path: string, body: object) {
    return request(app.getHttpServer())
      .post(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const openClass = async (extra: object = {}): Promise<string> =>
    (
      (
        await post(coordinator, 'equipping/classes', {
          ...TERM,
          name: 'Life Class A',
          ...WHEN,
          encounter_season_id: seasonId,
          ...extra,
        }).expect(201)
      ).body as { id: string }
    ).id;

  const code = (res: request.Response) => (res.body as { error: { code: string } }).error.code;

  /** A student registered and enrolled, as Enrollment writes them. */
  const enroll = async (classId: string, person: TestPerson): Promise<string> => {
    const registration = (
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
    return (
      await db
        .insertInto('equipping_enrollments')
        .values({ registration_id: registration, class_id: classId, started_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  };

  const saveLesson = (classId: string, lesson = 1) =>
    db
      .insertInto('equipping_lessons')
      .values({ class_id: classId, lesson, held_on: '2027-01-12', recorded_by: admin.id })
      .execute();

  describe('correcting When and where', () => {
    it('saves the four, keeps what they were, and writes the audit entry', async () => {
      const id = await openClass();
      const res = await post(coordinator, `equipping/classes/${id}/correction`, {
        day_of_week: 4,
        time_of_day: '18:30',
        place: '  Room 5 ',
        first_lesson_on: '2027-01-14',
      }).expect(200);
      expect(res.body).toMatchObject({
        id,
        day_of_week: 4,
        time_of_day: '18:30',
        place: 'Room 5',
        first_lesson_on: '2027-01-14',
        corrected: true,
        clash: null,
      });

      const corrections = await db.selectFrom('equipping_class_corrections').selectAll().execute();
      expect(corrections).toHaveLength(1);
      expect(corrections[0]).toMatchObject({
        class_id: id,
        day_of_week_before: 2,
        day_of_week_after: 4,
        place_before: 'Room 2',
        place_after: 'Room 5',
        corrected_by: coordinator.id,
      });
      expect(String(corrections[0].first_lesson_on_before)).toBe('2027-01-12');
      const audit = await db
        .selectFrom('audit_log')
        .select(['before', 'after'])
        .where('action', '=', 'equipping_class.corrected')
        .execute();
      expect(audit).toHaveLength(1);
      expect(audit[0].after).toMatchObject({ day_of_week: 4, place: 'Room 5' });
    });

    it('writes nothing for a save that changes nothing, and clears a blank place', async () => {
      const id = await openClass();
      const same = await post(coordinator, `equipping/classes/${id}/correction`, WHEN).expect(200);
      expect((same.body as { corrected: boolean }).corrected).toBe(false);
      expect(await db.selectFrom('equipping_class_corrections').selectAll().execute()).toHaveLength(
        0,
      );

      await post(coordinator, `equipping/classes/${id}/correction`, { ...WHEN, place: ' ' }).expect(
        200,
      );
      const row = await db
        .selectFrom('equipping_classes')
        .select('place')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.place).toBeNull();
    });

    it('warns of a clash with the Teacher’s own Cell and saves anyway', async () => {
      const id = await openClass({ time_of_day: '22:00', teacher_person_id: mario.id });
      const res = await post(coordinator, `equipping/classes/${id}/correction`, WHEN).expect(200);
      expect((res.body as { clash: unknown }).clash).toEqual({
        day_of_week: 2,
        time_of_day: '19:30',
      });
    });

    it('is refused once a lesson is saved, by the API and by the database', async () => {
      const id = await openClass();
      await saveLesson(id);
      const refused = await post(coordinator, `equipping/classes/${id}/correction`, {
        ...WHEN,
        day_of_week: 5,
      }).expect(409);
      expect(code(refused)).toBe('INVARIANT_VIOLATION');
      expect((refused.body as { error: { message: string } }).error.message).toContain(
        'Lesson 1 of Life Class A is saved',
      );
      await expect(
        sql`UPDATE equipping_classes SET day_of_week = 5 WHERE id = ${id}`.execute(db),
      ).rejects.toThrow(/before a lesson is saved/);
    });

    it('is refused at the database without a record of what it was', async () => {
      const id = await openClass();
      await expect(
        sql`UPDATE equipping_classes SET place = 'Hall' WHERE id = ${id}`.execute(db),
      ).rejects.toThrow(/record of what it was/);
    });

    it('keeps a correction as written', async () => {
      const id = await openClass();
      await post(coordinator, `equipping/classes/${id}/correction`, {
        ...WHEN,
        place: 'Hall',
      }).expect(200);
      await expect(
        sql`UPDATE equipping_class_corrections SET place_after = 'Room 9'`.execute(db),
      ).rejects.toThrow(/kept as written/);
      await expect(sql`DELETE FROM equipping_class_corrections`.execute(db)).rejects.toThrow(
        /kept as written/,
      );
    });
  });

  describe('cancelling a class', () => {
    it('cancels a class with no students, keeps it, and lists it only as Cancelled', async () => {
      const id = await openClass();
      await openClass({ name: 'Life Class B' });
      const res = await post(coordinator, `equipping/classes/${id}/cancel`, {
        reason: ' The Teacher moved to another Network ',
      }).expect(200);
      expect(res.body).toMatchObject({
        id,
        status: 'CANCELLED',
        cancel_reason: 'The Teacher moved to another Network',
      });
      expect((res.body as { cancelled_on: string }).cancelled_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const row = await db
        .selectFrom('equipping_classes')
        .select(['cancelled_at', 'cancelled_by', 'cancel_reason'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.cancelled_by).toBe(coordinator.id);
      expect(row.cancelled_at).not.toBeNull();
      const audit = await db
        .selectFrom('audit_log')
        .select(['target_id', 'after'])
        .where('action', '=', 'equipping_class.cancelled')
        .execute();
      expect(audit).toEqual([
        {
          target_id: id,
          after: { status: 'CANCELLED', reason: 'The Teacher moved to another Network' },
        },
      ]);

      const coordinated = (await get(coordinator, LIST).expect(200)).body as {
        data: { name: string; status: string; cancel_reason?: string }[];
      };
      expect(coordinated.data.map((c) => [c.name, c.status])).toEqual([
        ['Life Class A', 'CANCELLED'],
        ['Life Class B', 'NOT_STARTED'],
      ]);
      expect(coordinated.data[0].cancel_reason).toBe('The Teacher moved to another Network');

      // The Registrar's Enrollment and Final Grades list it nowhere (point 6).
      const enrollment = (
        await get(
          registrar,
          'equipping/classes?level=LIFE_CLASS&term_year=2027&term_number=1',
        ).expect(200)
      ).body as { data: { name: string }[] };
      expect(enrollment.data.map((c) => c.name)).toEqual(['Life Class B']);
      const grades = (
        await get(
          registrar,
          'equipping/final-grades?level=LIFE_CLASS&term_year=2027&term_number=1',
        ).expect(200)
      ).body as { data: { name: string }[] };
      expect(grades.data.map((c) => c.name)).toEqual(['Life Class B']);
    });

    it('is refused while a student is enrolled, and allowed once they have left', async () => {
      const id = await openClass();
      const enrollment = await enroll(id, pablo);
      const refused = await post(coordinator, `equipping/classes/${id}/cancel`, {
        reason: 'Not needed',
      }).expect(409);
      expect(code(refused)).toBe('INVARIANT_VIOLATION');
      expect((refused.body as { error: { message: string } }).error.message).toContain(
        '1 student is enrolled in Life Class A',
      );

      await db
        .updateTable('equipping_enrollments')
        .set({ ended_at: sql<Date>`now()`, ended_by: registrar.id, end_reason: 'MOVED' })
        .where('id', '=', enrollment)
        .execute();
      await post(coordinator, `equipping/classes/${id}/cancel`, { reason: 'Not needed' }).expect(
        200,
      );
    });

    it('is refused once a lesson is saved', async () => {
      const id = await openClass();
      await saveLesson(id);
      const refused = await post(coordinator, `equipping/classes/${id}/cancel`, {
        reason: 'Not needed',
      }).expect(409);
      expect(code(refused)).toBe('INVARIANT_VIOLATION');
      await expect(
        sql`UPDATE equipping_classes SET cancelled_at = now(), cancelled_by = ${admin.id},
              cancel_reason = 'x' WHERE id = ${id}`.execute(db),
      ).rejects.toThrow(/no lesson is saved/);
    });

    it('needs a reason', async () => {
      const id = await openClass();
      const refused = await post(coordinator, `equipping/classes/${id}/cancel`, {
        reason: '   ',
      }).expect(422);
      expect(code(refused)).toBe('VALIDATION_FAILED');
    });

    it('is final: nothing changes on a cancelled class, by the API or the database', async () => {
      const id = await openClass();
      await post(coordinator, `equipping/classes/${id}/cancel`, { reason: 'Not needed' }).expect(
        200,
      );

      const again = await post(coordinator, `equipping/classes/${id}/cancel`, {
        reason: 'Again',
      }).expect(409);
      expect(code(again)).toBe('INVARIANT_VIOLATION');
      for (const [path, body] of [
        [`equipping/classes/${id}/correction`, { ...WHEN, place: 'Hall' }],
        [`equipping/classes/${id}/teacher`, { teacher_person_id: mario.id }],
      ] as const) {
        const refused = await post(coordinator, path, body).expect(409);
        expect(code(refused)).toBe('INVARIANT_VIOLATION');
      }
      const registration = await db
        .insertInto('equipping_registrations')
        .values({
          ...TERM,
          person_id: pablo.id,
          bible_confirmed: true,
          manual_confirmed: true,
          registered_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const enrolling = await post(registrar, `equipping/classes/${id}/enrollments`, {
        registration_ids: [registration.id],
      }).expect(409);
      expect(code(enrolling)).toBe('INVARIANT_VIOLATION');

      await expect(
        sql`UPDATE equipping_classes SET name = 'Renamed' WHERE id = ${id}`.execute(db),
      ).rejects.toThrow(/cancelled class is final/);
      await expect(
        db
          .insertInto('equipping_enrollments')
          .values({ registration_id: registration.id, class_id: id, started_by: registrar.id })
          .execute(),
      ).rejects.toThrow(/cancelled class takes nobody/);
      await expect(saveLesson(id)).rejects.toThrow(/cancelled class takes nobody/);
      await expect(
        db
          .insertInto('equipping_class_guides')
          .values({ class_id: id, person_id: pablo.id, named_by: coordinator.id })
          .execute(),
      ).rejects.toThrow(/cancelled class takes nobody/);
    });

    it('frees its name for the class opened in its place (point 7)', async () => {
      const id = await openClass();
      await post(coordinator, `equipping/classes/${id}/cancel`, { reason: 'Wrong day' }).expect(
        200,
      );
      await openClass({ day_of_week: 4 });
      const second = await post(coordinator, 'equipping/classes', {
        ...TERM,
        name: 'life class a',
        ...WHEN,
        encounter_season_id: seasonId,
      }).expect(409);
      expect(code(second)).toBe('INVARIANT_VIOLATION');
    });

    it('never lands beside an enrollment committed meanwhile', async () => {
      const id = await openClass();
      const registration = (
        await db
          .insertInto('equipping_registrations')
          .values({
            ...TERM,
            person_id: pablo.id,
            bible_confirmed: true,
            manual_confirmed: true,
            registered_by: registrar.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

      // The enrollment holds the class FOR SHARE (its trigger) and stays uncommitted while the
      // cancellation is sent; the cancellation waits, then sees the student and refuses.
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let inserted!: () => void;
      const ready = new Promise<void>((resolve) => (inserted = resolve));
      const enrolling = db.transaction().execute(async (trx) => {
        await trx
          .insertInto('equipping_enrollments')
          .values({ registration_id: registration, class_id: id, started_by: registrar.id })
          .execute();
        inserted();
        await held;
      });
      await ready;
      const cancelling = post(coordinator, `equipping/classes/${id}/cancel`, {
        reason: 'Not needed',
      }).then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      await enrolling;
      const res = await cancelling;
      expect(res.status).toBe(409);
      expect(code(res)).toBe('INVARIANT_VIOLATION');
    });

    it('and an enrollment never lands beside a cancellation committed meanwhile', async () => {
      const id = await openClass();
      const registration = (
        await db
          .insertInto('equipping_registrations')
          .values({
            ...TERM,
            person_id: pablo.id,
            bible_confirmed: true,
            manual_confirmed: true,
            registered_by: registrar.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let cancelled!: () => void;
      const ready = new Promise<void>((resolve) => (cancelled = resolve));
      const cancelling = db.transaction().execute(async (trx) => {
        await sql`UPDATE equipping_classes SET cancelled_at = now(), cancelled_by = ${admin.id},
                    cancel_reason = 'Not needed' WHERE id = ${id}`.execute(trx);
        cancelled();
        await held;
      });
      await ready;
      const enrolling = db
        .insertInto('equipping_enrollments')
        .values({ registration_id: registration, class_id: id, started_by: registrar.id })
        .execute()
        .then(
          () => null,
          (error: unknown) => error,
        );
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      await cancelling;
      expect(String(await enrolling)).toMatch(/cancelled class takes nobody/);
    });
  });

  describe('at the API', () => {
    it('refuses both routes to a plain Leader and the Registrar, and admits the Admin', async () => {
      const id = await openClass();
      for (const as of [plainLeader, registrar]) {
        await post(as, `equipping/classes/${id}/correction`, WHEN).expect(403);
        await post(as, `equipping/classes/${id}/cancel`, { reason: 'Not needed' }).expect(403);
      }
      await post(admin, `equipping/classes/${id}/correction`, { ...WHEN, place: 'Hall' }).expect(
        200,
      );
      await post(admin, `equipping/classes/${id}/cancel`, { reason: 'Not needed' }).expect(200);
    });
  });
});
