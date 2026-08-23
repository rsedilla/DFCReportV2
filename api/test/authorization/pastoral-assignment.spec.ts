import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp, EPOCH } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The eleven authorization cases of CLAUDE.md, Authorization test suite.
 *
 * **These were written before the endpoint, and failed until it existed.** Pastoral
 * assignment is the highest-risk authorization surface in the system, the cases are
 * derived entirely from SKILL.md section 5 and needed no implementation to exist,
 * and writing them first made guard behaviour the thing the API was built toward
 * rather than something verified afterwards, when it is expensive to change
 * (docs/ROADMAP.md, Stage 1). Nothing here was ever skipped, marked pending, or
 * inverted -- a test that passes because it expects failure stops being a test the
 * moment the feature arrives.
 *
 * They are green now and run in the main suite, so they gate `main` rather than
 * being reported beside it.
 *
 * **Three of them are weaker than their names suggest, and that is recorded rather
 * than hidden.** Cases 1 and 4, and the leader half of the root case, are denied by
 * the capability guard before the domain layer runs, because the guard's target is
 * the person and in each of those the person is outside the actor's subtree. They
 * prove the guard twice. What they claim to prove -- invariant 1's endpoint checks
 * and invariant 4's ancestors branch -- is pinned in
 * `test/api/pastoral-reassignment.e2e.spec.ts`, by an actor holding an explicit
 * Whole Church grant, which is the actor class those rules exist for and which no
 * fixture here has.
 *
 * ---
 *
 * **The contract these cases pin.**
 *
 *   PUT /api/v1/people/{id}/pastoral-leader
 *   Idempotency-Key: <client-generated UUID>
 *   { "leader_id": uuid, "effective_date": "YYYY-MM-DD"?, "reason": string? }
 *
 *   200                       the reassignment was recorded
 *   403 CAPABILITY_DENIED     the actor lacks people.manage_pastoral_assignment,
 *                             or lacks records.backdate_effective_date for a
 *                             backdated effective_date
 *   403 SCOPE_DENIED          the actor holds the capability but not over one of
 *                             the objects the operation touches
 *   409 INVARIANT_VIOLATION   the resulting record breaks a section 5 rule
 *   409 IDEMPOTENCY_KEY_REUSED  the key was used for a different request
 *   409 REQUEST_IN_FLIGHT     the first request with this key has not finished
 *
 * The header is not optional and is not a Stage 4 concern. Section 22 requires it
 * on every state-changing request "from the first write endpoint, not added
 * later", and this is that endpoint. Every case below sends one, so an
 * implementation that ignores the header passes these tests and an implementation
 * that rejects a request without one still passes them -- which is the point:
 * these cases pin authorization, and the idempotency layer is tested where it is
 * built. What they must not do is pin a contract section 22 forbids.
 *
 * Two of those deserve saying out loud, because section 22 does not map error
 * codes to individual rules and an implementer would otherwise have to guess.
 *
 * **Invariant 4 answers SCOPE_DENIED, not INVARIANT_VIOLATION.** A leader acting
 * on themselves or on an upline is a statement about the actor's authority over
 * the target, which is what SCOPE_DENIED means; INVARIANT_VIOLATION is for a
 * record the rules reject however it was submitted, such as a cycle or a
 * cross-Network edge. The two are distinguished so an administrator diagnosing a
 * denial learns which half failed, and that only works if the halves stay
 * distinct.
 *
 * **The domain layer answers, not the guard.** Section 5 requires the source
 * leader and the destination leader both to be in scope, and forbids the actor
 * acting on themselves or on anyone upline. That is three objects with three
 * different rules, and a grant carries one scope. The guard checks the primary
 * target; the `hierarchy` module checks the rest. A developer who implements the
 * guard and believes the rule is implemented has built half of it.
 */

const ENDPOINT = (personId: string): string => `/api/v1/people/${personId}/pastoral-leader`;

