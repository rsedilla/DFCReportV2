import { Controller, Get, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';

import { ConquestService } from './conquest.service';
import { ConquestListDto } from './dto/conquest.dto';

/**
 * `/api/v1/conquest` (SKILL.md section 27), read-only.
 *
 * Each route declares the actor as its target, as the other Growth routes do; the list is
 * narrowed to the people the actor's grant reaches in the service (decision 0062). The
 * viewing capability resolves as of now (decision 0278), and no route names a period.
 */
@Controller('conquest')
export class ConquestController {
  constructor(private readonly conquest: ConquestService) {}

  /** The four count cards. */
  @Get('counts')
  @RequiresCapability(Capability.ConquestViewSubtree, { kind: 'actor' })
  async counts(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    return this.conquest.counts(actor);
  }

  /** The tab's list, one page, with each person's four goals. */
  @Get('people')
  @RequiresCapability(Capability.ConquestViewSubtree, { kind: 'actor' })
  async people(
    @Query() query: ConquestListDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    return this.conquest.list(actor, query);
  }
}
