import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';

import { APP_CONFIG, type AppConfig } from '../config/configuration';

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
 * This also makes the declared column type true. `PersonsTable.birth_date` has
 * said `string` since the first migration and nothing read it until the `people`
 * module, so the claim went unchallenged.
 *
 * OID 1082 is `date`. `date[]` is deliberately not registered: nothing returns
 * one, and pg's own types do not admit that OID without a cast, which is not
 * worth writing for a path that does not exist. If an array of dates is ever
 * selected, it needs the same treatment and this comment is where to look.
 */
types.setTypeParser(1082, (value) => value);

export const DATABASE = 'DATABASE';

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
            pool: new Pool({
              connectionString: config.databaseUrl,
              // Least-privilege credentials and a bounded pool (SKILL.md section 24).
              max: 10,
            }),
          }),
        }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
