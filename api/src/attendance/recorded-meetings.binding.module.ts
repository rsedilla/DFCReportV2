import { Global, Module } from '@nestjs/common';

import { RECORDED_MEETINGS_PORT } from '../cells/recorded-meetings.port';

import { AttendanceModule } from './attendance.module';
import { CellMeetingsService } from './cell-meetings.service';

/**
 * Binds `cells`' recorded-meetings port to the module that owns `cell_meetings`
 * (SKILL.md sections 2 and 12; `recorded-meetings.port.ts`).
 *
 * **`@Global()` because of where Nest resolves a dependency, not because the provider
 * deserves to be everywhere.** Nest resolves a provider's dependencies in the context of
 * the module that *registers* it. `CellsIndexService` is registered in `CellsModule`, so
 * a binding in `AppModule`'s own provider list is invisible to it — which is exactly how
 * `CELL_RELATIONSHIPS_PORT` failed once, turning fifteen sex-correction cases red in CI
 * on an application that compiled. `CellRelationshipsBindingModule` is the answer that
 * fault produced, and this is the same shape for the same reason.
 *
 * *`CELL_SCOPE_PORT` and `CELL_MEETING_SCOPE_PORT` are bound from `AppModule` and are not
 * a counter-example: their consumer is `CapabilityGuard`, which `AppModule` registers
 * globally, so `AppModule` is already the resolving context for them.*
 *
 * `CellsModule` cannot import `AttendanceModule` — `attendance` imports `cells`, so that
 * is a cycle, which is the whole reason a port exists. A global provider is how a module
 * receives an implementation it may not depend on.
 *
 * **A module of its own rather than `@Global()` on `AttendanceModule`.** A global module
 * publishes its exports, and this one would put two controllers and six providers into
 * the global registry to deliver one count. What is global here is one token.
 */
@Global()
@Module({
  imports: [AttendanceModule],
  providers: [{ provide: RECORDED_MEETINGS_PORT, useExisting: CellMeetingsService }],
  exports: [RECORDED_MEETINGS_PORT],
})
export class RecordedMeetingsBindingModule {}
