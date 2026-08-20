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
 * Usage:
 *   npm run migrate:up
 *   npm run migrate:down        (reverts the most recently applied migration)
 *   npm run migrate:status
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import 'dotenv/config';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const UP_MARKER = /^--\s*migrate:up\s*$/m;
const DOWN_MARKER = /^--\s*migrate:down\s*$/m;

// One lock for the whole migration history, so two deploys cannot race.
const ADVISORY_LOCK_KEY = 4_120_197_301;

interface Migration {
  version: string;
  name: string;
  up: string;
  down: string;
  checksum: string;
}

function parse(fileName: string, sql: string): Migration {
  const upAt = sql.search(UP_MARKER);
  const downAt = sql.search(DOWN_MARKER);

  if (upAt === -1) {
    throw new Error(`${fileName}: no "-- migrate:up" marker`);
  }
  if (downAt === -1) {
    throw new Error(
      `${fileName}: no "-- migrate:down" marker. A migration is reversible, or is ` +
        `explicitly marked irreversible and escalated before it runs (CLAUDE.md).`,
    );
  }
  if (downAt < upAt) {
    throw new Error(`${fileName}: "-- migrate:down" appears before "-- migrate:up"`);
  }

  const version = fileName.split('_')[0];
  if (!/^\d+$/.test(version)) {
    throw new Error(`${fileName}: filename must start with a numeric version, e.g. 0002_name.sql`);
  }

  return {
    version,
    name: fileName,
    up: sql.slice(upAt, downAt),
    down: sql.slice(downAt),
    // The checksum covers the whole file, comments included: a comment explaining
    // why a constraint exists is part of the migration.
    checksum: createHash('sha256').update(sql).digest('hex'),
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
        `immutable: write a new migration rather than editing this one.`,
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

async function down(client: Client): Promise<void> {
  const migrations = await load();
  const history = await applied(client);
  const last = [...history.values()].sort((a, b) => a.version.localeCompare(b.version)).pop();

  if (!last) {
    process.stdout.write('nothing to revert\n');
    return;
  }

  const migration = migrations.find((m) => m.version === last.version);
  if (!migration) {
    throw new Error(`migration ${last.name} is applied but its file is missing`);
  }
  assertUnchanged(migration, last);

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

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
