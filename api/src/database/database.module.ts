import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import { APP_CONFIG, type AppConfig } from '../config/configuration';

import type { Database } from './schema';

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
