import { sql } from 'kysely';
import { Client } from 'pg';

import { CellLock } from '../../src/database/cell-lock';
import { holdPersonLock } from '../setup/concurrency';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createCell, createPerson } from '../setup/fixtures';

import type { Db } from '../../src/database/database.module';
import type { TestCell, TestPerson } from '../setup/fixtures';

/**
 * **How a Cell closure takes its locks, measured rather than argued.**
 *
 * `SKILL.md` section 5 and section 10 both recorded this as unsettled, with an
 * unusual note attached: three orderings had been written for it in prose and each
 * was refuted, the last by `architecture-guardian` reproducing a deadlock. The
 * lesson recorded in `CLAUDE.md` is that it is a mechanism rather than a rule and
 * that prose is the wrong instrument -- every version read as sound, and the only
 * thing that ever settled it was running the database.
 *
 * So this file runs the database. It stages the writes a closure performs, directly,
 * with no service in front of them, and asserts what actually happens. Section 5 now
 * states the ordering, and what it states is what survived here.
 *
 * **Its first version measured the unfixed world**, and two of its four cases
 * asserted that a deadlock *occurs* -- the behaviour migration 0009 predicted in its
 * own comments. Applying the ordering turned both red, which is the transition this
 * file existed to produce. They are rewritten below as cases the ordering has to
 * keep green, and the shapes that used to deadlock survive as the two counter-example
 * cases: those are not stale, they are what pins each clause of the rule to a
 * failure, since an ordering rule with no reachable way of being wrong is a rule
 * nobody can check.
 *
 * The three clauses, and the case that fails without each:
 *
 *   sorted, over every Cell the operation touches   -> *waits rather than cycling*
 *   each row taken once at its final strength       -> *shared then upgraded*
 *   people before Cells, never the reverse          -> *Cells before people*
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('how a Cell closure takes its locks', () => {
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
   * The locks a closure takes, in the order section 5 now states, staged directly.
   *
   * It mirrors `CellsClosureService`, which composes `boundLockWaitsWithin`,
   * `lockPersonsWithin` and `lockCellsWithin` in exactly this sequence -- and it
   * **imports the strengths from `cell-lock.ts`** rather than spelling them, so a
   * change to what the service takes cannot leave this file measuring a lock nothing
   * uses. The order and the sort are staged here rather than imported, because they
   * are what is being measured.
   */
  const takeClosureLocks = async (
    client: Client,
    people: TestPerson[],
    closing: TestCell,
    destinations: TestCell[],
  ): Promise<void> => {
    // Section 5's bound, which a closure must set itself: `lockPersonsWithin` returns
    // before setting it when there is nobody to lock, and a Cell with no members to
    // disperse is exactly that case.
    await client.query("SET LOCAL lock_timeout = '2s'");

    for (const person of [...people].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      await advisoryLock(client, person);
    }

    for (const cell of orderedCellLocks(closing, destinations)) {
      await takeCellLock(client, cell);
    }
  };

  /**
   * The `cells` rows a closure touches, in the order it takes them.
   *
   * Separate from `takeClosureLocks` so the interleaving case below can issue them
   * one at a time: a case that lets one transaction take *all* its rows before the
   * other starts observes a wait whether or not anything is sorted, because the
   * second party blocks on the first row it asks for either way. Removing the sort
   * here left all five cases green until this was split out, which is the shape of
   * defect this repository keeps recording — a green suite over a rule nothing
   * exercises.
   */
  const orderedCellLocks = (
    closing: TestCell,
    destinations: TestCell[],
  ): { id: string; strength: string }[] =>
    [
      { id: closing.id, strength: CellLock.WritesTheRow },
      ...destinations.map((cell) => ({ id: cell.id, strength: CellLock.ReadsTheState })),
    ].sort((a, b) => (a.id < b.id ? -1 : 1));

  const takeCellLock = async (
    client: Client,
    cell: { id: string; strength: string },
  ): Promise<void> => {
    await client.query(`SELECT id FROM cells WHERE id = $1 ${cell.strength}`, [cell.id]);
  };

  /**
   * The five writes section 10 lists, staged directly.
   *
   * The last two -- ending the open category and schedule rows -- joined that list on
   * 2026-08-29 and are enforced by migration 0010. They are here because omitting
   * them makes every case in this file fail at COMMIT on a rule that has nothing to
   * do with locking, which would be a harness measuring its own omission.
   */
  const closeAndDisperse = async (
    client: Client,
    closing: TestCell,
    destination: TestCell | null,
    member: TestPerson | null,
    at: Date,
  ): Promise<void> => {
    if (member) {
      await client.query(
        'UPDATE cell_memberships SET ended_at = $1 WHERE person_id = $2 AND ended_at IS NULL',
        [at, member.id],
      );
    }

    if (member && destination) {
      await client.query(
        'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
        [member.id, destination.id, at],
      );
    }

    await client.query(
      'UPDATE cell_leaderships SET ended_at = $1 WHERE cell_id = $2 AND ended_at IS NULL',
      [at, closing.id],
    );

    for (const table of ['cell_categories', 'cell_schedules']) {
      await client.query(
        `UPDATE ${table} SET ended_at = GREATEST($1::timestamptz, started_at)
          WHERE cell_id = $2
            AND (ended_at IS NULL OR ended_at > GREATEST($1::timestamptz, started_at))`,
        [at, closing.id],
      );
    }

    await client.query(
      "UPDATE cells SET state = 'CLOSED', closed_at = $1, closure_reason = 'MEMBERS_DISPERSED' WHERE id = $2",
      [at, closing.id],
    );
  };

  /**
   * Juan in Mark's Cell and Rosalio in Ben's, so each closure has somebody to move,
   * and the instant everything after it is stamped with.
   *
   * **Read from the database rather than from `new Date()`, and a failing run is what
   * found that.** `createCell` takes `cells.created_at` from `now()` and gives the
   * leadership row the same instant; the Node host's clock can sit milliseconds
   * behind the server's, so a membership stamped here with a JS instant starts
   * *before* its Cell had a leader and `assert_membership_same_network` refuses it —
   * naming a Network rule for what is really a clock. One clock, and it is the one
   * the columns are compared against.
   */
  const seedMemberships = async (): Promise<Date> => {
    const at = await databaseNow();

    await db
      .insertInto('cell_memberships')
      .values([
        { person_id: juan.id, cell_id: markCell.id, started_at: at },
        { person_id: rosa.id, cell_id: benCell.id, started_at: at },
      ])
      .execute();

    return at;
  };

  const databaseNow = async (): Promise<Date> => {
    const row = await sql<{ at: Date }>`SELECT clock_timestamp() AS at`.execute(db);
    return row.rows[0].at;
  };

  describe('two closures dispersing into each other', () => {
    it('waits rather than cycling, which is what the ordering buys', async () => {
      // **This is the case that used to assert `40P01`.** Migration 0009 predicted
      // the deadlock at the `FOR SHARE` it added -- "two leaders doing that into each
      // other's Cells take the two `cells` rows in opposite orders" -- and the first
      // version of this file reproduced it. Under the ordering the second closure
      // waits on the first row in sorted order instead, which is a wait and not a
      // cycle, so one of the two always makes progress.
      await seedMemberships();
      // **Strictly after the seed, and a failing run is what made that explicit.**
      // A closure ends the leadership row at its effective instant, and
      // `assert_membership_same_network` resolves a Cell's leader as "started at or
      // before, ended after" — so a closure stamped at the very instant a membership
      // began refuses that membership for having no leader, which is true and is not
      // what any case here is about.
      const at = await databaseNow();

      const [one, two] = [await openClient(), await openClient()];

      try {
        const pidTwo = await backendPid(two);

        await one.query('BEGIN');
        await two.query('BEGIN');
        await one.query("SET LOCAL lock_timeout = '5s'");
        await two.query("SET LOCAL lock_timeout = '5s'");

        await advisoryLock(one, juan);
        await advisoryLock(two, rosa);

        // **The two acquisitions are interleaved, one row at a time**, and that is
        // what makes this case able to fail. Each closure asks for its own first row,
        // then its second; unsorted, the two first rows are different, so each ends
        // up holding the row the other is about to want.
        const oneOrder = orderedCellLocks(markCell, [benCell]);
        const twoOrder = orderedCellLocks(benCell, [markCell]);

        await takeCellLock(one, oneOrder[0]);

        // Sorted, this is the row `one` is already holding, so `two` blocks here
        // holding nothing. Unsorted it is the other row, and `two` takes it.
        const twoFirst = settled(takeCellLock(two, twoOrder[0]));

        // **`one` does not ask for its second row until `two` has got as far as it
        // can**, and that wait is what makes the case deterministic. Issuing both
        // second locks immediately leaves the outcome to whichever request reaches
        // the server first: `one` could take the row unsorted `two` was about to
        // claim, and the run would observe a wait for a reason having nothing to do
        // with sorting. It passed against an unsorted acquisition for exactly that
        // reason before this wait was added.
        expect(await settledOrBlocked(db, pidTwo, twoFirst)).toBe('blocked');

        const oneSecond = settled(takeCellLock(one, oneOrder[1]));
        const twoSecond = twoFirst.then(
          async (failed) => failed ?? settled(takeCellLock(two, twoOrder[1])),
        );

        expect(await oneSecond).toBeNull();

        await closeAndDisperse(one, markCell, benCell, juan, at);
        await one.query('COMMIT');

        // No cycle anywhere: `two` was waiting on a lock, never holding one `one`
        // wanted. Without the sort both of these carry `40P01`.
        expect(await twoFirst).toBeNull();
        expect(await twoSecond).toBeNull();

        // And what it finds once it wakes is the state one committed -- its own
        // destination is now closed, so its dispersal is refused on the rule rather
        // than by the database picking a victim. Which is the point: a refusal names
        // something a person can act on and `40P01` does not.
        const refused = await settled(
          (async () => {
            await closeAndDisperse(two, benCell, markCell, rosa, await databaseNow());
            await two.query('COMMIT');
          })(),
        );

        expect(refused).not.toBeNull();
        expect(refused?.message).toMatch(/CLOSED/i);
      } finally {
        await rollbackAndClose(one, two);
      }
    });

    it('still cycles if the rows are taken shared and then upgraded', async () => {
      // **The clause every prose version missed**, kept as a live counter-example
      // rather than deleted with the defect. Sorted acquisition is not the rule;
      // sorted acquisition *at the strength the operation will need* is. A closure
      // taking every row shared -- the cheaper choice, and the one that reads
      // plausibly -- would still have to upgrade its own Cell to write `state`, and
      // the upgrade is not itself sorted.
      //
      // Nothing in `src` does this. The case exists so the reason
      // `CellLock.WritesTheRow` is taken up front has something that fails without it.
      const [one, two] = [await openClient(), await openClient()];
      const ordered = [markCell, benCell].sort((a, b) => (a.id < b.id ? -1 : 1));

      try {
        await one.query('BEGIN');
        await two.query('BEGIN');

        for (const cell of ordered) {
          await one.query('SELECT id FROM cells WHERE id = $1 FOR SHARE', [cell.id]);
          await two.query('SELECT id FROM cells WHERE id = $1 FOR SHARE', [cell.id]);
        }

        // Each now upgrades its own Cell, which the other's share lock blocks. Both
        // upgrades go in flight before either is awaited: with only one of them
        // issued there is no cycle, just a wait, and awaiting it hangs the run rather
        // than reproducing anything. A first version of this file did exactly that
        // and stranded five backends.
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
        await rollbackAndClose(one, two);
      }
    });
  });

  describe('against an ordinary membership write', () => {
    it('still cycles if the Cell rows are taken before the people', async () => {
      // **Why the class order is fixed rather than chosen**, and the second
      // counter-example. `CellsMembershipService` takes an advisory lock on the
      // person and then, at commit, a row lock on the Cell -- so an operation taking
      // Cell rows first and reaching back for a person runs the pair in the opposite
      // order, and the two genuinely cycle.
      //
      // Section 5 says the order is fixed by an existing writer and anything added
      // later is established against it. This is that statement with a failure
      // attached to it.
      await seedMemberships();
      // **Strictly after the seed, and a failing run is what made that explicit.**
      // A closure ends the leadership row at its effective instant, and
      // `assert_membership_same_network` resolves a Cell's leader as "started at or
      // before, ended after" — so a closure stamped at the very instant a membership
      // began refuses that membership for having no leader, which is true and is not
      // what any case here is about.
      const at = await databaseNow();

      const [closer, adder] = [await openClient(), await openClient()];

      try {
        // **Read before the COMMIT is issued, not after.** node-postgres queues
        // statements on one connection, so asking a client for its own pid while its
        // COMMIT is in flight waits behind that COMMIT and returns only once the thing
        // being watched for has already finished. A first version did that and the
        // poll reported "never blocked" against a backend that was blocked the whole
        // time.
        const pidAdder = await backendPid(adder);

        await closer.query('BEGIN');
        await adder.query('BEGIN');
        await closer.query("SET LOCAL lock_timeout = '5s'");
        await adder.query("SET LOCAL lock_timeout = '5s'");

        // The reversed order: Cell rows first, sorted, and no person lock yet.
        for (const cell of [markCell, benCell].sort((a, b) => (a.id < b.id ? -1 : 1))) {
          await closer.query('SELECT id FROM cells WHERE id = $1 FOR NO KEY UPDATE', [cell.id]);
        }

        // An ordinary move of Juan into Ben's Cell, in the order that writer uses.
        await holdPersonLock(adder, juan.id);
        await adder.query(
          'UPDATE cell_memberships SET ended_at = $1 WHERE person_id = $2 AND ended_at IS NULL',
          [at, juan.id],
        );
        await adder.query(
          'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
          [juan.id, benCell.id, at],
        );

        // The adder's commit wants `FOR SHARE` on rows the closer holds; the closer
        // reaches back for the advisory lock the adder holds. Both in flight, for the
        // reason the case above gives.
        const adderOut = settled(adder.query('COMMIT'));
        await waitForBlocked(db, pidAdder, "the closer's Cell rows");

        const closerOut = settled(holdPersonLock(closer, juan.id));

        const codes = [await adderOut, await closerOut].map(
          (error) => (error as { code?: string } | null)?.code,
        );

        expect(codes).toContain('40P01');
      } finally {
        await rollbackAndClose(closer, adder);
      }
    });

    it('does not block an add into a destination Cell', async () => {
      // **Why a destination is taken `FOR SHARE` and not `FOR UPDATE`.** The stronger
      // lock would also work and would cost something real: `FOR UPDATE` conflicts
      // with the `FOR KEY SHARE` a `cell_memberships` insert takes through its foreign
      // key, so closing any Cell would block every concurrent add into every Cell it
      // disperses into, mid-statement.
      //
      // Nothing about the closure needs that. It needs only that the destination does
      // not close underneath it, which is what a share lock holds -- and share does
      // not conflict with share, so two closures dispersing into one Cell do not wait
      // for each other either.
      await seedMemberships();
      // **Strictly after the seed, and a failing run is what made that explicit.**
      // A closure ends the leadership row at its effective instant, and
      // `assert_membership_same_network` resolves a Cell's leader as "started at or
      // before, ended after" — so a closure stamped at the very instant a membership
      // began refuses that membership for having no leader, which is true and is not
      // what any case here is about.
      const at = await databaseNow();

      const [closer, adder] = [await openClient(), await openClient()];

      try {
        await closer.query('BEGIN');
        await adder.query('BEGIN');

        await takeClosureLocks(closer, [juan], markCell, [benCell]);

        // Somebody adds a different person to Ben's Cell -- the closer's destination
        // -- while the closer holds it shared.
        await adder.query("SET LOCAL lock_timeout = '2s'");
        await holdPersonLock(adder, root.id);
        await adder.query(
          'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
          [root.id, benCell.id, at],
        );

        expect(await settled(adder.query('COMMIT'))).toBeNull();
      } finally {
        await rollbackAndClose(closer, adder);
      }
    });

    it('makes an add into the closing Cell wait, then refuses it', async () => {
      // The ordering an existing writer already fixed, and which any closure ordering
      // has to keep. `CellLock.WritesTheRow` conflicts with the `FOR SHARE` that
      // `assert_cell_memberships_match_state` takes at commit, so the adder waits for
      // the closer rather than cycling with it -- and then re-reads the state and
      // refuses, because a member left open in a closed Cell can join no other.
      await seedMemberships();
      // **Strictly after the seed, and a failing run is what made that explicit.**
      // A closure ends the leadership row at its effective instant, and
      // `assert_membership_same_network` resolves a Cell's leader as "started at or
      // before, ended after" — so a closure stamped at the very instant a membership
      // began refuses that membership for having no leader, which is true and is not
      // what any case here is about.
      const at = await databaseNow();

      const [closer, adder] = [await openClient(), await openClient()];

      try {
        const pidAdder = await backendPid(adder);

        await closer.query('BEGIN');
        await adder.query('BEGIN');

        await takeClosureLocks(closer, [juan], markCell, []);
        await closeAndDisperse(closer, markCell, null, juan, at);

        await adder.query("SET LOCAL lock_timeout = '10s'");
        await holdPersonLock(adder, root.id);
        await adder.query(
          'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
          [root.id, markCell.id, at],
        );

        const blocked = settled(adder.query('COMMIT'));
        await waitForBlocked(db, pidAdder, "the closing Cell's row");

        await closer.query('COMMIT');

        const refused = await blocked;
        expect(refused).not.toBeNull();
        expect(refused?.message).toMatch(/CLOSED/i);
      } finally {
        await rollbackAndClose(closer, adder);
      }
    });
  });
});

