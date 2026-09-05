import { Test } from '@nestjs/testing';

import { AppConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { HierarchyModule } from '../../src/hierarchy/hierarchy.module';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';

/**
 * The graph a leader-scoped report is placed on (decision 0206; SKILL.md section 20).
 *
 * **It is not the tree, and it is not `subtreeAsOf` either.** Section 20 places a person by
 * their open assignment at the period's end, and where they have none — archived, encoded
 * but unassigned, an administrator — by the last one they held at any instant *within* the
 * period. So the edge set collapses rows from several instants into one map, where
 * `subtreeAsOf` reads one instant and collapses nothing. Section 3 forbids filtering a
 * period-based report by lifecycle state, so the person is in the figures either way; what
 * this decides is whose figures they are in.
 *
 * **Without the fallback the total still reconciles and the drill-down still breaks.** Such
 * a person sits in the Whole Church total and in no leader's, so section 16's drill-down and
 * section 17's chain lose people between two levels — the failure section 9 names in the
 * recording direction as "nobody is missed between two levels". That is why this is a graph
 * rather than a filter.
 *
 * **The cycle case was written before the query.** Section 5 invariant 2 constrains the
 * *active* tree at each write, and this map is not the active tree — so two people can each
 * end a period unassigned having each been under the other within it, from writes that were
 * legal when they were made. A walk over that map does not terminate, and section 20 says a
 * detected cycle refuses the figure rather than truncating the chain. Written first because
 * a query built against a passing fixture is a query built against nothing.
 *
 * Dates are fixed and in the past. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('the reporting placement graph (decision 0206)', () => {
  let db: Kysely<Database>;
  let app: INestApplication;
  let hierarchy: HierarchyService;

  /** October 2020, and the instant decision 0208 fixes as its end. */
  const PERIOD_START = new Date('2020-10-01T00:00:00+08:00');
  const PERIOD_END = new Date('2020-10-31T23:59:59.999+08:00');

  const OCT_1 = new Date('2020-10-01T00:00:00+08:00');
  const OCT_10 = new Date('2020-10-10T00:00:00+08:00');
  const OCT_12 = new Date('2020-10-12T00:00:00+08:00');
  const OCT_20 = new Date('2020-10-20T00:00:00+08:00');
  const AUGUST = new Date('2020-08-01T00:00:00+08:00');
  const LATE_AUGUST = new Date('2020-08-25T00:00:00+08:00');
  const SEPTEMBER = new Date('2020-09-01T00:00:00+08:00');
  const NOVEMBER = new Date('2020-11-01T00:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule, HierarchyModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    hierarchy = app.get(HierarchyService);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const closeAt = async (assignmentId: string, endedAt: Date) => {
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: endedAt })
      .where('id', '=', assignmentId)
      .execute();
  };

  /** Fixed so the final `id DESC` tiebreak cannot decide the case it is meant to lose. */
  const ZERO_LENGTH_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const REAL_ROW_ID = '00000000-0000-4000-8000-000000000001';

  const insertAssignment = async (
    id: string,
    personId: string,
    leaderId: string,
    startedAt: Date,
    endedAt: Date,
  ) => {
    await db
      .insertInto('pastoral_assignments')
      .values({
        id,
        person_id: personId,
        leader_id: leaderId,
        root_network: null,
        started_at: startedAt,
        ended_at: endedAt,
      })
      .execute();
  };

  const placement = (leaderId: string) =>
    hierarchy.reportingSubtree(db, leaderId, PERIOD_START, PERIOD_END);

  it('refuses a cycle that only the collapsed map has', async () => {
    // **Two writes, both legal when made, and no cycle ever exists in the active tree.**
    // Seeded from inside the cycle. The case below seeds from above it, which is what a real
    // report does and what this one cannot demonstrate.
    // Ana is under Ben until 10 October. Ben is placed under Ana on the 12th -- at which
    // point Ana has no open assignment, so section 5 invariant 2 sees no cycle and permits
    // it. Both rows close before the month ends.
    //
    // At the period's end neither has an open assignment, so each falls back to the last
    // assignment they held within the month: Ana to Ben, Ben to Ana. The map has a cycle the
    // tree never did, and section 20 says the figure refuses rather than truncating.
    const ana = await createPerson(db, { firstName: 'Ana', network: 'MENS' });
    const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });

    const anaUnderBen = await assignTo(db, ana.id, ben.id, OCT_1);
    await closeAt(anaUnderBen, OCT_10);

    const benUnderAna = await assignTo(db, ben.id, ana.id, OCT_12);
    await closeAt(benUnderAna, OCT_20);

    await expect(placement(ana.id)).rejects.toThrow(/cycle/i);
    await expect(placement(ben.id)).rejects.toThrow(/cycle/i);
  });

  it('does not reach a cycle from above it, which is the defect section 20 does not cover', async () => {
    // **The refusal above fires only because that case seeds inside the cycle.** This graph
    // is functional -- one out-edge per person -- so a cycle is a closed component: no member
    // is the child of a non-member, and a walk from a leader above can never enter it. A real
    // report is always scoped above.
    //
    // So the root's October figure returns cleanly and is short by everyone behind the cycle,
    // which is the silent truncation section 20 says must not happen. **Pinned as the
    // behaviour it currently has, not as the behaviour it should have** -- what it should do
    // is a Stop Condition in `CLAUDE.md`, and every remedy changes this expectation. It is
    // here so that settling it cannot forget this case.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const ana = await createPerson(db, { firstName: 'Ana', network: 'MENS' });
    const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);

    const anaUnderBen = await assignTo(db, ana.id, ben.id, OCT_1);
    await closeAt(anaUnderBen, OCT_10);
    const benUnderAna = await assignTo(db, ben.id, ana.id, OCT_12);
    await closeAt(benUnderAna, OCT_20);

    // Detection is over the whole graph now, so the figure refuses from above as section 20
    // requires -- rather than returning cleanly and short by everyone behind the cycle.
    await expect(placement(root.id)).rejects.toThrow(/cycle/i);
  });

  it('carries a person up past a leader who left before the period', async () => {
    // **The defect decision 0209 settles.** Manuel is archived in September, so he holds no
    // assignment within October. Mark holds an open row under Manuel throughout -- so he is
    // *not* in section 20's residual, which covers only somebody who held no open assignment
    // at any instant of the period, and dropping him made section 20's additivity claim
    // false with nothing detecting it.
    //
    // Decision 0209: the chain continues from Manuel's last assignment, whenever it was, so
    // Mark reaches the root through him. Two rules rather than one -- the fallback for a
    // *person* stays in-period, and what extends is the resolution of a *leader who has
    // already left*.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);
    const manuelsRow = await assignTo(db, manuel.id, root.id, AUGUST);
    await closeAt(manuelsRow, SEPTEMBER);
    await assignTo(db, mark.id, manuel.id, SEPTEMBER);

    await expect(placement(root.id)).resolves.toEqual([root.id, manuel.id, mark.id]);
    await expect(placement(manuel.id)).resolves.toEqual([manuel.id, mark.id]);
  });

  it('prefers the row actually held over one held for no time', async () => {
    // The `ended_at DESC` tiebreak, which nothing pinned. A zero-length row is legal
    // (`pastoral_assignments_period_ordered` is `>=`), and two rows can share a `started_at`.
    // Without the tiebreak the fallback can name a leader the person was under for zero time.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);
    await assignTo(db, manuel.id, root.id, SEPTEMBER);
    await assignTo(db, ben.id, root.id, SEPTEMBER);

    // **Identifiers are fixed, and the zero-length row deliberately carries the higher
    // one.** `id DESC` is the final tiebreak, so with random identifiers the case decides
    // itself by coin flip -- it passed with the `ended_at` tiebreak removed, pinning
    // nothing. Ordered this way, only `ended_at DESC` can pick the row actually held.
    await insertAssignment(ZERO_LENGTH_ID, mark.id, manuel.id, OCT_12, OCT_12);
    await insertAssignment(REAL_ROW_ID, mark.id, ben.id, OCT_12, OCT_20);

    await expect(placement(ben.id)).resolves.toEqual([ben.id, mark.id]);
    await expect(placement(manuel.id)).resolves.toEqual([manuel.id]);
  });

  it('places a person by their open assignment at the period end', async () => {
    // The ordinary case, and the one every other case is measured against.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);
    await assignTo(db, manuel.id, root.id, SEPTEMBER);
    await assignTo(db, mark.id, manuel.id, SEPTEMBER);

    await expect(placement(manuel.id)).resolves.toEqual([manuel.id, mark.id]);
  });

  it('places a person with no open assignment under their last leader within the period', async () => {
    // **The fallback, and the case decision 0206 exists for.** Mark is archived mid-October,
    // which section 5 makes a legitimate reason to hold no open assignment, and section 3
    // forbids filtering him out of October's figures for it. `subtreeAsOf` at the period's
    // end would not find him; this places him where he was.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);
    await assignTo(db, manuel.id, root.id, SEPTEMBER);
    const marksRow = await assignTo(db, mark.id, manuel.id, SEPTEMBER);
    await closeAt(marksRow, OCT_20);

    await expect(placement(manuel.id)).resolves.toEqual([manuel.id, mark.id]);

    // And the undated walk does not find him, which is why this method exists.
    await expect(hierarchy.subtreeAsOf(db, manuel.id, PERIOD_END)).resolves.toEqual([manuel.id]);
  });

  it('uses the last assignment within the period, not the first', async () => {
    // Mark moves from Manuel to Ben on the 12th and is archived on the 20th. October's
    // figures belong to Ben, who led him when he left, rather than to Manuel.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);
    await assignTo(db, manuel.id, root.id, SEPTEMBER);
    await assignTo(db, ben.id, root.id, SEPTEMBER);

    const underManuel = await assignTo(db, mark.id, manuel.id, SEPTEMBER);
    await closeAt(underManuel, OCT_12);
    const underBen = await assignTo(db, mark.id, ben.id, OCT_12);
    await closeAt(underBen, OCT_20);

    await expect(placement(ben.id)).resolves.toEqual([ben.id, mark.id]);
    await expect(placement(manuel.id)).resolves.toEqual([manuel.id]);
  });

  it('applies the fallback up the chain, so a drill-down still sums', async () => {
    // **Section 20 states this and it is what makes the additivity claim hold rather than
    // hold one level at a time.** Manuel is archived too, so placing Mark under Manuel is
    // not enough -- Manuel must himself resolve to the root, or the root's total loses both
    // of them while Manuel's total has Mark.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);
    const manuelsRow = await assignTo(db, manuel.id, root.id, SEPTEMBER);
    const marksRow = await assignTo(db, mark.id, manuel.id, SEPTEMBER);
    await closeAt(marksRow, OCT_10);
    await closeAt(manuelsRow, OCT_20);

    await expect(placement(manuel.id)).resolves.toEqual([manuel.id, mark.id]);
    await expect(placement(root.id)).resolves.toEqual([root.id, manuel.id, mark.id]);
  });

  it('leaves a person with no assignment in the period out of every subtree', async () => {
    // Section 20: where somebody held no open assignment at any instant of the period they
    // appear in the Whole Church total alone. No leader discipled them, and attributing them
    // to one would invent a pastoral relationship the tree never held.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const admina = await createPerson(db, { firstName: 'Admina', network: 'WOMENS' });

    await assignTo(db, root.id, null, SEPTEMBER);

    await expect(placement(root.id)).resolves.toEqual([root.id]);
    expect(await placement(root.id)).not.toContain(admina.id);
  });

  it('ignores an assignment that ended before the period began', async () => {
    // **Found by a mutation, not by reading the rule.** Section 20's fallback is the last
    // assignment held "at any instant within the period", and an assignment closed in
    // August was not held within October. Without the lower bound, Mark is placed under a
    // leader who had not led him for two months -- and the total still reconciles, because
    // he lands in exactly one subtree. Only the wrong one.
    //
    // The rest of this file passed with that bound removed, which is why it is here.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);
    await assignTo(db, manuel.id, root.id, SEPTEMBER);

    const longClosed = await assignTo(db, mark.id, manuel.id, AUGUST);
    await closeAt(longClosed, LATE_AUGUST);

    await expect(placement(manuel.id)).resolves.toEqual([manuel.id]);
    await expect(placement(root.id)).resolves.toEqual([root.id, manuel.id]);
  });

  it('ignores an assignment that begins after the period', async () => {
    // A November edge is not October's, at either end of the rule: it is not in force at the
    // period's end and it does not overlap the period, so it contributes nothing.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, root.id, null, SEPTEMBER);
    await assignTo(db, mark.id, root.id, NOVEMBER);

    await expect(placement(root.id)).resolves.toEqual([root.id]);
  });
});
