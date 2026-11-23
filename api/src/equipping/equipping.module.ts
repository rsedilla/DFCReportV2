import { Module } from '@nestjs/common';

import { AttendanceModule } from '../attendance/attendance.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { CellsModule } from '../cells/cells.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { PeopleModule } from '../people/people.module';
import { SuynlModule } from '../suynl/suynl.module';
import { TrainingModule } from '../training/training.module';

import { EquippingController } from './equipping.controller';
import { EquippingAttendanceService } from './equipping-attendance.service';
import { EquippingEncounterService } from './equipping-encounter.service';
import { EquippingGradesService } from './equipping-grades.service';
import { EquippingService } from './equipping.service';
import { PersonArchiveEquippingAdapter } from './person-archive.adapter';
import { SchoolEvidenceAdapter } from './school-evidence.adapter';

/**
 * `equipping` owns `equipping_classes`, `equipping_registrations` and
 * `equipping_enrollments` (SKILL.md sections 2 and 29, decision 0499). It reads the rest
 * through the owning modules' services, and nothing it imports reaches back to it.
 */
@Module({
  imports: [
    PeopleModule,
    HierarchyModule,
    CellsModule,
    AttendanceModule,
    SuynlModule,
    TrainingModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
  ],
  controllers: [EquippingController],
  providers: [
    EquippingService,
    EquippingAttendanceService,
    EquippingEncounterService,
    EquippingGradesService,
    PersonArchiveEquippingAdapter,
    SchoolEvidenceAdapter,
  ],
  exports: [PersonArchiveEquippingAdapter, SchoolEvidenceAdapter],
})
export class EquippingModule {}
