import { Controller, Get, Param, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { UuidParamPipe } from '../common/uuid-param.pipe';

import { CellMeetingsService } from './cell-meetings.service';
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
}
