import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { NetworksModule } from '../networks/networks.module';
import { PeopleModule } from '../people/people.module';

import { EncounterSeasonsController } from './encounter-seasons.controller';
import { EncounterSeasonsService } from './encounter-seasons.service';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

/**
 * `training` owns `training_graduations` and `encounter_seasons` (SKILL.md sections 2 and
 * 28). It imports what `suynl` does, for the same reasons, and `networks`, whose service
 * answers which Network's Encounter dates a reader is shown (decision 0296).
 */
@Module({
  imports: [
    HierarchyModule,
    NetworksModule,
    PeopleModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
  ],
  controllers: [TrainingController, EncounterSeasonsController],
  providers: [TrainingService, EncounterSeasonsService],
  // `suynl` reads who is past the LC Party through it (decision 0297); nothing here imports `suynl`.
  exports: [TrainingService],
})
export class TrainingModule {}
