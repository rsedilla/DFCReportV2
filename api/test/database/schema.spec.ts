import { sql, type Kysely } from 'kysely';

import { ALL_CAPABILITIES } from '../../src/auth/authorization/capabilities';
import { ALL_SCOPE_TYPES } from '../../src/auth/authorization/scopes';
import { createTestDb } from '../setup/database';

import type { Database } from '../../src/database/schema';

/**
 * An invariant that can be expressed as a database constraint must exist as a
 * database constraint (CLAUDE.md, Definition of Done). This suite checks that the
 * ones SKILL.md section 5 names are actually in the schema, by name, and that the
 * constraint trigger is deferred as section 4 requires.
 *
 * The behavioural half is in `invariants.spec.ts`. Both are needed: a constraint
 * that exists but does not fire, and a rule that fires from application code with
 * no constraint behind it, look identical from a passing test of the other kind.
 */
describe('the schema (SKILL.md sections 4, 5 and 7)', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('runs on PostgreSQL 16 or later, which the CYCLE clause requires', async () => {
    const result = await sql<{
      version: string;
    }>`SELECT current_setting('server_version') AS version`.execute(db);
    const major = Number.parseInt(result.rows[0].version.split('.')[0], 10);

    expect(major).toBeGreaterThanOrEqual(16);
  });

  describe('pastoral_assignments', () => {
    it('has the partial unique index that permits zero rows and forbids two', async () => {
      const index = await indexDefinition(db, 'pastoral_assignments_one_active');

      expect(index).toMatch(/CREATE UNIQUE INDEX/i);
      expect(index).toMatch(/\(person_id\)/i);
      expect(index).toMatch(/WHERE \(ended_at IS NULL\)/i);
    });

    it('has the no-self-assignment check', async () => {
      const constraint = await constraintDefinition(db, 'pastoral_assignments_no_self');

      expect(constraint).toMatch(/CHECK/i);
      expect(constraint).toMatch(/person_id <> leader_id/i);
    });

    it('has an index for subtree traversal by leader', async () => {
      const index = await indexDefinition(db, 'pastoral_assignments_active_by_leader');

      expect(index).toMatch(/\(leader_id\)/i);
      expect(index).toMatch(/WHERE \(ended_at IS NULL\)/i);
    });

    it('enforces the same-Network edge with a deferred constraint trigger', async () => {
      const trigger = await triggerFacts(db, 'pastoral_assignments_same_network');

      expect(trigger.is_constraint_trigger).toBe(true);
      // Section 4 requires a Network change and its reassignment to happen in one
      // atomic operation. A trigger firing per statement would see the
      // intermediate state and reject whichever ran first.
      expect(trigger.deferrable).toBe(true);
      expect(trigger.initially_deferred).toBe(true);
    });
  });

  describe('network_assignments', () => {
    it('re-validates open edges on a Network change, deferred', async () => {
      const trigger = await triggerFacts(db, 'network_assignments_keep_edges_same_network');

      expect(trigger.is_constraint_trigger).toBe(true);
      expect(trigger.deferrable).toBe(true);
      expect(trigger.initially_deferred).toBe(true);
    });
  });

  describe('one open row per person, on every effective-dated table', () => {
    it.each([
      ['person_lifecycle', 'person_lifecycle_one_open'],
      ['network_assignments', 'network_assignments_one_open'],
      ['pastoral_assignments', 'pastoral_assignments_one_active'],
    ])('%s', async (_table, indexName) => {
      const index = await indexDefinition(db, indexName);

      expect(index).toMatch(/CREATE UNIQUE INDEX/i);
      expect(index).toMatch(/\(person_id\)/i);
    });
  });

  describe('account_roles', () => {
    it('caps SENIOR_PASTOR with an index, not a check that runs', async () => {
      // A constraint trigger is skipped under `pg_restore --disable-triggers`; a
      // unique index is not. The restore is exactly when nobody is watching.
      const index = await indexDefinition(db, 'account_roles_one_senior_pastor_per_slot');

      expect(index).toMatch(/CREATE UNIQUE INDEX/i);
      expect(index).toMatch(/\(senior_pastor_slot\)/i);
      expect(index).toMatch(/WHERE \(revoked_at IS NULL\)/i);
    });

    it('ties the slot to the role', async () => {
      const constraint = await constraintDefinition(db, 'account_roles_slot_belongs_to_the_role');

      expect(constraint).toMatch(/CHECK/i);
      expect(constraint).toMatch(/senior_pastor_slot/i);
    });
  });

  describe('history is never deleted (principle 12)', () => {
    it.each(['person_lifecycle', 'network_assignments', 'pastoral_assignments'])(
      '%s refuses a DELETE',
      async (table) => {
        const trigger = await triggerFacts(db, `${table}_no_delete`);

        expect(trigger.deferrable).toBe(false);
      },
    );
  });

  describe('the closed enumerations of section 7', () => {
    it('stores exactly the twenty-four capabilities', async () => {
      expect(await enumLabels(db, 'capability')).toEqual([...ALL_CAPABILITIES]);
    });

    it('stores exactly the four scope values', async () => {
      expect(await enumLabels(db, 'scope_type')).toEqual([...ALL_SCOPE_TYPES]);
    });

    it('rejects read_only on a write capability at creation', async () => {
      const constraint = await constraintDefinition(db, 'capability_grants_read_only_is_a_read');

      expect(constraint).toMatch(/CHECK/i);
      expect(constraint).toMatch(/read_only/i);
    });

    it('requires a Network to be named on a NETWORK-scoped grant', async () => {
      const constraint = await constraintDefinition(db, 'capability_grants_network_scope_named');

      expect(constraint).toMatch(/scope_network/i);
    });
  });

  describe('the other closed enumerations', () => {
    it.each([
      ['sex', ['MALE', 'FEMALE']],
      ['civil_status', ['SINGLE', 'MARRIED', 'WIDOWED']],
      ['network', ['MENS', 'WOMENS']],
      ['lifecycle_state', ['CURRENT', 'ARCHIVED']],
      ['account_status', ['PENDING_ACTIVATION', 'ACTIVE', 'DISABLED']],
      ['account_role', ['SENIOR_PASTOR', 'ADMIN', 'LEADER']],
    ])('%s', async (typeName, expected) => {
      expect(await enumLabels(db, typeName)).toEqual(expected);
    });
  });
});

