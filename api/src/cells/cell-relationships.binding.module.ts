import { Global, Module } from '@nestjs/common';

import { CELL_RELATIONSHIPS_PORT } from '../networks/cell-relationships.port';

import { CellsModule } from './cells.module';
import { CellsReadService } from './cells.read.service';

/**
 * Binds `networks`' Cell-relationships port to the module that owns those tables
 * (SKILL.md section 4; `cell-relationships.port.ts`).
 *
 * **It is `@Global()` because of where Nest resolves a dependency, not because the
 * provider deserves to be everywhere.** Nest resolves a provider's dependencies in
 * the context of the module that *registers* it — `NetworksService` is registered in
 * `NetworksModule`, so a binding in `AppModule`'s provider list is invisible to it.
 * That is exactly how the 2026-08-24 authorization seam failed: the split compiled,
 * type-checked, passed the unit suite and broke every authenticated request, because
 * `CapabilityGuard` happened to be registered globally and the provider it needed was
 * not.
 *
 * Here the same shape produced a *refusal* rather than a crash, because the port
 * fails closed: every Network change answered `INVARIANT_VIOLATION` saying the
 * deployment could not check the precondition. Fifteen existing sex-correction cases
 * turned red at once, which is the failure mode this design was chosen for.
 *
 * `NetworksModule` cannot import `CellsModule` — `cells` imports `networks`, so that
 * is a cycle, which is the whole reason a port exists. A global provider is how a
 * module receives an implementation it may not depend on, and this codebase already
 * uses that for `DATABASE`, `APP_CONFIG`, `AuditService` and `IdempotencyService`.
 *
 * **A module of its own rather than `@Global()` on `CellsModule`**, which would
 * publish creation, closure, membership and configuration to every module in the
 * application to deliver one read. What is global here is one token.
 */
@Global()
@Module({
  imports: [CellsModule],
  providers: [{ provide: CELL_RELATIONSHIPS_PORT, useExisting: CellsReadService }],
  exports: [CELL_RELATIONSHIPS_PORT],
})
export class CellRelationshipsBindingModule {}
