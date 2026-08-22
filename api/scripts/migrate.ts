/**
 * Migration runner.
 *
 * Migrations are plain `.sql` files, applied in filename order, each holding a
 * `-- migrate:up` section and a `-- migrate:down` section. Nothing generates
 * them and nothing rewrites them: SKILL.md section 5 requires partial unique
 * indexes, check constraints and a deferrable constraint trigger, and CLAUDE.md
 * requires that DDL to be hand-written and to live in the migration history.
 * A tool that derives SQL from a model cannot express those, and a tool that
 * diffs a model against the database proposes dropping them.
 *
 * Applied migrations are recorded with a checksum. Editing a migration that has
 * already run is refused rather than silently ignored, because the database and
 * the file would then disagree with nothing to say so.
 *
 * Three directives, each enforcing a line of the migration policy in CLAUDE.md:
 *
 *   -- migrate:up
 *   -- migrate:down
 *   -- migrate:down:refuse-if-populated persons pastoral_assignments
 *       the down section will not run while any named table holds a row, unless
 *       the operator passes --force
 *   -- migrate:irreversible <why>
 *       stands in place of a down section, for a migration that cannot be
 *       reversed and is escalated as a Stop Condition before it runs
 *
 * Usage:
 *   npm run migrate:up
 *   npm run migrate:down        (reverts the most recently applied migration)
 *   npm run migrate:down -- --all   (reverts every applied migration, newest first)
 *   npm run migrate:status
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import 'dotenv/config';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const UP_MARKER = /^--\s*migrate:up\s*$/m;

/** `-- migrate:down` on its own, without the guard. */
const PLAIN_DOWN_MARKER = /^--[ \t]*migrate:down[ \t]*$/m;

/**
 * The guard, matched wherever it appears.
 *
 * Parsed independently of the marker on purpose. Matching it only as part of the
 * marker meant that a file carrying both lines --
 *
 *   -- migrate:down
 *   -- migrate:down:refuse-if-populated persons accounts
 *
 * -- matched the plain one first and turned the guard off, with no error and no
 * warning. A guard against destroying history the specification guarantees must
 * not have a silent off switch, and the layout that triggers it is the one this
 * file's own documentation invites.
 */
const REFUSE_IF_POPULATED = /^--[ \t]*migrate:down:refuse-if-populated([^\n]*)$/gm;

/**
 * `-- migrate:irreversible <why>`, which stands in place of a down section.
 *
 * CLAUDE.md asks for a migration to be reversible, or explicitly marked
 * irreversible and escalated as a Stop Condition before it runs. Without a way
 * to mark one, the only way to satisfy this runner would be to write a
 * destructive down and call it reversible, which is worse than saying so.
 */
const IRREVERSIBLE_MARKER = /^--[ \t]*migrate:irreversible[ \t]*([^\n]*)$/m;

// One lock for the whole migration history, so two deploys cannot race.
const ADVISORY_LOCK_KEY = 4_120_197_301;

export interface Migration {
  version: string;
  name: string;
  up: string;
  /** Null where the migration is marked irreversible. */
  down: string | null;
  /** Why it is irreversible, as written in the file. */
  irreversibleBecause: string | null;
  /** Tables the down section refuses to run against while they hold rows. */
  refuseIfPopulated: string[];
  checksum: string;
}

/** Whether a section holds anything the database would execute. */
function hasStatements(section: string): boolean {
  return section
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line !== '' && !line.startsWith('--'));
}