describe('reassigning a pastoral leader (SKILL.md section 5)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Men's Network: Oriel -> Ben -> Raymond -> Manuel -> Mark, and a sibling
  // branch Oriel -> Rico -> Juan that Raymond does not oversee.
  //
  // Ben exists so that Raymond has an upline who is not the Network root. A root
  // is protected by its own rule (section 5, Network roots), so a case built on
  // one would pass against an implementation that checks for a root and never
  // implements invariant 4 at all.
  let oriel: TestPerson;
  let ben: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let rico: TestPerson;
  let juan: TestPerson;

  // Women's Network: Geraldine -> Nora -> Bea, and Geraldine -> Cely.
  let geraldine: TestPerson;
  let nora: TestPerson;
  let bea: TestPerson;
  let cely: TestPerson;

  let raymondAccount: TestAccount;
  let orielAccount: TestAccount;
  let geraldineAccount: TestAccount;
  let adminAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

    geraldine = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
    nora = await createPerson(db, { firstName: 'Nora', network: 'WOMENS' });
    bea = await createPerson(db, { firstName: 'Bea', network: 'WOMENS' });
    cely = await createPerson(db, { firstName: 'Cely', network: 'WOMENS' });

    // Each Network has exactly one root leader, with no pastoral assignment above
    // them. That is the intended state, not missing data (section 5).
    await assignTo(db, oriel.id, null);
    await assignTo(db, geraldine.id, null);

    await assignTo(db, ben.id, oriel.id);
    await assignTo(db, raymond.id, ben.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, rico.id, oriel.id);
    await assignTo(db, juan.id, rico.id);

    await assignTo(db, nora.id, geraldine.id);
    await assignTo(db, bea.id, nora.id);
    await assignTo(db, cely.id, geraldine.id);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    orielAccount = await createAccount(app, db, {
      person: oriel,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    geraldineAccount = await createAccount(app, db, {
      person: geraldine,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 2,
    });
    adminAccount = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('1. refuses to let a leader pull a person from a sibling branch into their own subtree', async () => {
    // Validating only the destination would let an actor pull people in from a
    // branch they do not oversee. Juan sits under Rico, and Raymond oversees
    // neither.
    const response = await reassign(raymondAccount, juan.id, manuel.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('SCOPE_DENIED');
    await expectLeaderUnchanged(mark.id, manuel.id);
    await expectLeaderUnchanged(juan.id, rico.id);
  });

  it('2. refuses to let a leader push a person out of their own subtree', async () => {
    // Validating only the source would let an actor move people out of their
    // authorized scope and lose them. Rico is outside Raymond's subtree.
    const response = await reassign(raymondAccount, mark.id, rico.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('SCOPE_DENIED');
    await expectLeaderUnchanged(mark.id, manuel.id);
  });

  it('3. refuses to let a leader change their own pastoral assignment', async () => {
    // Otherwise a leader can detach themselves from their own leader or re-attach
    // themselves higher in the tree: privilege escalation through the org chart,
    // since authorized scope is derived from tree position.
    const response = await reassign(raymondAccount, raymond.id, rico.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('SCOPE_DENIED');
    await expectLeaderUnchanged(raymond.id, ben.id);
  });

  it('4. refuses to let a leader change the assignment of anyone upline of them', async () => {
    // Ben is Raymond's own leader. Without this rule a leader can re-attach their
    // upline, or themselves, higher in the tree -- privilege escalation through
    // the org chart, since authorized scope is derived from tree position.
    const response = await reassign(raymondAccount, ben.id, rico.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('SCOPE_DENIED');
    await expectLeaderUnchanged(ben.id, oriel.id);
  });

  // Beyond the eleven, and from section 5, Network roots rather than from the
  // CLAUDE.md list. It is here because case 4 used to be written against the root
  // and so proved this instead of what it claimed.
  it('refuses to reassign a Network root, Admin included', async () => {
    const byLeader = await reassign(raymondAccount, oriel.id, rico.id);
    expect(byLeader.status).toBe(403);

    const byAdmin = await reassign(adminAccount, oriel.id, rico.id);
    expect([403, 409]).toContain(byAdmin.status);

    // A root has no leader above them. That is the intended state, not missing
    // data, and no write may give them one.
    const assignment = await openAssignment(oriel.id);
    expect(assignment?.leader_id ?? null).toBeNull();
  });

  it('5. rejects an assignment under one of the person own descendants as a cycle', async () => {
    // Manuel under Mark, where Mark is already below Manuel. Recursive subtree
    // queries would fail to terminate, so this is rejected before writing.
    const response = await reassign(adminAccount, manuel.id, mark.id);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    await expectLeaderUnchanged(manuel.id, raymond.id);
    await expectLeaderUnchanged(mark.id, manuel.id);
  });

  it('6. rejects an assignment whose leader and person belong to different Networks', async () => {
    // Reassignment never changes a person's Network. If a person genuinely belongs
    // in the other one, that is a separate, explicit, audited Network change, and
    // it happens first.
    const response = await reassign(adminAccount, mark.id, nora.id);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    await expectLeaderUnchanged(mark.id, manuel.id);

    const network = await db
      .selectFrom('network_assignments')
      .select('network')
      .where('person_id', '=', mark.id)
      .where('ended_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(network.network).toBe('MENS');
  });

  it('7. leaves exactly one active assignment under concurrent writes', async () => {
    // Exercised concurrently, not only sequentially: a sequential test passes
    // against application-layer checks alone and will not detect a missing
    // database constraint (CLAUDE.md).
    const responses = await Promise.all([
      reassign(adminAccount, mark.id, raymond.id),
      reassign(adminAccount, mark.id, rico.id),
      reassign(adminAccount, mark.id, oriel.id),
    ]);

    for (const response of responses) {
      // Either the write won or it lost. It never fails in a way that says the
      // server did not understand what happened.
      expect([200, 409]).toContain(response.status);
      if (response.status === 409) {
        expect(['INVARIANT_VIOLATION', 'VERSION_CONFLICT']).toContain(response.body.error.code);
      }
    }

    const open = await db
      .selectFrom('pastoral_assignments')
      .select('id')
      .where('person_id', '=', mark.id)
      .where('ended_at', 'is', null)
      .execute();

    expect(open).toHaveLength(1);
  });

  it('8. lets Bishop Oriel reassign within the Women Network, and Pastora Geraldine within the Men', async () => {
    // The actor crosses Networks; the edge never does.
    const inWomens = await reassign(orielAccount, bea.id, cely.id);
    expect(inWomens.status).toBe(200);
    await expectLeaderUnchanged(bea.id, cely.id);

    const inMens = await reassign(geraldineAccount, mark.id, raymond.id);
    expect(inMens.status).toBe(200);
    await expectLeaderUnchanged(mark.id, raymond.id);
  });

  it('9. moves a leader whole subtree with them, rewriting no descendant assignment', async () => {
    const markBefore = await openAssignment(mark.id);
    expect(markBefore).not.toBeNull();

    const response = await reassign(adminAccount, manuel.id, rico.id);
    expect(response.status).toBe(200);

    // Only the reassigned person's own row changes.
    await expectLeaderUnchanged(manuel.id, rico.id);

    const markAfter = await openAssignment(mark.id);
    expect(markAfter).toEqual(markBefore);

    // Never rewrite or denormalize descendant assignments: a partial rewrite
    // silently detaches a branch, and the descendants disappear from the moved
    // leader's totals while appearing under no one.
    const markRows = await db
      .selectFrom('pastoral_assignments')
      .select('id')
      .where('person_id', '=', mark.id)
      .execute();
    expect(markRows).toHaveLength(1);
  });

  it('10. refuses to reassign an archived Person', async () => {
    // Restore them to CURRENT first, which is an explicit, separately authorized
    // decision. Keeping the two apart stops an archived record re-entering a
    // leader's current totals through a side door.
    await db
      .updateTable('person_lifecycle')
      .set({ ended_at: new Date() })
      .where('person_id', '=', mark.id)
      .where('ended_at', 'is', null)
      .execute();

    await db
      .insertInto('person_lifecycle')
      .values({
        person_id: mark.id,
        state: 'ARCHIVED',
        reason: 'NO_LONGER_IN_CURRENT_NETWORK',
        started_at: new Date(),
      })
      .execute();

    const response = await reassign(adminAccount, mark.id, raymond.id);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    await expectLeaderUnchanged(mark.id, manuel.id);
  });

  it('11. refuses to let a non-Admin backdate an assignment effective date', async () => {
    // Backdating silently rewrites which leader a person belonged to during a past
    // period, changing totals for periods already reported. It is a separate
    // capability, held by Admin only, and always with a reason.
    const response = await reassign(raymondAccount, mark.id, raymond.id, {
      effective_date: '2026-01-01',
      reason: 'Correcting an earlier record.',
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    await expectLeaderUnchanged(mark.id, manuel.id);

    const rows = await db
      .selectFrom('pastoral_assignments')
      .select('started_at')
      .where('person_id', '=', mark.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].started_at.getTime()).toBe(EPOCH.getTime());
  });

  function reassign(
    actor: TestAccount,
    personId: string,
    leaderId: string,
    extra: Record<string, unknown> = {},
  ) {
    return (
      request(app.getHttpServer())
        .put(ENDPOINT(personId))
        .set('Authorization', `Bearer ${actor.accessToken}`)
        // Client-generated, one per request, as section 22 and section 23 require.
        // A leader on an unreliable connection will retry, and a retry must never
        // create a second record.
        .set('Idempotency-Key', randomUUID())
        .send({ leader_id: leaderId, ...extra })
    );
  }

  async function openAssignment(
    personId: string,
  ): Promise<{ id: string; leader_id: string | null; started_at: Date } | null> {
    const row = await db
      .selectFrom('pastoral_assignments')
      .select(['id', 'leader_id', 'started_at'])
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

    return row ?? null;
  }

  async function expectLeaderUnchanged(personId: string, leaderId: string): Promise<void> {
    const assignment = await openAssignment(personId);

    expect(assignment).not.toBeNull();
    expect(assignment?.leader_id).toBe(leaderId);
  }
});
