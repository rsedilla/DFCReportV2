import { Module } from '@nestjs/common';

import { AttendanceModule } from '../attendance/attendance.module';
import { CellsModule } from '../cells/cells.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { NetworksModule } from '../networks/networks.module';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

/**
 * Owns `report_snapshots` and `notifications` (SKILL.md section 26), and nothing else.
 *
 * **It roots no query in another module's tables** (section 2, and decision 0206). Every
 * figure it reports is computed by the module that owns the rows and reaches here through
 * a service interface; this module composes them and will store the snapshot. Widening
 * section 2's exemption for it was considered and refused — the exemption would reach
 * around eleven tables across four modules, which is not an exemption but the ownership
 * rule reversed for one module.
 *
 * A plain import rather than a port: neither `reporting -> attendance` nor
 * `reporting -> hierarchy` is a cycle, and section 2 is explicit that a dependency which is
 * not a cycle takes the ordinary route. `hierarchy` arrives with leader scope, which needs
 * the placement graph walked by the module that owns `pastoral_assignments`.
 */
@Module({
  // `CellsModule` arrives with the Cell coverage denominator, which section 2 assigns to
  // that module by name. Not a cycle: `cells` imports neither `attendance` nor this.
  imports: [AttendanceModule, CellsModule, HierarchyModule, NetworksModule],
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
