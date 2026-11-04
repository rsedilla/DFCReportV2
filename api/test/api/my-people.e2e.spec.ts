import { sql } from 'kysely';
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
  cell: {
    cell_id: string;
    category: string | null;
    day_of_week: number | null;
    led_by: { person_id: string; full_name: string; first_name: string } | null;
  } | null;
  cell_withheld: boolean;
}

/**
 * A leader's people as one plain list (SKILL.md section 19, decisions 0422 and 0437): two levels
 * down for a Full view account, which the fixtures give by default, and every level for one
 * without Full view.
 *
 * Lorenzo is a root; Ramon is under him and reads the list. Anselmo and Benito are under Ramon,
 * Celso is under Anselmo and a member of Anselmo's Cell, and Dante is under Celso, three levels
 * down. Pascual is Ramon's sibling under Lorenzo. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('my people (decisions 0422 and 0437)', () => {
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
    expect(a.cell).toEqual({
      cell_id: cellId,
      category: 'YOUNG_PRO',
      day_of_week: 5,
      led_by: { person_id: anselmo.id, full_name: 'Anselmo Diaz', first_name: 'Anselmo' },
    });
    expect(b.cell).toBeNull();
    expect(b.cell_withheld).toBe(false);
    // Celso is under Anselmo and a member of his Cell.
    expect(c.leader).toEqual({ person_id: anselmo.id, full_name: 'Anselmo Diaz' });
    expect(c.cell?.cell_id).toBe(cellId);
    expect(c.cell?.led_by?.first_name).toBe('Anselmo');
  });

  it('leaves out the third level for a Full view account, and anyone outside the reader’s branch', async () => {
    const ids = ((await get(reader, '').expect(200)).body.data as Row[]).map(
      (row) => row.person_id,
    );

    expect(ids).not.toContain(dante.id);
    expect(ids).not.toContain(pascual.id);
    expect(ids).not.toContain(lorenzo.id);
    expect(ids).not.toContain(ramon.id);
  });

  it('counts them, directly and beneath, and says the list stops at two levels', async () => {
    expect((await get(reader, '/counts').expect(200)).body).toEqual({
      all: 3,
      direct: 2,
      beneath: 1,
      every_level: false,
    });
  });

  describe('without Full view (decision 0437)', () => {
    let recording: TestAccount;

    beforeEach(async () => {
      await db
        .updateTable('accounts')
        .set({ full_view: false, moves_people: false, approves_cells: false })
        .where('id', '=', reader.id)
        .execute();
      recording = reader;
    });

    it('lists every level of the reader’s branch, each with their own leader', async () => {
      const rows = (await get(recording, '').expect(200)).body.data as Row[];

      expect(rows.map((row) => row.person_id)).toEqual([anselmo.id, benito.id, celso.id, dante.id]);
      expect(rows[3].leader).toEqual({ person_id: celso.id, full_name: expect.any(String) });
      expect(rows[3].leader?.full_name.startsWith('Celso')).toBe(true);
      expect(rows.map((row) => row.person_id)).not.toContain(pascual.id);
    });

    it('counts every level, and says so', async () => {
      expect((await get(recording, '/counts').expect(200)).body).toEqual({
        all: 4,
        direct: 2,
        beneath: 2,
        every_level: true,
      });
    });

    it('pages across the deeper levels by the cursor it hands back', async () => {
      const first = await get(recording, '?limit=3').expect(200);
      const second = await get(recording, `?limit=3&cursor=${first.body.next_cursor}`).expect(200);
      expect((second.body.data as Row[]).map((row) => row.person_id)).toEqual([dante.id]);
      expect(second.body.next_cursor).toBeNull();
    });

    it('names the reader as the leader of a Cell they lead themselves', async () => {
      const own = await createCell(db, { leader: ramon, category: 'YOUNG_PRO', dayOfWeek: 6 });
      const emilio = await addCellMember(db, own, { firstName: 'Emilio', under: ramon.id });

      const rows = (await get(recording, '').expect(200)).body.data as Row[];
      const row = rows.find((r) => r.person_id === emilio.id);
      expect(row?.cell?.cell_id).toBe(own.cellId);
      expect(row?.cell?.led_by).toEqual({
        person_id: ramon.id,
        full_name: 'Ramon Ilagan',
        first_name: 'Ramon',
      });
    });
  });

  it('pages by the cursor it hands back', async () => {
    const first = await get(reader, '?limit=2').expect(200);
    expect((first.body.data as Row[]).map((row) => row.person_id)).toEqual([anselmo.id, benito.id]);
    const second = await get(reader, `?limit=2&cursor=${first.body.next_cursor}`).expect(200);
    expect((second.body.data as Row[]).map((row) => row.person_id)).toEqual([celso.id]);
    expect(second.body.next_cursor).toBeNull();
  });

  /** The reader's account with its role revoked, so it holds only what a case grants it. */
  async function stripRoles(account: TestAccount): Promise<TestAccount> {
    await db
      .updateTable('account_roles')
      .set({ revoked_at: sql`granted_at + interval '1 second'` })
      .where('account_id', '=', account.id)
      .execute();
    return account;
  }

  async function grant(account: TestAccount, scope: 'OWN_SUBTREE' | 'NETWORK') {
    const admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Adele', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
    await db
      .insertInto('capability_grants')
      .values({
        account_id: account.id,
        capability: 'people.view_subtree',
        scope_type: scope,
        scope_network: scope === 'NETWORK' ? 'MENS' : null,
        read_only: true,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: admin.id,
      })
      .execute();
  }

  it('refuses an account holding no people.view_subtree, on both routes', async () => {
    const bare = await stripRoles(reader);

    expect((await get(bare, '').expect(403)).body.error.code).toBe('CAPABILITY_DENIED');
    expect((await get(bare, '/counts').expect(403)).body.error.code).toBe('CAPABILITY_DENIED');
  });

  it('withholds each Cell from a reader who may not read Cells', async () => {
    // people.view_subtree over their own branch, and no cell.view_subtree at all.
    const reader2 = await stripRoles(reader);
    await grant(reader2, 'OWN_SUBTREE');

    // An account holding no role has no Full view, so the list reaches every level.
    const rows = (await get(reader2, '').expect(200)).body.data as Row[];
    expect(rows.map((row) => row.person_id)).toEqual([anselmo.id, benito.id, celso.id, dante.id]);
    for (const row of rows) {
      expect(row.cell).toBeNull();
      expect(row.cell_withheld).toBe(true);
    }
  });

  it('lists the reader’s own two levels under a Network-wide grant, never the rest of the Network', async () => {
    // Pascual's grant reaches the whole Men's Network; his list is still his own tree, which is
    // nobody: the rows come from the tree, never from the grant.
    const wide = await createAccount(app, db, { person: pascual, roles: [] });
    await grant(wide, 'NETWORK');

    expect((await get(wide, '').expect(200)).body.data).toEqual([]);
    expect((await get(wide, '/counts').expect(200)).body).toEqual({
      all: 0,
      direct: 0,
      beneath: 0,
      every_level: true,
    });
  });

  it('answers a reader with nobody under them with an empty list', async () => {
    const lone = await createAccount(app, db, { person: benito, roles: ['LEADER'] });

    expect((await get(lone, '').expect(200)).body.data).toEqual([]);
    expect((await get(lone, '/counts').expect(200)).body).toEqual({
      all: 0,
      direct: 0,
      beneath: 0,
      every_level: false,
    });
  });

  it('refuses a request with no session', async () => {
    await request(app.getHttpServer()).get('/api/v1/cells/people/mine').expect(401);
  });
});
