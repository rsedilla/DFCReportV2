import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { PeopleReadService } from '../../src/people/people.read.service';
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
 * Equipping at the API (SKILL.md sections 7 and 29, decision 0499): registration and
 * enrollment for Life Class.
 *
 * What is pinned, each from the ruling rather than from the service:
 *
 *   - only the Admin and an Equipper reach these routes, and a Leader is refused;
 *   - the two ticks (a physical Bible, the Life Class Manual) are always required;
 *   - a record requirement not met asks for a reason, and with one the person is registered
 *     with exception, the requirements not met kept on the row;
 *   - one registration per person, level and term;
 *   - enrolling needs a birthday and 14 on the person's own Network's Encounter weekend, all
 *     of a batch or none;
 *   - a person is moved, or withdrawn with a reason, and nothing is deleted.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 *
 *   Ramon (Men's root) -> Mario -> Ben, Carlo, Dino
 *   Mario leads a Cell, so he may teach (point 10)
 *   Ada: an administrator outside the tree; Eva: an Equipper
 */
describe('Equipping (section 29, decision 0499)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let equipper: TestAccount;
  let leader: TestAccount;
  let mario: TestPerson;
  let ben: TestPerson;
  let carlo: TestPerson;
  let dino: TestPerson;
  let seasonId: string;

  const TERM = { level: 'LIFE_CLASS', term_year: 2027, term_number: 1 };
  // The season's weekends; Dino turns 14 three days after the Men's.
  const MENS_WEEKEND = '2027-03-06';
  const WOMENS_WEEKEND = '2027-03-13';

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
    await createCell(db, { leader: mario });
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS', birthDate: '1999-02-01' });
    await assignTo(db, ben.id, mario.id);
    carlo = await createPerson(db, { firstName: 'Carlo', network: 'MENS', birthDate: null });
    await assignTo(db, carlo.id, mario.id);
    dino = await createPerson(db, { firstName: 'Dino', network: 'MENS', birthDate: '2013-03-09' });
    await assignTo(db, dino.id, mario.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    equipper = await createAccount(app, db, { person: eva, roles: ['EQUIPPER'] });
    leader = await createAccount(app, db, { person: mario, roles: ['LEADER'] });

    seasonId = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: '2027-01-30',
          mens_encounter_on: MENS_WEEKEND,
          womens_lc_party_on: '2027-02-06',
          womens_encounter_on: WOMENS_WEEKEND,
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
      .post(`/api/v1/equipping/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/equipping/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const ticks = { bible_confirmed: true, manual_confirmed: true };

  const register = (person: TestPerson, extra: object = {}, as: TestAccount = equipper) =>
    post(as, 'registrations', {
      ...TERM,
      person_id: person.id,
      ...ticks,
      exception_reason: 'Their leader confirms they attend every week.',
      ...extra,
    });

  const openClass = (name = 'Life Class A', teacherId: string = mario.id) =>
    post(equipper, 'classes', {
      ...TERM,
      name,
      day_of_week: 2,
      time_of_day: '19:00',
      place: 'Room 2',
      first_lesson_on: '2027-01-12',
      teacher_person_id: teacherId,
      encounter_season_id: seasonId,
    });

  describe('the Teacher (owner, 2026-11-18: a Cell Leader in the tree)', () => {
    const refusal = async (teacherId: string) => {
      const response = await openClass('Life Class T', teacherId);
      return { status: response.status, code: response.body.error?.code };
    };

    it('opens a class taught by a current Cell Leader in the tree', async () => {
      await openClass().expect(201);
    });

    it('refuses a Teacher in the tree who leads no Cell', async () => {
      expect(await refusal(ben.id)).toEqual({ status: 409, code: 'INVARIANT_VIOLATION' });
    });

    it('refuses a Teacher who leads a Cell but is outside the tree', async () => {
      // Ada holds no pastoral assignment; leading a Cell does not put her in the tree.
      const ada = await db
        .selectFrom('accounts')
        .select('person_id')
        .where('id', '=', admin.id)
        .executeTakeFirstOrThrow();
      await createCell(db, { leader: { id: ada.person_id } as TestPerson });
      expect(await refusal(ada.person_id)).toEqual({ status: 409, code: 'INVARIANT_VIOLATION' });
    });

    it('answers NOT_FOUND for an Equipping record, as registering does', async () => {
      expect(await refusal(equipper.personId)).toEqual({ status: 404, code: 'NOT_FOUND' });
    });

    it('offers only current Cell Leaders in the tree when the picker asks for Teachers', async () => {
      const all = (await get(equipper, 'people?q=Mar').expect(200)).body as {
        data: { id: string }[];
      };
      const teachers = (await get(equipper, 'people?q=Mar&teachers=true').expect(200)).body as {
        data: { id: string }[];
      };
      expect(all.data.map((row) => row.id)).toContain(mario.id);
      expect(teachers.data.map((row) => row.id)).toEqual([mario.id]);

      const noLeader = (await get(equipper, 'people?q=Ben&teachers=true').expect(200)).body as {
        data: unknown[];
      };
      expect(noLeader.data).toEqual([]);
    });
  });

  describe('who may', () => {
    it('lets the Equipper and the Admin read the classes, and refuses a Leader', async () => {
      const query = `classes?level=LIFE_CLASS&term_year=2027&term_number=1`;
      await get(equipper, query).expect(200);
      await get(admin, query).expect(200);
      const refused = await get(leader, query);
      expect({ status: refused.status, code: refused.body.error?.code }).toEqual({
        status: 403,
        code: 'CAPABILITY_DENIED',
      });
    });

    it('refuses a Leader registering anybody', async () => {
      const refused = await register(ben, {}, leader);
      expect(refused.status).toBe(403);
      expect(await db.selectFrom('equipping_registrations').selectAll().execute()).toHaveLength(0);
    });

    it('gives an Equipper the Equipping screens', async () => {
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${equipper.accessToken}`)
        .expect(200);
      expect(me.body.screens).toBe('EQUIPPING');
    });
  });

  describe('registering', () => {
    it('reads the four record requirements for the form, SUYNL being lessons 1 to 4', async () => {
      const lessonsOf = async (lessons: number[]) => {
        for (const lesson of lessons) {
          await db
            .insertInto('suynl_lessons')
            .values({ person_id: ben.id, lesson, confirmed_by: mario.id, recorded_by: admin.id })
            .execute();
        }
      };
      const read = async () =>
        (await get(equipper, `people/${ben.id}`).expect(200)).body as {
          requirements: { code: string; met: boolean; detail: string }[];
          birth_date: string | null;
        };

      // Seven lessons, but not lesson 4 (owner, 2026-11-18: lessons 1 to 4, whatever else).
      await lessonsOf([1, 2, 3, 5, 7, 8, 9]);
      const before = await read();
      expect(before.birth_date).toBe('1999-02-01');
      expect(before.requirements.map((each) => [each.code, each.met])).toEqual([
        ['HAS_LEADER', true],
        ['CELL_REGULAR', false],
        ['DCC_REGULAR', false],
        ['SUYNL_LESSONS_1_TO_4', false],
      ]);
      expect(before.requirements[3].detail).toBe('Lesson 4 not recorded yet');

      await lessonsOf([4]);
      expect((await read()).requirements[3]).toMatchObject({
        code: 'SUYNL_LESSONS_1_TO_4',
        met: true,
      });
    });

    it('refuses a registration missing either of the two ticks', async () => {
      const response = await register(ben, { bible_confirmed: false });
      expect({ status: response.status, field: response.body.error?.details?.field }).toEqual({
        status: 422,
        field: 'bible_confirmed',
      });
    });

    it('asks for a reason when a record requirement is not met', async () => {
      const response = await register(ben, { exception_reason: undefined });
      expect(response.status).toBe(422);
      expect(response.body.error?.details).toMatchObject({
        field: 'exception_reason',
        unmet: ['CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_LESSONS_1_TO_4'],
      });
    });

    it('registers with exception, keeping what was not met and why, and audits it', async () => {
      const body = (await register(ben).expect(201)).body as { status: string; unmet: string[] };
      expect(body.status).toBe('REGISTERED_WITH_EXCEPTION');

      const row = await db
        .selectFrom('equipping_registrations')
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(row.unmet).toEqual(['CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_LESSONS_1_TO_4']);
      expect(row.exception_reason).toBe('Their leader confirms they attend every week.');
      expect(row.registered_by).toBe(equipper.id);

      const audit = await db
        .selectFrom('audit_log')
        .select(['action', 'target_id'])
        .where('action', '=', 'equipping_registration.created')
        .execute();
      expect(audit).toEqual([{ action: 'equipping_registration.created', target_id: ben.id }]);
    });

    it('refuses a second registration for the same level and term', async () => {
      await register(ben).expect(201);
      const again = await register(ben);
      expect({ status: again.status, code: again.body.error?.code }).toEqual({
        status: 409,
        code: 'INVARIANT_VIOLATION',
      });
    });
  });

  describe('enrolling', () => {
    it('enrolls a batch into a class, and the list says Enrolled', async () => {
      const cls = (await openClass().expect(201)).body as { id: string };
      const reg = (await register(ben).expect(201)).body as { id: string };

      await post(equipper, `classes/${cls.id}/enrollments`, { registration_ids: [reg.id] }).expect(
        201,
      );

      const list = (
        await get(equipper, 'registrations?level=LIFE_CLASS&term_year=2027&term_number=1').expect(
          200,
        )
      ).body as { data: { status: string; class: { name: string } | null }[] };
      expect(list.data.map((row) => [row.status, row.class?.name])).toEqual([
        ['ENROLLED', 'Life Class A'],
      ]);
    });

    it('refuses the whole batch when one has no birthday or is under 14 at the Encounter', async () => {
      const cls = (await openClass().expect(201)).body as { id: string };
      const ids = [];
      for (const person of [ben, carlo, dino]) {
        ids.push(((await register(person).expect(201)).body as { id: string }).id);
      }

      const response = await post(equipper, `classes/${cls.id}/enrollments`, {
        registration_ids: ids,
      });
      expect(response.status).toBe(409);
      const reasons = (
        response.body.error.details.refusals as { registration_id: string; reason: string }[]
      )
        .map((each) => each.reason)
        .sort();
      expect(reasons).toEqual([
        `13 on ${MENS_WEEKEND}, under 14 for the Encounter`,
        'no birthday recorded',
      ]);
      expect(await db.selectFrom('equipping_enrollments').selectAll().execute()).toHaveLength(0);
    });

    it('admits a person who turns 14 on the first day of the Encounter weekend', async () => {
      // The edge of the owner's "14 by the first day" (2026-11-19): 14 that day is enough.
      const eli = await createPerson(db, {
        firstName: 'Eli',
        network: 'MENS',
        birthDate: '2013-03-06',
      });
      await assignTo(db, eli.id, mario.id);
      const cls = (await openClass().expect(201)).body as { id: string };
      const reg = (await register(eli).expect(201)).body as { id: string };
      await post(equipper, `classes/${cls.id}/enrollments`, { registration_ids: [reg.id] }).expect(
        201,
      );
    });

    it('moves a person to another class and withdraws them, keeping both rows', async () => {
      const a = (await openClass('Life Class A').expect(201)).body as { id: string };
      const b = (await openClass('Life Class B').expect(201)).body as { id: string };
      const reg = (await register(ben).expect(201)).body as { id: string };
      const enrolled = (
        await post(equipper, `classes/${a.id}/enrollments`, { registration_ids: [reg.id] }).expect(
          201,
        )
      ).body as { enrolled: { enrollment_id: string }[] };

      const moved = (
        await post(equipper, `enrollments/${enrolled.enrolled[0].enrollment_id}/move`, {
          class_id: b.id,
        }).expect(200)
      ).body as { enrollment_id: string };

      // Cancelling is refused while they are in a class.
      const cancel = await post(equipper, `registrations/${reg.id}/cancel`, {
        reason: 'Moved away',
      });
      expect(cancel.status).toBe(409);

      await post(equipper, `enrollments/${moved.enrollment_id}/withdraw`, {
        reason: 'Works on Tuesdays now',
      }).expect(200);

      const rows = await db
        .selectFrom('equipping_enrollments')
        .select(['class_id', 'end_reason'])
        .orderBy('started_at')
        .execute();
      expect(rows).toEqual([
        { class_id: a.id, end_reason: 'MOVED' },
        { class_id: b.id, end_reason: 'WITHDRAWN' },
      ]);

      await post(equipper, `registrations/${reg.id}/cancel`, { reason: 'Moved away' }).expect(200);
    });
  });

  describe('the database', () => {
    it('refuses deleting a registration', async () => {
      await register(ben).expect(201);
      await expect(db.deleteFrom('equipping_registrations').execute()).rejects.toThrow(
        /keeps its history/,
      );
    });

    it('refuses an Equipper account also holding LEADER', async () => {
      await expect(
        db
          .insertInto('account_roles')
          .values({ account_id: equipper.id, role: 'LEADER' })
          .execute(),
      ).rejects.toThrow(/account_roles_equipper_not_with_leader/);
    });
  });
  describe('the Equipping account and the rest of the church (decision 0499, 18 Nov)', () => {
    const form = (overrides: Record<string, unknown> = {}) => ({
      first_name: 'Elena',
      last_name: 'Fixtureson',
      birth_date_not_given: true,
      sex: 'FEMALE',
      civil_status: 'SINGLE',
      mobile_number_not_given: true,
      email: 'elena.equipping@example.test',
      ...overrides,
    });

    const createEquipper = (as: TestAccount, body: object) =>
      request(app.getHttpServer())
        .post('/api/v1/accounts/equipper')
        .set('Authorization', `Bearer ${as.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    it('gives an Equipping account only with a record of its own, outside the tree', async () => {
      const made = await createEquipper(admin, form()).expect(201);
      expect(made.body.role).toBe('EQUIPPER');

      // In no count of people: outside the tree, as a Network Admin's record is.
      const outside = await app
        .get(PeopleReadService)
        .outsideTreeAt(db, new Date(Date.now() + 1000));
      expect(outside.has(made.body.person_id)).toBe(true);

      // The ordinary form no longer gives the role to a Person who already has a record.
      await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ person_id: ben.id, email: 'ben.equipping@example.test', role: 'EQUIPPER' })
        .expect(422);
    });

    it('refuses a Network Admin the school and the Equipping account', async () => {
      const nora = await createPerson(db, { firstName: 'Nora', network: 'WOMENS' });
      const networkAdmin = await createAccount(app, db, { person: nora, roles: ['NETWORK_ADMIN'] });

      await get(networkAdmin, 'classes?level=LIFE_CLASS&term_year=2027&term_number=1').expect(403);
      await createEquipper(networkAdmin, form()).expect(403);
    });

    it("closes an archived person's registration and class place, keeping both", async () => {
      const registered = await register(ben).expect(201);
      const cls = await openClass().expect(201);
      await post(equipper, `classes/${cls.body.id}/enrollments`, {
        registration_ids: [registered.body.id],
      }).expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/people/${ben.id}/archive`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'MOVED_AWAY' })
        .expect(200);

      const registration = await db
        .selectFrom('equipping_registrations')
        .select(['cancelled_at', 'cancel_reason'])
        .where('id', '=', registered.body.id)
        .executeTakeFirstOrThrow();
      expect(registration.cancel_reason).toBe('Archived');
      const enrollment = await db
        .selectFrom('equipping_enrollments')
        .select(['ended_at', 'end_reason'])
        .where('registration_id', '=', registered.body.id)
        .executeTakeFirstOrThrow();
      expect(enrollment.end_reason).toBe('ARCHIVED');
    });

    it('refuses to merge away a record that is registered', async () => {
      await register(ben).expect(201);

      const preview = await request(app.getHttpServer())
        .get(`/api/v1/people/${dino.id}/merge-preview?duplicate_id=${ben.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(
        (preview.body.refusals as { code: string }[]).map((refusal) => refusal.code),
      ).toContain('IN_THE_SCHOOL');
    });

    it('records each person the Equipper opens, as a full-record read is', async () => {
      await get(equipper, `people/${ben.id}`).expect(200);

      const views = await db
        .selectFrom('person_views')
        .select('viewer_person_id')
        .where('person_id', '=', ben.id)
        .execute();
      expect(views).toHaveLength(1);
    });

    it('refuses a reason of spaces at the edge rather than at the column', async () => {
      const registered = await register(ben).expect(201);
      const refused = await post(equipper, `registrations/${registered.body.id}/cancel`, {
        reason: '   ',
      }).expect(422);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
  describe('the Equipping record and its history (decision 0499, second review)', () => {
    it('keeps the Equipping record out of the tree and its Cells', async () => {
      const wilma = await createPerson(db, { firstName: 'Wilma', network: 'WOMENS' });
      await assignTo(db, wilma.id, null);
      const wren = await createPerson(db, { firstName: 'Wren', network: 'WOMENS' });
      await assignTo(db, wren.id, wilma.id);

      const asLeader = await request(app.getHttpServer())
        .put(`/api/v1/people/${wren.id}/pastoral-leader`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ pastoral_leader_id: equipper.personId });
      expect(asLeader.status).toBe(409);
      expect(JSON.stringify(asLeader.body)).toContain('Equipping account');

      const cell = await createCell(db, { leader: wilma });
      const asMember = await request(app.getHttpServer())
        .post(`/api/v1/cells/${cell.id}/members`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ person_id: equipper.personId });
      expect(asMember.status).toBe(409);
      expect(JSON.stringify(asMember.body)).toContain('Equipping account');
    });

    it('disables an Equipping account with its record, and refuses keeping it', async () => {
      const archive = (body: object) =>
        request(app.getHttpServer())
          .post(`/api/v1/people/${equipper.personId}/archive`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('Idempotency-Key', randomUUID())
          .send(body);

      await archive({ reason: 'OTHER', note: 'Left the school.', account_access: 'KEEP' }).expect(
        422,
      );
      const done = await archive({ reason: 'OTHER', note: 'Left the school.' }).expect(200);
      expect(done.body.account_access).toBe('DISABLE');

      const account = await db
        .selectFrom('accounts')
        .select('status')
        .where('id', '=', equipper.id)
        .executeTakeFirstOrThrow();
      expect(account.status).toBe('DISABLED');
    });

    it('refuses rewriting a registration, undoing a cancellation, or a class place on a cancelled one', async () => {
      const registered = (await register(ben).expect(201)).body as { id: string };
      const cls = (await openClass().expect(201)).body as { id: string };

      await expect(
        db
          .updateTable('equipping_registrations')
          .set({ person_id: carlo.id })
          .where('id', '=', registered.id)
          .execute(),
      ).rejects.toThrow(/keeps the person, level and term/);

      await post(equipper, `registrations/${registered.id}/cancel`, {
        reason: 'Moved to another church.',
      }).expect(200);

      await expect(
        db
          .updateTable('equipping_registrations')
          .set({ cancelled_at: null, cancelled_by: null, cancel_reason: null })
          .where('id', '=', registered.id)
          .execute(),
      ).rejects.toThrow(/stays cancelled/);

      await expect(
        db
          .insertInto('equipping_enrollments')
          .values({ registration_id: registered.id, class_id: cls.id, started_by: equipper.id })
          .execute(),
      ).rejects.toThrow(/cancelled registration/);
    });
  });
  describe('the Equipping record, found and merged (owner, 2026-11-18)', () => {
    const search = (as: TestAccount, q: string, extra = '') =>
      request(app.getHttpServer())
        .get(`/api/v1/people?q=${encodeURIComponent(q)}${extra}`)
        .set('Authorization', `Bearer ${as.accessToken}`);

    it("finds an Equipping record in the Admin's search alone, labelled", async () => {
      const nora = await createPerson(db, { firstName: 'Nora', network: 'WOMENS' });
      const networkAdmin = await createAccount(app, db, { person: nora, roles: ['NETWORK_ADMIN'] });

      const byAdmin = (await search(admin, 'Eva', '&church_wide=true').expect(200)).body as {
        data: { id: string; equipping_account?: boolean }[];
      };
      expect(byAdmin.data.find((row) => row.id === equipper.personId)).toMatchObject({
        equipping_account: true,
      });

      const byNetworkAdmin = (await search(networkAdmin, 'Eva').expect(200)).body as {
        data: { id: string }[];
      };
      expect(byNetworkAdmin.data.map((row) => row.id)).not.toContain(equipper.personId);

      await request(app.getHttpServer())
        .get(`/api/v1/people/${equipper.personId}`)
        .set('Authorization', `Bearer ${networkAdmin.accessToken}`)
        .expect(404);

      // Nor does the Equipper's own picker offer an Equipping record to sign up.
      const picker = (await get(equipper, 'people?q=Eva').expect(200)).body as {
        data: { id: string }[];
      };
      expect(picker.data.map((row) => row.id)).not.toContain(equipper.personId);

      // Nor its pastoral path, which would name it (third review).
      await request(app.getHttpServer())
        .get(`/api/v1/people/${equipper.personId}/pastoral-path`)
        .set('Authorization', `Bearer ${networkAdmin.accessToken}`)
        .expect(404);
    });

    it('treats an Equipping record as nobody in the school, for the Admin too', async () => {
      // Third review: the picker left it out and the form and register did not.
      await get(admin, `people/${equipper.personId}`).expect(404);
      await register({ id: equipper.personId } as TestPerson, {}, admin).expect(404);
    });

    it("leaves an Equipping record out of everyone's duplicate check but the Admin's", async () => {
      // Owner, 2026-11-18: neither shown nor withheld, and never gated on. Eva's Equipping
      // record is Eva Testfixture, born 1985-06-15, so the same three are a Tier 1 match.
      const nora = await createPerson(db, { firstName: 'Nora', network: 'WOMENS' });
      await assignTo(db, nora.id, null);
      const networkAdmin = await createAccount(app, db, {
        person: await createPerson(db, { firstName: 'Nadia', network: 'WOMENS' }),
        roles: ['NETWORK_ADMIN'],
      });
      const check = (as: TestAccount) =>
        request(app.getHttpServer())
          .get('/api/v1/people/duplicate-candidates')
          .query({ first_name: 'Eva', last_name: 'Testfixture', birth_date: '1985-06-15' })
          .set('Authorization', `Bearer ${as.accessToken}`)
          .expect(200);

      expect(JSON.stringify((await check(admin)).body.data)).toContain(equipper.personId);
      // Not a withheld line either: a covering Network Admin sees her named nowhere, and a
      // Leader, outside whose scope she sits, is shown no "possible match" line for her.
      expect(JSON.stringify((await check(networkAdmin)).body.data)).not.toContain(
        equipper.personId,
      );
      const byLeader = (await check(leader)).body.data as { possible_match?: true }[];
      expect(byLeader.filter((row) => row.possible_match)).toEqual([]);

      const add = (as: TestAccount) =>
        request(app.getHttpServer())
          .post('/api/v1/people')
          .set('Authorization', `Bearer ${as.accessToken}`)
          .set('Idempotency-Key', randomUUID())
          .send({
            first_name: 'Eva',
            last_name: 'Testfixture',
            birth_date: '1985-06-15',
            sex: 'FEMALE',
            civil_status: 'SINGLE',
            mobile_number_not_given: true,
            pastoral_leader_id: nora.id,
          });
      // The Admin is asked about it; a Network Admin adds her own record without being asked.
      const asked = await add(admin).expect(409);
      expect(JSON.stringify(asked.body)).toContain(equipper.personId);
      await add(networkAdmin).expect(201);
    });

    it('refuses merging an Equipping record, in either direction', async () => {
      const evaAgain = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
      for (const [kept, duplicate] of [
        [evaAgain.id, equipper.personId],
        [equipper.personId, evaAgain.id],
      ]) {
        const preview = await request(app.getHttpServer())
          .get(`/api/v1/people/${kept}/merge-preview?duplicate_id=${duplicate}`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200);
        expect(
          (preview.body.refusals as { code: string }[]).map((refusal) => refusal.code),
        ).toContain('EQUIPPING_ACCOUNT');
      }
    });
  });
});
