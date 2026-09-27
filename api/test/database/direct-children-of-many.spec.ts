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
 * `directChildrenOfManyAsOf`, the one-statement-per-generation form of
 * `directChildrenAsOf` that the DCC checklist walk now uses (SKILL.md section 9).
 *
 * **It must answer exactly what one call per leader answered**, because the checklist
 * decides whose attendance an actor is shown, and a batching change is a place where a
 * period boundary quietly moves. So each case compares against the per-leader method
 * as well as against the expected people.
 *
 * `[started_at, ended_at)` is the period every effective-dated table uses (section 5):
 * a row ending exactly at the instant is not in force, and one starting at it is.
 *
 * Dates go forward from a fixed base rather than back from now. Fixture names are
 * invented (CLAUDE.md, Secrets); the tree is `Raymond -> Manuel -> Mark`.
 */
describe('direct children of a whole generation, as of an instant (section 9)', () => {
  let db: Kysely<Database>;
  let app: INestApplication;
  let hierarchy: HierarchyService;

  const OCTOBER = new Date('2027-10-01T00:00:00+08:00');
  const MID_OCTOBER = new Date('2027-10-15T00:00:00+08:00');
  const NOVEMBER = new Date('2027-11-01T00:00:00+08:00');

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

  /** What the per-leader method answers for the same set, concatenated and sorted. */
  const perLeader = async (leaderIds: string[], at: Date): Promise<string[]> => {
    const all: string[] = [];
    for (const leaderId of leaderIds) {
      all.push(...(await hierarchy.directChildrenAsOf(db, leaderId, at)));
    }

    return all.sort();
  };

  it('answers an empty generation with nobody', async () => {
    await expect(hierarchy.directChildrenOfManyAsOf(db, [], MID_OCTOBER)).resolves.toEqual([]);
  });

  it('answers the direct children of every leader in the set, and no grandchild', async () => {
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    const timothy = await createPerson(db, { firstName: 'Timothy', network: 'MENS' });
    const nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    const quentin = await createPerson(db, { firstName: 'Quentin', network: 'MENS' });

    await assignTo(db, raymond.id, null, OCTOBER);
    await assignTo(db, manuel.id, raymond.id, OCTOBER);
    await assignTo(db, ben.id, raymond.id, OCTOBER);
    await assignTo(db, mark.id, manuel.id, OCTOBER);
    await assignTo(db, timothy.id, manuel.id, OCTOBER);
    await assignTo(db, nathan.id, ben.id, OCTOBER);
    // A grandchild of Manuel, which one generation must not reach.
    await assignTo(db, quentin.id, mark.id, OCTOBER);

    const children = await hierarchy.directChildrenOfManyAsOf(db, [manuel.id, ben.id], MID_OCTOBER);

    expect([...children].sort()).toEqual([mark.id, timothy.id, nathan.id].sort());
    expect([...children].sort()).toEqual(await perLeader([manuel.id, ben.id], MID_OCTOBER));
    expect(children).not.toContain(quentin.id);
    // The leaders themselves are not their own children.
    expect(children).not.toContain(manuel.id);
    expect(children).not.toContain(ben.id);
  });

  it('excludes a row ending exactly at the instant and includes one starting at it', async () => {
    // Mark is under Manuel in October and moves to Ben at the first instant of
    // November: a close-and-open pair sharing one instant, which is a reassignment
    // (section 5). At that instant the old row is over and the new one is in force,
    // so Mark is Ben's child and not Manuel's -- once, not twice.
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

    await expect(hierarchy.directChildrenOfManyAsOf(db, [manuel.id], NOVEMBER)).resolves.toEqual(
      [],
    );
    await expect(hierarchy.directChildrenOfManyAsOf(db, [ben.id], NOVEMBER)).resolves.toEqual([
      mark.id,
    ]);
    await expect(
      hierarchy.directChildrenOfManyAsOf(db, [manuel.id, ben.id], NOVEMBER),
    ).resolves.toEqual([mark.id]);

    // One millisecond earlier the old row is still in force and the new one is not.
    const justBefore = new Date(NOVEMBER.getTime() - 1);
    await expect(hierarchy.directChildrenOfManyAsOf(db, [manuel.id], justBefore)).resolves.toEqual([
      mark.id,
    ]);
    await expect(hierarchy.directChildrenOfManyAsOf(db, [ben.id], justBefore)).resolves.toEqual([]);

    for (const at of [justBefore, NOVEMBER]) {
      expect(
        [...(await hierarchy.directChildrenOfManyAsOf(db, [manuel.id, ben.id], at))].sort(),
      ).toEqual(await perLeader([manuel.id, ben.id], at));
    }
  });

  it('does not reach a row that begins after the instant', async () => {
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, raymond.id, null, OCTOBER);
    await assignTo(db, manuel.id, raymond.id, OCTOBER);
    await assignTo(db, mark.id, manuel.id, NOVEMBER);

    await expect(
      hierarchy.directChildrenOfManyAsOf(db, [raymond.id, manuel.id], MID_OCTOBER),
    ).resolves.toEqual([manuel.id]);
  });
});
