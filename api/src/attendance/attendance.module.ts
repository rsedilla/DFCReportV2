import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { CellsModule } from '../cells/cells.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { PeopleModule } from '../people/people.module';

import { CellMeetingsController } from './cell-meetings.controller';
import { CellMeetingsScopeService } from './cell-meetings.scope.service';
import { CellMeetingsService } from './cell-meetings.service';
import { DccAttendanceService } from './dcc-attendance.service';
import { DccCalendarService } from './dcc-calendar.service';
import { CellFiguresService } from './cell-figures.service';
import { DccFiguresService } from './dcc-figures.service';
import { DccCoverageService } from './dcc-coverage.service';
import { DccController } from './dcc.controller';

/**
 * Owns `dcc_events`, `dcc_attendance`, `cell_meetings`, `cell_attendance` and
 * `cell_meeting_changes` (SKILL.md section 2, Modules).
 *
 * No other module writes those tables, and no other module reaches them for
 * anything this module's services can answer. That is what gives the section 13
 * and section 14 rules one home — the submission window, the meeting statuses, the
 * append-only correction, and the two version units — rather than four.
 *
 * **It touches no table it does not own.** `hierarchy` answers every question about
 * a pastoral assignment, including the dated ones section 9 needs; `people` answers
 * identity and lifecycle; `auth` answers whether a Person holds an account, which is
 * what decides a checklist (section 9); `authorization` answers scope; `audit` writes
 * its entries. `IdempotencyService` writes `idempotency_keys`, which section 2
 * assigns to no module.
 *
 * **It imports `AuthModule` as well as `AuthorizationModule`**, which no other
 * domain module does. The reason is `AccountsRepository`: section 9 routes a
 * submission to "the nearest upline leader who does" hold an account, so the
 * checklist is decided by a fact about `accounts`, and `auth` owns that table. There
 * is no cycle — `auth -> cells` and nothing imports `attendance` — but the edge is
 * named here because it is the one place a domain module depends on authentication
 * rather than on authorization, and a reader is entitled to know it was deliberate.
 */
@Module({
  imports: [
    HierarchyModule,
    PeopleModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
    CellsModule,
  ],
  controllers: [DccController, CellMeetingsController],
  providers: [
    DccCalendarService,
    DccAttendanceService,
    DccCoverageService,
    CellMeetingsService,
    CellMeetingsScopeService,
    DccFiguresService,
    CellFiguresService,
  ],
  // **Two of these are exported to be bound to a port token, and for nothing else.**
  // Nest resolves a provider's dependencies in the module that *registers* it, so a
  // `useExisting` naming a class needs that class reachable from the binding's own
  // module — the wiring fault `module-graph.spec.ts` exists to catch.
  //
  // `CellMeetingsScopeService` carries `CELL_MEETING_SCOPE_PORT`, bound in `AppModule`
  // because its consumer is the globally registered `CapabilityGuard` (decision 0188).
  // `CellMeetingsService` carries `RECORDED_MEETINGS_PORT`, bound in
  // `RecordedMeetingsBindingModule` because *its* consumer is registered in `CellsModule`,
  // which `AppModule` is not the resolving context for.
  exports: [
    DccCalendarService,
    CellMeetingsScopeService,
    CellMeetingsService,
    DccFiguresService,
    CellFiguresService,
  ],
})
export class AttendanceModule {}
