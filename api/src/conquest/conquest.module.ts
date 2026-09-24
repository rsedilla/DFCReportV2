import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { CellsModule } from '../cells/cells.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { PeopleModule } from '../people/people.module';
import { SuynlModule } from '../suynl/suynl.module';

import { ConquestController } from './conquest.controller';
import { ConquestService } from './conquest.service';

/**
 * `conquest` owns `conquest_confirmations` (SKILL.md sections 2 and 27) and composes the
 * derived goals from `hierarchy`, `cells` and `suynl`. No module it imports reaches back
 * to it.
 */
@Module({
  imports: [HierarchyModule, CellsModule, SuynlModule, PeopleModule, AuthorizationModule],
  controllers: [ConquestController],
  providers: [ConquestService],
})
export class ConquestModule {}
