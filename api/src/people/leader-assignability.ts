import { InvariantViolationError, NotFoundError } from '../common/errors/api-error';
import { type Db } from '../database/database.module';
import { type NetworksService } from '../networks/networks.service';

import type { NetworkName } from '../database/schema';

/**
 * Whether this Person may be the pastoral leader of a new edge (SKILL.md section
 * 5): not merged away, not archived, and in the same Network as of the instant
 * the edge takes effect.
 *
 * A function rather than a method, because all three write paths that open an
 * edge need it — creation, the sex correction's forced reassignment, and
 * reassignment itself — and none of the three owns it.
 *
 * It stays in `people` rather than moving to `hierarchy` with the rest of section
 * 5, because it reads `persons` and `person_lifecycle` and section 2 gives those
 * tables to this module. `networks` is a parameter for the same reason the
 * coverage test is a parameter to invariant 1: the caller already holds it, and
 * taking it as an argument is what keeps this a function.
 */
/**
 * Refuses a leader the new edge could not legally point at.
 *
 * The database enforces the same-Network rule and would reject this at commit
 * (section 5), but a constraint violation surfacing as a 500 tells an encoder
 * nothing. This turns the two reachable cases into the answers section 22
 * defines for them.
 */
export async function assertLeaderIsAssignable(
  /**
   * Whose view of `persons` and `person_lifecycle` to trust. Both callers now
   * validate inside their own transaction and after taking the person lock —
   * creation used to validate outside it, which left the answer stale by the time
   * the edge was written.
   */
  executor: Db,
  leaderId: string,
  network: NetworkName,
  /**
   * The instant the resulting edge takes effect. The constraint trigger compares
   * `network_as_of(leader, started_at)`, so a backdated correction has to be
   * checked against the leader's Network *then* rather than now, or the answer
   * here disagrees with the answer at commit.
   */
  at: Date,
  /** Passed in rather than injected: see the note above. */
  networks: NetworksService,
): Promise<void> {
  const leader = await executor
    .selectFrom('persons')
    .select(['id', 'merged_into_id'])
    .where('id', '=', leaderId)
    .executeTakeFirst();

  if (!leader) {
    throw new NotFoundError('No such pastoral leader.');
  }

  if (leader.merged_into_id !== null) {
    throw new InvariantViolationError(
      'That leader was absorbed by a merge. Use the surviving Person instead.',
      { pastoral_leader_id: leaderId },
    );
  }

  // An archived Person acquiring a new disciple would leave a live pastoral
  // edge under someone who is not a current Person -- the same corruption
  // section 3 refuses when archiving a Person who leads a Cell. Restore them
  // first, which is an explicit and separately audited decision.
  const lifecycle = await executor
    .selectFrom('person_lifecycle')
    .select('state')
    .where('person_id', '=', leaderId)
    .where('ended_at', 'is', null)
    .executeTakeFirst();

  if (lifecycle?.state === 'ARCHIVED') {
    throw new InvariantViolationError(
      'That leader is archived. Restore them first, or choose another leader.',
      { pastoral_leader_id: leaderId },
    );
  }

  // Through `executor`, like every other read here. A pooled read taken while
  // the caller holds a transaction needs a second connection from a bounded pool
  // and starves once enough requests do it at once.
  const leaderNetwork = await networks.networkAsOf(executor, leaderId, at);
  if (leaderNetwork !== network) {
    throw new InvariantViolationError(
      'A pastoral assignment may not cross Networks. This person belongs to the other Network from that leader.',
      { pastoral_leader_id: leaderId, person_network: network, leader_network: leaderNetwork },
    );
  }
}
