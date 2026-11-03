import { Controller, Get, Inject, Query } from '@nestjs/common';

import { AuthorizationService } from '../auth/authorization/authorization.service';
import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import { CapabilityDeniedError } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';
import { AuditReadService } from './audit-read.service';
import { decodeAuditLogCursor, encodeAuditLogCursor } from './audit-log-cursor';
import { AuditLogDto } from './dto/audit-log.dto';

import type { Actor } from '../auth/authorization/authorization.service';

/**
 * The first route that reads `audit_log` (SKILL.md sections 19, 21 and 22, decisions 0428 and
 * 0430).
 *
 * A church target, so only a Whole Church holder of `audit.view` passes the guard, and
 * `audit.view` is Whole Church only (decision 0430). **The account must also hold the `ADMIN`
 * role**: an entry carries the values it changed, birthdays and mobile numbers among them, so
 * the log is the Admin's alone however `audit.view` is granted. Reading it is not itself logged
 * (decision 0419).
 */
@Controller('audit-log')
export class AuditLogController {
  constructor(
    private readonly audit: AuditReadService,
    private readonly authorization: AuthorizationService,
    @Inject(DATABASE) private readonly db: Db,
  ) {}

  @Get()
  @RequiresCapability(Capability.AuditView, { kind: 'church' })
  async list(
    @Query() query: AuditLogDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    const roles = await this.authorization.honouredRolesWithin(this.db, actor.accountId);
    if (!roles.includes('ADMIN')) {
      throw new CapabilityDeniedError(
        'Only an Admin reads the audit log, because its entries hold birthdays, mobile numbers ' +
          'and what was searched for (SKILL.md section 21).',
        { required_role: 'ADMIN' },
      );
    }

    const { rows, names, nextCursor, truncated } = await this.audit.list({
      q: query.q ?? null,
      kind: query.kind ?? 'EVERYTHING',
      limit: query.limit ?? 50,
      cursor: decodeAuditLogCursor(query.cursor),
    });
    return { data: rows, names, truncated, next_cursor: encodeAuditLogCursor(nextCursor) };
  }
}
