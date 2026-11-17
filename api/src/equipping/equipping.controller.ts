import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ValidationFailedError } from '../common/errors/api-error';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { normalizeName } from '../people/duplicate-matching';
import {
  CHURCH_WIDE_PAGE_LIMIT,
  CHURCH_WIDE_SEARCH_MINIMUM,
  CHURCH_WIDE_SEARCHES_PER_MINUTE,
} from '../people/dto/people.dto';
import { PeopleService } from '../people/people.service';

import {
  EnrollDto,
  EquippingSearchDto,
  EquippingTermDto,
  ListRegistrationsDto,
  MoveEnrollmentDto,
  OpenClassDto,
  ReasonDto,
  RegisterDto,
} from './dto/equipping.dto';
import { EquippingService } from './equipping.service';

/**
 * `/api/v1/equipping` (SKILL.md section 29, decision 0499): Registration and Enrollment for
 * Life Class.
 *
 * **Every route is `equipping.manage` against the church**, which only a Whole Church grant
 * covers (section 7): the Admin and the Equipper hold it, and nobody else by default. The
 * people it reads it reads through `people`, `hierarchy`, `cells`, `attendance`, `suynl` and
 * `training`, so the role holds no read capability of those modules.
 */
@Controller('equipping')
export class EquippingController {
  constructor(
    private readonly equipping: EquippingService,
    private readonly people: PeopleService,
    @Inject(ThrottlerStorage) private readonly throttle: ThrottlerStorage,
  ) {}

  /**
   * The person picker. **It searches the church, so it is bounded and recorded as a
   * church-wide search is** (section 8, decision 0303): three letters, a page of at most
   * twenty, thirty a minute per account, each one audited. Five fields a row, the ones
   * section 8 publishes church-wide.
   */
  @Get('people')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async search(
    @Query() query: EquippingSearchDto,
    @CurrentActor() actor: Actor,
  ): Promise<{ data: Record<string, unknown>[] }> {
    if (normalizeName(query.q).replace(/\s+/g, '').length < CHURCH_WIDE_SEARCH_MINIMUM) {
      throw new ValidationFailedError('Enter at least three letters of a name.', { field: 'q' });
    }
    const key = `church-wide-search:${actor.accountId}`;
    const spent = await this.throttle.increment(
      key,
      60_000,
      CHURCH_WIDE_SEARCHES_PER_MINUTE,
      60_000,
      key,
    );
    if (spent.isBlocked) {
      throw new ThrottlerException();
    }
    const data = await this.equipping.search(query.q, CHURCH_WIDE_PAGE_LIMIT);
    await this.people.recordDirectorySearch(actor.accountId, query.q, data.length);
    return { data };
  }

  /** One person as the registration form shows them, with the four record requirements. */
  @Get('people/:id')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async candidate(
    @Param('id', new UuidParamPipe('id')) id: string,
  ): Promise<Record<string, unknown>> {
    return this.equipping.candidate(id);
  }

  /** The seasons a class names, read here so an Equipper needs no SUYNL capability. */
  @Get('encounter-seasons')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async encounterSeasons(): Promise<Record<string, unknown>> {
    return this.equipping.encounterSeasons();
  }

  @Get('registrations')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async registrations(@Query() query: ListRegistrationsDto): Promise<Record<string, unknown>> {
    return this.equipping.registrations(query);
  }

  @Post('registrations')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async register(
    @Body() body: RegisterDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.register(actor, body, claim);
  }

  @Post('registrations/:id/cancel')
  @HttpCode(200)
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async cancel(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: ReasonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.cancel(actor, id, body.reason, claim);
  }

  @Get('classes')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async classes(@Query() query: EquippingTermDto): Promise<Record<string, unknown>> {
    return this.equipping.classes(query);
  }

  @Post('classes')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async openClass(
    @Body() body: OpenClassDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.openClass(actor, body, claim);
  }

  @Get('classes/:id')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async classDetail(
    @Param('id', new UuidParamPipe('id')) id: string,
  ): Promise<Record<string, unknown>> {
    return this.equipping.classDetail(id);
  }

  @Post('classes/:id/enrollments')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async enroll(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: EnrollDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.enroll(actor, id, body.registration_ids, claim);
  }

  @Post('enrollments/:id/move')
  @HttpCode(200)
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async move(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: MoveEnrollmentDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.move(actor, id, body.class_id, claim);
  }

  @Post('enrollments/:id/withdraw')
  @HttpCode(200)
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async withdraw(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: ReasonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.withdraw(actor, id, body.reason, claim);
  }
}
