import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CurrentActor } from '../auth/current-actor.decorator';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../common/idempotency/current-idempotency.decorator';

import { UuidParamPipe } from '../common/uuid-param.pipe';

import { CellsClosureService } from './cells.closure.service';
import { CellsConfigurationService } from './cells.configuration.service';
import { CellsMembershipService } from './cells.membership.service';
import { CellsService } from './cells.service';
import {
  AddCellMemberDto,
  CellMembersDto,
  ChangeCellCategoryDto,
  ChangeCellScheduleDto,
  CloseCellDto,
  CreateCellDto,
} from './dto/cells.dto';

/**
 * `/api/v1/cells` (SKILL.md section 22).
 *
 * Creation is the one section 2 relaxes rather than the one section 10 makes
 * ordinary: while initial encoding is open, Admin creates a Cell and its leadership
 * assignment directly. Everything else here is an ordinary section 10 operation, and
 * each resolves scope through the Cell's leader rather than through the person named.
 * Request-and-approve and the handover workflow arrive with their own slices, and
 * each carries its own capability.
 */
@Controller('cells')
export class CellsController {
  constructor(
    private readonly cells: CellsService,
    private readonly membership: CellsMembershipService,
    private readonly configuration: CellsConfigurationService,
    private readonly closure: CellsClosureService,
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
   * This Cell's current members (SKILL.md section 10, *What closing does*; section 22).
   *
   * **It exists because the closure endpoint made it necessary.** Section 10 requires
   * the members to be "presented at the point of closure", and the closure refuses any
   * decision list that is not exactly the Cell's current membership — so mandating the
   * list turned a documented-but-unbuilt route into a blocker. Section 22 has
   * documented this path since before the endpoint existed.
   *
   * **`cell.manage_membership`, resolved against the Cell**, which is what the two
   * write routes below declare. Everyone who may act on this list may see it, and
   * nobody else — a derivation rather than a new rule, and section 7 declares its
   * capability list closed so inventing a read capability for it is not available.
   *
   * The cost is real and is escalated rather than hidden: guarding a read with a write
   * capability means `read_only` on a grant of it is rejected at creation (section 7),
   * so a person cannot be given roster visibility without also being given the power
   * to change it. Whether a Cell roster deserves a read capability of its own is
   * recorded as open in `CLAUDE.md`.
   */
  @Get(':id/members')
  @RequiresCapability(Capability.CellManageMembership, {
    kind: 'cell',
    from: 'params.id',
  })
  async members(
    @Param('id') cellId: string,
    @Query() query: CellMembersDto,
  ): Promise<{ data: Record<string, unknown>[]; next_cursor: string | null }> {
    return this.membership.membersOf(cellId, { limit: query.limit, cursor: query.cursor });
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
     * `UuidParamPipe` rather than Nest's `ParseUUIDPipe`, and **not** because that one
     * is stricter — two earlier versions of this comment said so and it does not
     * reproduce: with no `version` option its predicate is as loose as `isUuid`. The
     * reason is section 22's single error envelope, which `BadRequestException` is not,
     * and that `identifiers.ts` exists to be the one copy of this question. See the
     * withdrawal in `uuid-param.pipe.ts`.
     */
    @Param('person_id', new UuidParamPipe('person_id')) personId: string,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.membership.remove(cellId, personId, actor, claim);
  }

  /**
   * Change this Cell's category, effective today.
   *
   * Section 10: "Cell category is editable over time, e.g. Youth -> Young Pro. Keep
   * the same Cell ID. Preserve category history with effective dates." The Cell ID
   * deliberately does not change with it — section 10 gives that as the reason a Cell
   * ID encodes nothing, since "an identifier such as `YTH-0042` becomes a lie the
   * moment a Youth Cell becomes Young Pro".
   *
   * `PUT` rather than `PATCH`: the body carries the whole of what a category is, so
   * there is no partial form of this request.
   */
  @Put(':id/category')
  @RequiresCapability(Capability.CellManageConfiguration, {
    kind: 'cell',
    from: 'params.id',
  })
  async changeCategory(
    @Param('id') cellId: string,
    @Body() body: ChangeCellCategoryDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.configuration.changeCategory(cellId, body.category, actor, claim);
  }

  /**
   * Change this Cell's standing day and time, effective at the start of next month.
   *
   * Section 10 fixes the effective date and gives the reason: a month must hold
   * exactly one schedule, or moving a Cell from Saturday to Sunday "silently rewrites
   * the coverage figure for every earlier month". The response says
   * `effective_at` and `effective_date` rather than leaving a client to infer them,
   * and the pair matters here: the instant is 16:00 UTC on the last day of the previous
   * month, so a client rendering a date from it alone shows the wrong month.
   *
   * **This is not how a single meeting moves.** A lost venue or a clash is a
   * `RESCHEDULED` meeting (section 13); section 10 keeps the two apart deliberately,
   * because the schedule is the Cell's standing arrangement.
   */
  @Put(':id/schedule')
  @RequiresCapability(Capability.CellManageConfiguration, {
    kind: 'cell',
    from: 'params.id',
  })
  async changeSchedule(
    @Param('id') cellId: string,
    @Body() body: ChangeCellScheduleDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.configuration.changeSchedule(
      cellId,
      body.day_of_week,
      body.time_of_day,
      actor,
      claim,
    );
  }

  /**
   * Close this Cell (SKILL.md section 10, *What closing does*).
   *
   * **`POST .../closure` rather than `DELETE /cells/{id}`.** A closure is not a
   * deletion and must not be spelled like one: section 10 keeps the Cell, its ID, its
   * history and every relationship record in full, and migration 0009 refuses a
   * `DELETE` on the table outright. It is also not idempotent in the way `DELETE`
   * implies — a second closure of a closed Cell is refused, because a closure is
   * never reversed or repeated (section 10, *Reopening*).
   *
   * **The body carries a decision about every current member.** Section 10 requires
   * closure to "not complete without the decision being made and recorded", and this
   * is that decision rather than a convenience: a member the request does not name
   * refuses the closure, and one it names who is no longer a member refuses it too.
   *
   * The capability is `cell.manage_lifecycle`, resolved against this Cell through its
   * leader (section 7) — which is what makes section 10's list of holders, the Cell's
   * current leader and any leader upline of them within their own subtree, Admin and
   * the Senior Pastors, fall out of the scope rather than being restated. Each
   * dispersal **destination** is a second object and is checked in the domain layer
   * under `cell.manage_membership`, which is the shape section 7 settles for a rule
   * about anything the guard did not resolve.
   */
  @Post(':id/closure')
  @RequiresCapability(Capability.CellManageLifecycle, {
    kind: 'cell',
    from: 'params.id',
  })
  @HttpCode(200)
  async close(
    @Param('id') cellId: string,
    @Body() body: CloseCellDto,
    @CurrentActor() actor: Actor,
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.closure.close(
      cellId,
      {
        reason: body.reason,
        note: body.note,
        effectiveDate: body.effective_date,
        members: body.members.map((member) => ({
          personId: member.person_id,
          destinationCellId: member.destination_cell_id,
        })),
      },
      actor,
      claim,
    );
  }
}
