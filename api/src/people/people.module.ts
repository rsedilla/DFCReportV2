import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';

import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

/**
 * Owns `persons` and `person_lifecycle` (SKILL.md section 2, Modules). No other
 * module reads or writes them directly.
 *
 * It reads `pastoral_assignments` and `network_assignments` for the identity
 * fields section 8 permits church-wide, which is the seam worth watching: those
 * belong to `hierarchy` and `networks`, and anything beyond reading a current
 * value for display goes through their services.
 */
@Module({
  imports: [HierarchyModule, AuthModule],
  controllers: [PeopleController],
  providers: [PeopleService],
  exports: [PeopleService],
})
export class PeopleModule {}
