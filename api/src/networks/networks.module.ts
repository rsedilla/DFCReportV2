import { Module } from '@nestjs/common';

import { NetworksService } from './networks.service';

/** Owns `network_assignments` (SKILL.md section 2, Modules). */
@Module({
  providers: [NetworksService],
  exports: [NetworksService],
})
export class NetworksModule {}
