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
 * The Life Class Coordinator at the API (SKILL.md sections 7 and 29, decision 0501).
 *
 * What is pinned, each from the ruling rather than from the service:
 *
 *   - the Admin ticks *Life Class Coordinator* on a Leader account, only with Full view, the
 *     database refusing it without, and clearing Full view clears it;
 *   - the ticked Leader opens a class, with or without a Teacher, lists the term's classes and
 *     names the Teacher; a Leader without the tick and the Registrar are refused;
 *   - the Teacher is a current Cell Leader in the tree when named;
 *   - a clash with the Teacher's own Cell warns and never refuses (owner, 2026-11-20).
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 *
 *   Ramon (Men's root) -> Mario, who leads a Cell on Tuesdays at 19:30, and Nico, who leads none
 *   Lito: a Full view Leader, the Coordinator; Ada: an administrator; Eva: a Registrar
 */
describe('The Life Class Coordinator (section 29, decision 0501)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let coordinator: TestAccount;
  let plainLeader: TestAccount;
  let mario: TestPerson;
  let nico: TestPerson;
  let seasonId: string;

  const TERM = { level: 'LIFE_CLASS', term_year: 2027, term_number: 1 };

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
    nico = await createPerson(db, { firstName: 'Nico', network: 'MENS' });
    await assignTo(db, nico.id, ramon.id);
    const lito = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
    await assignTo(db, lito.id, ramon.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    coordinator = await createAccount(app, db, { person: lito, roles: ['LEADER'] });
    plainLeader = await createAccount(app, db, { person: nico, roles: ['LEADER'] });

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

  const tick = (account: TestAccount, value: boolean) =>
    post(admin, `accounts/${account.id}/coordinates-life-class`, {
      coordinates_life_class: value,
    });

  const openClass = (as: TestAccount, extra: object = {}) =>
    post(as, 'equipping/classes', {
      ...TERM,
      name: 'Life Class A',
      day_of_week: 2,
      time_of_day: '19:00',
      place: 'Room 2',
      first_lesson_on: '2027-01-12',
      encounter_season_id: seasonId,
      ...extra,
    });

  describe('the tick', () => {
    it('is given by the Admin, and is the database refusing it without Full view', async () => {
      const ticked = await tick(coordinator, true).expect(200);
      expect(ticked.body).toEqual({ id: coordinator.id, coordinates_life_class: true });

      const audit = await db
        .selectFrom('audit_log')
        .select(['action', 'after'])
        .where('action', '=', 'account.coordinates_life_class_changed')
        .execute();
      expect(audit).toHaveLength(1);

      await expect(
        sql`UPDATE accounts SET full_view = false WHERE id = ${plainLeader.id};
            `.execute(db),
      ).resolves.toBeDefined();
      await expect(
        sql`UPDATE accounts SET coordinates_life_class = true WHERE id = ${plainLeader.id}`.execute(
          db,
        ),
      ).rejects.toThrow(/accounts_coordinates_life_class_needs_full_view/);
    });

    it('is refused without Full view, and clearing Full view clears it', async () => {
      await db
        .updateTable('accounts')
        .set({ full_view: false })
        .where('id', '=', plainLeader.id)
        .execute();
      const refused = await tick(plainLeader, true).expect(409);
      expect((refused.body as { error: { code: string } }).error.code).toBe('INVARIANT_VIOLATION');

      await tick(coordinator, true).expect(200);
      await post(admin, `accounts/${coordinator.id}/full-view`, { full_view: false }).expect(200);
      const row = await db
        .selectFrom('accounts')
        .select('coordinates_life_class')
        .where('id', '=', coordinator.id)
        .executeTakeFirstOrThrow();
      expect(row.coordinates_life_class).toBe(false);
    });
  });

  describe('every Coordinator route at the API', () => {
    it('refuses a plain Leader and the Registrar, and admits the ticked Leader and the Admin', async () => {
      await tick(coordinator, true).expect(200);
      const id = ((await openClass(coordinator).expect(201)).body as { id: string }).id;
      const reads = [
        'equipping/teachers?q=Mar',
        'equipping/coordinate/encounter-seasons',
        `equipping/coordinate/classes/${id}/students`,
        `equipping/coordinate/classes/${id}/clash?person_id=${mario.id}`,
      ];
      for (const path of reads) {
        await get(plainLeader, path).expect(403);
        await get(registrar, path).expect(403);
        await get(coordinator, path).expect(200);
        await get(admin, path).expect(200);
      }
      for (const as of [plainLeader, registrar]) {
        await post(as, `equipping/classes/${id}/teacher`, { teacher_person_id: mario.id }).expect(
          403,
        );
      }
    });

    it('records the Teacher search as a church-wide search is (decision 0303)', async () => {
      await tick(coordinator, true).expect(200);
      await get(coordinator, 'equipping/teachers?q=Mar').expect(200);
      const searches = await db
        .selectFrom('audit_log')
        .select('action')
        .where('actor_id', '=', coordinator.id)
        .where('action', '=', 'directory.searched')
        .execute();
      expect(searches).toHaveLength(1);
      await get(coordinator, 'equipping/teachers?q=Ma').expect(422);
    });
  });

  describe('opening a class and naming its Teacher', () => {
    it('is the ticked Leader’s, and not a plain Leader’s or the Registrar’s', async () => {
      await openClass(coordinator).expect(403);
      await tick(coordinator, true).expect(200);
      await openClass(plainLeader).expect(403);
      await openClass(registrar).expect(403);

      const opened = await openClass(coordinator).expect(201);
      expect((opened.body as { teacher: unknown }).teacher).toBeNull();

      const listed = await get(
        coordinator,
        'equipping/coordinate/classes?level=LIFE_CLASS&term_year=2027&term_number=1',
      ).expect(200);
      expect(listed.body).toMatchObject({
        data: [{ name: 'Life Class A', teacher: null, enrolled: 0 }],
      });
      await get(
        plainLeader,
        'equipping/coordinate/classes?level=LIFE_CLASS&term_year=2027&term_number=1',
      ).expect(403);
    });

    it('names a current Cell Leader in the tree, and refuses anybody else', async () => {
      await tick(coordinator, true).expect(200);
      const id = ((await openClass(coordinator).expect(201)).body as { id: string }).id;

      const refused = await post(coordinator, `equipping/classes/${id}/teacher`, {
        teacher_person_id: nico.id,
      }).expect(409);
      expect((refused.body as { error: { code: string } }).error.code).toBe('INVARIANT_VIOLATION');

      const named = await post(coordinator, `equipping/classes/${id}/teacher`, {
        teacher_person_id: mario.id,
      }).expect(200);
      expect((named.body as { teacher: { id: string } }).teacher.id).toBe(mario.id);

      const audit = await db
        .selectFrom('audit_log')
        .select('action')
        .where('action', '=', 'equipping_class.teacher_named')
        .execute();
      expect(audit).toHaveLength(1);
    });

    it('warns of a clash with the Teacher’s own Cell and saves anyway (owner, 2026-11-20)', async () => {
      await tick(coordinator, true).expect(200);
      const id = ((await openClass(coordinator).expect(201)).body as { id: string }).id;

      const asked = await get(
        coordinator,
        `equipping/coordinate/classes/${id}/clash?person_id=${mario.id}`,
      ).expect(200);
      expect(asked.body).toEqual({ clash: { day_of_week: 2, time_of_day: '19:30' } });

      const named = await post(coordinator, `equipping/classes/${id}/teacher`, {
        teacher_person_id: mario.id,
      }).expect(200);
      expect((named.body as { clash: unknown }).clash).toEqual({
        day_of_week: 2,
        time_of_day: '19:30',
      });

      const later = await openClass(coordinator, {
        name: 'Life Class C',
        time_of_day: '21:30',
      }).expect(201);
      const clear = await get(
        coordinator,
        `equipping/coordinate/classes/${(later.body as { id: string }).id}/clash?person_id=${mario.id}`,
      ).expect(200);
      expect(clear.body).toEqual({ clash: null });

      // Every check is recorded under Lookups, a clash or not (owner, 2026-11-20).
      const checks = await db
        .selectFrom('audit_log')
        .select(['after'])
        .where('actor_id', '=', coordinator.id)
        .where('action', '=', 'equipping_class.clash_checked')
        .execute();
      expect(checks.length).toBeGreaterThanOrEqual(2);

      // Asked of somebody who may not teach, it says nothing of their week.
      const notATeacher = await get(
        coordinator,
        `equipping/coordinate/classes/${id}/clash?person_id=${nico.id}`,
      ).expect(200);
      expect(notATeacher.body).toEqual({ clash: null });

      // Named on opening, the Teacher is checked the same way.
      const opened = await openClass(coordinator, {
        name: 'Life Class B',
        teacher_person_id: mario.id,
      }).expect(201);
      expect((opened.body as { clash: unknown }).clash).toEqual({
        day_of_week: 2,
        time_of_day: '19:30',
      });
    });
  });
});
