import { Body, Controller, Delete, Param, Post } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';

import { UuidParamPipe } from '../common/uuid-param.pipe';

import { CellsMembershipService } from './cells.membership.service';
import { CellsService } from './cells.service';
import { AddCellMemberDto, CreateCellDto } from './dto/cells.dto';

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
  constructor(
    private readonly cells: CellsService,
    private readonly membership: CellsMembershipService,
  ) {}

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

  /**
   * Add a person to this Cell, moving them out of any Cell they already belong to
   * (SKILL.md section 10, Managing Cell membership).
   *
   * **The target is the Cell**, which section 7 resolves through its leader: "a
   * Cell, a Cell meeting, a membership or a leadership resolves through the Cell's
   * leader as of the period being viewed, falling back to its last leader where the
   * Cell is closed." That is what makes section 10's list of holders — the Cell's
   * current leader over their own Cells, any leader upline of them within their own
   * subtree, Admin, Senior Pastors — fall out of the scope rather than being
   * restated here.
   *
   * **Deliberately not the person being added.** Section 10 says membership need not
   * mirror pastoral assignment, so a leader may add somebody from outside their own
   * pastoral subtree to their Cell; resolving scope against the member would refuse
   * exactly that. The *source* Cell of a move is the second object and is checked in
   * the domain layer (section 7).
   */
  @Post(':id/members')
  @RequiresCapability(Capability.CellManageMembership, {
    kind: 'cell',
    from: 'params.id',
  })
  async addMember(
    @Param('id') cellId: string,
    @Body() body: AddCellMemberDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.membership.add(cellId, body.person_id, actor, claim);
  }

  /**
   * End a person's membership of this Cell, leaving them in none.
   *
   * Section 10 makes this ordinary rather than exceptional: somebody who comes once
   * and does not return "remains a member until removed", and removing them is "an
   * ordinary authorized action… routine tidying rather than a defect". People left
   * without a Cell appear on section 15's attention list, which is what stops the
   * removal being silent.
   *
   * `DELETE` names the membership, not the row: section 5 never deletes a row of an
   * effective-dated table, and migration 0009 refuses one. The membership is closed,
   * and the record is preserved in full.
   */
  @Delete(':id/members/:person_id')
  @RequiresCapability(Capability.CellManageMembership, {
    kind: 'cell',
    from: 'params.id',
  })
  async removeMember(
    @Param('id') cellId: string,
    /**
     * **Validated here, because nothing else validates it.** Section 7: "a route
     * with a path parameter the guard does not resolve against must validate it
     * itself… reaching a `uuid` comparison with one produces a database error rather
     * than an answer." The guard resolves `params.id` and nothing else, so before this
     * the value reached a `uuid` column and `22P02` answered `INTERNAL_ERROR`.
     *
     * `UuidParamPipe` rather than Nest's `ParseUUIDPipe`: that one carries a stricter
     * predicate than the rest of this API, and would refuse identifiers the `{id}` in
     * the same path accepts.
     */
    @Param('person_id', new UuidParamPipe('person_id')) personId: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.membership.remove(cellId, personId, actor, claim);
  }
}
