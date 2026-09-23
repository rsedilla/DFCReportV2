import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';

import { SubmitTrainingDto, TrainingListDto } from './dto/training.dto';
import { TrainingService } from './training.service';

/**
 * `/api/v1/training` (SKILL.md section 28), on the terms `SuynlController` states: every
 * route targets the actor, and who may be read or filed for is decided per person.
 */
@Controller('training')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  /** A card per school and one for people with none yet (decision 0281). */
  @Get('counts')
  @RequiresCapability(Capability.TrainingViewSubtree, { kind: 'actor' })
  async counts(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    return this.training.counts(actor);
  }

  /** The tab's list, one page, with each person's current graduations. */
  @Get('people')
  @RequiresCapability(Capability.TrainingViewSubtree, { kind: 'actor' })
  async people(
    @Query() query: TrainingListDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    return this.training.list(actor, query);
  }

  /** Save the tab's draft, whole or not at all. Filing on behalf is checked per person. */
  @Post('submit')
  @RequiresCapability(Capability.TrainingConfirm, { kind: 'actor' })
  async submit(
    @Body() body: SubmitTrainingDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.training.submit(actor, body.changes, claim);
  }
}
