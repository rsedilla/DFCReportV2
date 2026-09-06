import request from 'supertest';

import { startOfNextManilaMonth } from '../../src/common/time/manila';
import { currentReportingMonth, databaseNow } from '../../src/common/time/submission-window';
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
 * decision 0207 requires a leader to be able to read the reported month's figures for
 * somebody who left their subtree after it. The two cases that pin that are `left after the
 * period` and `joined only after the period`, and they are the ones that fail if the walk is
 * swapped back to the undated one.
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

  /**
   * The reported month throughout, and the month after it is where people move.
   *
   * **Both are in the past, and named for their role rather than for a month** (decision
   * 0216). They were `2026-10-01` and November, written on 2026-09-07 — so every case in
   * this file asked for a period that had not begun, through four review passes, and
   * nothing could see it because no rule existed for anything to fail on. A month named
   * `OCTOBER` is a month somebody has to check the calendar to date; a month named for
   * what it does in the test cannot drift past the clock unnoticed.
   *
   * Fixed dates rather than clock-relative ones, because the tree these cases build is
   * dated and a moving period would move the assertions with it. The cases that pin the
   * boundary itself read the clock instead, and they are confined to one block — which is
   * a fact a reader can check by grepping that block's name, rather than a count that goes
   * stale the next time one is added. *It was a count, and was wrong one commit later.*
   */
  const REPORTED_MONTH = '2026-06-01';
  const IN_PERIOD = new Date('2026-06-05T10:00:00+08:00');
  const AFTER_PERIOD = new Date('2026-07-05T10:00:00+08:00');

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
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${mark.id}`,
        raymondAccount,
      );

      expect(response.status).toBe(200);
      expect(response.body.scope).toEqual({ kind: 'LEADER', personId: mark.id });
      expect(response.body.period).toBe(REPORTED_MONTH);
    });

    it('refuses a Leader a scope above them, and does not narrow it', async () => {
      const response = await get(`period=${REPORTED_MONTH}&scope=WHOLE_CHURCH`, markAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      // Section 7: never silently narrowed to what they do hold. A body carrying Mark's
      // own figures under a Whole Church heading is the failure this pins.
      expect(response.body).not.toHaveProperty('uniquePeople');
    });

    it('refuses a Leader their own upline', async () => {
      const response = await get(
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${raymond.id}`,
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
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${sibling.id}`,
        markAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('lets Admin read Whole Church', async () => {
      const response = await get(`period=${REPORTED_MONTH}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(200);
      expect(response.body.scope).toEqual({ kind: 'WHOLE_CHURCH' });
    });
  });

  /**
   * The half decision 0207 requires and the undated walk refused. Both cases move
   * `drifter` **after the reported period** and ask about the period, so the answer turns
   * entirely on which tree the guard walks.
   */
  describe('the selector resolves as of the period reported (decision 0207)', () => {
    it('admits somebody who was in the subtree during the period and left after it', async () => {
      await assignTo(db, drifter.id, mark.id, IN_PERIOD);
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: AFTER_PERIOD })
        .where('person_id', '=', drifter.id)
        .execute();
      await assignTo(db, drifter.id, raymond.id, AFTER_PERIOD);

      const response = await get(
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${drifter.id}`,
        markAccount,
      );

      // Under `ancestorsOf` this is a 403: in force *now*, `drifter` is Raymond's.
      expect(response.status).toBe(200);
    });

    /**
     * **The case `started_at` alone cannot decide**, and the reason this is here: in the
     * two cases either side, the later row's `started_at` is already past the period's
     * end, so the walk excludes it whether or not `ended_at` is consulted. A mutation
     * dropping the `ended_at` half of the predicate survived both of them.
     *
     * Here both rows begin *before* the period ends, so only `ended_at` separates them.
     */
    it('refuses somebody who left the subtree before the period began', async () => {
      const LEFT_BEFORE_PERIOD = new Date('2026-05-10T10:00:00+08:00');

      await assignTo(db, drifter.id, mark.id, new Date('2026-01-05T10:00:00+08:00'));
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: LEFT_BEFORE_PERIOD })
        .where('person_id', '=', drifter.id)
        .execute();
      await assignTo(db, drifter.id, raymond.id, LEFT_BEFORE_PERIOD);

      const response = await get(
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${drifter.id}`,
        markAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses somebody who joined the subtree only after the period', async () => {
      await assignTo(db, drifter.id, raymond.id, IN_PERIOD);
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: AFTER_PERIOD })
        .where('person_id', '=', drifter.id)
        .execute();
      await assignTo(db, drifter.id, mark.id, AFTER_PERIOD);

      const response = await get(
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${drifter.id}`,
        markAccount,
      );

      // The mirror of the case above, and the one an undated walk would *admit*.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });
  });

  /**
   * A `NETWORK` grant resolves through `network_as_of` at the instant the target carries
   * (decision 0217), which for this target is the period being reported.
   *
   * **The dated pair below is the point.** A grant naming the Men's Network must cover a
   * leader who was in it **at the instant the period resolves at** — its last millisecond,
   * not any point within it — whoever they are today, and
   * `currentNetwork`, which this branch used to be refused for lacking, answers about now.
   * Swapping the resolution back to it turns the first case red and leaves every other
   * case in this block green.
   *
   * *These replace two cases pinning decision 0215's outright refusal, made earlier on this
   * branch on the ground that no dated Network resolution existed. One did.*
   */
  describe('a NETWORK grant resolves as of the period (decision 0217)', () => {
    const SWITCHED_AT = new Date('2026-07-05T10:00:00+08:00');
    const AFTER_THE_SWITCH = '2026-07-01';

    /** An account holding `reports.view_subtree` at one Network and nothing else. */
    const granteeFor = async (network: 'MENS' | 'WOMENS'): Promise<TestAccount> => {
      const outsider = await createPerson(db, {
        firstName: 'Perla',
        lastName: 'Kalaw',
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
          scope_network: network,
          read_only: true,
          reason: 'A Network-scoped reporting grant, resolved as of the period reported.',
          granted_by: adminAccount.id,
        })
        .execute();

      return grantee;
    };

    /**
     * Somebody in the Men's Network for the reported month who is in the Women's Network
     * now. Written straight to `network_assignments` because section 4 reaches this state
     * only through `people.correct_sex`, and the correction endpoint is not what is under
     * test. They hold no pastoral edge, so nothing here is cross-Network.
     */
    const switcher = async (): Promise<TestPerson> => {
      const person = await createPerson(db, {
        firstName: 'Rosa',
        lastName: 'Limbaga',
        network: 'MENS',
      });

      await db
        .updateTable('network_assignments')
        .set({ ended_at: SWITCHED_AT })
        .where('person_id', '=', person.id)
        .execute();
      await db
        .insertInto('network_assignments')
        .values({
          person_id: person.id,
          network: 'WOMENS',
          reason: 'A fixture standing in for a section 4 correction.',
          actor_id: null,
          started_at: SWITCHED_AT,
        })
        .execute();

      return person;
    };

    it('admits a leader in the granted Network during the period, though not now', async () => {
      const person = await switcher();
      const grantee = await granteeFor('MENS');

      const response = await get(
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${person.id}`,
        grantee,
      );

      // Under `currentNetwork` this is a 403: as of now, `person` is in the Women's
      // Network. This is the case the whole ruling turns on.
      expect(response.status).toBe(200);
    });

    it('refuses the same leader for a period after they left the granted Network', async () => {
      const person = await switcher();
      const grantee = await granteeFor('MENS');

      const response = await get(
        `period=${AFTER_THE_SWITCH}&scope=LEADER&leader_id=${person.id}`,
        grantee,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('admits a leader whose Network never changed', async () => {
      const grantee = await granteeFor('MENS');

      const response = await get(
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${mark.id}`,
        grantee,
      );

      expect(response.status).toBe(200);
    });

    it('refuses a leader of the other Network', async () => {
      const grantee = await granteeFor('WOMENS');

      const response = await get(
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${mark.id}`,
        grantee,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    /**
     * **Whole Church is not narrowed to the Network**, which is section 7's non-narrowing
     * rule rather than anything about dates. The generic message is correct here and was
     * not under decision 0215: a Network grant now does cover records, so "another target
     * would work" is true.
     */
    it('refuses a Whole Church selector without narrowing it to the Network', async () => {
      const grantee = await granteeFor('MENS');

      const response = await get(`period=${REPORTED_MONTH}&scope=WHOLE_CHURCH`, grantee);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body).not.toHaveProperty('uniquePeople');
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
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${excluded.personId}`,
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
        `period=${REPORTED_MONTH}&scope=LEADER&leader_id=${beneath.id}`,
        excluded,
      );

      expect(response.status).toBe(200);
    });
  });

  /**
   * A report may not name a period that has not begun (decision 0216, SKILL.md section 20).
   *
   * **These are the only clock-relative cases in the file, and they are the boundary
   * itself.** Every other case uses a fixed past month, which is what keeps the dated tree
   * assertions stable; a fixed *future* month would pin this rule against a calendar that
   * eventually catches up with it, which is the drift that made the rule necessary.
   *
   * **The accepted case is the one that does the work.** Refusing next month is satisfied by
   * almost any comparison, including several wrong ones — a mutation comparing the period's
   * **end** to the clock refuses next month correctly and also refuses the *current* month,
   * whose end has not arrived either. Only asking for the current month can tell those
   * apart, and the current month is the boundary: its start is behind the clock and its end
   * is ahead of it.
   */
  describe('a period that has not begun (decision 0216)', () => {
    it('reports the current month, whose start is behind the clock and whose end is not', async () => {
      // **The database's clock, not this process's.** The rule under test compares against
      // `databaseNow`; deriving the month from `new Date()` would let a host clock a
      // millisecond ahead at a Manila month boundary ask for a month the service says has
      // not begun. That is the split decision 0160 names, and `currentReportingMonth` is
      // this repository's own answer to it.
      const thisMonth = await currentReportingMonth(db);

      const response = await get(`period=${thisMonth}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(200);
      expect(response.body.period).toBe(thisMonth);
      // Section 17: an open month says so. Named here because it is the fact that makes
      // the current month legitimately reportable while the next one is not.
      expect(response.body.open).toBe(true);
    });

    it('refuses the next month', async () => {
      const nextMonth = startOfNextManilaMonth(await databaseNow(db));

      const response = await get(`period=${nextMonth}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('period');
      // Not a report of zeroes. The calendar runs thirteen months ahead, so the body this
      // refusal replaces would have carried a real `n` and said nobody attended anything.
      expect(response.body).not.toHaveProperty('uniquePeople');
    });

    /**
     * **Authorization is answered first** (section 7's contents-ordering rule, decision
     * 0193), and decision 0216 relies on that rather than restating it: the refusal lives
     * in the service, so the guard has already run. Without this case the ordering is an
     * accident of where the check was put, and moving the check into the guard — which
     * decision 0216 rejects, because it would put a host-clock month comparison there —
     * would silently turn this 403 into a 422.
     */
    it('answers SCOPE_DENIED, not VALIDATION_FAILED, for a scope the actor does not hold', async () => {
      const nextMonth = startOfNextManilaMonth(await databaseNow(db));

      const response = await get(`period=${nextMonth}&scope=WHOLE_CHURCH`, markAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
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
      const response = await get(`period=${REPORTED_MONTH}&scope=NETWORK`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      // The guard reads `scope` before the DTO does, so its field name is the one a
      // client sees. Asserting the code alone cannot tell the two refusals apart.
      expect(response.body.error.details.field).toBe('query.scope');
    });

    it('refuses a leader_id sent with WHOLE_CHURCH rather than ignoring it', async () => {
      const response = await get(
        `period=${REPORTED_MONTH}&scope=WHOLE_CHURCH&leader_id=${mark.id}`,
        adminAccount,
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('leader_id');
    });

    it('refuses LEADER with no leader_id', async () => {
      const response = await get(`period=${REPORTED_MONTH}&scope=LEADER`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  it('is closed to an account holding no reporting capability', async () => {
    const grantless = await createAccount(app, db, { person: drifter, roles: [] });

    const response = await get(`period=${REPORTED_MONTH}&scope=WHOLE_CHURCH`, grantless);

    expect(response.status).toBe(403);
    // §22 makes the two 403s deliberately distinct: an administrator diagnosing this
    // needs to know whether to add a capability or widen a scope. Asserting the status
    // alone passes under either and would not notice them being swapped.
    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
  });
});
