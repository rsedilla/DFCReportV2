import { Inject, Injectable } from '@nestjs/common';

import { DATABASE, type Db } from '../database/database.module';

import type { Database, NetworkName, Sex } from '../database/schema';
import type { Transaction } from 'kysely';

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

  /**
   * Opens a Network assignment inside a caller's transaction.
   *
   * Here rather than in `people` because `networks` owns this table (section 2,
   * Modules) and because the same-Network rules in sections 4 and 5 are checked
   * against it. One writer is what keeps that checkable.
   *
   * Section 4: a person's initial Network takes effect on the date they are
   * encoded. Nothing is backdated and no legacy history is invented.
   */
  async assignWithin(
    transaction: Transaction<Database>,
    assignment: {
      personId: string;
      network: NetworkName;
      actorId: string | null;
      startedAt: Date;
      reason?: string | null;
    },
  ): Promise<void> {
    await transaction
      .insertInto('network_assignments')
      .values({
        person_id: assignment.personId,
        network: assignment.network,
        actor_id: assignment.actorId,
        reason: assignment.reason ?? null,
        started_at: assignment.startedAt,
      })
      .execute();
  }

  /**
   * Network follows from sex under the homogeneous-network rule (section 4).
   *
   * Assigned rather than proposed: the mapping is total, so a confirmation step
   * asks the encoder to approve a tautology, and confirmations of tautologies are
   * clicked without being read. The field that can genuinely be wrong is sex.
   */
  networkForSex(sex: Sex): NetworkName {
    return sex === 'MALE' ? 'MENS' : 'WOMENS';
  }

  /** The person's Network as it stands now. */
  async currentNetwork(personId: string): Promise<NetworkName | null> {
    return this.networkAsOf(personId, new Date());
  }
}
