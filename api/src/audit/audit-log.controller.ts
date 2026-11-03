import { Controller, Get, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { AuditReadService } from './audit-read.service';
import { decodeAuditLogCursor, encodeAuditLogCursor } from './audit-log-cursor';
import { AuditLogDto } from './dto/audit-log.dto';

/**
 * The first route that reads `audit_log` (SKILL.md sections 19, 21 and 22, decision 0428).
 *
 * A church target, so only a Whole Church holder of `audit.view` reads it, by default the
 * Admin role alone: a grant of the capability at any narrower scope reads nothing here.
 * Reading it is not itself logged (decision 0419).
 */
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly audit: AuditReadService) {}

  @Get()
  @RequiresCapability(Capability.AuditView, { kind: 'church' })
  async list(@Query() query: AuditLogDto): Promise<Record<string, unknown>> {
    const { rows, names, nextCursor } = await this.audit.list({
      q: query.q ?? null,
      kind: query.kind ?? 'EVERYTHING',
      limit: query.limit ?? 50,
      cursor: decodeAuditLogCursor(query.cursor),
    });
    return { data: rows, names, next_cursor: encodeAuditLogCursor(nextCursor) };
  }
}
