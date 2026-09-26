import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';
import { UuidParamPipe } from '../common/uuid-param.pipe';

import { EncounterSeasonDto } from './dto/encounter-season.dto';
import { EncounterSeasonsService } from './encounter-seasons.service';

/**
 * `/api/v1/encounter-seasons` (SKILL.md section 28, decision 0296).
 *
 * **Read under `suynl.view_subtree`, targeting the actor**, as the SUYNL tab's own reads do,
 * each reader shown their own Network's half and a Whole Church reader both (decision 0296).
 *
 * **Written under `settings.manage` against the church**, the first routes to carry it.
 * The capability is Whole Church only (section 7), and a church target is covered by a
 * Whole Church grant and nothing narrower.
 */
@Controller('encounter-seasons')
export class EncounterSeasonsController {
  constructor(private readonly seasons: EncounterSeasonsService) {}

  /**
   * Not paged, as `GET /dcc/events` is not: three seasons a year is a size set by the
   * calendar rather than by the data (section 22).
   */
  @Get()
  @RequiresCapability(Capability.SuynlViewSubtree, { kind: 'actor' })
  async list(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    return this.seasons.list(actor);
  }

  @Post()
  @RequiresCapability(Capability.SettingsManage, { kind: 'church' })
  async create(
    @Body() body: EncounterSeasonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.seasons.create(actor, body, claim);
  }

  @Patch(':id')
  @RequiresCapability(Capability.SettingsManage, { kind: 'church' })
  async update(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: EncounterSeasonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.seasons.update(actor, id, body, claim);
  }
}
