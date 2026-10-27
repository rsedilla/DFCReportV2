import { Global, Module } from '@nestjs/common';

import { ABSENT_PEOPLE_PORT } from '../people/person-archive.ports';

import { AbsentPeopleService } from './absent-people.service';
import { AttendanceModule } from './attendance.module';

/**
 * Binds `people`'s *Absent 3+ Months* port to the module that composes the list (decision
 * 0397). `GET /api/v1/people/absent` is served by `PeopleController`, beside the routes it
 * would otherwise race for `/people/:id`, and `people` cannot import `AttendanceModule`,
 * which imports it. `@Global()` and a module of its own for the reasons
 * `CellRelationshipsBindingModule` gives; what is global here is one token.
 */
@Global()
@Module({
  imports: [AttendanceModule],
  providers: [{ provide: ABSENT_PEOPLE_PORT, useExisting: AbsentPeopleService }],
  exports: [ABSENT_PEOPLE_PORT],
})
export class AbsentPeopleBindingModule {}
