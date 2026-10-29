import { Injectable } from '@nestjs/common';

import { isUuid } from '../common/identifiers';

import type { MergedPersonsPort } from '../auth/authorization/merged-persons.port';
import type { Db } from '../database/database.module';

/**
 * `people`'s half of `MERGED_PERSONS_PORT` (decision 0408, point 17): the record a Person was
 * merged into, read from the table this module owns.
 *
 * **A class of its own rather than a method on `PeopleReadService`**, because that service
 * depends on `AuthorizationService`, which depends on this port: binding the port to it would be
 * a cycle between instances, which no module arrangement removes. This reads one column and
 * depends on nothing but the executor it is handed.
 */
@Injectable()
export class MergedPersonsAdapter implements MergedPersonsPort {
  async keptRecordOfWithin(executor: Db, personId: string): Promise<string | null> {
    if (!isUuid(personId)) {
      return null;
    }

    const row = await executor
      .selectFrom('persons')
      .select('merged_into_id')
      .where('id', '=', personId)
      .executeTakeFirst();

    return row?.merged_into_id ?? null;
  }
}
