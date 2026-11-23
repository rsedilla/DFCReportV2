import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * A student taking Life Class again is shown as a 2nd try (SKILL.md section 29, decision 0511).
 *
 *   - a try is a grade posted *Not passed* at the level; *Not yet* and a withdrawal are not;
 *   - the Registration list and a class's *Ready to enroll* count the tries in earlier terms;
 *   - the Register form's person read lists each earlier try, oldest first;
 *   - a record merged into the person brings its tries with it (decision 0408).
 *
 * Fixture names are invented (CLAUDE.md, Secrets). Pablo failed Life Class in term 1 of 2027,
 * was posted *Not yet* in term 2, and registers again for term 3.
 */
describe('A student taking Life Class again (section 29, decision 0511)', () => {
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
          mens_lc_party_on: '2027-10-02',
          mens_encounter_on: '2027-11-06',
          womens_lc_party_on: '2027-10-09',
          womens_encounter_on: '2027-11-13',
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

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const classIn = async (termNumber: number, name: string) =>
    (
      await db
        .insertInto('equipping_classes')
        .values({
          level: 'LIFE_CLASS',
          term_year: 2027,
          term_number: termNumber,
          name,
          day_of_week: 2,
          time_of_day: '19:00',
          first_lesson_on: `2027-0${termNumber * 3}-01`,
          teacher_person_id: admin.personId,
          encounter_season_id: seasonId,
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const register = async (person: TestPerson, termNumber: number) =>
    (
      await db
        .insertInto('equipping_registrations')
        .values({
          level: 'LIFE_CLASS',
          term_year: 2027,
          term_number: termNumber,
          person_id: person.id,
          bible_confirmed: true,
          manual_confirmed: true,
          registered_by: registrar.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** A class posted with one student graded as given, as posting writes it (decision 0508). */
  const posted = async (
    person: TestPerson,
    termNumber: number,
    name: string,
    grade: 'PASSED' | 'NOT_PASSED' | 'NOT_YET',
    reason: string,
  ) => {
    const classId = await classIn(termNumber, name);
    const registration = await register(person, termNumber);
    const enrollment = (
      await db
        .insertInto('equipping_enrollments')
        .values({ registration_id: registration, class_id: classId, started_by: registrar.id })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
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
        grade,
        reason,
        lessons_kept: 5,
        lessons_made_up: 0,
      })
      .execute();
  };

  const listFor = async (termNumber: number) =>
    (
      (
        await get(
          registrar,
          `equipping/registrations?level=LIFE_CLASS&term_year=2027&term_number=${termNumber}`,
        ).expect(200)
      ).body as { data: { person: { id: string }; try_number: number }[] }
    ).data;

  it('counts a posted Not passed as a try, and Not yet as none', async () => {
    await posted(pablo, 1, 'Life Class A', 'NOT_PASSED', 'More than three absences');
    await posted(pablo, 2, 'Life Class B', 'NOT_YET', 'Still to attend the Encounter');
    await register(pablo, 3);

    expect((await listFor(1))[0].try_number).toBe(1);
    expect((await listFor(2))[0].try_number).toBe(2);
    expect((await listFor(3))[0].try_number).toBe(2);
  });

  it('does not count a withdrawal', async () => {
    const classId = await classIn(1, 'Life Class A');
    const registration = await register(pablo, 1);
    await db
      .insertInto('equipping_enrollments')
      .values({
        registration_id: registration,
        class_id: classId,
        started_by: registrar.id,
        ended_at: new Date(),
        ended_by: registrar.id,
        end_reason: 'WITHDRAWN',
        withdraw_note: 'Moved abroad',
      })
      .execute();
    await register(pablo, 3);
    expect((await listFor(3))[0].try_number).toBe(1);
  });

  it('lists each earlier try on the Register form, and none for a first try', async () => {
    const first = await get(registrar, `equipping/people/${pablo.id}`).expect(200);
    expect((first.body as { earlier_tries: unknown[] }).earlier_tries).toEqual([]);

    await posted(pablo, 1, 'Life Class A', 'NOT_PASSED', 'More than three absences');
    await posted(pablo, 2, 'Life Class B', 'NOT_PASSED', 'Missed three of lessons 1 to 4');
    const res = await get(registrar, `equipping/people/${pablo.id}`).expect(200);
    expect((res.body as { earlier_tries: unknown[] }).earlier_tries).toEqual([
      {
        term_year: 2027,
        term_number: 1,
        class_name: 'Life Class A',
        reason: 'More than three absences',
      },
      {
        term_year: 2027,
        term_number: 2,
        class_name: 'Life Class B',
        reason: 'Missed three of lessons 1 to 4',
      },
    ]);
  });

  it('marks the try on a class’s Ready to enroll', async () => {
    await posted(pablo, 1, 'Life Class A', 'NOT_PASSED', 'More than three absences');
    await register(pablo, 3);
    const classId = await classIn(3, 'Life Class C');
    const res = await get(registrar, `equipping/classes/${classId}`).expect(200);
    const ready = (res.body as { ready: { person: { id: string }; try_number: number }[] }).ready;
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ person: { id: pablo.id }, try_number: 2 });
  });

  it('brings the tries of a record merged into the person (decision 0408)', async () => {
    const duplicate = await createPerson(db, { firstName: 'Pablito', network: 'MENS' });
    await posted(duplicate, 1, 'Life Class A', 'NOT_PASSED', 'More than three absences');
    await db
      .updateTable('persons')
      .set({ merged_into_id: pablo.id, merged_at: new Date(), merge_reason: 'Recorded twice' })
      .where('id', '=', duplicate.id)
      .execute();
    await register(pablo, 3);
    expect((await listFor(3)).find((row) => row.person.id === pablo.id)?.try_number).toBe(2);
    const res = await get(registrar, `equipping/people/${pablo.id}`).expect(200);
    expect((res.body as { earlier_tries: unknown[] }).earlier_tries).toHaveLength(1);
  });
});