export function parse(fileName: string, sql: string): Migration {
  const upAt = sql.search(UP_MARKER);
  const plainDown = PLAIN_DOWN_MARKER.exec(sql);
  const guards = [...sql.matchAll(REFUSE_IF_POPULATED)];
  const irreversibleMatch = IRREVERSIBLE_MARKER.exec(sql);

  // The down section starts at whichever marker comes first. The two are matched
  // by separate expressions on purpose: one regex matching both meant the plain
  // marker always won, which silently disabled the guard, and it also made the
  // placement check below unreachable, because every guard line was itself a
  // match for that regex.
  const downIndexes = [plainDown?.index, guards[0]?.index].filter(
    (index): index is number => index !== undefined,
  );
  const downAt = downIndexes.length > 0 ? Math.min(...downIndexes) : undefined;

  if (upAt === -1) {
    throw new Error(`${fileName}: no "-- migrate:up" marker`);
  }

  const version = fileName.split('_')[0];
  if (!/^\d+$/.test(version)) {
    throw new Error(`${fileName}: filename must start with a numeric version, e.g. 0002_name.sql`);
  }

  // The checksum covers the whole file, comments included: a comment explaining
  // why a constraint exists is part of the migration.
  const checksum = createHash('sha256').update(sql).digest('hex');

  if (irreversibleMatch) {
    if (downAt !== undefined) {
      throw new Error(
        `${fileName}: marked irreversible and also carries a down section. Choose one.`,
      );
    }
    if (irreversibleMatch.index < upAt) {
      // Otherwise the up section slices to nothing, an empty statement runs, and
      // the version is recorded as applied against a schema that was never
      // created -- after which the checksum makes the file unfixable in place.
      throw new Error(
        `${fileName}: "-- migrate:irreversible" appears before "-- migrate:up", which ` +
          `would leave the up section empty and record the migration as applied.`,
      );
    }
    if (irreversibleMatch[1].trim() === '') {
      throw new Error(
        `${fileName}: "-- migrate:irreversible" must say why, on the same line. It is ` +
          `escalated as a Stop Condition before it runs, and the reason is what gets escalated.`,
      );
    }
    if (!hasStatements(sql.slice(upAt, irreversibleMatch.index))) {
      // The same rule as the down path below, and it matters more here: an
      // irreversible migration recorded as applied against a schema it never
      // created cannot be reverted at all, because `down` refuses it by design.
      // There is no way back from that except a restore.
      throw new Error(
        `${fileName}: the up section holds no statements, only comments or whitespace. ` +
          `Applying it would record an irreversible migration that did nothing, and ` +
          `irreversible migrations cannot be reverted.`,
      );
    }

    return {
      version,
      name: fileName,
      up: sql.slice(upAt, irreversibleMatch.index),
      down: null,
      irreversibleBecause: irreversibleMatch[1].trim(),
      refuseIfPopulated: [],
      checksum,
    };
  }

  if (downAt === undefined) {
    throw new Error(
      `${fileName}: no "-- migrate:down" marker. A migration is reversible, or is ` +
        `explicitly marked irreversible with "-- migrate:irreversible <why>" and ` +
        `escalated before it runs (CLAUDE.md).`,
    );
  }
  if (downAt < upAt) {
    throw new Error(`${fileName}: "-- migrate:down" appears before "-- migrate:up"`);
  }

  if (guards.length > 1) {
    throw new Error(
      `${fileName}: more than one "-- migrate:down:refuse-if-populated" directive. ` +
        `Name every table on one line, so there is one list to read.`,
    );
  }
  // A guard is either the down marker itself, or the line directly below a plain
  // one. Anywhere else -- inside the up section, or paragraphs below the marker --
  // the file means something other than what the runner would do with it, so it
  // is refused rather than guessed at.
  if (guards.length === 1 && plainDown) {
    // Where both lines are present they must be adjacent, in that order. The
    // dangerous placement is a guard stranded in the up section: it becomes the
    // first down marker, the up section truncates there, and the real DDL is
    // parsed as the down section with nothing to say so.
    const linesBetween = sql.slice(plainDown.index, guards[0].index).split('\n').length - 1;
    const adjacent = guards[0].index > plainDown.index && linesBetween === 1;

    if (!adjacent) {
      throw new Error(
        `${fileName}: the "-- migrate:down:refuse-if-populated" directive must be the ` +
          `down marker itself, or the line directly below it. Anywhere else it does ` +
          `not guard the section it appears to guard.`,
      );
    }
  }

  // The same reasoning as the irreversible ordering check above, which this
  // branch was missing: an up section holding nothing executable runs an empty
  // statement, records the version as applied against a schema that was never
  // created, and is then frozen by its own checksum. It is also how a guard
  // stranded in the up section of a file with no plain down marker presents --
  // the guard becomes the marker, the up section truncates to a comment, and the
  // real DDL is parsed as the down section.
  if (!hasStatements(sql.slice(upAt, downAt))) {
    throw new Error(
      `${fileName}: the up section holds no statements, only comments or whitespace. ` +
        `Applying it would record the migration against a schema it never created.`,
    );
  }

  return {
    version,
    name: fileName,
    up: sql.slice(upAt, downAt),
    down: sql.slice(downAt),
    irreversibleBecause: null,
    refuseIfPopulated: (guards[0]?.[1] ?? '')
      .split(/[\s,]+/)
      .map((table) => table.trim())
      .filter((table) => table !== ''),
    checksum,
  };
}

async function load(): Promise<Migration[]> {
  const entries = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];

  for (const fileName of entries) {
    const sql = await readFile(join(MIGRATIONS_DIR, fileName), 'utf8');
    migrations.push(parse(fileName, sql));
  }

  const versions = new Set<string>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`duplicate migration version ${migration.version}`);
    }
    versions.add(migration.version);
  }

  return migrations;
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

