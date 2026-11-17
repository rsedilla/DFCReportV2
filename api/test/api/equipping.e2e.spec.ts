import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

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
 *   - the three ticks are always required;
 *   - a record requirement not met asks for a reason, and with one the person is registered
 *     with exception, the requirements not met kept on the row;
 *   - one registration per person, level and term;
 *   - enrolling needs a birthday and 15 on the person's own Network's Encounter weekend, all
 *     of a batch or none;
 *   - a person is moved, or withdrawn with a reason, and nothing is deleted.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 *
 *   Ramon (Men's root) -> Mario -> Ben, Carlo, Dino
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
  // The season's weekends; Dino turns 15 three days after the Men's.
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
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS', birthDate: '1999-02-01' });
    await assignTo(db, ben.id, mario.id);
    carlo = await createPerson(db, { firstName: 'Carlo', network: 'MENS', birthDate: null });
    await assignTo(db, carlo.id, mario.id);
    dino = await createPerson(db, { firstName: 'Dino', network: 'MENS', birthDate: '2012-03-09' });
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

  const ticks = { devotion_confirmed: true, bible_confirmed: true, manual_confirmed: true };

  const register = (person: TestPerson, extra: object = {}, as: TestAccount = equipper) =>
    post(as, 'registrations', {
      ...TERM,
      person_id: person.id,
      ...ticks,
      exception_reason: 'Their leader confirms they attend every week.',
      ...extra,
    });

  const openClass = (name = 'Life Class A') =>
    post(equipper, 'classes', {
      ...TERM,
      name,
      day_of_week: 2,
      time_of_day: '19:00',
      place: 'Room 2',
      first_lesson_on: '2027-01-12',
      teacher_person_id: mario.id,
      encounter_season_id: seasonId,
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
    it('reads the four record requirements for the form', async () => {
      for (let lesson = 1; lesson <= 5; lesson += 1) {
        await db
          .insertInto('suynl_lessons')
          .values({ person_id: ben.id, lesson, confirmed_by: mario.id, recorded_by: admin.id })
          .execute();
      }

      const body = (await get(equipper, `people/${ben.id}`).expect(200)).body as {
        requirements: { code: string; met: boolean }[];
        birth_date: string | null;
      };
      expect(body.birth_date).toBe('1999-02-01');
      expect(body.requirements.map((each) => [each.code, each.met])).toEqual([
        ['HAS_LEADER', true],
        ['CELL_REGULAR', false],
        ['DCC_REGULAR', false],
        ['SUYNL_FIVE', true],
      ]);
    });

    it('refuses a registration missing any of the three ticks', async () => {
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
        unmet: ['CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_FIVE'],
      });
    });

    it('registers with exception, keeping what was not met and why, and audits it', async () => {
      const body = (await register(ben).expect(201)).body as { status: string; unmet: string[] };
      expect(body.status).toBe('REGISTERED_WITH_EXCEPTION');

      const row = await db
        .selectFrom('equipping_registrations')
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(row.unmet).toEqual(['CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_FIVE']);
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

    it('refuses the whole batch when one has no birthday or is under 15 at the Encounter', async () => {
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
        `14 on ${MENS_WEEKEND}, under 15 for the Encounter`,
        'no birthday recorded',
      ]);
      expect(await db.selectFrom('equipping_enrollments').selectAll().execute()).toHaveLength(0);
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
});
