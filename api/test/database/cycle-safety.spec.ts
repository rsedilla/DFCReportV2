import { Test } from '@nestjs/testing';

import { DatabaseModule } from '../../src/database/database.module';
import { AppConfigModule } from '../../src/config/config.module';
import { HierarchyModule } from '../../src/hierarchy/hierarchy.module';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';

/**
 * Cycles cannot be expressed as a row-level constraint, so section 5 asks for two
 * things: the domain layer rejects one before writing, and every recursive query
 * carries its own cycle detection so that a cycle introduced by any other means --
 * a migration, direct SQL, or a defect -- surfaces as an error rather than as a
 * query that never returns.
 *
 * This suite checks the second. It writes a cycle the way the specification says
 * one will really arrive: straight into the database, past every service.
 */
describe('recursive queries are cycle-safe (SKILL.md section 5)', () => {
  let db: Kysely<Database>;
  let app: INestApplication;
  let hierarchy: HierarchyService;

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

  it('resolves a subtree of an ordinary tree', async () => {
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);

    await expect(hierarchy.subtreeOf(db, raymond.id)).resolves.toEqual([
      raymond.id,
      manuel.id,
      mark.id,
    ]);
    await expect(hierarchy.ancestorsOf(mark.id)).resolves.toEqual([manuel.id, raymond.id]);
    await expect(hierarchy.directChildrenOf(raymond.id)).resolves.toEqual([manuel.id]);
  });

  it('reports a cycle as an error rather than hanging', async () => {
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    // Written directly, exactly as a data migration or a fix script would.
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, manuel.id, mark.id);

    await expect(hierarchy.subtreeOf(db, manuel.id)).rejects.toThrow(/cycle/i);
    await expect(hierarchy.ancestorsOf(mark.id)).rejects.toThrow(/cycle/i);
  });

  it('treats a Network root as having no ancestors', async () => {
    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, oriel.id, null);

    await expect(hierarchy.ancestorsOf(oriel.id)).resolves.toEqual([]);
  });
});
