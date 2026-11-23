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
  EncounterAttendanceDto,
  EncounterQueryDto,
  EnrollDto,
  EnrollEncounterDto,
  EquippingSearchDto,
  EquippingTermDto,
  ListRegistrationsDto,
  MoveEnrollmentDto,
  OpenClassDto,
  ReasonDto,
  NameGuideDto,
  RecordMakeUpDto,
  SaveLessonDto,
  RegisterDto,
  SetTeacherDto,
  SwapGuideDto,
  TeacherClashDto,
} from './dto/equipping.dto';
import { EquippingAttendanceService } from './equipping-attendance.service';
import { EquippingEncounterService } from './equipping-encounter.service';
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
    private readonly attendance: EquippingAttendanceService,
    private readonly encounter: EquippingEncounterService,
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

  /**
   * The Coordinator's Guide search (decision 0501, point 4): only who may guide Life Class, a pass
   * of SOL 1 or beyond and in the tree, bounded and recorded as a church-wide search is.
   */
  @Get('guides')
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async guides(
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
    const data = await this.equipping.search(query.q, CHURCH_WIDE_PAGE_LIMIT, 'guides');
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
   * Whether a class fits a person's week, before they are named its Teacher (decision 0501,
   * point 2). A Teacher named when the class is opened is checked by the opening itself.
   */
  @Get('coordinate/classes/:id/clash')
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async teacherClash(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Query() query: TeacherClashDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    // **Recorded and limited as a church-wide search is** (owner, 2026-11-20, decision 0501):
    // each answer can name when a Cell outside the Coordinator's scope meets, so a check is
    // written under the Audit Log's Lookups and held to thirty a minute per account.
    const key = `teacher-clash:${actor.accountId}`;
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
    return this.equipping.teacherClash(actor, id, query.person_id);
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

  /** Names a Guide of the class, and shares out the students with no Guide (decision 0501). */
  @Post('classes/:id/guides')
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async nameGuide(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: NameGuideDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.nameGuide(actor, id, body.person_id, claim);
  }

  /** Removes a Guide from the class; their students are shared out again. */
  @Post('classes/:id/guides/:guideId/remove')
  @HttpCode(200)
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async removeGuide(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Param('guideId', new UuidParamPipe('guideId')) guideId: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.removeGuide(actor, id, guideId, claim);
  }

  /**
   * The classes the actor teaches or guides (decision 0501, point 21), which decide whether
   * their *Equipping* item is drawn. **`equipping.class` against the actor**, which every
   * Leader holds over themselves; the school narrows it (decision 0503).
   */
  @Get('my-classes')
  @RequiresCapability(Capability.EquippingClass, { kind: 'actor' })
  async myClasses(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    return this.attendance.myClasses(actor);
  }

  /**
   * The reader's people in the school (decision 0501, points 5 and 21): **`people.view_subtree`
   * against the actor** (decision 0504), the People access every Leader holds over their own
   * branch, narrowed to those enrolled. Read only.
   */
  @Get('my-people')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'actor' })
  async myPeople(@CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    return this.attendance.myPeople(actor);
  }

  /**
   * A class's lessons, register and make-ups owed (decision 0501, points 10 to 12): the whole
   * class to its Teacher, the Coordinator and the Admin, and a Guide's own students to a Guide.
   */
  @Get('classes/:id/attendance')
  @RequiresCapability(Capability.EquippingClass, { kind: 'actor' })
  async classAttendance(
    @Param('id', new UuidParamPipe('id')) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    return this.attendance.classAttendance(actor, id);
  }

  /** Who came to one lesson, saved by the class's Teacher (decision 0501, point 10). */
  @Post('classes/:id/lessons/:lesson')
  @HttpCode(200)
  @RequiresCapability(Capability.EquippingClass, { kind: 'actor' })
  async saveLesson(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Param('lesson') lesson: string,
    @Body() body: SaveLessonDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    if (!/^[1-9]$/.test(lesson)) {
      throw new ValidationFailedError('A lesson is a number from 1 to 9.', { field: 'lesson' });
    }
    return this.attendance.saveLesson(actor, id, Number(lesson), body, claim);
  }

  /** A make-up of a missed lesson, recorded as M with its date (decision 0501, point 12). */
  @Post('classes/:id/make-ups')
  @HttpCode(201)
  @RequiresCapability(Capability.EquippingClass, { kind: 'actor' })
  async recordMakeUp(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: RecordMakeUpDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.attendance.recordMakeUp(actor, id, body, claim);
  }

  /** *Swap Guide* for one student (decision 0501, point 8). */
  @Post('enrollments/:id/guide')
  @HttpCode(200)
  @RequiresCapability(Capability.EquippingCoordinate, { kind: 'church' })
  async swapGuide(
    @Param('id', new UuidParamPipe('id')) id: string,
    @Body() body: SwapGuideDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.equipping.swapGuide(actor, id, body.guide_id, claim);
  }

  /**
   * One Network's Encounter weekend (decision 0501, point 14; decision 0507): who is cleared,
   * who needs a make-up and who can't go, after lesson 4, the classes still waiting for it, and
   * who is enrolled. The Registrar's and the Admin's.
   */
  @Get('encounter')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async encounterList(@Query() query: EncounterQueryDto): Promise<Record<string, unknown>> {
    return this.encounter.list(query.network, query.season_id);
  }

  /** Cleared students into one weekend, before it begins. */
  @Post('encounter/enrollments')
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async enrollEncounter(
    @Body() body: EnrollEncounterDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.encounter.enroll(actor, body, claim);
  }

  /** Who came to one weekend, from its first day: the register's ENC column. */
  @Post('encounter/attendance')
  @HttpCode(200)
  @RequiresCapability(Capability.EquippingManage, { kind: 'church' })
  async encounterAttendance(
    @Body() body: EncounterAttendanceDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.encounter.recordAttendance(actor, body, claim);
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
