import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type Db } from '../database/database.module';

import type { NetworkName } from '../database/schema';

/**
 * The `networks` module: Network assignment and its history.
 *
 * Network is effective-dated rather than a column on the Person, because a column
 * cannot answer which Network someone belonged to during a past month, and every
 * Network-scoped report for a closed period depends on that answer (SKILL.md
 * section 4).
 */
@Injectable()
export class NetworksService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * The person's Network as it stood at `at`, or null where none was recorded
   * then. Null is a real answer: the system is authoritative for Network history
   * only from a person's encoding date forward.
   */
  async networkAsOf(personId: string, at: Date): Promise<NetworkName | null> {
    const row = await this.db
      .selectFrom('network_assignments')
      .select('network')
      .where('person_id', '=', personId)
      .where('started_at', '<=', at)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', at)]))
      .orderBy('started_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row?.network ?? null;
  }

  /** The person's Network as it stands now. */
  async currentNetwork(personId: string): Promise<NetworkName | null> {
    return this.networkAsOf(personId, new Date());
  }
}
