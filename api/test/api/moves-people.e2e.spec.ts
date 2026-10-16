import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * Moves people (SKILL.md sections 5 and 7, decision 0356), pinned at the API as the
 * ruling's "What the build owes" asks: who may tick it, what it gives, and what a Leader
 * without it may do. The section 5 invariants a ticked mover meets are pinned in
 * `test/authorization/pastoral-assignment.spec.ts`, case 12 among them.
 *
 * ```text
 * Oriel (Men's root, SENIOR_PASTOR account)
 * ├── Elena     (LEADER, a Primary, ticked Moves people)
 * │   ├── Corazon  (LEADER, not ticked)
 * │   │   └── Marilou
 * │   └── Teresa
 * └── Rosa      (LEADER, a Primary, not ticked)
 *     └── Lito
 * Ester (Women's, outside the tree, ADMIN account)
 * ```
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('Moves people (decision 0356)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let orielAccount: TestAccount;
  let admin: TestAccount;
  let elena: TestPerson;
  let elenaAccount: TestAccount;
  let corazonAccount: TestAccount;
  let marilou: TestPerson;
  let teresa: TestPerson;
  let rosaAccount: TestAccount;
  let lito: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    nameSeniorPastors(app, [oriel.id]);
    orielAccount = await createAccount(app, db, {
      person: oriel,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });

    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    elena = await createPerson(db, { firstName: 'Elena', network: 'MENS' });
    await assignTo(db, elena.id, oriel.id);
    elenaAccount = await createAccount(app, db, {
      person: elena,
      roles: ['LEADER'],
      movesPeople: true,
    });

    const corazon = await createPerson(db, { firstName: 'Corazon', network: 'MENS' });
    await assignTo(db, corazon.id, elena.id);
    corazonAccount = await createAccount(app, db, { person: corazon, roles: ['LEADER'] });

    marilou = await createPerson(db, { firstName: 'Marilou', network: 'MENS' });
    await assignTo(db, marilou.id, corazon.id);

    teresa = await createPerson(db, { firstName: 'Teresa', network: 'MENS' });
    await assignTo(db, teresa.id, elena.id);

    const rosa = await createPerson(db, { firstName: 'Rosa', network: 'MENS' });
    await assignTo(db, rosa.id, oriel.id);
    rosaAccount = await createAccount(app, db, { person: rosa, roles: ['LEADER'] });

    lito = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
    await assignTo(db, lito.id, rosa.id);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const http = () => request(app.getHttpServer());

  const setMovesPeople = (actor: TestAccount, accountId: string, value: unknown) =>
    http()
      .post(`/api/v1/accounts/${accountId}/moves-people`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ moves_people: value });

  const setFullView = (actor: TestAccount, accountId: string, value: boolean) =>
    http()
      .post(`/api/v1/accounts/${accountId}/full-view`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ full_view: value });

  const move = (actor: TestAccount, personId: string, leaderId: string) =>
    http()
      .put(`/api/v1/people/${personId}/pastoral-leader`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ pastoral_leader_id: leaderId });

  const me = (account: TestAccount) =>
    http().get('/api/v1/auth/me').set('Authorization', `Bearer ${account.accessToken}`);

  async function leaderOf(personId: string): Promise<string | null> {
    const row = await db
      .selectFrom('pastoral_assignments')
      .select('leader_id')
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .executeTakeFirstOrThrow();
    return row.leader_id;
  }

  async function moveScopes(account: TestAccount): Promise<string[]> {
    const held = (await me(account).expect(200)).body.capabilities as {
      capability: string;
      scope_type: string;
    }[];
    return held
      .filter((grant) => grant.capability === 'people.manage_pastoral_assignment')
      .map((grant) => grant.scope_type);
  }

  describe('who moves people', () => {
    it('lets a ticked Primary move somebody in their branch at once', async () => {
      await move(elenaAccount, marilou.id, teresa.id).expect(200);
      expect(await leaderOf(marilou.id)).toBe(teresa.id);
    });

    it('refuses a Leader without the tick, inside their own branch', async () => {
      const response = await move(corazonAccount, marilou.id, teresa.id).expect(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      expect(await leaderOf(marilou.id)).not.toBe(teresa.id);
    });

    it('refuses a ticked Primary a move to another branch, which the Admin then makes', async () => {
      const refused = await move(elenaAccount, marilou.id, lito.id).expect(403);
      expect(refused.body.error.code).toBe('SCOPE_DENIED');

      await move(admin, marilou.id, lito.id).expect(200);
      expect(await leaderOf(marilou.id)).toBe(lito.id);
    });

    it('lets a Senior Pastor move across branches directly', async () => {
      await move(orielAccount, marilou.id, lito.id).expect(200);
      expect(await leaderOf(marilou.id)).toBe(lito.id);
    });

    it('gives the capability over the own subtree to a ticked Leader, and nothing to one without the tick', async () => {
      expect(await moveScopes(elenaAccount)).toEqual(['OWN_SUBTREE']);
      expect(await moveScopes(rosaAccount)).toEqual([]);
    });
  });

  describe('ticking and clearing Moves people', () => {
    it('is admitted to an Admin, gives the capability over the own subtree, and each change is audit logged', async () => {
      const ticked = await setMovesPeople(admin, rosaAccount.id, true).expect(200);
      expect(ticked.body).toEqual({ id: rosaAccount.id, moves_people: true });
      expect(await moveScopes(rosaAccount)).toEqual(['OWN_SUBTREE']);

      await setMovesPeople(admin, rosaAccount.id, false).expect(200);
      expect(await moveScopes(rosaAccount)).toEqual([]);

      const entries = await db
        .selectFrom('audit_log')
        .select(['actor_id', 'target_type', 'target_id', 'before', 'after'])
        .where('action', '=', 'account.moves_people_changed')
        .orderBy('occurred_at')
        .execute();

      expect(entries).toEqual([
        {
          actor_id: admin.id,
          target_type: 'account',
          target_id: rosaAccount.id,
          before: { moves_people: false },
          after: { moves_people: true },
        },
        {
          actor_id: admin.id,
          target_type: 'account',
          target_id: rosaAccount.id,
          before: { moves_people: true },
          after: { moves_people: false },
        },
      ]);
    });

    it('writes nothing and logs nothing when the value is already set', async () => {
      const response = await setMovesPeople(admin, elenaAccount.id, true).expect(200);
      expect(response.body).toEqual({ id: elenaAccount.id, moves_people: true });

      const entries = await db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'account.moves_people_changed')
        .execute();
      expect(entries).toEqual([]);
    });

    it('is refused to a Leader, ticked or not, and to a Senior Pastor', async () => {
      for (const actor of [elenaAccount, corazonAccount, orielAccount]) {
        for (const value of [true, false]) {
          const response = await setMovesPeople(actor, rosaAccount.id, value).expect(403);
          expect(response.body.error.code).toBe('CAPABILITY_DENIED');
        }
      }
    });

    it('is refused on an account holding no Leader role', async () => {
      const response = await setMovesPeople(admin, orielAccount.id, true).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses a body that is not a boolean', async () => {
      const response = await setMovesPeople(admin, rosaAccount.id, 'yes').expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('is refused on a Leader account without Full view', async () => {
      await setFullView(admin, rosaAccount.id, false).expect(200);

      const response = await setMovesPeople(admin, rosaAccount.id, true).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      const row = await db
        .selectFrom('accounts')
        .select('moves_people')
        .where('id', '=', rosaAccount.id)
        .executeTakeFirstOrThrow();
      expect(row.moves_people).toBe(false);
    });

    it('is cleared with Full view, with Approves Cells, each audited as its own change', async () => {
      await db
        .updateTable('accounts')
        .set({ approves_cells: true })
        .where('id', '=', elenaAccount.id)
        .execute();

      await setFullView(admin, elenaAccount.id, false).expect(200);

      const row = await db
        .selectFrom('accounts')
        .select(['full_view', 'approves_cells', 'moves_people'])
        .where('id', '=', elenaAccount.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ full_view: false, approves_cells: false, moves_people: false });

      const actions = await db
        .selectFrom('audit_log')
        .select(['action', 'before', 'after'])
        .where('target_id', '=', elenaAccount.id)
        .orderBy('action')
        .execute();
      expect(actions).toEqual([
        {
          action: 'account.approves_cells_changed',
          before: { approves_cells: true },
          after: { approves_cells: false },
        },
        {
          action: 'account.full_view_changed',
          before: { full_view: true },
          after: { full_view: false },
        },
        {
          action: 'account.moves_people_changed',
          before: { moves_people: true },
          after: { moves_people: false },
        },
      ]);
      expect(await moveScopes(elenaAccount)).toEqual([]);
    });

    it('cannot be held without Full view, by the database too', async () => {
      await expect(
        db
          .updateTable('accounts')
          .set({ full_view: false, moves_people: true })
          .where('id', '=', rosaAccount.id)
          .execute(),
      ).rejects.toThrow(/accounts_moves_people_needs_full_view/);
    });

    it('starts a new Leader account without it, and the account read says so', async () => {
      // A Leader account arrives with the Cell leadership that qualifies it (section 6).
      await createCell(db, { leader: teresa });

      await http()
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ person_id: teresa.id, email: 'teresa.mover@example.test', role: 'LEADER' })
        .expect(201);

      const read = await http()
        .get(`/api/v1/accounts/for-person/${teresa.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(read.body.account.moves_people).toBe(false);
    });
  });
});
