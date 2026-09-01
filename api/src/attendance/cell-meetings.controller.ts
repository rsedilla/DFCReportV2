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

import { CellMeetingsService } from './cell-meetings.service';
import { SubmitCellMeetingDto } from './dto/cell-meeting-submit.dto';
import { CellMeetingsQueryDto } from './dto/cell-meetings.dto';

/**
 * `/api/v1/cells/{id}/meetings` (SKILL.md sections 12, 13 and 22).
 *
 * **In `attendance` rather than in `cells`, sharing the `cells` path prefix.**
 * Section 2 gives `cell_meetings` to this module, and a controller's URL says where
 * the resource sits in the API rather than which module owns the table. Putting
 * these routes on `CellsController` would put section 13's rules in the module that
 * owns none of their tables, which is the arrangement section 2 exists to prevent.
 *
 * Nest resolves the two controllers' routes independently, and they do not collide:
 * `CellsController` declares `:id`, `:id/members` and `:id/closure`, none of which
 * matches `:id/meetings`.
 *
 * **`cell.take_attendance`, resolved against the Cell.** Section 7 guards a
 * meeting's roster with the capability that records it, "deliberately **not**
 * `cell.manage_membership`", because requiring the management capability to reach an
 * attendance surface would mean nobody could take attendance without also being able
 * to move the roster. The same argument covers this route: a list of which meetings
 * are recorded and which are awaiting a record is what taking attendance needs to
 * know before it starts, and section 19 puts exactly that list in a leader's own
 * outstanding work.
 *
 * Section 7's capability list is closed, so this is the existing capability read
 * against a new surface rather than a new name. Whether a Cell-scoped *read* deserves
 * a capability of its own is already open in `CLAUDE.md` for `GET
 * /api/v1/cells/{id}/members`, and this route joins that question rather than
 * reopening it: the consequence is the same one recorded there, that roster
 * visibility cannot be granted without the power the capability also carries.
 *
 * **The Cell id is validated by the route**, which section 7 requires of a path
 * parameter — except that here the guard *does* resolve against it, so the pipe is
 * belt and braces rather than the sole defence. It stays because a malformed
 * identifier should answer with a refusal rather than reaching a `uuid` comparison,
 * and because the guard's resolution and the service's lookup are two places a
 * malformed value could surface differently.
 */
@Controller('cells')
export class CellMeetingsController {
  constructor(private readonly meetings: CellMeetingsService) {}

  /** This Cell's meetings for a reporting month, scheduled and recorded. */
  @Get(':id/meetings')
  @RequiresCapability(Capability.CellTakeAttendance, {
    kind: 'cell',
    from: 'params.id',
  })
  async list(
    @Param('id', new UuidParamPipe('id')) cellId: string,
    @Query() query: CellMeetingsQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.meetings.meetingsIn(cellId, query.month);
  }

  /**
   * Who there is to record for this meeting (sections 12 and 13).
   *
   * `{meeting_id}` is a `YYYY-MM-DD` Manila date, not a UUID — section 13 identifies a
   * meeting by its Cell and its scheduled date, and section 22 names the parameter
   * `meeting_id` under the identifier convention while noting that the convention's
   * canonicalization does not reach it: section 7 canonicalizes only a UUID-shaped
   * value, so a date passes through untouched. The name is right for the day this
   * route ever takes a UUID; what it is not is a demonstration of the rule working.
   *
   * **No `UuidParamPipe` on it, for that reason.** The guard resolves against the Cell
   * rather than the meeting, so this parameter is one "the guard does not resolve
   * against" — section 7 asks that such a parameter be validated by the route, and the
   * validation a date needs is a date's, which the service applies when it derives the
   * month.
   */
  @Get(':id/meetings/:meetingId/roster')
  @RequiresCapability(Capability.CellTakeAttendance, {
    kind: 'cell',
    from: 'params.id',
  })
  async roster(
    @Param('id', new UuidParamPipe('id')) cellId: string,
    @Param('meetingId') meetingId: string,
  ): Promise<Record<string, unknown>> {
    return this.meetings.rosterFor(cellId, meetingId);
  }

  /**
   * Record this meeting for the first time (sections 12, 13 and 14).
   *
   * **`cell.take_attendance`, and `cell.correct_subtree` is not declared here.**
   * Section 7 keeps the two separate: `take_attendance` guards the first submission and
   * `correct_subtree` guards amendment of an already-submitted record. This route makes
   * only first submissions — a second one is refused in the service — so the capability
   * that reaches it is the first, and the correction capability belongs with the
   * correction path rather than being declared where nothing uses it.
   */
  @Post(':id/meetings/:meetingId/submit')
  @RequiresCapability(Capability.CellTakeAttendance, {
    kind: 'cell',
    from: 'params.id',
  })
  async submit(
    @Param('id', new UuidParamPipe('id')) cellId: string,
    @Param('meetingId') meetingId: string,
    @Body() body: SubmitCellMeetingDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.meetings.submit(cellId, meetingId, body, actor, claim);
  }
}
