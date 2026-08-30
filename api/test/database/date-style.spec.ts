import { Kysely, PostgresDialect } from 'kysely';
import { Client, Pool } from 'pg';

import {
  assertDateStyle,
  DATE_STYLE,
  DATE_STYLE_OPTION,
  DateStyleError,
} from '../../src/database/date-style';
import { createTestApp } from '../setup/fixtures';

import type { Database } from '../../src/database/schema';

/**
 * `DateStyle` is pinned by the pool, and this is what makes that more than a line
 * nobody would notice being deleted.
 *
 * **The danger is asserted rather than described.** The first case shows what a
 * non-ISO server does to a connection that has not pinned anything: `now()` comes back
 * as `null`, from a query that succeeded. That is the whole reason the pin exists, and
 * it is worth seeing in a test rather than trusting a comment about it.
 *
 * **These cases change a database-level setting**, which is why they are careful. The
 * new default reaches only connections opened after it, both probe connections are
 * opened and closed inside the test, and the reset runs in `finally`. Nothing else
 * runs concurrently: `npm test` is `jest --runInBand`. If a run is killed between the
 * `ALTER` and the reset, the scratch database keeps a hostile default until somebody
 * runs `ALTER DATABASE <db> RESET DateStyle` — which is recoverable, and is the reason
 * the setting is applied to the database rather than to the role.
 *
 * Fixture data is invented (CLAUDE.md, Secrets).
 */
describe('DateStyle is pinned by the connection, not inherited (SKILL.md section 24)', () => {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
  const database = new URL(url).pathname.replace(/^\//, '');

  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: url });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  async function withHostileDefault<T>(body: () => Promise<T>): Promise<T> {
    // Quoted as an identifier, because the database name comes from configuration.
    await admin.query(`ALTER DATABASE "${database}" SET DateStyle = 'German, DMY'`);

    try {
      return await body();
    } finally {
      await admin.query(`ALTER DATABASE "${database}" RESET DateStyle`);
    }
  }

  async function report(options?: string): Promise<{ style: string; now: unknown }> {
    const client = new Client(
      options === undefined ? { connectionString: url } : { connectionString: url, options },
    );
    await client.connect();

    try {
      const style = (await client.query<{ DateStyle: string }>('SHOW DateStyle')).rows[0].DateStyle;
      const now = (await client.query<{ t: unknown }>('SELECT now() AS t')).rows[0].t;

      return { style, now };
    } finally {
      await client.end();
    }
  }

  it('parses every timestamp as null on a connection that inherits a non-ISO style', async () => {
    // **This is the defect, demonstrated.** The query succeeds, the row arrives, and
    // the timestamp is null. Nothing raises, so an application reading it answers with
    // an empty date and logs nothing.
    const inherited = await withHostileDefault(() => report());

    expect(inherited.style).toBe('German, DMY');
    expect(inherited.now).toBeNull();
  });

  it('reports the pinned style and parses timestamps, against the same hostile default', async () => {
    const pinned = await withHostileDefault(() => report(DATE_STYLE_OPTION));

    expect(pinned.style).toBe(DATE_STYLE);
    expect(pinned.now).toBeInstanceOf(Date);
  });

  it('starts the application against a hostile default, which is what pins the pool', async () => {
    // **This is the case that fails if the `options` line leaves the pool.** The three
    // above open their own connections and pass the option by hand, so none of them
    // can tell whether the application's pool carries it; this one builds the real
    // thing while the database default is hostile.
    //
    // `DatabaseModule.onApplicationBootstrap` reads `DateStyle` back and throws unless
    // the pin took effect, so an unpinned pool cannot finish starting here.
    const app = await withHostileDefault(() => createTestApp());

    await app.close();
  });

  it('throws where the session is not pinned, which is what the startup check is for', async () => {
    // **Pins `assertDateStyle` rather than the pin.** The case above asserts the
    // application starts; it would go on passing with the startup check deleted. This
    // one hands the check a genuinely unpinned session and requires it to refuse —
    // without which the check could be a no-op and nothing would say so.
    const hostile = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: url, options: '-c DateStyle=German,DMY' }),
      }),
    });

    try {
      await expect(assertDateStyle(hostile)).rejects.toThrow(DateStyleError);
    } finally {
      await hostile.destroy();
    }
  });

  it('leaves no hostile default behind', async () => {
    // The reset is in a `finally`, and this is what says so out loud: a later suite
    // reading nulls because of these cases would be a strange thing to debug.
    //
    // **Asserted as ISO rather than as the pinned value, and the difference is the
    // point.** An unpinned connection inherits whatever the server is set to, and this
    // project's development server runs `ISO, DMY` rather than PostgreSQL's default
    // `ISO, MDY` — which is exactly the variation the pin exists to stop mattering. A
    // first version of this case asserted equality with the pinned value and failed
    // here, on a correctly configured machine.
    const after = await report();

    expect(after.style).toMatch(/^ISO/);
    expect(after.now).toBeInstanceOf(Date);
  });
});
