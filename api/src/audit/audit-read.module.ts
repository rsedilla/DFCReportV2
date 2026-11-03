import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CellsModule } from '../cells/cells.module';
import { PeopleModule } from '../people/people.module';
import { AuditLogController } from './audit-log.controller';
import { AuditReadService } from './audit-read.service';

/**
 * Reading `audit_log` (decision 0428), apart from `AuditModule`, which writes it.
 *
 * Separate because `AuditModule` is global and every module writes through it; the reader
 * asks `people`, `auth` and `cells` for the names an entry carries, and importing them into
 * the writer would make it depend on modules that depend on it.
 */
@Module({
  imports: [PeopleModule, AuthModule, CellsModule],
  controllers: [AuditLogController],
  providers: [AuditReadService],
})
export class AuditReadModule {}
