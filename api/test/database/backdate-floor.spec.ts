import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createCell, createPerson, EPOCH } from '../setup/fixtures';

import { sql } from 'kysely';

import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';

/**
 * SKILL.md section 4's backdate floor, checked against the schema rather than
 * against the service that computes it.
 *
 * **These write raw SQL, deliberately.** A test that goes through
 * `PUT /people/{id}/sex` cannot tell a floor the service enforces from a floor the
 * database enforces, and the whole point of the rule is that at the wrong instant
 * there is *no legal write*. So each case performs the four-row atomic operation
 * by hand and asserts what `COMMIT` does with it.
 *
 * The rule under test is a property of **two** firings of
 * `assert_network_change_keeps_edges`, and the terms come from different ones.
 *
 * The first is the `UPDATE` closing the old Network row — first because the close
 * must precede the open, and a deferred trigger's events fire at commit in the
 * order they were queued. Its bound is *that row's* `started_at` rather than the
 * effective date, so it reaches nearly every edge the person has held. Term (a),
 * and term (b) at exact equality with a zero-length edge, both fail there. The
 * second is the `INSERT` of the new row, bounded by the effective date, and term
 * (b)'s ordinary case fails there.
 *
 * Fixture names and dates are invented (CLAUDE.md, Secrets).
 */
