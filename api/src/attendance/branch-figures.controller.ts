import { Controller, Get, Param } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { NotFoundError } from '../common/errors/api-error';
import { UuidParamPipe } from '../common/uuid-param.pipe';
import { PeopleReadService } from '../people/people.read.service';

import { BranchFiguresService } from './branch-figures.service';

/**
 * The Network screen's figures for the current month (SKILL.md section 17, decision
 * 0252): `GET /api/v1/leaders/{id}/dcc-behind` and `GET /api/v1/leaders/{id}/cell-figures`.
 *
 * **Two routes because two capabilities**: DCC records behind is read under
 * `dcc.view_subtree` and the Cell figures under `cell.view_subtree` (decision 0252), so a
 * reader holding one sees that figure and the tree, and not the other. The tree itself is
 * `people.view_subtree`'s, on the routes beside these in `people`.
 *
 * **The target is the person in the path.** Which target a per-row figure should be
 * authorized against is recorded as open in `CLAUDE.md`; the rows are that person's
 * branch, so a scope covering them covers every row wherever scopes nest.
 *
 * **Existence is checked after the guard** (decision 0253), as the tree routes do.
 */
@Controller('leaders')
export class BranchFiguresController {
  constructor(
    private readonly figures: BranchFiguresService,
    private readonly read: PeopleReadService,
  ) {}

  @Get(':id/dcc-behind')
  @RequiresCapability(Capability.DccViewSubtree, { kind: 'person', from: 'params.id' })
  async dccBehind(
    @Param('id', new UuidParamPipe('id')) id: string,
  ): Promise<Record<string, unknown>> {
    await this.assertExists(id);

    return this.figures.dccBehind(id);
  }

  @Get(':id/cell-figures')
  @RequiresCapability(Capability.CellViewSubtree, { kind: 'person', from: 'params.id' })
  async cellFigures(
    @Param('id', new UuidParamPipe('id')) id: string,
  ): Promise<Record<string, unknown>> {
    await this.assertExists(id);

    return this.figures.cellFigures(id);
  }

  private async assertExists(id: string): Promise<void> {
    if (!(await this.read.findById(id))) {
      throw new NotFoundError('No such person.');
    }
  }
}
