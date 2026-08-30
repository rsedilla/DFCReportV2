import { Module } from '@nestjs/common';

import { SettingsModule } from '../admin/settings/settings.module';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { NetworksModule } from '../networks/networks.module';
import { PeopleModule } from '../people/people.module';

import { CellsController } from './cells.controller';
import { CellsClosureService } from './cells.closure.service';
import { CellsConfigurationService } from './cells.configuration.service';
import { CellsLeadershipRequestService } from './cells.leadership-request.service';
import { CellsMembershipService } from './cells.membership.service';
import { CellsReadService } from './cells.read.service';
import { CellsService } from './cells.service';

/**
 * Owns the six tables SKILL.md section 26 gives to `cells`: `cells`,
 * `cell_categories`, `cell_schedules`, `cell_leaderships`, `cell_memberships` and
 * `cell_leadership_requests` (migration 0009). **No other module writes them**, and
 * none reads them for anything this module's services can answer.
 *
 * **It imports `AuthorizationModule` rather than `AuthModule`**, which is the seam
 * the 2026-08-24 ruling established and the reason there is no cycle: `auth` needs
 * to know whether a Person is a current Cell Leader before it may provision a
 * `LEADER` account (section 6), so `auth` imports this module — and this module
 * would import `auth` right back if it took the whole of it to ask an authorization
 * question. What it needs is the question, not the module.
 *
 * The graph runs `auth -> cells -> {people, networks, hierarchy, authorization,
 * admin/settings, audit}`
 * with nothing pointing back. `test/unit/module-graph.spec.ts` builds the injector
 * without a database, which is what makes a wiring mistake fail in seconds rather
 * than on every authenticated request.
 *
 * **It touches no table it does not own.** Every cross-module read goes through the
 * service owning that table, inside the transaction this module opens: `people` for a
 * Person's identity and lifecycle, `hierarchy` for an open pastoral assignment,
 * `networks` for a Network in force, `authorization` for roles, grants and the Account
 * behind an actor, `audit` for its entries, and `admin/settings` for the
 * initial-encoding flag. `IdempotencyService` writes `idempotency_keys`, which section
 * 2 assigns to no module.
 *
 * *Written as the whole set rather than as one operation's reads, because naming an
 * operation is what kept getting it wrong.* Three successive batches left this short by
 * one {M} `networks`, then `authorization` {M} while the graph sentence six lines above
 * listed both all along; and it attributed the `hierarchy` and `networks` reads to
 * creating a Cell, which does neither. Both belong to approval
 * (`CellsLeadershipRequestService`), and its Network comparison for a new Cell is
 * between the prospective leader and their *pastoral* leader, not between two Cell
 * leaders.
 *
 * Six services, and the split is the one `people` already settled: `CellsService`,
 * `CellsLeadershipRequestService`, `CellsMembershipService`,
 * `CellsConfigurationService` and `CellsClosureService` are named for the
 * operations, `CellsReadService` for the reads another module needs. *The count
 * was five for two slices after the request service arrived, which is what a
 * docblock enumerating its own subject costs.* Section 2's "organise by module, never by layer" is about how the
 * application is divided and does not reach inside one, so the read seam is a
 * judgement rather than a requirement — and the boundary that *is* enforced, table
 * ownership, is unaffected by it.
 */
@Module({
  imports: [
    PeopleModule,
    NetworksModule,
    HierarchyModule,
    AuthorizationModule,
    SettingsModule,
    AuditModule,
  ],
  controllers: [CellsController],
  providers: [
    CellsService,
    CellsLeadershipRequestService,
    CellsMembershipService,
    CellsConfigurationService,
    CellsClosureService,
    CellsReadService,
  ],
  exports: [CellsReadService],
})
export class CellsModule {}