async function indexDefinition(db: Kysely<Database>, name: string): Promise<string> {
  const result = await sql<{ indexdef: string }>`
    SELECT indexdef FROM pg_indexes WHERE indexname = ${name}
  `.execute(db);

  if (result.rows.length === 0) {
    throw new Error(`index ${name} does not exist`);
  }

  return result.rows[0].indexdef;
}

async function constraintDefinition(db: Kysely<Database>, name: string): Promise<string> {
  const result = await sql<{ definition: string }>`
    SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = ${name}
  `.execute(db);

  if (result.rows.length === 0) {
    throw new Error(`constraint ${name} does not exist`);
  }

  return result.rows[0].definition;
}

async function triggerFacts(
  db: Kysely<Database>,
  name: string,
): Promise<{ is_constraint_trigger: boolean; deferrable: boolean; initially_deferred: boolean }> {
  const result = await sql<{
    is_constraint_trigger: boolean;
    deferrable: boolean;
    initially_deferred: boolean;
  }>`
    SELECT tgconstraint <> 0 AS is_constraint_trigger,
           tgdeferrable    AS deferrable,
           tginitdeferred  AS initially_deferred
      FROM pg_trigger
     WHERE tgname = ${name}
       AND NOT tgisinternal
  `.execute(db);

  if (result.rows.length === 0) {
    throw new Error(`trigger ${name} does not exist`);
  }

  return result.rows[0];
}

async function enumLabels(db: Kysely<Database>, typeName: string): Promise<string[]> {
  const result = await sql<{ enumlabel: string }>`
    SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = ${typeName}
     ORDER BY e.enumsortorder
  `.execute(db);

  if (result.rows.length === 0) {
    throw new Error(`type ${typeName} does not exist`);
  }

  return result.rows.map((row) => row.enumlabel);
}
