import type { ScopeMembership } from '../auth/authorization/authorization.service';
import type { Capability } from '../auth/authorization/capabilities';
import { NotFoundError, ScopeDeniedError } from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import type { Db } from '../database/database.module';
import type { HierarchyService } from '../hierarchy/hierarchy.service';
import type { PeopleReadService } from '../people/people.read.service';

/**
 * The people a Pending list keeps under `?leader_id=` (decision 0370): that leader and everyone
 * beneath them in the tree now, within the reader's own scope, so the filter narrows and never
 * widens. Opened from a Recording Progress row.
 *
 * **Scope first, then existence, as a report's scope selector** (decision 0253): a leader
 * outside the reader's scope is refused `SCOPE_DENIED` whether or not they exist, and one
 * inside it who names nobody, a Person absorbed by a merge included, is answered `NOT_FOUND`,
 * as the report routes answer it.
 */
export async function pendingBranch(
  db: Db,
  hierarchy: HierarchyService,
  people: PeopleReadService,
  view: ScopeMembership,
  capability: Capability,
  leaderId: string,
): Promise<Set<string>> {
  const leader = canonicalId(leaderId);
  const inScope =
    view.kind === 'WHOLE_CHURCH' || [...view.personIds].some((id) => canonicalId(id) === leader);

  if (!inScope) {
    throw new ScopeDeniedError(
      'That leader is outside your authorized scope, so their branch cannot be listed.',
      { capability, field: 'leader_id' },
    );
  }

  if ((await people.findById(leaderId)) === null) {
    throw new NotFoundError('No such person.', { field: 'leader_id' });
  }

  const branch = (await hierarchy.subtreeOf(db, leaderId)).map((id) => canonicalId(id));
  if (view.kind === 'WHOLE_CHURCH') {
    return new Set(branch);
  }

  const covered = new Set([...view.personIds].map((id) => canonicalId(id)));
  return new Set(branch.filter((id) => covered.has(id)));
}
