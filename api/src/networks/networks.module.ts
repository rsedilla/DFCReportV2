import { Module } from '@nestjs/common';

import { HierarchyModule } from '../hierarchy/hierarchy.module';

import { NetworksService } from './networks.service';

/**
 * Owns `network_assignments` (SKILL.md section 2, Modules).
 *
 * It imports `hierarchy` because several of section 4's preconditions are facts
 * about pastoral assignments — whether the person is a Network root, whether they
 * lead anyone, and how far back the change may be dated. Each is asked of the module
 * that owns that table rather than read from it here.
 *
 * *Counted as two until the second pass on the Cell precondition, which found the
 * same count wrong in three other places. Stated as "several" with the list beside
 * it, because the number is what kept going stale.*
 */
@Module({
  imports: [HierarchyModule],
  providers: [NetworksService],
  exports: [NetworksService],
})
export class NetworksModule {}