describe('the backdate floor is a property of the schema (section 4)', () => {
  let db: Kysely<Database>;

  const ASSIGNED_AT = new Date('2026-03-01T09:15:00+08:00');

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function openClient(): Promise<Client> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    return client;
  }

  /**
   * The whole operation section 4 mandates, at one instant: close the Network row,
   * open the new one, close the pastoral edge, open its replacement. Resolves to
   * whether `COMMIT` was accepted.
   *
   * The four rows share `effectiveAt` because section 4 requires it. Nothing here
   * varies that — the case that separates them by a microsecond is already pinned
   * in `invariants.spec.ts`.
   */
  async function attemptCorrection(options: {
    personId: string;
    toNetwork: 'MENS' | 'WOMENS';
    newLeaderId: string;
    effectiveAt: Date;
    /** Where the person holds no open edge, only the Network half is written. */
    reassign?: boolean;
  }): Promise<{ committed: boolean; error?: string }> {
    const client = await openClient();

    try {
      await client.query('BEGIN');
      await client.query('UPDATE network_assignments SET ended_at = $1 WHERE person_id = $2', [
        options.effectiveAt,
        options.personId,
      ]);
      await client.query(
        'INSERT INTO network_assignments (person_id, network, started_at) VALUES ($1, $2, $3)',
        [options.personId, options.toNetwork, options.effectiveAt],
      );

      if (options.reassign !== false) {
        await client.query(
          'UPDATE pastoral_assignments SET ended_at = $1 WHERE person_id = $2 AND ended_at IS NULL',
          [options.effectiveAt, options.personId],
        );
        await client.query(
          'INSERT INTO pastoral_assignments (person_id, leader_id, started_at) VALUES ($1, $2, $3)',
          [options.personId, options.newLeaderId, options.effectiveAt],
        );
      }

      await client.query('COMMIT');
      return { committed: true };
    } catch (error) {
      return { committed: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await client.end();
    }
  }

  describe('term (a): the started_at of the person current assignment', () => {
    it('refuses the correction at that instant, and accepts it one instant later', async () => {
      // Both halves in one case on purpose. Refusal alone is satisfied by a floor
      // that refuses everything, and acceptance alone by one that refuses nothing;
      // the pair is what pins the boundary in the place section 4 puts it.
      for (const [offsetMs, expected] of [
        [0, false],
        [1, true],
      ] as const) {
        await truncateAll(db);

        const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
        const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
        const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
        await assignTo(db, person.id, mensLeader.id, ASSIGNED_AT);

        const result = await attemptCorrection({
          personId: person.id,
          toNetwork: 'WOMENS',
          newLeaderId: womensLeader.id,
          effectiveAt: new Date(ASSIGNED_AT.getTime() + offsetMs),
        });

        // At the assignment's own start the correction closes it at zero length.
        // That row is selected by the `UPDATE` firing and compared at its own
        // timestamp, where the person already resolves to the corrected Network
        // and their old leader does not — so the edge was cross-Network for the
        // whole of its life and there is no instant at which it can be closed.
        expect({ offsetMs, committed: result.committed }).toEqual({
          offsetMs,
          committed: expected,
        });

        if (!expected) {
          expect(result.error).toMatch(/crossing Networks/);
        }
      }
    });
  });

  describe('term (b): the ended_at of an already-closed edge, in either direction', () => {
    it('refuses at the shared timestamp of a zero-length closed leader-side edge', async () => {
      // Section 4's second bullet, and the case that makes the bound *strictly*
      // later rather than at-or-after. It fails in the `UPDATE` firing: the
      // `INSERT` firing does not select an edge whose `ended_at` equals the
      // effective date. A zero-length row is inert as an answer and is still
      // examined, which section 5 states and which nothing else pins.
      const closedAt = new Date('2026-05-10T14:00:00+08:00');

      const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const formerDisciple = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

      await assignTo(db, person.id, mensLeader.id, EPOCH);

      // A row entered in error and closed at zero length (section 5), on which the
      // corrected person was the *leader*.
      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: formerDisciple.id,
          leader_id: person.id,
          started_at: closedAt,
          ended_at: closedAt,
        })
        .execute();

      const atTheFloor = await attemptCorrection({
        personId: person.id,
        toNetwork: 'WOMENS',
        newLeaderId: womensLeader.id,
        effectiveAt: closedAt,
      });

      expect(atTheFloor.committed).toBe(false);
      expect(atTheFloor.error).toMatch(/crossing Networks/);
    });

    it('accepts one instant after that timestamp', async () => {
      const closedAt = new Date('2026-05-10T14:00:00+08:00');

      const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const formerDisciple = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

      await assignTo(db, person.id, mensLeader.id, EPOCH);
      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: formerDisciple.id,
          leader_id: person.id,
          started_at: closedAt,
          ended_at: closedAt,
        })
        .execute();

      const result = await attemptCorrection({
        personId: person.id,
        toNetwork: 'WOMENS',
        newLeaderId: womensLeader.id,
        effectiveAt: new Date(closedAt.getTime() + 1),
      });

      expect(result.committed).toBe(true);
    });

    it('refuses before the ended_at of an ordinary closed edge', async () => {
      // The `INSERT` firing rather than the `UPDATE` one: an edge with
      // `ended_at > eff` is selected and compared where the person already
      // resolves to the corrected Network, and being closed it cannot be
      // reassigned to resolve what it reports.
      const openedAt = new Date('2026-04-01T10:00:00+08:00');
      const closedAt = new Date('2026-06-01T10:00:00+08:00');

      const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const formerDisciple = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

      await assignTo(db, person.id, mensLeader.id, EPOCH);
      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: formerDisciple.id,
          leader_id: person.id,
          started_at: openedAt,
          ended_at: closedAt,
        })
        .execute();

      const result = await attemptCorrection({
        personId: person.id,
        toNetwork: 'WOMENS',
        newLeaderId: womensLeader.id,
        effectiveAt: new Date(closedAt.getTime() - 1),
      });

      expect(result.committed).toBe(false);
      expect(result.error).toMatch(/crossing Networks/);
    });

    it('would accept exactly at that ended_at, which is the instant section 4 gives up', async () => {
      // **This asserts what the schema does, not what the system does**, and it is
      // here so the difference is written down rather than discovered.
      //
      // For an ordinary closed edge — `started_at` strictly before `ended_at` — an
      // effective date equal to its `ended_at` passes both firings: the `INSERT`
      // firing does not select it, and the `UPDATE` firing compares it at its own
      // `started_at`, which the old Network row still covers.
      //
      // Section 4 refuses that instant anyway, because a *zero-length* closed edge
      // at the same timestamp does not pass and the two are not usefully
      // distinguishable in a rule. The floor is therefore conservative by one
      // instant here, deliberately, and the service test asserting the refusal is
      // what holds the system to section 4 rather than to this.
      const openedAt = new Date('2026-04-01T10:00:00+08:00');
      const closedAt = new Date('2026-06-01T10:00:00+08:00');

      const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const formerDisciple = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

      await assignTo(db, person.id, mensLeader.id, EPOCH);
      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: formerDisciple.id,
          leader_id: person.id,
          started_at: openedAt,
          ended_at: closedAt,
        })
        .execute();

      const result = await attemptCorrection({
        personId: person.id,
        toNetwork: 'WOMENS',
        newLeaderId: womensLeader.id,
        effectiveAt: closedAt,
      });

      expect(result.committed).toBe(true);
    });

    it('reaches a closed edge on which the person was the subordinate, not only the leader', async () => {
      // "In either direction" (section 4, section 5), exercised on the person_id
      // side with the *other* term held out of the way.
      //
      // The open assignment deliberately starts at EPOCH, before the closed edge
      // rather than after it, so that term (a) cannot be what refuses this. The
      // natural history — under Rico until June, under Manuel since — makes term
      // (a) June as well, and would also leave the correction trying to close an
      // assignment before its own `started_at`, which is a check constraint
      // failing rather than the rule under test. Two open periods never overlap
      // here; a closed one overlapping an open one is what the partial unique
      // index permits and is all this needs.
      const openedAt = new Date('2026-04-01T10:00:00+08:00');
      const closedAt = new Date('2026-06-01T10:00:00+08:00');

      const formerLeader = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

      await assignTo(db, person.id, mensLeader.id, EPOCH);
      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: person.id,
          leader_id: formerLeader.id,
          started_at: openedAt,
          ended_at: closedAt,
        })
        .execute();

      const beforeTheClose = await attemptCorrection({
        personId: person.id,
        toNetwork: 'WOMENS',
        newLeaderId: womensLeader.id,
        effectiveAt: new Date(closedAt.getTime() - 1),
      });

      expect(beforeTheClose.committed).toBe(false);
      expect(beforeTheClose.error).toMatch(/crossing Networks/);
    });
  });

  describe('a person with nothing to strand', () => {
    it('accepts a Network change backdated freely where they hold no assignment at all', async () => {
      // Section 4: each term is a maximum over rows that may be empty, and an
      // empty term contributes nothing. A Person encoded but not yet assigned has
      // no floor.
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });

      const result = await attemptCorrection({
        personId: person.id,
        toNetwork: 'WOMENS',
        newLeaderId: womensLeader.id,
        effectiveAt: new Date(EPOCH.getTime() + 1),
        reassign: false,
      });

      expect(result.committed).toBe(true);
    });
  });

  describe('the two Cell terms are not a property of the schema (section 4)', () => {
    /**
     * **This case asserts that the database lets the damage through**, which is the
     * premise the two Cell terms rest on and the reason they are enforced in
     * `networks` rather than by a constraint.
     *
     * `assert_network_change_keeps_edges` reads `pastoral_assignments` and no other
     * table, and the Cell triggers fire only on writes to their own tables — so a
     * correction that reaches back over a Cell membership writes no `cell_memberships`
     * row and nothing re-examines it. The membership is left comparing a member in one
     * Network against a leader in the other, permanently, with nothing raised.
     *
     * If a future migration ever does re-validate Cell relationships on a Network
     * write, this case goes red — and that is the signal to re-derive the floor's Cell
     * terms rather than to relax the assertion.
     */
    it('commits a correction that strands a closed Cell membership', async () => {
      const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
      const geraldine = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });

      await assignTo(db, manuel.id, null);
      await assignTo(db, geraldine.id, null);
      await assignTo(db, grace.id, geraldine.id);
      await assignTo(db, mark.id, manuel.id, ASSIGNED_AT);

      // Both ends of the membership from one fixed clock, which is the per-period
      // rule in `test/setup/fixtures.ts`.
      const joinedAt = new Date('2026-05-10T19:00:00+08:00');
      const leftAt = new Date('2026-06-20T18:00:00+08:00');

      const cell = await createCell(db, { leader: manuel, createdAt: joinedAt });
      await db
        .insertInto('cell_memberships')
        .values({ person_id: mark.id, cell_id: cell.id, started_at: joinedAt, ended_at: leftAt })
        .execute();

      // Dated before the membership began, so the corrected Network is in force at
      // the instant the membership was validated at.
      const result = await attemptCorrection({
        personId: mark.id,
        toNetwork: 'WOMENS',
        newLeaderId: grace.id,
        effectiveAt: new Date('2026-04-01T00:00:00+08:00'),
      });

      expect(result.committed).toBe(true);

      // And the membership really is stranded, which is what makes the commit a
      // defect rather than a harmless permission. Asserting only `committed` would
      // pass against a fixture that never created a cross-Network situation at all.
      const asOf = await sql<{ member: string; leader: string }>`
        SELECT network_as_of(${mark.id}::uuid, ${joinedAt}::timestamptz)::text AS member,
               network_as_of(${manuel.id}::uuid, ${joinedAt}::timestamptz)::text AS leader
      `.execute(db);

      expect(asOf.rows[0].member).toBe('WOMENS');
      expect(asOf.rows[0].leader).toBe('MENS');
    });
  });
});
