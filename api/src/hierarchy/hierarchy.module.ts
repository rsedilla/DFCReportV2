import { Module } from '@nestjs/common';

import { HierarchyService } from './hierarchy.service';

/**
 * Owns `pastoral_assignments`. No other module reads or writes that table
 * directly; cross-module access goes through this service (SKILL.md section 2,
 * Modules).
 */
@Module({
  providers: [HierarchyService],
  exports: [HierarchyService],
})
export class HierarchyModule {}
