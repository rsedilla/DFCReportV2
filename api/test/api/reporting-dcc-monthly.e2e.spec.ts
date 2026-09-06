import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/reports/dcc/monthly` — the first reporting route, and the first thing in
 * this system authorized by a **dated** walk of the pastoral tree (SKILL.md sections 7,
 * 9, 12, 20 and 22; decisions 0207 and 0214).
 *
 * **Authorization is tested here rather than only against the service**, because the API
 * is the sole authority for it (`CLAUDE.md`, Definition of Done). Every case below asks
 * the question a client asks: a request, a status, and a body.
 *
 * **The dated cases are the point of the slice.** `ancestorsOf` filters
 * `ended_at IS NULL`, so before this the guard could only answer about *now* — and
 * decision 0207 requires a leader to be able to read October's figures for somebody who
 * left their subtree in November. The two cases that pin that are `left in November` and
 * `joined in November`, and they are the ones that fail if the walk is swapped back to the
 * undated one.
 *
 * The tree is `raymond -> manuel -> mark`, which is `CLAUDE.md`'s example tree, and
 * `drifter`, who moves between subtrees. Fixture names and email addresses are invented
 * (`CLAUDE.md`, Secrets).
 */
describe('GET /api/v1/reports/dcc/monthly (sections 7, 20 and 22)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let drifter: TestPerson;

  let raymondAccount: TestAccount;
  let markAccount: TestAccount;
  let adminAccount: TestAccount;

  /** October 2026 is the reported month throughout; November is where people move. */
  const OCTOBER = '2026-10-01';
  const IN_OCTOBER = new Date('2026-10-05T10:00:00+08:00');
  const IN_NOVEMBER = new Date('2026-11-05T10:00:00+08:00');

  const get = (query: string, account: TestAccount) =>
    request(app.getHttpServer())
      .get(`/api/v1/reports/dcc/monthly?${query}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alvarez',
      network: 'MENS',
    });
    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Bautista', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    drifter = await createPerson(db, { firstName: 'Dante', lastName: 'Espino', network: 'MENS' });

    await assignTo(db, raymond.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
    adminAccount = await createAccount(app, db, { person: manuel, roles: ['ADMIN'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('the scope selector is the target (section 7)', () => {
    it('lets a Leader read their own subtree', async () => {
      const response = await get(
        `period=${OCTOBER}&scope=LEADER&leader_id=${mark.id}`,
        raymondAccount,
      );

      expect(response.status).toBe(200);
      expect(response.body.scope).toEqual({ kind: 'LEADER', personId: mark.id });
      expect(response.body.period).toBe(OCTOBER);
    });

    it('refuses a Leader a scope above them, and does not narrow it', async () => {
      const response = await get(`period=${OCTOBER}&scope=WHOLE_CHURCH`, markAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      // Section 7: never silently narrowed to what they do hold. A body carrying Mark's
      // own figures under a Whole Church heading is the failure this pins.
      expect(response.body).not.toHaveProperty('uniquePeople');
    });

    it('refuses a Leader their own upline', async () => {
      const response = await get(
        `period=${OCTOBER}&scope=LEADER&leader_id=${raymond.id}`,
        markAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    /**
     * **A disjoint branch, which the case above is not.** `raymond -> manuel -> mark` has
     * no sibling, so asking Mark for Raymond tests the upline direction twice and the
     * sideways direction never — and sideways is `CLAUDE.md`'s first authorization case.
     */
    it('refuses a Leader a branch disjoint from their own', async () => {
      const sibling = await createPerson(db, {
        firstName: 'Noel',
        lastName: 'Fajardo',
        network: 'MENS',
      });
      await assignTo(db, sibling.id, raymond.id);

      const response = await get(
        `period=${OCTOBER}&scope=LEADER&leader_id=${sibling.id}`,
        markAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('lets Admin read Whole Church', async () => {
      const response = await get(`period=${OCTOBER}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(200);
      expect(response.body.scope).toEqual({ kind: 'WHOLE_CHURCH' });
    });
  });

  /**
   * The half decision 0207 requires and the undated walk refused. Both cases move
   * `drifter` in **November** and ask about **October**, so the answer turns entirely on
   * which tree the guard walks.
   */
  describe('the selector resolves as of the period reported (decision 0207)', () => {
    it('admits somebody who was in the subtree in October and left in November', async () => {
      await assignTo(db, drifter.id, mark.id, IN_OCTOBER);
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: IN_NOVEMBER })
        .where('person_id', '=', drifter.id)
        .execute();
      await assignTo(db, drifter.id, raymond.id, IN_NOVEMBER);

      const response = await get(
        `period=${OCTOBER}&scope=LEADER&leader_id=${drifter.id}`,
        markAccount,
      );

      // Under `ancestorsOf` this is a 403: in force *now*, `drifter` is Raymond's.
      expect(response.status).toBe(200);
    });

    /**
     * **The case `started_at` alone cannot decide**, and the reason this is here: in the
     * two cases either side, the November row's `started_at` is already past the period's
     * end, so the walk excludes it whether or not `ended_at` is consulted. A mutation
     * dropping the `ended_at` half of the predicate survived both of them.
     *
     * Here both rows begin *before* the period ends, so only `ended_at` separates them.
     */
    it('refuses somebody who left the subtree before the period began', async () => {
      const LEFT_IN_SEPTEMBER = new Date('2026-09-10T10:00:00+08:00');

      await assignTo(db, drifter.id, mark.id, new Date('2026-01-05T10:00:00+08:00'));
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: LEFT_IN_SEPTEMBER })
        .where('person_id', '=', drifter.id)
        .execute();
      await assignTo(db, drifter.id, raymond.id, LEFT_IN_SEPTEMBER);

      const response = await get(
        `period=${OCTOBER}&scope=LEADER&leader_id=${drifter.id}`,
        markAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses somebody who joined the subtree only in November', async () => {
      await assignTo(db, drifter.id, raymond.id, IN_OCTOBER);
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: IN_NOVEMBER })
        .where('person_id', '=', drifter.id)
        .execute();
      await assignTo(db, drifter.id, mark.id, IN_NOVEMBER);

      const response = await get(
        `period=${OCTOBER}&scope=LEADER&leader_id=${drifter.id}`,
        markAccount,
      );

      // The mirror of the case above, and the one an undated walk would *admit*.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });
  });

  /**
   * Decision 0214's fail-closed answer. `NetworksService.currentNetwork` is undated, so
   * resolving a `NETWORK` grant here would authorize October against a November Network.
   * `CLAUDE.md` carries that as a Stop Condition; until it is settled the route refuses.
   */
  describe('a NETWORK grant is refused rather than resolved (decision 0214)', () => {
    it('refuses a Network-scoped grant of reports.view_subtree', async () => {
      const outsider = await createPerson(db, {
        firstName: 'Noel',
        lastName: 'Fajardo',
        network: 'MENS',
      });
      await assignTo(db, outsider.id, raymond.id);
      const grantee = await createAccount(app, db, { person: outsider, roles: [] });
      await db
        .insertInto('capability_grants')
        .values({
          account_id: grantee.id,
          capability: 'reports.view_subtree',
          scope_type: 'NETWORK',
          scope_network: 'MENS',
          read_only: true,
          reason: 'A Network-scoped reporting grant, which has no dated resolution.',
          granted_by: adminAccount.id,
        })
        .execute();

      const response = await get(`period=${OCTOBER}&scope=LEADER&leader_id=${mark.id}`, grantee);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      // **The message names the grant, not the record.** No target works for a Network
      // grant here, so "not over this record" would send an administrator looking for a
      // record when the thing to fix is the grant -- the distinction §7 already draws for
      // a capability granted too narrowly.
      expect(response.body.error.message).toContain('Network');
      expect(response.body.error.details.scope_type).toBe('NETWORK');
    });
  });

  /**
   * `SUBTREE_EXCL_SELF` reaches this route only through an explicit Admin grant -- no role
   * default issues `reports.view_subtree` at that scope -- so without these two cases the
   * branch deciding whether a leader may read *their own* figures never runs, and flipping
   * `includeSelf` reddens nothing.
   */
  describe('a SUBTREE_EXCL_SELF grant excludes the actor themselves', () => {
    let excluded: TestAccount;

    beforeEach(async () => {
      const holder = await createPerson(db, {
        firstName: 'Grace',
        lastName: 'Hilario',
        network: 'MENS',
      });
      await assignTo(db, holder.id, raymond.id);

      excluded = await createAccount(app, db, { person: holder, roles: [] });
      await db
        .insertInto('capability_grants')
        .values({
          account_id: excluded.id,
          capability: 'reports.view_subtree',
          scope_type: 'SUBTREE_EXCL_SELF',
          read_only: true,
          reason: 'Exercises the branch no role default reaches.',
          granted_by: adminAccount.id,
        })
        .execute();
    });

    it('refuses the holder their own figures', async () => {
      const response = await get(
        `period=${OCTOBER}&scope=LEADER&leader_id=${excluded.personId}`,
        excluded,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('admits somebody beneath them', async () => {
      const beneath = await createPerson(db, {
        firstName: 'Ivan',
        lastName: 'Joson',
        network: 'MENS',
      });
      await assignTo(db, beneath.id, excluded.personId);

      const response = await get(
        `period=${OCTOBER}&scope=LEADER&leader_id=${beneath.id}`,
        excluded,
      );

      expect(response.status).toBe(200);
    });
  });

  describe('the request is refused at the edge before anything is computed', () => {
    it('refuses a month that is not the first of one', async () => {
      const response = await get(`period=2026-10-15&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('query.period');
    });

    it('refuses a scope it does not compute, at the guard rather than the DTO', async () => {
      const response = await get(`period=${OCTOBER}&scope=NETWORK`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      // The guard reads `scope` before the DTO does, so its field name is the one a
      // client sees. Asserting the code alone cannot tell the two refusals apart.
      expect(response.body.error.details.field).toBe('query.scope');
    });

    it('refuses a leader_id sent with WHOLE_CHURCH rather than ignoring it', async () => {
      const response = await get(
        `period=${OCTOBER}&scope=WHOLE_CHURCH&leader_id=${mark.id}`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('leader_id');
    });

    it('refuses LEADER with no leader_id', async () => {
      const response = await get(`period=${OCTOBER}&scope=LEADER`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  it('is closed to an account holding no reporting capability', async () => {
    const grantless = await createAccount(app, db, { person: drifter, roles: [] });

    const response = await get(`period=${OCTOBER}&scope=WHOLE_CHURCH`, grantless);

    expect(response.status).toBe(403);
    // §22 makes the two 403s deliberately distinct: an administrator diagnosing this
    // needs to know whether to add a capability or widen a scope. Asserting the status
    // alone passes under either and would not notice them being swapped.
    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
  });
});
