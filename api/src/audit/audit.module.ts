import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';

/**
 * Owns `audit_log` (SKILL.md section 2, Modules).
 *
 * Global, because section 21's list of auditable actions spans almost every
 * module — people, hierarchy, networks, cells, attendance, admin — and a log
 * every module must import explicitly is a log somebody writes around.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
