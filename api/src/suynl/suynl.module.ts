import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { PeopleModule } from '../people/people.module';

import { SuynlController } from './suynl.controller';
import { SuynlService } from './suynl.service';

/**
 * `suynl` owns `suynl_lessons` (SKILL.md sections 2 and 28).
 *
 * It imports `AuthModule` for `AccountsRepository`, which names the account behind a
 * row in a conflict, as `attendance` does. No module it imports reaches back to it.
 */
@Module({
  imports: [HierarchyModule, PeopleModule, AuthModule, AuthorizationModule, AuditModule],
  controllers: [SuynlController],
  providers: [SuynlService],
  exports: [SuynlService],
})
export class SuynlModule {}
