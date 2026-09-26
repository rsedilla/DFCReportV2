import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import { NotFoundError } from '../common/errors/api-error';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { PeopleReadService } from '../people/people.read.service';

import { SubmitSuynlDto, SuynlListDto } from './dto/suynl.dto';
import { SuynlService } from './suynl.service';

/**
 * `/api/v1/suynl` (SKILL.md section 28).
 *
 * **Every route but `readiness/{id}` declares the actor as its target**, as the DCC routes do: a list and a
 * save name many people, the guard resolves one target, and the restriction to the
 * people the actor may read or file for is decided per person in the service
 * (decision 0062).
 *
 * The viewing capability resolves as of now (decision 0278), and none of these routes
 * names a period.
 */
@Controller('suynl')
export class SuynlController {
  constructor(
    private readonly suynl: SuynlService,
    private readonly peopleRead: PeopleReadService,
  ) {}

  /** The three count cards (decision 0281). */
  @Get('counts')
  @RequiresCapability(Capability.SuynlViewSubtree, { kind: 'actor' })
  async counts(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    return this.suynl.counts(actor);
  }

  /** The tab's list, one page, with each person's current lessons. */
  @Get('people')
  @RequiresCapability(Capability.SuynlViewSubtree, { kind: 'actor' })
  async people(
    @Query() query: SuynlListDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    return this.suynl.list(actor, query);
  }

  /**
   * The readiness table on Reports → SUYNL (decision 0297): the reader's direct disciples,
   * or a whole-church reader's two roots, each counting their branch.
   */
  @Get('readiness')
  @RequiresCapability(Capability.SuynlViewSubtree, { kind: 'actor' })
  async readiness(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    return this.suynl.readiness(actor, null);
  }

  /**
   * The same table for a leader the reader opened. **The target is the person in the path**,
   * whose branch every row is part of, and existence is checked after the guard (decision
   * 0253), as the Network screen's routes do.
   */
  @Get('readiness/:id')
  @RequiresCapability(Capability.SuynlViewSubtree, { kind: 'person', from: 'params.id' })
  async readinessOf(
    @Param('id', new UuidParamPipe('id')) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    if (!(await this.peopleRead.findById(id))) {
      throw new NotFoundError('No such person.');
    }

    return this.suynl.readiness(actor, id);
  }

  /**
   * Save the tab's draft, whole or not at all.
   *
   * `suynl.confirm` lets an actor reach the route; filing on behalf is checked per person
   * in the service, since which a line needs depends on whose disciple it names.
   */
  @Post('submit')
  @RequiresCapability(Capability.SuynlConfirm, { kind: 'actor' })
  async submit(
    @Body() body: SubmitSuynlDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.suynl.submit(actor, body.changes, claim);
  }
}
