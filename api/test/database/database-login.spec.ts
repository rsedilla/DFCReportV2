import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Test } from '@nestjs/testing';
import { Kysely, PostgresDialect } from 'kysely';
import { Client, Pool } from 'pg';

import { APP_CONFIG, loadConfig } from '../../src/config/configuration';
import {
  DatabaseLoginError,
  loginProblems,
  readLoginFacts,
} from '../../src/database/database-login';
import { DatabaseModule } from '../../src/database/database.module';

import type { Database } from '../../src/database/schema';

/**
 * The production startup check and the script that sets up the login it wants
 * (SKILL.md section 24, decision 0453).
 *
 * The suite connects as the tables' owner, which is what lets it empty them between
 * cases, so that login is the one the check must refuse.
 *
 * **The restricted login is a real one**, created for the case and dropped after it,
 * and set up by running `scripts/restricted-login.sql` itself rather than a copy of its
 * grants. Creating a login needs CREATEROLE, which CI's database user has (it is the
 * image's superuser) and a development machine's test login may not. Where it is
 * missing those cases say so and pass, except in CI, where they fail: a check that
 * quietly stopped running there would be the one place it was meant to run.
 */
describe('the restricted database login (decision 0453)', () => {
  const url = process.env.DATABASE_URL ?? '';

  let owner: Client;
  let ownerLogin: string;
  let canCreateLogins: boolean;

  const openDb = (connectionString: string): Kysely<Database> =>
    new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 1 }) }),
    });

  beforeAll(async () => {
    owner = new Client({ connectionString: url });
    await owner.connect();
    const { rows } = await owner.query<{ login: string; can: boolean }>(
      `SELECT current_user AS login, rolsuper OR rolcreaterole AS can
         FROM pg_roles WHERE rolname = current_user`,
    );
    ownerLogin = rows[0].login;
    canCreateLogins = rows[0].can;
  });

  afterAll(async () => {
    await owner.end();
  });

  it('reports the suite’s own login as owning the tables and able to empty them', async () => {
    const db = openDb(url);
    try {
      const facts = await readLoginFacts(db);
      expect(facts.login).toBe(ownerLogin);
      expect(facts.owned).toEqual(expect.arrayContaining(['audit_log', 'persons']));
      expect(facts.truncatable).toEqual(expect.arrayContaining(['audit_log', 'persons']));
      expect(facts.tablesWithoutAccess).toEqual([]);
      expect(facts.sequencesWithoutAccess).toEqual([]);
      expect(loginProblems(facts).length).toBeGreaterThan(0);
    } finally {
      await db.destroy();
    }
  });

  it('refuses to start in production on that login, and starts outside it', async () => {
    const boot = async (nodeEnv: 'production' | 'test') => {
      const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule] })
        .overrideProvider(APP_CONFIG)
        .useValue({ ...loadConfig(), nodeEnv })
        .compile();
      return moduleRef.createNestApplication();
    };

    const production = await boot('production');
    try {
      await expect(production.init()).rejects.toThrow(DatabaseLoginError);
    } finally {
      await production.close();
    }

    const outside = await boot('test');
    try {
      await expect(outside.init()).resolves.toBeDefined();
    } finally {
      await outside.close();
    }
  });

  describe('a login set up by the script', () => {
    const login = `dfc_login_probe_${randomBytes(4).toString('hex')}`;
    const password = randomBytes(18).toString('base64url');
    let created = false;

    const loginUrl = (): string => {
      const parsed = new URL(url);
      parsed.username = login;
      parsed.password = password;
      return parsed.toString();
    };

    /** The script as psql would run it, with its two variables filled in. */
    const runScript = async () => {
      const script = readFileSync(join(__dirname, '../../scripts/restricted-login.sql'), 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('\\'))
        .join('\n')
        .replaceAll(':"app"', `"${login}"`)
        .replaceAll(':"owner"', `"${ownerLogin}"`)
        .replaceAll(":'app'", `'${login}'`)
        .replaceAll(":'owner'", `'${ownerLogin}'`);
      await owner.query(script);
    };

    const skipped = (): boolean => {
      if (canCreateLogins) {
        return false;
      }
      if (process.env.CI === 'true') {
        throw new Error(`The test database login "${ownerLogin}" cannot create a login in CI.`);
      }
      // A development machine's test login may lack CREATEROLE; CI runs these.
      console.warn(`Skipped: "${ownerLogin}" cannot create a login here. CI runs this case.`);
      return true;
    };

    beforeAll(async () => {
      if (!canCreateLogins) {
        return;
      }
      await owner.query(`CREATE ROLE "${login}" LOGIN PASSWORD '${password}'`);
      created = true;
      await runScript();
    });

    afterAll(async () => {
      if (!created) {
        return;
      }
      await owner.query('DROP TABLE IF EXISTS zz_login_probe');
      // Revokes every grant and default privilege the script gave it, then drops it.
      await owner.query(`DROP OWNED BY "${login}"`);
      await owner.query(`DROP ROLE "${login}"`);
    });

    it('passes the check', async () => {
      if (skipped()) {
        return;
      }
      const db = openDb(loginUrl());
      try {
        expect(loginProblems(await readLoginFacts(db))).toEqual([]);
      } finally {
        await db.destroy();
      }
    });

    it('cannot TRUNCATE, and cannot read the migration history', async () => {
      if (skipped()) {
        return;
      }
      const client = new Client({ connectionString: loginUrl() });
      await client.connect();
      try {
        await expect(client.query('TRUNCATE audit_log')).rejects.toThrow(/permission denied/);
        await expect(client.query('SELECT 1 FROM schema_migrations')).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await client.end();
      }
    });

    it('is given a table a later migration creates, with no grant by hand', async () => {
      if (skipped()) {
        return;
      }
      await owner.query('CREATE TABLE zz_login_probe (id serial PRIMARY KEY)');
      const db = openDb(loginUrl());
      try {
        expect(loginProblems(await readLoginFacts(db))).toEqual([]);
      } finally {
        await db.destroy();
        await owner.query('DROP TABLE zz_login_probe');
      }
    });

    it('is refused again once a table is out of its reach', async () => {
      if (skipped()) {
        return;
      }
      await owner.query(`REVOKE DELETE ON persons FROM "${login}"`);
      const db = openDb(loginUrl());
      try {
        expect(loginProblems(await readLoginFacts(db))).toEqual([
          'it cannot read and write 1 table(s) (persons)',
        ]);
      } finally {
        await db.destroy();
        await owner.query(`GRANT DELETE ON persons TO "${login}"`);
      }
    });
  });
});
