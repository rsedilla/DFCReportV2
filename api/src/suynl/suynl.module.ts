import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { PeopleModule } from '../people/people.module';
import { TrainingModule } from '../training/training.module';

import { SuynlController } from './suynl.controller';
import { SuynlService } from './suynl.service';

/**
 * `suynl` owns `suynl_lessons` (SKILL.md sections 2 and 28).
 *
 * It imports `AuthModule` for `AccountsRepository`, which names the account behind a
 * row in a conflict, as `attendance` does, and `TrainingModule` for who the readiness table
 * leaves out (decision 0297). No module it imports reaches back to it.
 */
@Module({
  imports: [
    HierarchyModule,
    PeopleModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
    TrainingModule,
  ],
  controllers: [SuynlController],
  providers: [SuynlService],
  exports: [SuynlService],
})
export class SuynlModule {}
