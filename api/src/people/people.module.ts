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
 * Owns `persons` and `person_lifecycle` (SKILL.md section 2, Modules). **No other
 * module writes them**, which is the half of section 2's rule that is true here
 * and the half the invariants depend on.
 *
 * It is deliberately not "no other module reads them": `hierarchy` joins `persons`
 * to name a leader and a disciple in its own queries. The sentence said "reads or
 * writes" until the split, and stating a rule more strongly than the code keeps it
 * is how the rule stops being checkable.
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
 * **Five services, one module**, split by operation rather than by layer: each
 * owns a rule this specification states, and every one still writes through the
 * same owning services.
 *
 * What it buys is that the two operations carrying a section number of their own —
 * the sex correction and the reassignment — can be reviewed alone. **What it does
 * not buy is any sharing of the write skeleton**, which is still assembled by hand
 * in three places. An earlier version of this paragraph implied otherwise.
 *
 * That is deferred rather than declined. Extracting it from two call sites and
 * guessing at a third is the shape-without-its-reason section 25 rule 19 exists to
 * stop, and Stage 3's Cell writes are the third. The concern is not hypothetical:
 * the copies have already drifted on one of the eleven steps — the sex correction
 * stamps its effective instant before its transaction where the reassignment does
 * it after the lock — and this split neither detected nor prevented that.
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
