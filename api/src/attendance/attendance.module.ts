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
    CellMeetingsService,
    CellMeetingsScopeService,
  ],
  // `CellMeetingsScopeService` is exported for `AppModule`'s `CELL_MEETING_SCOPE_PORT`
  // binding alone (decision 0188). Nest resolves a provider's dependencies in the
  // module that *registers* it, so a `useExisting` in `AppModule` needs the class
  // reachable from there — the wiring fault `module-graph.spec.ts` exists to catch.
  exports: [DccCalendarService, CellMeetingsScopeService],
})
export class AttendanceModule {}
