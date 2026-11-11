import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The Network Admin files Growth records for a leader, and the limits (SKILL.md sections 7,
 * 14, 27 and 28, decision 0469, point 5): SUYNL lessons and Training graduations of their
 * own Network, each recorded as on behalf. A Network root's own records and the other
 * Network stay out of reach. Conquest has no route that files anything. Every name is
 * invented (CLAUDE.md, Secrets).
 *
 * The tree: Wilma (Women's root, no account) -> Wanda (Leader account) -> Winnie, and
 * Wilma -> Wendy. Mario (Men's root) -> Manny (Leader account) -> Milo. Nora is the Women's
 * Network Admin, Noel the Men's and Ada the Admin, all outside the tree.
 */
describe('the Network Admin files Growth records for a leader (decision 0469)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let networkAdmin: TestAccount;
  let mensAdmin: TestAccount;
  let womensRoot: TestPerson;
  let mensRoot: TestPerson;
  let wanda: TestPerson;
  let wandaAccount: TestAccount;
  let wendy: TestPerson;
  let winnie: TestPerson;
  let manny: TestPerson;
  let milo: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);

    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ada', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    womensRoot = await createPerson(db, { firstName: 'Wilma', network: 'WOMENS' });
    await assignTo(db, womensRoot.id, null);
    mensRoot = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mensRoot.id, null);

    wanda = await createPerson(db, { firstName: 'Wanda', network: 'WOMENS' });
    await assignTo(db, wanda.id, womensRoot.id);
    wendy = await createPerson(db, { firstName: 'Wendy', network: 'WOMENS' });
    await assignTo(db, wendy.id, womensRoot.id);
    winnie = await createPerson(db, { firstName: 'Winnie', network: 'WOMENS' });
    await assignTo(db, winnie.id, wanda.id);

    manny = await createPerson(db, { firstName: 'Manny', network: 'MENS' });
    await assignTo(db, manny.id, mensRoot.id);
    milo = await createPerson(db, { firstName: 'Milo', network: 'MENS' });
    await assignTo(db, milo.id, manny.id);

    wandaAccount = await createAccount(app, db, { person: wanda, roles: ['LEADER'] });
    await createAccount(app, db, { person: manny, roles: ['LEADER'] });

    networkAdmin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['NETWORK_ADMIN'],
    });
    mensAdmin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Noel', network: 'MENS' }),
      roles: ['NETWORK_ADMIN'],
    });
  });

  const post = (account: TestAccount, path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const refused = (response: request.Response): [number, string] => [
    response.status,
    (response.body.error?.code ?? response.body.code) as string,
  ];

  const lastAudit = (action: string, targetId: string) =>
    db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action as never)
      .where('target_id', '=', targetId)
      .orderBy('occurred_at', 'desc')
      .executeTakeFirstOrThrow();

  /** The Admin corrects a person's sex, which moves them to the Men's Network under Manny. */
  const moveToMens = (person: TestPerson) =>
    request(app.getHttpServer())
      .put(`/api/v1/people/${person.id}/sex`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ sex: 'MALE', reason: 'Entered in error.', pastoral_leader_id: manny.id })
      .expect(200);

  const rowsOf = async (account: TestAccount, path: string) =>
    new Map(
      (
        (await get(account, `${path}?limit=100`).expect(200)).body.data as {
          person_id: string;
          may_file: boolean;
        }[]
      ).map((row) => [row.person_id, row.may_file]),
    );

  describe('SUYNL', () => {
    const tick = (account: TestAccount, person: TestPerson, lesson = 1) =>
      post(account, '/suynl/submit', {
        changes: [{ person_id: person.id, lesson, done: true }],
      });

    const current = (person: TestPerson, lesson = 1) =>
      db
        .selectFrom('suynl_lessons')
        .selectAll()
        .where('person_id', '=', person.id)
        .where('lesson', '=', lesson)
        .where('superseded_at', 'is', null)
        .executeTakeFirst();

    it('files a lesson for a leader’s disciple, as on behalf', async () => {
      await tick(networkAdmin, winnie).expect(201);

      const row = await current(winnie);
      expect(row?.confirmed_by).toBe(wanda.id);
      expect(row?.recorded_by).toBe(networkAdmin.id);
      expect((await lastAudit('suynl_lesson.confirmed', winnie.id)).after).toMatchObject({
        confirmed_by: wanda.id,
        on_behalf: true,
      });
    });

    it('files for a root’s disciple where the root holds no account, as on behalf', async () => {
      await tick(networkAdmin, wendy).expect(201);

      expect((await current(wendy))?.confirmed_by).toBe(womensRoot.id);
      expect((await lastAudit('suynl_lesson.confirmed', wendy.id)).after).toMatchObject({
        on_behalf: true,
      });
    });

    it('withdraws a lesson a leader filed, with a reason, as on behalf', async () => {
      await tick(wandaAccount, winnie).expect(201);
      const seen = await current(winnie);

      await post(networkAdmin, '/suynl/submit', {
        changes: [
          { person_id: winnie.id, lesson: 1, done: false, seen_id: seen?.id, reason: 'Not yet.' },
        ],
      }).expect(201);

      expect(await current(winnie)).toBeUndefined();
      const entry = await lastAudit('suynl_lesson.corrected', winnie.id);
      expect(entry.actor_id).toBe(networkAdmin.id);
      expect(entry.reason).toBe('Not yet.');
      expect(entry.after).toMatchObject({ on_behalf: true });
    });

    it('files for a root’s disciple where the root holds an account, as the root’s statement', async () => {
      await createAccount(app, db, { person: womensRoot, roles: ['LEADER'] });

      await tick(networkAdmin, wendy).expect(201);

      const row = await current(wendy);
      expect(row?.confirmed_by).toBe(womensRoot.id);
      expect(row?.recorded_by).toBe(networkAdmin.id);
      expect((await lastAudit('suynl_lesson.confirmed', wendy.id)).after).toMatchObject({
        on_behalf: true,
      });
    });

    it('files nothing for an archived person', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/people/${winnie.id}/archive`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'MOVED_AWAY' })
        .expect(200);

      expect(refused(await tick(networkAdmin, winnie))[1]).toBe('INVARIANT_VIOLATION');
      expect(await current(winnie)).toBeUndefined();
    });

    it('is refused a Network root’s own lessons, which the Admin files', async () => {
      expect(refused(await tick(networkAdmin, womensRoot))).toEqual([403, 'SCOPE_DENIED']);
      expect(await current(womensRoot)).toBeUndefined();
      await tick(admin, womensRoot).expect(201);
    });

    it('files nothing in the other Network, its root answered as anybody there is', async () => {
      const inScope = await tick(networkAdmin, milo);
      const root = await tick(networkAdmin, mensRoot);

      expect(refused(inScope)).toEqual([403, 'SCOPE_DENIED']);
      expect(root.body).toEqual({
        ...inScope.body,
        error: {
          ...inScope.body.error,
          details: { ...inScope.body.error.details, person_id: mensRoot.id },
        },
      });
      expect(await current(milo)).toBeUndefined();
    });

    it('is told on the list whom it may file for: its Network’s people, and no root', async () => {
      const rows = await rowsOf(networkAdmin, '/suynl/people');

      expect(rows.get(winnie.id)).toBe(true);
      expect(rows.get(wendy.id)).toBe(true);
      expect(rows.get(wanda.id)).toBe(true);
      expect(rows.get(womensRoot.id)).toBe(false);
      expect(rows.has(milo.id)).toBe(false);
    });

    it('follows the Network a person is in now, after a sex correction', async () => {
      await moveToMens(winnie);

      expect(refused(await tick(networkAdmin, winnie))).toEqual([403, 'SCOPE_DENIED']);
      await tick(mensAdmin, winnie).expect(201);
      expect((await current(winnie))?.confirmed_by).toBe(manny.id);
    });

    it('files nothing for an administrator outside the tree, and nothing for itself', async () => {
      const other = await createPerson(db, { firstName: 'Nina', network: 'WOMENS' });
      await createAccount(app, db, { person: other, roles: ['NETWORK_ADMIN'] });

      expect(refused(await tick(networkAdmin, other))[1]).toBe('INVARIANT_VIOLATION');
      expect(
        refused(await tick(networkAdmin, { id: networkAdmin.personId } as TestPerson)),
      ).toEqual([403, 'SCOPE_DENIED']);
      expect(await db.selectFrom('suynl_lessons').selectAll().execute()).toEqual([]);
    });

    it('still refuses a Leader a lesson of somebody they do not record', async () => {
      expect(refused(await tick(wandaAccount, wendy))[0]).toBe(403);
    });
  });

  describe('Training', () => {
    const graduate = (account: TestAccount, person: TestPerson, extra = {}) =>
      post(account, '/training/submit', {
        changes: [
          {
            person_id: person.id,
            program: 'LIFE_CLASS',
            graduated: true,
            graduated_on: '2019-03-10',
            ...extra,
          },
        ],
      });

    const current = (person: TestPerson) =>
      db
        .selectFrom('training_graduations')
        .selectAll()
        .where('person_id', '=', person.id)
        .where('program', '=', 'LIFE_CLASS')
        .where('superseded_at', 'is', null)
        .executeTakeFirst();

    it('files a graduation for a leader’s disciple, as on behalf', async () => {
      await graduate(networkAdmin, winnie).expect(201);

      const row = await current(winnie);
      expect(row?.confirmed_by).toBe(wanda.id);
      expect(row?.recorded_by).toBe(networkAdmin.id);
      expect((await lastAudit('training_graduation.confirmed', winnie.id)).after).toMatchObject({
        confirmed_by: wanda.id,
        on_behalf: true,
      });
    });

    it('corrects a graduation the Admin filed, with a reason', async () => {
      await graduate(admin, winnie).expect(201);
      const seen = await current(winnie);

      await graduate(networkAdmin, winnie, {
        graduated_on: '2019-03-17',
        seen_id: seen?.id,
        reason: 'Wrong week.',
      }).expect(201);

      const entry = await lastAudit('training_graduation.corrected', winnie.id);
      expect(entry.actor_id).toBe(networkAdmin.id);
      expect(entry.reason).toBe('Wrong week.');
      expect(entry.after).toMatchObject({ on_behalf: true });
      const row = await current(winnie);
      expect(row?.confirmed_by).toBe(wanda.id);
      expect(row?.recorded_by).toBe(networkAdmin.id);
    });

    it('is refused a Network root’s own graduation, which the Admin files', async () => {
      expect(refused(await graduate(networkAdmin, womensRoot))).toEqual([403, 'SCOPE_DENIED']);
      expect(await current(womensRoot)).toBeUndefined();
      await graduate(admin, womensRoot).expect(201);
    });

    it('files nothing in the other Network', async () => {
      const inScope = await graduate(networkAdmin, milo);
      const root = await graduate(networkAdmin, mensRoot);

      expect(refused(inScope)).toEqual([403, 'SCOPE_DENIED']);
      expect(root.body).toEqual({
        ...inScope.body,
        error: {
          ...inScope.body.error,
          details: { ...inScope.body.error.details, person_id: mensRoot.id },
        },
      });
      expect(await db.selectFrom('training_graduations').selectAll().execute()).toEqual([]);
    });

    it('is told on the list whom it may file for: its Network’s people, and no root', async () => {
      const rows = await rowsOf(networkAdmin, '/training/people');

      expect(rows.get(winnie.id)).toBe(true);
      expect(rows.get(womensRoot.id)).toBe(false);
      expect(rows.has(milo.id)).toBe(false);
    });

    it('follows the Network a person is in now, after a sex correction', async () => {
      await moveToMens(winnie);

      expect(refused(await graduate(networkAdmin, winnie))).toEqual([403, 'SCOPE_DENIED']);
      await graduate(mensAdmin, winnie).expect(201);
    });

    it('still refuses a Leader anybody outside their branch', async () => {
      expect(refused(await graduate(wandaAccount, wendy))).toEqual([403, 'SCOPE_DENIED']);
    });
  });

  it('files for somebody in the tree who holds an Admin account, whose page it cannot change (decision 0475)', async () => {
    const wynn = await createPerson(db, { firstName: 'Wynn', network: 'WOMENS' });
    await assignTo(db, wynn.id, wanda.id);
    await createAccount(app, db, { person: wynn, roles: ['ADMIN'] });

    expect((await get(networkAdmin, `/people/${wynn.id}`).expect(200)).body.read_only).toBe(true);

    await post(networkAdmin, '/suynl/submit', {
      changes: [{ person_id: wynn.id, lesson: 1, done: true }],
    }).expect(201);
    await post(networkAdmin, '/training/submit', {
      changes: [
        { person_id: wynn.id, program: 'LIFE_CLASS', graduated: true, graduated_on: '2019-03-10' },
      ],
    }).expect(201);

    for (const action of ['suynl_lesson.confirmed', 'training_graduation.confirmed']) {
      expect((await lastAudit(action, wynn.id)).after).toMatchObject({
        confirmed_by: wanda.id,
        on_behalf: true,
      });
    }
  });
});
