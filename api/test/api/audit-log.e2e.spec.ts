import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { AuditAction, Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

interface Row {
  id: string;
  occurred_at: string;
  action: string;
  kind: string | null;
  actor: { account_id: string; person_id: string | null } | null;
  target: { type: string; id: string; person_id: string | null; cell_code: string | null };
  before: unknown;
  after: unknown;
  reason: string | null;
}

/**
 * The Admin's Audit Log (SKILL.md sections 19, 21 and 22, decision 0428).
 *
 * Entries are written straight into `audit_log`, which is append-only and admits an insert, so
 * each case controls exactly what the log holds. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('the Audit Log (decision 0428)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let adele: TestPerson;
  let bruno: TestPerson;
  let carla: TestPerson;
  let dario: TestPerson;
  let cell: TestCell;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    adele = await createPerson(db, { firstName: 'Adele', lastName: 'Ocampo', network: 'WOMENS' });
    bruno = await createPerson(db, { firstName: 'Bruno', lastName: 'Lacson', network: 'MENS' });
    carla = await createPerson(db, { firstName: 'Carla', lastName: 'Mendez', network: 'WOMENS' });
    dario = await createPerson(db, { firstName: 'Dario', lastName: 'Navarro', network: 'MENS' });
    await assignTo(db, bruno.id, null);
    await assignTo(db, carla.id, null);
    await assignTo(db, dario.id, bruno.id);
    cell = await createCell(db, { leader: dario });

    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });
    // Provisioning writes entries of its own; each case starts from an empty log.
    await truncateLog();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** `audit_log` refuses DELETE by trigger, so it is emptied by TRUNCATE alone. */
  async function truncateLog(): Promise<void> {
    await sql`TRUNCATE audit_log`.execute(db);
  }

  let minute = 0;
  async function entry(values: {
    action: AuditAction;
    targetType: string;
    targetId: string;
    actorId?: string | null;
    before?: unknown;
    after?: unknown;
    reason?: string;
  }): Promise<string> {
    minute += 1;
    const row = await db
      .insertInto('audit_log')
      .values({
        action: values.action,
        target_type: values.targetType,
        target_id: values.targetId,
        actor_id: values.actorId === undefined ? admin.id : values.actorId,
        before: values.before === undefined ? null : JSON.stringify(values.before),
        after: values.after === undefined ? null : JSON.stringify(values.after),
        reason: values.reason ?? null,
        occurred_at: new Date(Date.UTC(2026, 10, 1, 0, minute)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  const get = (reader: TestAccount, path = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/audit-log${path}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);

  async function actions(path = ''): Promise<string[]> {
    const response = await get(admin, path).expect(200);
    return (response.body.data as Row[]).map((row) => row.action);
  }

  it('lists the whole log newest first, naming who acted and whom it was about', async () => {
    await entry({ action: 'person.created', targetType: 'person', targetId: carla.id });
    await entry({
      action: 'pastoral_assignment.transferred',
      targetType: 'person',
      targetId: dario.id,
      before: { leader_id: carla.id },
      after: { leader_id: bruno.id },
    });
    await entry({ action: 'cell_category.changed', targetType: 'cell', targetId: cell.id });

    const response = await get(admin).expect(200);
    const rows = response.body.data as Row[];
    expect(rows.map((row) => row.action)).toEqual([
      'cell_category.changed',
      'pastoral_assignment.transferred',
      'person.created',
    ]);
    expect(rows[0].target).toMatchObject({ type: 'cell', cell_code: cell.cellId, person_id: null });
    expect(rows[1]).toMatchObject({
      kind: 'MOVES',
      actor: { account_id: admin.id, person_id: adele.id },
      target: { type: 'person', person_id: dario.id },
    });
    // The leaders a move went from and to are named, as is everyone the page mentions.
    expect(response.body.names[carla.id].name).toBe('Carla Mendez');
    expect(response.body.names[bruno.id].name).toBe('Bruno Lacson');
    expect(response.body.names[adele.id].name).toBe('Adele Ocampo');
    expect(response.body.names[dario.id].name).toBe('Dario Navarro');
  });

  it('says System for an entry nobody made, and names an account’s person', async () => {
    const reader = await createAccount(app, db, { person: bruno, roles: ['LEADER'] });
    await truncateLog();
    await entry({
      action: 'sign_in.paused',
      targetType: 'account',
      targetId: reader.id,
      actorId: null,
    });

    const [row] = (await get(admin).expect(200)).body.data as Row[];
    expect(row.actor).toBeNull();
    expect(row.target).toMatchObject({ type: 'account', person_id: bruno.id });
  });

  it('pages by the cursor it hands back, skipping and repeating nothing', async () => {
    for (let i = 0; i < 5; i += 1) {
      await entry({ action: 'person.updated', targetType: 'person', targetId: carla.id });
    }
    const first = await get(admin, '?limit=3').expect(200);
    const second = await get(admin, `?limit=3&cursor=${first.body.next_cursor}`).expect(200);
    const ids = [...first.body.data, ...second.body.data].map((row: Row) => row.id);
    expect(new Set(ids).size).toBe(5);
    expect(second.body.next_cursor).toBeNull();
  });

  it('narrows to one kind, and refuses a kind it does not know', async () => {
    await entry({ action: 'person.created', targetType: 'person', targetId: carla.id });
    await entry({
      action: 'setting.changed',
      targetType: 'setting',
      targetId: 'cell_attention_months',
    });
    await entry({ action: 'cell_category.changed', targetType: 'cell', targetId: cell.id });

    expect(await actions('?kind=SETTINGS')).toEqual(['setting.changed']);
    expect(await actions('?kind=CELLS')).toEqual(['cell_category.changed']);
    expect(await actions('?kind=EVERYTHING')).toHaveLength(3);
    await get(admin, '?kind=EVERYONE').expect(422);
  });

  it('finds the entries about a person, or made by them, by name or Member ID', async () => {
    const brunoAccount = await createAccount(app, db, { person: bruno, roles: ['LEADER'] });
    await truncateLog();
    await entry({ action: 'person.created', targetType: 'person', targetId: carla.id });
    await entry({ action: 'person.updated', targetType: 'person', targetId: dario.id });
    await entry({
      action: 'directory.searched',
      targetType: 'account',
      targetId: brunoAccount.id,
      actorId: brunoAccount.id,
    });

    expect(await actions('?q=mendez')).toEqual(['person.created']);
    expect(await actions('?q=lacson')).toEqual(['directory.searched']);
    const { member_id } = await db
      .selectFrom('persons')
      .select('member_id')
      .where('id', '=', dario.id)
      .executeTakeFirstOrThrow();
    expect(await actions(`?q=${member_id}`)).toEqual(['person.updated']);
    expect(await actions('?q=nobody')).toEqual([]);
  });

  it('finds the entries about a Cell by its Cell ID', async () => {
    await entry({ action: 'person.created', targetType: 'person', targetId: carla.id });
    await entry({ action: 'cell_schedule.changed', targetType: 'cell', targetId: cell.id });

    expect(await actions(`?q=${cell.cellId}`)).toEqual(['cell_schedule.changed']);
    expect(await actions(`?q=${cell.cellId.toLowerCase()}`)).toEqual(['cell_schedule.changed']);
  });

  it('finds an entry through its own subject, not through somebody or a Cell in its detail', async () => {
    // A membership names its Cell only in the detail; its subject is the person (section 21).
    await entry({
      action: 'cell_membership.added',
      targetType: 'person',
      targetId: carla.id,
      after: { cell_id: cell.cellId, cell_uuid: cell.id },
    });
    await entry({
      action: 'pastoral_assignment.transferred',
      targetType: 'person',
      targetId: dario.id,
      before: { leader_id: carla.id },
      after: { leader_id: bruno.id },
    });

    expect(await actions(`?q=${cell.cellId}`)).toEqual([]);
    expect(await actions('?q=mendez')).toEqual(['cell_membership.added']);
    expect(await actions('?q=lacson')).toEqual([]);
  });

  it('refuses a cursor it cannot read', async () => {
    await get(admin, '?cursor=not-a-cursor').expect(422);
  });

  it('writes nothing to the log when it is read', async () => {
    await entry({ action: 'person.created', targetType: 'person', targetId: carla.id });
    await get(admin).expect(200);
    await get(admin, '?q=mendez').expect(200);
    const { count } = await db
      .selectFrom('audit_log')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(Number(count)).toBe(1);
  });

  describe('who may read it', () => {
    it('refuses a Leader', async () => {
      const reader = await createAccount(app, db, { person: bruno, roles: ['LEADER'] });
      await get(reader).expect(403);
    });

    it('refuses a Senior Pastor', async () => {
      nameSeniorPastors(app, [bruno.id, carla.id]);
      const pastor = await createAccount(app, db, {
        person: bruno,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });
      await get(pastor).expect(403);
    });

    it('refuses a grant of audit.view narrower than Whole Church', async () => {
      const reader = await createAccount(app, db, { person: bruno, roles: ['LEADER'] });
      await db
        .insertInto('capability_grants')
        .values({
          account_id: reader.id,
          capability: 'audit.view',
          scope_type: 'OWN_SUBTREE',
          read_only: true,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();
      await get(reader).expect(403);
    });

    it('admits a Whole Church grant of audit.view', async () => {
      const reader = await createAccount(app, db, { person: bruno, roles: ['LEADER'] });
      await db
        .insertInto('capability_grants')
        .values({
          account_id: reader.id,
          capability: 'audit.view',
          scope_type: 'WHOLE_CHURCH',
          read_only: true,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();
      await get(reader).expect(200);
    });

    it('refuses a request with no session', async () => {
      await request(app.getHttpServer()).get('/api/v1/audit-log').expect(401);
    });
  });
});
