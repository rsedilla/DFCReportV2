import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { NetworksModule } from '../networks/networks.module';

import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

/**
 * Owns `persons` and `person_lifecycle` (SKILL.md section 2, Modules). No other
 * module reads or writes them directly.
 *
 * It never touches `pastoral_assignments` or `network_assignments`, in either
 * direction. Creating a Person opens both, and both go through the service that
 * owns the table — `hierarchy` and `networks` — inside the transaction `people`
 * opens. Section 2 gives the reason: the section 5 invariants have one place to
 * live only while `hierarchy` is the sole writer of that table, and this module
 * performs the system's first assignment write.
 */
@Module({
  imports: [HierarchyModule, NetworksModule, AuthModule],
  controllers: [PeopleController],
  providers: [PeopleService],
  exports: [PeopleService],
})
export class PeopleModule {}
