import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { PeopleModule } from '../people/people.module';

import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

/**
 * `training` owns `training_graduations` (SKILL.md sections 2 and 28), and imports what
 * `suynl` does, for the same reasons.
 */
@Module({
  imports: [HierarchyModule, PeopleModule, AuthModule, AuthorizationModule, AuditModule],
  controllers: [TrainingController],
  providers: [TrainingService],
})
export class TrainingModule {}
