import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';

import { APP_CONFIG, type AppConfig } from '../config/configuration';

import { assertDateStyle, DATE_STYLE_OPTION } from './date-style';

import type { Database } from './schema';

/**
 * A `date` column comes back as the string it is, not as a `Date`.
 *
 * node-pg's default parser turns `1985-06-15` into a JavaScript `Date`, which is
 * an instant — and it builds that instant in the host's local zone, so the value
 * read back is `1985-06-14T16:00:00Z` on a machine in Asia/Manila. The day has
 * moved before any application code has seen it.
 *
 * SKILL.md section 22 says it plainly: date-only fields are plain `YYYY-MM-DD`
 * Asia/Manila dates, and "Never send a date-only field as a timestamp; the
 * conversion is where months silently shift". A birthday, an effective date and a
 * Cell meeting date are facts about a day, not moments in time, and giving them a
 * zone is what makes a report land in the wrong month.
 *
 * This also makes the declared column type true. `PersonsTable.birth_date` said
 * `string` from the first migration until section 3 made a birthday optional, and
 * nothing read it until the `people` module, so the claim went unchallenged for a
 * long time. It is `string | null` now, and the parser passes null through.
 *
 * OID 1082 is `date`. `date[]` is deliberately not registered: nothing returns
 * one, and pg's own types do not admit that OID without a cast, which is not
 * worth writing for a path that does not exist. If an array of dates is ever
 * selected, it needs the same treatment and this comment is where to look.
 */
types.setTypeParser(1082, (value) => value);

export const DATABASE = 'DATABASE';

/**
 * A connection the database drops is logged, and the process keeps running.
 *
 * `pg` reports a dropped connection as an `'error'` event, and an event with no
 * listener ends the process. An idle connection's error goes to the pool, and a
 * checked-out one's goes to that client alone, which the pool stops listening to
 * while a request holds it. So both need a listener. The request holding the
 * connection still fails, because its query is rejected, and the pool discards the
 * connection when it is released.
 */
function listenForDroppedConnections(pool: Pool): Pool {
  const logger = new Logger('Database');
  const log = (err: Error): void => logger.error(`Database connection lost: ${err.message}`);

  pool.on('error', log);
  pool.on('connect', (client) => client.on('error', log));

  return pool;
}

export type Db = Kysely<Database>;

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Db =>
        new Kysely<Database>({
          dialect: new PostgresDialect({
            pool: listenForDroppedConnections(
              new Pool({
                connectionString: config.databaseUrl,
                // Least-privilege credentials and a bounded pool (SKILL.md section 24).
                max: 10,
                // **Every wait is bounded** (section 24: an unbounded wait holds a
                // connection, and ten of them hold the pool). A statement that runs past
                // 30 s fails rather than holding one, and a request that cannot get a
                // connection within 5 s is refused rather than queued without limit.
                statement_timeout: 30_000,
                connectionTimeoutMillis: 5_000,
                // **`DateStyle` is pinned per connection rather than inherited**
                // (`date-style.ts`). Under a non-ISO style the driver parses every
                // timestamp as null rather than failing, so an inherited value is a
                // silent way to lose every date in the system. Sent in the startup
                // packet, so it applies to every connection this pool opens without a
                // session hook to remember.
                options: DATE_STYLE_OPTION,
              }),
            ),
          }),
        }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * Read the pin back and refuse to start unless it took effect.
   *
   * Not a check on how the server is configured — the pool no longer depends on that.
   * It is a check on the pin itself, which is what stops it being a line somebody
   * removes without anything noticing. The alternative is an application that starts
   * happily and answers every date with null.
   */
  async onApplicationBootstrap(): Promise<void> {
    await assertDateStyle(this.db);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
