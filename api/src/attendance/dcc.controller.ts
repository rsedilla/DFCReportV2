import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';
import { UuidParamPipe } from '../common/uuid-param.pipe';

import { DccAttendanceService } from './dcc-attendance.service';
import { DccCoverageService } from './dcc-coverage.service';
import {
  DccCoverageGapsDto,
  DccEventsQueryDto,
  DccRosterDto,
  SubmitDccAttendanceDto,
} from './dto/dcc.dto';

/**
 * `/api/v1/dcc` (SKILL.md sections 9 and 22).
 *
 * **Every route here declares the actor as the target**, and the restriction to the
 * people the caller may record or read is a check in the owning module. Section 7 says a
 * DCC event "is church-wide and resolves through nothing; the endpoints on it are
 * scoped by the people they return", and the guard resolves one capability against
 * one target — so the target that carries meaning here is the caller, and the
 * event carries none (decision 0171). *This said "both routes" while there were two;
 * there are four since the ruling of 2026-09-09, and the statement is about the shape
 * rather than about the count.*
 *
 * **Two capabilities, split by act rather than by method** (decision 0227). The roster
 * and the submission carry `dcc.take_attendance`; the events index and its coverage
 * drill-down carry `dcc.view_subtree`, because each of those carries a figure measured
 * over the actor's subtree and a recording capability names no subtree to measure one
 * over. The viewing capability is also grantable `read_only`, which a figure somebody may
 * read without recording anything should be.
 *
 * `{ kind: 'church' }` is the reading "church-wide" invites and is wrong: it is
 * Whole Church only, and would deny every Leader holding either capability at
 * own/subtree — which is every leader who records or reads DCC.
 *
 * **`dcc.correct_subtree` is not declared here and is still enforced.** Section 7
 * keeps it separate from `take_attendance`, and a single submission can carry both
 * kinds of line: a person with no record is a first submission, a person whose
 * value changes is a correction. Which is which is not knowable from the request,
 * only from what is stored — so the guard declares the capability that lets a
 * caller reach the route at all, and the service checks the second per person
 * (decision 0062: the guard checks one target; the rest is domain layer).
 *
 * **The event id is validated by the route.** Section 7 requires that of "a path
 * parameter the guard does not resolve against", and the guard here resolves the
 * actor — so without `UuidParamPipe` a malformed identifier would reach a `uuid`
 * comparison and answer with a database error rather than with a refusal.
 */
@Controller('dcc')
export class DccController {
  constructor(
    private readonly attendance: DccAttendanceService,
    private readonly coverage: DccCoverageService,
  ) {}

  /**
   * `GET /api/v1/dcc/events?month=YYYY-MM-01` — the month's events (decision 0227).
   *
   * **It exists because both routes below take an event identifier and nothing handed a
   * leader one.** Section 22's route table named no index, so the roster and the
   * submission were unreachable from a screen.
   *
   * **`dcc.view_subtree`, not `dcc.take_attendance`, and the reason is the figure.** Each
   * row carries that event's coverage measured over the actor's subtree, and a recording
   * capability names no subtree to measure over. The viewing capability does, it is a
   * Read capability, and it is grantable `read_only` — which a figure somebody may read
   * without recording anything should be. The recording capability still guards the
   * roster and the submission this index leads to: the index is a read, what it leads to
   * is a write, and the capabilities differ because the acts differ.
   *
   * **`{ kind: 'actor' }` on the same terms as the two routes below**, and for the reason
   * this controller's docblock gives: a DCC event is church-wide and resolves through
   * nothing, so the target that carries meaning is the caller. `{ kind: 'church' }` would
   * deny every Leader holding the capability at own-subtree, which is every leader this
   * index is for.
   */
  @Get('events')
  @RequiresCapability(Capability.DccViewSubtree, { kind: 'actor' })
  async events(
    @Query() query: DccEventsQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    return this.coverage.eventsIn(actor, query.month);
  }

  /**
   * `GET /api/v1/dcc/events/{id}/coverage-gaps` — who owes a record (decision 0228).
   *
   * **The drill-down behind the index's figure**, and an attention list on section 15's
   * terms: filtered to the actor's scope, ordered by name, never ranked and never
   * colour-graded. Section 19 is why it exists — "a dashboard of counts tells a leader
   * nothing to act on" — and section 14's on-behalf recording is the act it enables.
   *
   * **The same capability as the index, because it is the same disclosure.** It names
   * leaders the actor may already see, and every roster line already carries
   * `responsible_leader_id` (decision 0194). What decision 0228 makes load-bearing is the
   * *scope*: the same list shown church-wide and ordered by how many records are missing
   * is the leaderboard section 13 exists to prevent.
   *
   * `{id}` is validated by `UuidParamPipe`: the guard resolves the actor and not this
   * parameter, so without it a malformed identifier reaches a `uuid` comparison and
   * answers with a database error rather than a refusal (section 7).
   */
  @Get('events/:id/coverage-gaps')
  @RequiresCapability(Capability.DccViewSubtree, { kind: 'actor' })
  async coverageGaps(
    @Param('id', new UuidParamPipe('id')) eventId: string,
    @Query() query: DccCoverageGapsDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    return this.coverage.coverageGaps(eventId, actor, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /**
   * Who there is to record for this event (section 9).
   *
   * The exact counterpart of `GET /api/v1/cells/{id}/meetings/{meeting_id}/roster`
   * one domain over, which section 7 guards with the capability that records the
   * meeting for the reason that applies here too: taking attendance needs to know
   * who there is to mark, and that is a property of the attendance surface rather
   * than of anything that manages a list.
   */
  @Get('events/:id/roster')
  @RequiresCapability(Capability.DccTakeAttendance, { kind: 'actor' })
  async roster(
    @Param('id', new UuidParamPipe('id')) eventId: string,
    @Query() query: DccRosterDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    return this.attendance.roster(eventId, actor, { limit: query.limit, cursor: query.cursor });
  }

  /** Record this event's attendance for the people in the body (sections 9 and 14). */
  @Post('events/:id/submit')
  @RequiresCapability(Capability.DccTakeAttendance, { kind: 'actor' })
  async submit(
    @Param('id', new UuidParamPipe('id')) eventId: string,
    @Body() body: SubmitDccAttendanceDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.attendance.submit(
      eventId,
      body.records.map((record) => ({
        person_id: record.person_id,
        present: record.present,
        version: record.version ?? null,
        correction_reason: record.correction_reason,
      })),
      actor,
      claim,
      body.amendment,
    );
  }
}