async function connect(): Promise<Client> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env, or export it.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function ensureHistory(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function applied(client: Client): Promise<Map<string, AppliedRow>> {
  const { rows } = await client.query<AppliedRow>(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
  );
  return new Map(rows.map((row) => [row.version, row]));
}

function assertUnchanged(migration: Migration, row: AppliedRow): void {
  if (row.checksum !== migration.checksum) {
    throw new Error(
      `${migration.name} has changed since it was applied. Migration history is ` +
        `immutable: write a new migration rather than editing this one. ` +
        `While this schema is not yet deployed anywhere, correcting 0001 in place is ` +
        `permitted (CLAUDE.md, 2026-08-21) -- drop and rebuild this database instead.`,
    );
  }
}

async function up(client: Client): Promise<void> {
  const migrations = await load();
  const history = await applied(client);
  let ran = 0;

  for (const migration of migrations) {
    const row = history.get(migration.version);
    if (row) {
      assertUnchanged(migration, row);
      continue;
    }

    process.stdout.write(`applying ${migration.name}\n`);
    await client.query('BEGIN');
    try {
      await client.query(migration.up);
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      );
      await client.query('COMMIT');
      ran += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  process.stdout.write(ran === 0 ? 'nothing to apply\n' : `applied ${ran} migration(s)\n`);
}

/**
 * Reverts the most recently applied migration, or every one of them with
 * `--all`.
 *
 * `--all` exists for the round trip CI runs on an empty database. Reverting only
 * the newest migration checks only the newest down section, and every stage that
 * adds a file quietly shrinks what that step covers -- by Stage 4 it would be
 * asserting that the most recent migration is reversible while saying nothing at
 * all about the eight below it.
 *
 * It is not a way to empty a database. Every `refuse-if-populated` guard is
 * evaluated for each migration on the way down, so the first one holding data
 * stops the whole descent, and `--force` still has to be asked for by name.
 */
async function down(client: Client): Promise<void> {
  const all = process.argv.includes('--all');

  for (;;) {
    const reverted = await revertLast(client);
    if (!reverted || !all) {
      return;
    }
  }
}

/** Whether a migration was reverted. False means nothing was applied. */
async function revertLast(client: Client): Promise<boolean> {
  const migrations = await load();
  const history = await applied(client);
  const last = [...history.values()].sort((a, b) => a.version.localeCompare(b.version)).pop();

  if (!last) {
    process.stdout.write('nothing to revert\n');
    return false;
  }

  const migration = migrations.find((m) => m.version === last.version);
  if (!migration) {
    throw new Error(`migration ${last.name} is applied but its file is missing`);
  }
  assertUnchanged(migration, last);

  if (migration.down === null) {
    throw new Error(
      `${migration.name} is marked irreversible and cannot be reverted: ` +
        `${migration.irreversibleBecause ?? ''}\n` +
        `Restore from a backup, or write a new migration that moves forward.`,
    );
  }

  await assertNotPopulated(client, migration);

  process.stdout.write(`reverting ${migration.name}\n`);
  await client.query('BEGIN');
  try {
    await client.query(migration.down);
    await client.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return true;
}

/**
 * A down section that drops a table holding history is the failure the migration
 * policy in CLAUDE.md exists to prevent, and it is one command away at three in
 * the morning. A migration naming its tables is refused rather than run once any
 * of them holds a row.
 *
 * `--force` exists because a refusal with no override gets worked around by
 * running the SQL by hand, which is the same act with no record of it. Using it
 * is a deliberate decision, and it says so on the way past.
 */
async function assertNotPopulated(client: Client, migration: Migration): Promise<void> {
  if (migration.refuseIfPopulated.length === 0) {
    return;
  }

  const populated: string[] = [];

  for (const table of migration.refuseIfPopulated) {
    const { rows } = await client.query<{ exists: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [table],
    );
    if (!rows[0].exists) {
      continue;
    }

    const { rowCount } = await client.query(`SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1`);
    if (rowCount !== null && rowCount > 0) {
      populated.push(table);
    }
  }

  if (populated.length === 0) {
    return;
  }

  if (process.argv.includes('--force')) {
    process.stdout.write(
      `--force: reverting ${migration.name} although ${populated.join(', ')} hold data. ` +
        `This destroys history the specification guarantees is preserved.\n`,
    );
    return;
  }

  throw new Error(
    `${migration.name} will not be reverted: ${populated.join(', ')} hold data, and its ` +
      `down section drops them.\n` +
      `History in these tables is never dropped (CLAUDE.md, migration policy). Write a ` +
      `migration that moves forward, or restore from a backup. Pass --force only as a ` +
      `deliberate decision to destroy that data.`,
  );
}

/** Table names come from the migration file, never from input, but quote anyway. */
function quoteIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`invalid table name in a refuse-if-populated directive: ${name}`);
  }
  return `"${name}"`;
}

async function status(client: Client): Promise<void> {
  const migrations = await load();
  const history = await applied(client);

  for (const migration of migrations) {
    const row = history.get(migration.version);
    const state = row ? `applied ${row.applied_at.toISOString()}` : 'pending';
    process.stdout.write(`${migration.name.padEnd(40)} ${state}\n`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  if (!['up', 'down', 'status'].includes(command)) {
    throw new Error(`unknown command "${command}". Use up, down or status.`);
  }

  const client = await connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureHistory(client);

    if (command === 'up') {
      await up(client);
    } else if (command === 'down') {
      await down(client);
    } else {
      await status(client);
    }
  } finally {
    await client.end();
  }
}

// Only when run as a command. `parse` is imported by its tests, and without this
// guard that import runs the migrator: it read Jest's own argv, failed on
// `--runInBand`, and set a non-zero exit code while every test passed.
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
