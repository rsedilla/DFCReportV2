import { Test } from '@nestjs/testing';
import { sql } from 'kysely';

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
 * The dated subtree walk every Stage 5 reporting read depends on (decision 0206;
 * SKILL.md sections 18 and 20).
 *
 * Section 18 requires a historical report to respect historical pastoral assignments,
 * and section 20 resolves the tree as of the end of the period reported. `subtreeOf`
 * filters `ended_at IS NULL`, so it answers only about now and would let a November
 * reassignment rewrite October. This is the method that does not.
 *
 * **Dates go forward from a fixed base rather than back from `now`.** A suite that
 * subtracts from the current instant drifts across a month boundary depending on when
 * it runs, and this file is about month boundaries.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('the dated subtree walk (decision 0206)', () => {
  let db: Kysely<Database>;
  let app: INestApplication;
  let hierarchy: HierarchyService;

  /** Fixed, and every instant below is one of these. */
  const OCTOBER = new Date('2027-10-01T00:00:00+08:00');
  const MID_OCTOBER = new Date('2027-10-15T00:00:00+08:00');
  const NOVEMBER = new Date('2027-11-01T00:00:00+08:00');
  const DECEMBER = new Date('2027-12-01T00:00:00+08:00');

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

  /** Closes an assignment, which is the half of a reassignment that ends the old edge. */
  const closeAt = async (assignmentId: string, endedAt: Date) => {
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: endedAt })
      .where('id', '=', assignmentId)
      .execute();
  };

  it('answers about the instant it is given, not about now', async () => {
    // Mark is under Manuel in October and moves to Ben in November. October's answer
    // must not move when November's reassignment lands, which is section 3's
    // reproducibility guarantee reached through the tree.
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, raymond.id, null, OCTOBER);
    await assignTo(db, manuel.id, raymond.id, OCTOBER);
    await assignTo(db, ben.id, raymond.id, OCTOBER);
    const marksFirst = await assignTo(db, mark.id, manuel.id, OCTOBER);

    await closeAt(marksFirst, NOVEMBER);
    await assignTo(db, mark.id, ben.id, NOVEMBER);

    await expect(hierarchy.subtreeAsOf(db, manuel.id, MID_OCTOBER)).resolves.toEqual([
      manuel.id,
      mark.id,
    ]);
    await expect(hierarchy.subtreeAsOf(db, ben.id, MID_OCTOBER)).resolves.toEqual([ben.id]);

    // The same rows answer the other way round in December.
    await expect(hierarchy.subtreeAsOf(db, manuel.id, DECEMBER)).resolves.toEqual([manuel.id]);
    await expect(hierarchy.subtreeAsOf(db, ben.id, DECEMBER)).resolves.toEqual([ben.id, mark.id]);

    // And `subtreeOf` answers only about now, which is why reporting may not use it.
    await expect(hierarchy.subtreeOf(db, ben.id)).resolves.toEqual([ben.id, mark.id]);
  });

  it('excludes a row ending exactly at the instant, and places nobody twice', async () => {
    // **The half-open property, and the case that makes it load-bearing.** A
    // reassignment closes one row and opens another at one instant. Were the bound
    // inclusive at both ends, Mark would be in Manuel's subtree and in Ben's at that
    // instant -- and section 20's unique-people total would count him twice while both
    // leaders' figures claimed him.
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, raymond.id, null, OCTOBER);
    await assignTo(db, manuel.id, raymond.id, OCTOBER);
    await assignTo(db, ben.id, raymond.id, OCTOBER);
    const marksFirst = await assignTo(db, mark.id, manuel.id, OCTOBER);

    await closeAt(marksFirst, NOVEMBER);
    await assignTo(db, mark.id, ben.id, NOVEMBER);

    const underManuel = await hierarchy.subtreeAsOf(db, manuel.id, NOVEMBER);
    const underBen = await hierarchy.subtreeAsOf(db, ben.id, NOVEMBER);

    expect(underManuel).toEqual([manuel.id]);
    expect(underBen).toEqual([ben.id, mark.id]);

    // Stated as the property rather than left to the two assertions above: across the
    // whole church at that instant, Mark appears exactly once.
    const wholeChurch = await hierarchy.subtreeAsOf(db, raymond.id, NOVEMBER);
    expect(wholeChurch.filter((id) => id === mark.id)).toHaveLength(1);
  });

  it('includes the person themselves, and answers for a leaf', async () => {
    // The anchor row is in the result. The rule is section 16's `Total People` --
    // "distinct people in the pastoral subtree" -- reached through section 20's person
    // key, and a subtree total that excluded the leader would be short by one at every
    // level. *A first version justified it by section 7's `OWN_SUBTREE` including the
    // actor and by "every caller of this method": there are no callers, and scope
    // resolution goes through `isWithinSubtree`, an undated upward walk, rather than
    // through this.*
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, raymond.id, null, OCTOBER);
    await assignTo(db, mark.id, raymond.id, OCTOBER);

    await expect(hierarchy.subtreeAsOf(db, mark.id, MID_OCTOBER)).resolves.toEqual([mark.id]);
  });

  it('has no edges before the tree existed', async () => {
    // A period before anybody was assigned resolves to the person alone rather than to
    // the tree they later acquired -- the reassignment rule at the other end.
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, raymond.id, null, NOVEMBER);
    await assignTo(db, mark.id, raymond.id, NOVEMBER);

    await expect(hierarchy.subtreeAsOf(db, raymond.id, MID_OCTOBER)).resolves.toEqual([raymond.id]);
  });

  it('rejects a cycle that exists only in the dated projection', async () => {
    // **The hazard decision 0206 names, and it is not the one `subtreeOf` guards.**
    // Section 5 invariant 2 is evaluated against the *active* tree at each write, so the
    // rows in force at a past instant are a different edge set -- and that set can hold
    // a cycle the open rows never did.
    //
    // Written straight into the database, past every service, which is how section 5
    // says a cycle really arrives.
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await sql`
      INSERT INTO pastoral_assignments (person_id, leader_id, started_at)
      VALUES (${mark.id}::uuid, ${manuel.id}::uuid, ${OCTOBER}),
             (${manuel.id}::uuid, ${mark.id}::uuid, ${OCTOBER})
    `.execute(db);

    await expect(hierarchy.subtreeAsOf(db, manuel.id, MID_OCTOBER)).rejects.toThrow(/cycle/i);
  });
});
