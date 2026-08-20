import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'kysely';

import { Public } from '../auth/authorization/authorization.decorators';
import { ApiError, ApiErrorCode } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';

/**
 * Liveness for the container platform. It discloses nothing beyond whether the
 * process can reach its database.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  @Get()
  @Public('A container platform checks this before it can hold a token.')
  async check(): Promise<{ status: 'ok' }> {
    try {
      await sql`SELECT 1`.execute(this.db);
    } catch {
      throw new ApiError(ApiErrorCode.INTERNAL_ERROR, 'The database is not reachable.');
    }

    return { status: 'ok' };
  }
}
