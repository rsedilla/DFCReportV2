import { sql } from 'kysely';

import type { Db } from './database.module';

/**
 * The login the API connects as is checked at startup in production (SKILL.md section 24,
 * decision 0453).
 *
 * **Too much.** A superuser, or a login that owns a table or can `TRUNCATE` one, can empty
 * a table past the rules that records are never deleted and the audit log is append-only:
 * `TRUNCATE` fires no row trigger, and section 5 rests that exemption on the application's
 * login not holding it. A login that owns the database or the `public` schema can drop a table
 * outright, which no trigger sees either. One that can create in it is refused as well.
 *
 * **Too little.** A table it cannot read and write, or a sequence it cannot use, is a grant
 * somebody forgot after a migration added it. Found here, it stops the deploy at its
 * health check; found by a request, it is an error on whichever screen reaches it first.
 *
 * `scripts/restricted-login.sql` sets both up, and gives the login every table a later
 * migration adds. The migration runner's own history is left out of the too-little check:
 * the API never reads it.
 */
export const MIGRATION_LEDGER = 'schema_migrations';

/** What the database says about the login, gathered in one statement. */
export interface LoginFacts {
  login: string;
  superuser: boolean;
  /** Owns the database or the `public` schema, directly or through a role it belongs to. */
  ownsDatabaseOrSchema: boolean;
  /** Can create objects in the `public` schema. */
  createsInSchema: boolean;
  /** Tables the login owns, directly or through a role it belongs to. */
  owned: string[];
  truncatable: string[];
  /** Tables it lacks one of SELECT, INSERT, UPDATE and DELETE on. */
  tablesWithoutAccess: string[];
  /** Sequences it cannot draw a number from. */
  sequencesWithoutAccess: string[];
}

export async function readLoginFacts(db: Db): Promise<LoginFacts> {
  const { rows } = await sql<{
    login: string;
    superuser: boolean;
    owns_database_or_schema: boolean;
    creates_in_schema: boolean;
    owned: string[];
    truncatable: string[];
    tables_without_access: string[];
    sequences_without_access: string[];
  }>`
    SELECT current_user AS login,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
           (SELECT pg_has_role(current_user, d.datdba, 'MEMBER')
              FROM pg_database d WHERE d.datname = current_database())
             OR (SELECT pg_has_role(current_user, s.nspowner, 'MEMBER')
                   FROM pg_namespace s WHERE s.nspname = 'public') AS owns_database_or_schema,
           has_schema_privilege('public', 'CREATE') AS creates_in_schema,
           coalesce(array_agg(c.relname::text ORDER BY c.relname) FILTER (
             WHERE c.relkind IN ('r', 'p') AND pg_has_role(current_user, c.relowner, 'MEMBER')
           ), '{}') AS owned,
           coalesce(array_agg(c.relname::text ORDER BY c.relname) FILTER (
             WHERE c.relkind IN ('r', 'p') AND has_table_privilege(c.oid, 'TRUNCATE')
           ), '{}') AS truncatable,
           coalesce(array_agg(c.relname::text ORDER BY c.relname) FILTER (
             WHERE c.relkind IN ('r', 'p')
               AND c.relname <> ${MIGRATION_LEDGER}
               AND NOT (has_table_privilege(c.oid, 'SELECT')
                    AND has_table_privilege(c.oid, 'INSERT')
                    AND has_table_privilege(c.oid, 'UPDATE')
                    AND has_table_privilege(c.oid, 'DELETE'))
           ), '{}') AS tables_without_access,
           coalesce(array_agg(c.relname::text ORDER BY c.relname) FILTER (
             WHERE c.relkind = 'S' AND NOT has_sequence_privilege(c.oid, 'USAGE')
           ), '{}') AS sequences_without_access
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
  `.execute(db);

  const row = rows[0];
  return {
    login: row.login,
    superuser: row.superuser,
    ownsDatabaseOrSchema: row.owns_database_or_schema,
    createsInSchema: row.creates_in_schema,
    owned: row.owned,
    truncatable: row.truncatable,
    tablesWithoutAccess: row.tables_without_access,
    sequencesWithoutAccess: row.sequences_without_access,
  };
}

const named = (names: string[]): string =>
  names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

/** What is wrong with the login, one sentence each; empty when it is right. */
export function loginProblems(facts: LoginFacts): string[] {
  const problems: string[] = [];
  if (facts.superuser) {
    problems.push('it is a superuser');
  }
  if (facts.ownsDatabaseOrSchema && !facts.superuser) {
    problems.push('it owns the database or its public schema');
  }
  if (facts.createsInSchema && !facts.superuser && !facts.ownsDatabaseOrSchema) {
    problems.push('it can create tables in the public schema');
  }
  if (facts.owned.length > 0) {
    problems.push(`it owns ${facts.owned.length} table(s) (${named(facts.owned)})`);
  }
  if (facts.truncatable.length > 0 && !facts.superuser) {
    problems.push(
      `it can TRUNCATE ${facts.truncatable.length} table(s) (${named(facts.truncatable)})`,
    );
  }
  if (facts.tablesWithoutAccess.length > 0) {
    problems.push(
      `it cannot read and write ${facts.tablesWithoutAccess.length} table(s) ` +
        `(${named(facts.tablesWithoutAccess)})`,
    );
  }
  if (facts.sequencesWithoutAccess.length > 0) {
    problems.push(
      `it cannot use ${facts.sequencesWithoutAccess.length} sequence(s) ` +
        `(${named(facts.sequencesWithoutAccess)})`,
    );
  }
  return problems;
}

/** Thrown at startup, so production never runs on the wrong login. */
export class DatabaseLoginError extends Error {
  constructor(login: string, problems: string[]) {
    super(
      `Refusing to start: the database login "${login}" is not the restricted login ` +
        `production requires (SKILL.md section 24): ${problems.join('; ')}. Connect as a ` +
        'login holding only SELECT, INSERT, UPDATE and DELETE on the tables, and set it ' +
        'up with api/scripts/restricted-login.sql.',
    );
    this.name = 'DatabaseLoginError';
  }
}

export async function assertRestrictedLogin(db: Db): Promise<void> {
  const facts = await readLoginFacts(db);
  const problems = loginProblems(facts);
  if (problems.length > 0) {
    throw new DatabaseLoginError(facts.login, problems);
  }
}
