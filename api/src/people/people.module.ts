import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { NetworksModule } from '../networks/networks.module';

import { PeopleController } from './people.controller';
import { PeopleDuplicatesService } from './people.duplicates.service';
import { PeopleReadService } from './people.read.service';
import { PeopleReassignmentService } from './people.reassignment.service';
import { PeopleService } from './people.service';
import { PeopleSexCorrectionService } from './people.sex-correction.service';

/**
 * Owns `persons` and `person_lifecycle` (SKILL.md section 2, Modules). No other
 * module reads or writes them directly.
 *
 * It touches no table it does not own, in either direction. Creating a Person
 * opens a Network assignment, a pastoral assignment and an audit entry, and each
 * goes through the service owning that table — `networks`, `hierarchy` and
 * `audit` — inside the transaction `people` opens.
 *
 * Section 2 gives the reason for the first of those: the section 5 invariants
 * have one place to live only while `hierarchy` is the sole writer of
 * `pastoral_assignments`, and this module performs the system's first assignment
 * write. The same argument covers `audit_log`, which section 21 makes append-only
 * and which this module was also the first to write.
 *
 * **Five services, one module.** The split is by operation rather than by layer,
 * which section 2 requires: each of them owns a rule this specification states,
 * and every one still writes through the same owning services. What it buys is
 * that the two operations carrying a section number of their own — the sex
 * correction and the reassignment — can be reviewed alone, which is what a single
 * file assembling every write path's invariants by hand made impossible.
 */
@Module({
  imports: [HierarchyModule, NetworksModule, AuthModule],
  controllers: [PeopleController],
  providers: [
    PeopleService,
    PeopleReadService,
    PeopleDuplicatesService,
    PeopleSexCorrectionService,
    PeopleReassignmentService,
  ],
  exports: [
    PeopleService,
    PeopleReadService,
    PeopleDuplicatesService,
    PeopleSexCorrectionService,
    PeopleReassignmentService,
  ],
})
export class PeopleModule {}
