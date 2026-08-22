import { Module } from '@nestjs/common';

import { HierarchyModule } from '../hierarchy/hierarchy.module';

import { NetworksService } from './networks.service';

/**
 * Owns `network_assignments` (SKILL.md section 2, Modules).
 *
 * It imports `hierarchy` because section 4 puts two preconditions on a Network
 * change that are facts about pastoral assignments — whether the person leads
 * anyone, and how far back the change may be dated. Both are asked of the module
 * that owns that table rather than read from it here.
 */
@Module({
  imports: [HierarchyModule],
  providers: [NetworksService],
  exports: [NetworksService],
})
export class NetworksModule {}
