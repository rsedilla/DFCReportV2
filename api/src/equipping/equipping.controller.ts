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
import { PersonViewsService } from '../people/person-views.service';

import {
  EnrollDto,
  EquippingSearchDto,
  EquippingTermDto,
  ListRegistrationsDto,
  MoveEnrollmentDto,
  OpenClassDto,
  ReasonDto,
  RegisterDto,
  SetTeacherDto,
  TeacherClashDto,
} from './dto/equipping.dto';
import { EquippingService } from './equipping.service';

/**
 * `/api/v1/equipping` (SKILL.md section 29, decision 0499): Registration and Enrollment for
 * Life Class.
 *
 * **Every route is `equipping.manage` against the church**, which only a Whole Church grant
 * covers (section 7): the Admin and the Registrar hold it, and nobody else by default. **The
 * Coordinator's routes are `equipping.coordinate`** (decision 0501): opening a class, naming
 * its Teacher, the Teacher search and the Coordinator's *Classes*, held by the Admin and by a
 * Full view Leader ticked *Life Class Coordinator*. The Registrar no longer opens a class. The
 * people it reads it reads through `people`, `hierarchy`, `cells`, `attendance`, `suynl` and
 * `training`, so the role holds no read capability of those modules.
 */
@Controller('equipping')
export class EquippingController {
  constructor(
    private readonly equipping: EquippingService,
    private readonly people: PeopleService,
    private readonly views: PersonViewsService,
    @Inject(ThrottlerStorage) private readonly throttle: ThrottlerStorage,
  ) {}

  /**
   * The person picker. **It searches the church, so it is bounded and recorded as a
   * church-wide search is** (section 8, decision 0303): three letters, a page of at most
   * twenty, thirty a minute per account, each one audited. Four fields a row, the ones
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

  /**
   * The Coordinator's Teacher search (decision 0501, point 2): only who may teach, a current
   * Cell Leader in the tree (decision 0499, point 10), bounded and recorded as every church-wide
   * search is (section 8, decision 0303).
   */
  @Get('teachers')
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async teachers(
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
    const data = await this.equipping.search(query.q, CHURCH_WIDE_PAGE_LIMIT, true);
    await this.people.recordDirectorySearch(actor.accountId, query.q, data.length);
    return { data };
  }

  /** One person as the registration form shows them, with the four record requirements. */
  @Get('people/:id')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async candidate(
    @Param('id', new UuidParamPipe('id')) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    const candidate = await this.equipping.candidate(id);
    // **Recorded as a full-record read is** (section 8, decision 0414): it carries the
    // birthday and the attendance figures, so it counts toward the hour's alert to the Admin.
    if (actor.personId !== null) {
      await this.views.record(id, actor.personId);
    }
    return candidate;
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
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async openClass(
    @Body() body: OpenClassDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.openClass(actor, body, claim);
  }

  /** The Coordinator's *Classes* (decision 0501, point 22): a level's classes in a term. */
  @Get('coordinate/classes')
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async coordinatorClasses(@Query() query: EquippingTermDto): Promise<Record<string, unknown>> {
    return this.equipping.coordinatorClasses(query);
  }

  /** The seasons a class names, for the Coordinator's *Open a class*. */
  @Get('coordinate/encounter-seasons')
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async coordinatorSeasons(): Promise<Record<string, unknown>> {
    return this.equipping.encounterSeasons();
  }

  /** Who is enrolled in one class, for the Coordinator's *Students*. */
  @Get('coordinate/classes/:id/students')
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async coordinatorStudents(
    @Param('id', new UuidParamPipe('id')) id: string,
  ): Promise<Record<string, unknown>> {
    return this.equipping.coordinatorClassStudents(id);
  }

  /**
   * Whether a day and time fit a person's week, before they are named a class's Teacher, when
   * opening one or editing it (decision 0501, point 2).
   */
  @Get('coordinate/clash')
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async teacherClash(@Query() query: TeacherClashDto): Promise<Record<string, unknown>> {
    return this.equipping.teacherClash(query.person_id, query.day_of_week, query.time_of_day);
  }

  /** Names or changes a class's Teacher (decision 0501, point 2). */
  @Post('classes/:id/teacher')
  @HttpCode(200)
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async setTeacher(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: SetTeacherDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.setTeacher(actor, id, body.teacher_person_id, claim);
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
