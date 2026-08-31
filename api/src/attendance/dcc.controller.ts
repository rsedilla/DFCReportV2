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
import { DccRosterDto, SubmitDccAttendanceDto } from './dto/dcc.dto';

/**
 * `/api/v1/dcc` (SKILL.md sections 9 and 22).
 *
 * **Both routes declare the actor as the target**, and the restriction to the
 * people the caller may record is a check in the owning module. Section 7 says a
 * DCC event "is church-wide and resolves through nothing; the endpoints on it are
 * scoped by the people they return", and the guard resolves one capability against
 * one target — so the target that carries meaning here is the caller, and the
 * event carries none (decision 0171).
 *
 * `{ kind: 'church' }` is the reading "church-wide" invites and is wrong: it is
 * Whole Church only, and would deny every Leader holding `dcc.take_attendance` at
 * own/subtree — which is every leader who records DCC.
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
  constructor(private readonly attendance: DccAttendanceService) {}

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
    );
  }
}
