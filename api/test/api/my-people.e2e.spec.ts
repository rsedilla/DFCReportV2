import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  addCellMember,
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

interface Row {
  person_id: string;
  full_name: string;
  leader: { person_id: string; full_name: string } | null;
  cell: { cell_id: string; category: string | null; day_of_week: number | null } | null;
  cell_withheld: boolean;
}

/**
 * A leader's people two levels down, as one plain list (SKILL.md section 19, decision 0422).
 *
 * Lorenzo is a root; Ramon is under him and reads the list. Anselmo and Benito are under Ramon,
 * Celso is under Anselmo and a member of Anselmo's Cell, and Dante is under Celso, three levels
 * down. Pascual is Ramon's sibling under Lorenzo. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('my people, two levels down (decision 0422)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let lorenzo: TestPerson;
  let ramon: TestPerson;
  let anselmo: TestPerson;
  let benito: TestPerson;
  let celso: TestPerson;
  let dante: TestPerson;
  let pascual: TestPerson;
  let reader: TestAccount;
  let cellId: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    lorenzo = await createPerson(db, { firstName: 'Lorenzo', network: 'MENS' });
    ramon = await createPerson(db, { firstName: 'Ramon', lastName: 'Ilagan', network: 'MENS' });
    anselmo = await createPerson(db, { firstName: 'Anselmo', lastName: 'Diaz', network: 'MENS' });
    benito = await createPerson(db, { firstName: 'Benito', lastName: 'Cruz', network: 'MENS' });
    pascual = await createPerson(db, { firstName: 'Pascual', network: 'MENS' });
    await assignTo(db, lorenzo.id, null);
    await assignTo(db, ramon.id, lorenzo.id);
    await assignTo(db, pascual.id, lorenzo.id);
    await assignTo(db, anselmo.id, ramon.id);
    await assignTo(db, benito.id, ramon.id);
    const cell = await createCell(db, { leader: anselmo, category: 'YOUNG_PRO', dayOfWeek: 5 });
    cellId = cell.cellId;
    celso = await addCellMember(db, cell, { firstName: 'Celso', under: anselmo.id });
    dante = await createPerson(db, { firstName: 'Dante', network: 'MENS' });
    await assignTo(db, dante.id, celso.id);

    reader = await createAccount(app, db, { person: ramon, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/cells/people/mine${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  it('lists the reader’s people two levels down, in first-name order, each with their leader and Cell', async () => {
    const rows = (await get(reader, '').expect(200)).body.data as Row[];

    expect(rows.map((row) => row.person_id)).toEqual([anselmo.id, benito.id, celso.id]);
    const [a, b, c] = rows;
    // Their own people have no leader named: the reader is it.
    expect(a.leader).toBeNull();
    // Anselmo leads the Cell; Benito belongs to none.
    expect(a.cell).toEqual({ cell_id: cellId, category: 'YOUNG_PRO', day_of_week: 5 });
    expect(b.cell).toBeNull();
    expect(b.cell_withheld).toBe(false);
    // Celso is under Anselmo and a member of his Cell.
    expect(c.leader).toEqual({ person_id: anselmo.id, full_name: 'Anselmo Diaz' });
    expect(c.cell?.cell_id).toBe(cellId);
  });

  it('leaves out the third level and anyone outside the reader’s branch', async () => {
    const ids = ((await get(reader, '').expect(200)).body.data as Row[]).map(
      (row) => row.person_id,
    );

    expect(ids).not.toContain(dante.id);
    expect(ids).not.toContain(pascual.id);
    expect(ids).not.toContain(lorenzo.id);
    expect(ids).not.toContain(ramon.id);
  });

  it('counts them, directly and beneath', async () => {
    expect((await get(reader, '/counts').expect(200)).body).toEqual({
      all: 3,
      direct: 2,
      beneath: 1,
    });
  });

  it('pages by the cursor it hands back', async () => {
    const first = await get(reader, '?limit=2').expect(200);
    expect((first.body.data as Row[]).map((row) => row.person_id)).toEqual([anselmo.id, benito.id]);
    const second = await get(reader, `?limit=2&cursor=${first.body.next_cursor}`).expect(200);
    expect((second.body.data as Row[]).map((row) => row.person_id)).toEqual([celso.id]);
    expect(second.body.next_cursor).toBeNull();
  });

  it('answers a reader with nobody under them with an empty list', async () => {
    const lone = await createAccount(app, db, { person: benito, roles: ['LEADER'] });

    expect((await get(lone, '').expect(200)).body.data).toEqual([]);
    expect((await get(lone, '/counts').expect(200)).body).toEqual({
      all: 0,
      direct: 0,
      beneath: 0,
    });
  });

  it('refuses a request with no session', async () => {
    await request(app.getHttpServer()).get('/api/v1/cells/people/mine').expect(401);
  });
});
