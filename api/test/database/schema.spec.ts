import { sql, type Kysely } from 'kysely';

import { ALL_CAPABILITIES } from '../../src/auth/authorization/capabilities';
import { ALL_SCOPE_TYPES } from '../../src/auth/authorization/scopes';
import { createTestDb } from '../setup/database';

import type { Database } from '../../src/database/schema';

/**
 * An invariant that can be expressed as a database constraint must exist as a
 * database constraint (CLAUDE.md, Definition of Done). This suite checks that the
 * ones SKILL.md sections 4, 5, 6 and 7 name are actually in the schema, by name,
 * and that the constraint trigger is deferred as section 4 requires. A rule
 * stated as the *absence* of something — section 6's refusal of a database
 * default on `issued_at` — is held here too, since nothing else can fail for it.
 *
 * The behavioural half is in `invariants.spec.ts`. Both are needed: a constraint
 * that exists but does not fire, and a rule that fires from application code with
 * no constraint behind it, look identical from a passing test of the other kind.
 */
describe('the schema (SKILL.md sections 4, 5, 6 and 7)', () => {
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

    it('holds an account to one governing role with an index, for the same reason', async () => {
      // Section 7: an account holds at most one of ADMIN and SENIOR_PASTOR. The
      // shape is held here as well as the behaviour, because the predicate is the
      // whole rule.
      //
      // **The absence is the load-bearing assertion.** Presence of the two names
      // is satisfied by a predicate widened to include LEADER, which would forbid
      // a legitimate row — so a shape test asserting only what is there pins the
      // narrowing and not the widening, and the comment here claimed both until a
      // review said otherwise. The behavioural cases in invariants.spec.ts catch
      // it too; a shape that agrees with them is what stops the two drifting.
      const index = await indexDefinition(db, 'account_roles_one_governing_role');

      expect(index).toMatch(/CREATE UNIQUE INDEX/i);
      expect(index).toMatch(/\(account_id\)/i);
      expect(index).toMatch(/revoked_at IS NULL/i);
      expect(index).toMatch(/ADMIN/);
      expect(index).toMatch(/SENIOR_PASTOR/);
      expect(index).not.toMatch(/LEADER/);
    });

    it('refuses grant-making to a Senior Pastor from both sides, and defers', async () => {
      // Section 7: `roles.manage` and `accounts.manage` are never held by an
      // account holding SENIOR_PASTOR, however granted. The rule spans two tables,
      // so no index reaches it and there are two triggers rather than one --
      // enforcing on grants alone is walkable by granting first and adding the
      // role second.
      //
      // **Both halves of the shape matter.** Deferral is what lets a transaction
      // revoke a conflicting grant and add the role in either order; the pairing is
      // what makes the rule symmetric. A later migration dropping either would
      // leave the behavioural cases in invariants.spec.ts as the only guard, and
      // one of those passes on the surviving direction alone.
      const onGrants = await constraintTriggerFacts(
        db,
        'capability_grants',
        'capability_grants_not_for_senior_pastor',
      );
      const onRoles = await constraintTriggerFacts(
        db,
        'account_roles',
        'account_roles_senior_pastor_makes_no_grants',
      );

      const shared = {
        deferrable: true,
        initially_deferred: true,
        fires_on_insert: true,
        fires_on_update: true,
        timing: 'AFTER',
        per_row: true,
        enabled: true,
      };

      // The function is named too, because a migration repointing either trigger
      // at a different function would otherwise pass -- which is the one fact
      // `deleteTriggerFacts` asserts at every one of its call sites.
      expect(onGrants).toEqual({ ...shared, function_name: 'assert_grant_not_for_senior_pastor' });
      expect(onRoles).toEqual({
        ...shared,
        function_name: 'assert_senior_pastor_makes_no_grants',
      });
    });

    it('ties the slot to the role, and refuses a null slot explicitly', async () => {
      const constraint = await constraintDefinition(db, 'account_roles_slot_belongs_to_the_role');

      expect(constraint).toMatch(/CHECK/i);
      expect(constraint).toMatch(/senior_pastor_slot/i);
      // Not redundant with `IN (1, 2)`: a CHECK passes on NULL, so without this
      // the cap admits any number of slotless Senior Pastors. The behavioural
      // proof is in invariants.spec.ts; this holds the constraint's shape so a
      // rewrite cannot quietly drop it.
      expect(constraint).toMatch(/senior_pastor_slot IS NOT NULL/i);
    });
  });

  describe('refresh_tokens', () => {
    it('gives issued_at no default, because the absence is the enforcement', async () => {
      // `issued_at` is compared against `accounts.sessions_revoked_at` and against
      // a JWT's `iat`, both stamped by an API process (SKILL.md section 6), and
      // that comparison decides whether a revoked session stays alive. `now()` is
      // the database's clock, so a default here is a silent fallback to the wrong
      // one for any writer that omits the column -- a backfill, a data fix, a
      // future service.
      //
      // The rule is therefore stated as an absence, and an absence is what has to
      // be held: a later migration adding `DEFAULT now()` back would reinstate the
      // defect with the whole suite green. The TypeScript type covers only writers
      // that go through the query builder, which is the gap this closes.
      const column = await columnFacts(db, 'refresh_tokens', 'issued_at');

      expect(column.default_expression).toBeNull();
      // The other half. Without NOT NULL, a writer omitting the column inserts a
      // null rather than failing, and every comparison against it is false -- so
      // the token sorts on neither side of a revocation.
      expect(column.not_null).toBe(true);
    });
  });

  describe('history is never deleted (principle 12)', () => {
    it.each([
      'person_lifecycle',
      'network_assignments',
      'pastoral_assignments',
      'account_roles',
      'capability_grants',
    ])('%s refuses a DELETE, before the row goes', async (table) => {
      // Asserting only that a trigger of this name exists would pass for a
      // trigger on INSERT that did nothing.
      const trigger = await deleteTriggerFacts(db, `${table}_no_delete`);

      expect(trigger.fires_on_delete).toBe(true);
      expect(trigger.timing).toBe('BEFORE');
      expect(trigger.per_row).toBe(true);
      expect(trigger.enabled).toBe(true);
      expect(trigger.table_name).toBe(table);
      expect(trigger.function_name).toBe('refuse_delete_of_history');
    });

    it.each([
      ['person_lifecycle', 'person_lifecycle_period_ordered'],
      ['network_assignments', 'network_assignments_period_ordered'],
      ['pastoral_assignments', 'pastoral_assignments_period_ordered'],
    ])('%s permits a zero-length row, which is how an error is corrected', async (_t, name) => {
      // Section 5 prescribes closing the wrong row and opening the right one, and
      // a strict `>` allowed only closing it a moment later -- recording a
      // non-zero period of a fact that was never true. The behavioural proof is
      // in invariants.spec.ts; this holds the boundary so a rewrite of the
      // constraint cannot quietly put it back.
      const constraint = await constraintDefinition(db, name);

      expect(constraint).toMatch(/ended_at >= started_at/i);
      expect(constraint).not.toMatch(/ended_at > started_at/i);
    });
  });

  describe('the tables migration 0002 adds', () => {
    it('makes audit_log append-only, against both writes', async () => {
      // Section 21: "Nothing updates or deletes a row". A trigger on DELETE alone
      // would leave the way an audit trail is actually tampered with wide open.
      const trigger = await deleteTriggerFacts(db, 'audit_log_append_only');

      expect(trigger.fires_on_delete).toBe(true);
      expect(trigger.fires_on_update).toBe(true);
      expect(trigger.timing).toBe('BEFORE');
      expect(trigger.per_row).toBe(true);
      expect(trigger.enabled).toBe(true);
      expect(trigger.table_name).toBe('audit_log');
      expect(trigger.function_name).toBe('refuse_change_to_audit_log');
    });

    it('refuses a DELETE on settings, with its own message', async () => {
      const trigger = await deleteTriggerFacts(db, 'settings_no_delete');

      expect(trigger.fires_on_delete).toBe(true);
      expect(trigger.timing).toBe('BEFORE');
      expect(trigger.per_row).toBe(true);
      expect(trigger.enabled).toBe(true);
      expect(trigger.table_name).toBe('settings');
      // Not refuse_delete_of_history(), whose message tells the caller to close
      // the row and open a new one. `settings` holds one row per key and is
      // corrected by writing a value.
      expect(trigger.function_name).toBe('refuse_delete_of_setting');
    });

    it('holds the settings key set closed, as section 7 says it is', async () => {
      const constraint = await constraintDefinition(db, 'settings_key_is_known');

      expect(constraint).toMatch(/CHECK/i);
      expect(constraint).toMatch(/cell_attention_months/);
      expect(constraint).toMatch(/initial_encoding_open/);
    });

    it('keys idempotency by account and key together, never by key alone', async () => {
      // A global key would let one account claim another's (SKILL.md section 22,
      // and the reasoning in the migration).
      const constraint = await constraintDefinition(db, 'idempotency_keys_pkey');

      expect(constraint).toMatch(/PRIMARY KEY/i);
      expect(constraint).toMatch(/account_id/);
      expect(constraint).toMatch(/key/);
    });

    it('stores the two idempotency states section 22 names', async () => {
      expect(await enumLabels(db, 'idempotency_state')).toEqual(['IN_FLIGHT', 'COMPLETED']);
    });

    it('leaves audit_log.action as text, because section 21 does not close its list', async () => {
      // The one closed-enumeration decision in this schema that goes the other
      // way. Section 7 says its capability list is closed and that adding one is
      // an amendment; section 21 opens its list with "including", and a migration
      // may not turn that into a closure.
      const facts = await columnFacts(db, 'audit_log', 'action');
      expect(facts.not_null).toBe(true);

      const constraint = await constraintDefinition(db, 'audit_log_action_shape');
      expect(constraint).toMatch(/CHECK/i);
    });

    it('makes audit_log.target_id required text, because not every target is a UUID', async () => {
      // Section 21 lists "System setting changed" as auditable and section 7 keys
      // `settings` by `key`, so a uuid column here cannot record the one auditable
      // action migration 0002 introduces -- and leaves section 7's rule that an
      // audit entry resolves scope through its target with nothing to resolve.
      const facts = await columnFacts(db, 'audit_log', 'target_id');

      expect(facts.data_type).toBe('text');
      expect(facts.not_null).toBe(true);
    });
  });

  describe('the token retention floor of section 6', () => {
    // The floor is a security control rather than housekeeping: the obvious
    // prune deletes exactly the rows still carrying the reuse signal, so the
    // Definition of Done requires it to exist as a constraint rather than as an
    // instruction to whoever writes the retention job.
    it.each(['refresh_tokens', 'account_tokens'])(
      'guards %s with a delete trigger, before the row goes',
      async (table) => {
        // The same five facts every other no-delete case asserts. Name and
        // function alone would pass for a trigger recreated FOR EACH STATEMENT,
        // where OLD does not exist and the floor can never be read, or for one
        // left disabled by ALTER TABLE ... DISABLE TRIGGER.
        const trigger = await deleteTriggerFacts(db, `${table}_retention_floor`);

        expect(trigger.fires_on_delete).toBe(true);
        expect(trigger.timing).toBe('BEFORE');
        expect(trigger.per_row).toBe(true);
        expect(trigger.enabled).toBe(true);
        expect(trigger.table_name).toBe(table);
        expect(trigger.function_name).toBe('refuse_delete_before_retention_floor');
      },
    );
  });

  describe('the closed enumerations of section 7', () => {
    it('stores exactly the twenty-six capabilities', async () => {
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

/**
 * A constraint trigger's shape, read from the catalog rather than from its
 * definition text.
 *
 * Named for the table as well as the trigger, because trigger names are per
 * relation in PostgreSQL -- so matching on the name alone passes for a trigger of
 * the right name on the wrong table, and for one left disabled by
 * `ALTER TABLE ... DISABLE TRIGGER`. That is the warning `deleteTriggerFacts`
 * below already carries, and a first version of this helper reintroduced both
 * gaps eighty lines above it.
 */
async function constraintTriggerFacts(
  db: Kysely<Database>,
  table: string,
  name: string,
): Promise<{
  deferrable: boolean;
  initially_deferred: boolean;
  fires_on_insert: boolean;
  fires_on_update: boolean;
  timing: string;
  per_row: boolean;
  enabled: boolean;
  function_name: string;
}> {
  const result = await sql<{
    deferrable: boolean;
    initially_deferred: boolean;
    fires_on_insert: boolean;
    fires_on_update: boolean;
    timing: string;
    per_row: boolean;
    enabled: boolean;
    function_name: string;
  }>`
    SELECT t.tgdeferrable          AS deferrable,
           t.tginitdeferred        AS initially_deferred,
           (t.tgtype & 4) <> 0     AS fires_on_insert,
           (t.tgtype & 16) <> 0    AS fires_on_update,
           (t.tgtype & 1) <> 0     AS per_row,
           CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
           t.tgenabled IN ('O', 'A') AS enabled,
           p.proname               AS function_name
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = ${name}
       AND c.relname = ${table}
       AND NOT t.tgisinternal
  `.execute(db);

  if (result.rows.length === 0) {
    throw new Error(`constraint trigger ${name} does not exist on ${table}`);
  }

  return result.rows[0];
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

async function columnFacts(
  db: Kysely<Database>,
  table: string,
  column: string,
): Promise<{ not_null: boolean; default_expression: string | null; data_type: string }> {
  // Read from the catalog rather than information_schema.columns, whose
  // column_default is null both for a column with no default and for one whose
  // default the caller may not see -- and a test of an absence cannot use a
  // source that reports absence for two different reasons. Throwing when the
  // column is missing keeps a rename from reading as a passing absence.
  const result = await sql<{
    not_null: boolean;
    default_expression: string | null;
    data_type: string;
  }>`
    SELECT a.attnotnull                        AS not_null,
           pg_get_expr(d.adbin, d.adrelid)     AS default_expression,
           format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE c.relname = ${table}
       AND a.attname = ${column}
       AND a.attnum > 0
       AND NOT a.attisdropped
  `.execute(db);

  if (result.rows.length === 0) {
    throw new Error(`column ${table}.${column} does not exist`);
  }

  return result.rows[0];
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

async function deleteTriggerFacts(
  db: Kysely<Database>,
  name: string,
): Promise<{
  fires_on_delete: boolean;
  fires_on_update: boolean;
  timing: string;
  function_name: string;
  per_row: boolean;
  enabled: boolean;
  table_name: string;
}> {
  // Trigger names are per-relation in PostgreSQL, so matching on the name alone
  // would pass for a trigger of the right name attached to the wrong table --
  // and for one left disabled by ALTER TABLE ... DISABLE TRIGGER.
  const result = await sql<{
    fires_on_delete: boolean;
    fires_on_update: boolean;
    timing: string;
    function_name: string;
    per_row: boolean;
    enabled: boolean;
    table_name: string;
  }>`
    SELECT (t.tgtype & 8) <> 0   AS fires_on_delete,
           (t.tgtype & 16) <> 0  AS fires_on_update,
           (t.tgtype & 1) <> 0   AS per_row,
           CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
           t.tgenabled IN ('O', 'A') AS enabled,
           c.relname             AS table_name,
           p.proname             AS function_name
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE t.tgname = ${name}
       AND NOT t.tgisinternal
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
