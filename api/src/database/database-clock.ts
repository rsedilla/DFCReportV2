import { Inject, Injectable } from '@nestjs/common';

import { databaseNow } from '../common/time/submission-window';

import { DATABASE, type Db } from './database.module';

/**
 * The database's clock, for a caller that must not hold the pool: the reporting controller
 * names Trends' current month with it (`test/unit/reporting-transaction-seam.spec.ts`).
 * It reads no table, and must not, since a figure read here would sit outside a report's
 * snapshot.
 */
@Injectable()
export class DatabaseClock {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  now(): Promise<Date> {
    return databaseNow(this.db);
  }
}