/**
 * Whether a backend got its statement or is stuck waiting for a lock, whichever
 * happens first.
 *
 * The blocked half is a poll and the taken half is the statement's own promise, so a
 * case can stage "let the other side get as far as it can" without either sleeping
 * for a guessed interval or racing the server. Sleeping is what makes a concurrency
 * case pass on a fast machine and fail on a slow one.
 */
async function settledOrBlocked(
  db: Db,
  pid: number,
  statement: Promise<unknown>,
): Promise<'taken' | 'blocked'> {
  return Promise.race([
    statement.then(() => 'taken' as const),
    waitForBlocked(db, pid, 'a lock another transaction holds').then(() => 'blocked' as const),
  ]);
}

/**
 * Takes the person lock the way `lockPersonsWithin` does.
 *
 * Delegates to `test/setup/concurrency.ts` rather than spelling the key out, which is
 * what it used to do — along with four inline copies in this file that did not go
 * through it.
 */
async function advisoryLock(client: Client, person: TestPerson): Promise<void> {
  await holdPersonLock(client, person.id);
}

async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function backendPid(client: Client): Promise<number> {
  const result = await client.query<{ pid: string }>('SELECT pg_backend_pid() AS pid');
  return Number(result.rows[0].pid);
}

async function rollbackAndClose(...clients: Client[]): Promise<void> {
  for (const client of clients) {
    await client.query('ROLLBACK').catch(() => undefined);
  }

  for (const client of clients) {
    await client.end();
  }
}

/**
 * Resolves to the rejection rather than throwing it, so a pending rejection cannot go
 * unhandled if a later statement throws first -- which takes down the run with a
 * failure naming neither test.
 */
async function settled(promise: Promise<unknown>): Promise<Error | null> {
  return promise.then(
    () => null,
    (error: Error) => error,
  );
}

/**
 * Wait until this backend is genuinely blocked on a lock, keyed on its own pid.
 *
 * Keyed on the pid rather than on the lock, because a case that polls for "any
 * backend blocked on anything" passes against a harness that happens to be slow --
 * `pg_stat_activity` is cluster-wide and this machine also carries `dfc_dev`.
 */
async function waitForBlocked(db: Db, pid: number, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
