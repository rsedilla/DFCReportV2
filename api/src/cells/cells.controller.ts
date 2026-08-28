import { Body, Controller, Post } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';

import { CellsService } from './cells.service';
import { CreateCellDto } from './dto/cells.dto';

/**
 * `/api/v1/cells` (SKILL.md section 22).
 *
 * One route today, and it is the one section 2 relaxes rather than the one section
 * 10 makes ordinary: while initial encoding is open, Admin creates a Cell and its
 * leadership assignment directly. Request-and-approve, closure and configuration
 * arrive with their own slices, and each carries its own capability.
 */
@Controller('cells')
export class CellsController {
  constructor(private readonly cells: CellsService) {}

  /**
   * Section 2, Initial data load: "Admin creates the Cell and the leadership
   * assignment directly, exercising `cell.approve_leadership` and
   * `cell.manage_leadership` at Whole Church scope."
   *
   * **The guard declares the first of the two, and the domain layer checks the
   * second.** Section 7 settles the shape: the guard resolves one capability
   * against one target, and a rule about anything else is a check in the owning
   * module. `cell.approve_leadership` is the decision being made — whether this
   * person should lead a Cell — and section 7 gives it to Admin alone, at Whole
   * Church only, so a grant issued narrower covers nothing and is refused
   * `SCOPE_DENIED`.
   *
   * **The target is the prospective leader**, which is what the scope is about. It
   * is the same choice section 10 makes for a request: "the prospective leader is
   * what the scope is about, because the thing being decided is whether that person
   * should lead". A Cell is the other object of a handover and does not exist yet
   * here, so this path has only one.
   */
  @Post()
  @RequiresCapability(Capability.CellApproveLeadership, {
    kind: 'person',
    from: 'body.cell_leader_id',
  })
  async create(
    @Body() body: CreateCellDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.cells.createDirectly(
      {
        cellLeaderId: body.cell_leader_id,
        category: body.category,
        dayOfWeek: body.day_of_week,
        timeOfDay: body.time_of_day,
      },
      actor,
      claim,
    );
  }
}
