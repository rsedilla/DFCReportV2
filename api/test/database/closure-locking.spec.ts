import { sql } from 'kysely';
import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createCell, createPerson } from '../setup/fixtures';

import type { Db } from '../../src/database/database.module';
import type { TestCell, TestPerson } from '../setup/fixtures';

/**
 * **The harness for Cell closure's locking, written before the endpoint.**
 *
 * `SKILL.md` section 5 and section 10 both record the ordering as *unsettled*, and
 * `CLAUDE.md` carries it as an open item with an unusual note: three orderings were
 * written for it in prose and each was refuted, the last by reproducing a deadlock.
 * The lesson recorded there is that this is a mechanism rather than a rule and that
 * prose is the wrong instrument — every version read as sound, and the only thing
 * that ever settled it was running the database.
 *
 * So this file runs the database. It stages the writes a closure performs, directly,
 * with no endpoint in front of them, and asserts what actually happens. What survives
 * here is what section 5 gets to say afterwards.
 *
 * **These are not tests of a feature.** They are measurements, and two of them assert
 * a deadlock *occurs* — which is the current, unfixed behaviour that migration 0009
 * predicted in its own comments and that CLAUDE.md escalated. When the closure
 * endpoint chooses an ordering, the cases asserting `40P01` become the cases that
 * must go red, and the ones asserting a wait must stay green.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('what a Cell closure actually deadlocks on', () => {
  let db: Db;

  let root: TestPerson;
  let mark: TestPerson;
  let ben: TestPerson;
  let markCell: TestCell;
  let benCell: TestCell;
  let juan: TestPerson;
  let rosa: TestPerson;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    markCell = await createCell(db, { leader: mark });

    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, ben.id, root.id);
    benCell = await createCell(db, { leader: ben });

    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);

    rosa = await createPerson(db, { firstName: 'Rosalio', network: 'MENS' });
    await assignTo(db, rosa.id, ben.id);
  });

  afterAll(async () => {
    await db.destroy();
  });

  /**
   * The three writes a closure makes to another Cell's tables, in the order section
   * 10 lists them. Deliberately *not* a service call: no closure endpoint exists, and
   * the point is to measure the schema rather than an implementation.
   */
  const closeAndDisperse = async (
    client: Client,
    closing: TestCell,
    destination: TestCell,
    member: TestPerson,
    at: Date,
  ): Promise<void> => {
    await client.query(
      "UPDATE cells SET state = 'CLOSED', closed_at = $1, closure_reason = 'MEMBERS_DISPERSED' WHERE id = $2",
      [at, closing.id],
    );
    await client.query(
      'UPDATE cell_leaderships SET ended_at = $1 WHERE cell_id = $2 AND ended_at IS NULL',
      [at, closing.id],
    );
    await client.query(
      'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
      [member.id, destination.id, at],
    );
  };

  describe('closure against closure, dispersing into each other', () => {
    it('deadlocks, which is what section 10 predicted and nothing prevents', async () => {
      // Migration 0009 states this in its own comment, at the `FOR SHARE` it added:
      // "Two leaders doing that into each other's Cells take the two `cells` rows in
      // opposite orders — the closure's `UPDATE` on its own, this `FOR SHARE` on the
      // other's — and PostgreSQL picks a victim with `40P01`."
      //
      // Reproducing it is the first thing this harness owes, because three written
      // orderings were refuted and the last one deadlocked. A rule proposed for this
      // is worth exactly as much as its behaviour here.
      const [one, two] = [await openClient(), await openClient()];
      const at = new Date();

      try {
        await one.query('BEGIN');
        await two.query('BEGIN');

        // Each takes an exclusive lock on its own Cell first.
        await closeAndDisperse(one, markCell, benCell, juan, at);
        await closeAndDisperse(two, benCell, markCell, rosa, at);

        // **Both commits go in flight before either is awaited**, and that ordering is
        // the whole of the setup. Each deferred trigger runs at its own COMMIT and
        // wants `FOR SHARE` on the row the other holds exclusively — so with only one
        // committing there is no cycle, just a wait that never ends, and awaiting it
        // hangs the run rather than reproducing anything. A first version did that.
        const first = settled(one.query('COMMIT'));
        const second = settled(two.query('COMMIT'));

        const outcomes = [await first, await second];
        const codes = outcomes.map((error) => (error as { code?: string } | null)?.code);

        // One of the two is chosen as the victim. Which one is PostgreSQL's decision
        // and this case deliberately does not assert it.
        expect(codes).toContain('40P01');
        expect(codes.filter((code) => code === '40P01')).toHaveLength(1);
      } finally {
        await one.query('ROLLBACK').catch(() => undefined);
        await two.query('ROLLBACK').catch(() => undefined);
        await one.end();
        await two.end();
      }
    });

    it('does not deadlock when both take the Cell rows in one order first', async () => {
      // The remedy section 5 uses for the person lock, measured rather than asserted:
      // if both operations take **every** `cells` row they will touch, up front and in
      // one agreed order, the cycle cannot form. Ascending `id` is the order here
      // because it is total and both sides can compute it without coordinating.
      //
      // This is the case a closure endpoint has to keep green. It says nothing yet
      // about which strength each lock needs — that is the next case.
      const [one, two] = [await openClient(), await openClient()];
      const at = new Date();

      const ordered = [markCell, benCell].sort((a, b) => (a.id < b.id ? -1 : 1));

      try {
        const pidTwo = Number(
          (await two.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        await one.query('BEGIN');
        await two.query('BEGIN');

        for (const cell of ordered) {
          await one.query('SELECT id FROM cells WHERE id = $1 FOR UPDATE', [cell.id]);
        }

        // Two now wants the first row in the same order, so it waits rather than
        // taking a lock one already holds and then reaching back.
        const blocked = settled(
          (async () => {
            for (const cell of ordered) {
              await two.query('SELECT id FROM cells WHERE id = $1 FOR UPDATE', [cell.id]);
            }
          })(),
        );

        await waitForBlocked(db, pidTwo, 'the first Cell row in sorted order');

        await closeAndDisperse(one, markCell, benCell, juan, at);
        await one.query('COMMIT');

        // No deadlock: two was waiting, not holding something one wanted.
        expect(await blocked).toBeNull();
        await two.query('ROLLBACK');
      } finally {
        await one.query('ROLLBACK').catch(() => undefined);
        await two.query('ROLLBACK').catch(() => undefined);
        await one.end();
        await two.end();
      }
    });
  });

  describe('closure against an ordinary membership write', () => {
    it('makes the adder wait rather than cycle, which is the ordering already fixed', async () => {
      // `CellsMembershipService` takes a person advisory lock and then, at commit, the
      // `FOR SHARE` this trigger issues. A closure takes the `cells` row exclusively
      // and never wants that person lock, so the two wait rather than cycle — the
      // property `SKILL.md` section 5 records as "already fixed by an existing writer".
      //
      // Measured here so a closure ordering cannot be chosen that breaks it.
      const [closer, adder] = [await openClient(), await openClient()];
      const at = new Date();

      try {
        const pidAdder = Number(
          (await adder.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        await closer.query('BEGIN');
        await adder.query('BEGIN');

        await closer.query(
          "UPDATE cells SET state = 'CLOSED', closed_at = $1, closure_reason = 'MEMBERS_DISPERSED' WHERE id = $2",
          [at, markCell.id],
        );
        await closer.query(
          'UPDATE cell_leaderships SET ended_at = $1 WHERE cell_id = $2 AND ended_at IS NULL',
          [at, markCell.id],
        );

        await adder.query(
          'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
          [juan.id, markCell.id, at],
        );

        // The adder's deferred check reads the Cell `FOR SHARE` at commit, and the
        // closer holds it exclusively.
        const blocked = settled(adder.query('COMMIT'));
        await waitForBlocked(db, pidAdder, "the closing Cell's row");

        await closer.query('COMMIT');

        // It waited, then re-read the state and refused — a member cannot be left open
        // in a closed Cell, which is what that trigger exists to prevent.
        const refused = await blocked;
        expect(refused).not.toBeNull();
        expect(refused?.message).toMatch(/closed/i);
      } finally {
        await closer.query('ROLLBACK').catch(() => undefined);
        await adder.query('ROLLBACK').catch(() => undefined);
        await closer.end();
        await adder.end();
      }
    });
  });

  describe('what the ordering has to be taken at', () => {
    it('shows a shared lock is not enough to order two closures', async () => {
      // The strength question section 10 leaves open, measured. If a closure took its
      // destination rows `FOR SHARE` — the cheaper choice, and the one that lets two
      // dispersals into one Cell proceed together — two closures crossing still cycle,
      // because each also takes its **own** Cell exclusively to set `state`.
      //
      // So the sorted acquisition above has to be at the strength the operation will
      // actually need, not at the weakest one that reads plausibly.
      const [one, two] = [await openClient(), await openClient()];
      const ordered = [markCell, benCell].sort((a, b) => (a.id < b.id ? -1 : 1));

      try {
        await one.query('BEGIN');
        await two.query('BEGIN');

        // Both take both rows in the agreed order, but shared.
        for (const cell of ordered) {
          await one.query('SELECT id FROM cells WHERE id = $1 FOR SHARE', [cell.id]);
          await two.query('SELECT id FROM cells WHERE id = $1 FOR SHARE', [cell.id]);
        }

        // Each now upgrades its own Cell to exclusive, which the other's share lock
        // blocks. Sorted acquisition bought nothing, because the upgrade is not sorted.
        // Both upgrades in flight before either is awaited, for the reason the first
        // case gives: one alone is a wait, not a cycle.
        const first = settled(
          one.query("UPDATE cells SET state = 'CLOSED', closed_at = now() WHERE id = $1", [
            markCell.id,
          ]),
        );
        const second = settled(
          two.query("UPDATE cells SET state = 'CLOSED', closed_at = now() WHERE id = $1", [
            benCell.id,
          ]),
        );

        const codes = [await first, await second].map(
          (error) => (error as { code?: string } | null)?.code,
        );

        expect(codes).toContain('40P01');
      } finally {
        await one.query('ROLLBACK').catch(() => undefined);
        await two.query('ROLLBACK').catch(() => undefined);
        await one.end();
        await two.end();
      }
    });
  });
});

async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Resolves to the rejection rather than throwing it, so a pending rejection cannot go
 * unhandled if a later statement throws first — which takes down the run with a
 * failure naming neither test.
 */
async function settled(promise: Promise<unknown>): Promise<Error | null> {
  return promise.then(
    () => null,
    (error: Error) => error,
  );
}

async function waitForBlocked(db: Db, pid: number, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await sql<{ count: string }>`
      SELECT count(*) AS count
        FROM pg_stat_activity
       WHERE pid = ${pid}
         AND state = 'active'
         AND wait_event_type = 'Lock'
    `.execute(db);

    if (Number(waiting.rows[0].count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`backend ${pid} never blocked on ${what}; the case proves nothing`);
}
