import {
  type Actor,
  type ActorAuthority,
  type AuthorizationService,
} from '../../auth/authorization/authorization.service';
import { type Capability } from '../../auth/authorization/capabilities';
import { ScopeType } from '../../auth/authorization/scopes';
import {
  type ApiError,
  CapabilityDeniedError,
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
} from '../errors/api-error';
import { sameId } from '../identifiers';

import type { Db } from '../../database/database.module';
import type { HierarchyService } from '../../hierarchy/hierarchy.service';
import type { PersonForDecision } from '../../people/people.read.service';

/** The two filing capabilities of one Growth module (SKILL.md sections 27 and 28). */
export interface FilingCapabilities {
  confirm: Capability;
  onBehalf: Capability;
}

/** Who a row filed for this person names, once the actor may file it. */
export interface Filing {
  /** The person's pastoral leader now; null only for a Network root. */
  confirmedBy: string | null;
  /** Filed for a downline leader's disciple (Section 14). */
  onBehalf: boolean;
}

/**
 * Whether this actor may file a Growth record about this person, and whose statement it
 * is (SKILL.md sections 27 and 28; decisions 0279 and 0280).
 *
 * Returns the refusal rather than throwing it, so a list can ask the same question per
 * row that a write asks and answer with a flag.
 *
 * **Ordered as DCC recording is**: existence, then scope, and only then anything about
 * the person that section 8 withholds outside it. The confirming leader is the
 * person's pastoral leader now, as a DCC record's responsible leader is theirs.
 */
export async function filingFor(
  deps: { authorization: AuthorizationService },
  executor: Db,
  actor: Actor,
  authority: ActorAuthority,
  capabilities: FilingCapabilities,
  personId: string,
  identity: PersonForDecision | undefined,
  assignment: { leaderId: string | null } | undefined,
): Promise<Filing | ApiError> {
  if (identity === undefined) {
    return new NotFoundError('No such person.', { person_id: personId });
  }

  const covers = (capability: Capability): Promise<boolean> =>
    deps.authorization.coversWith(executor, actor, authority, capability, {
      kind: 'person',
      personId,
    });

  if (!(await covers(capabilities.confirm)) && !(await covers(capabilities.onBehalf))) {
    return denied(authority, capabilities.confirm, personId);
  }

  // Decision 0280: nobody files or corrects a record about themselves, whatever
  // their grant. `SCOPE_DENIED`, as section 22 answers section 5's prohibition on
  // acting on oneself.
  if (sameId(personId, actor.personId)) {
    return new ScopeDeniedError('Nobody files their own Growth records (decision 0280).', {
      person_id: personId,
    });
  }

  if (identity.isArchived) {
    return new InvariantViolationError(
      'This person is archived. Restore them before recording anything for them.',
      { person_id: personId },
    );
  }

  if (identity.mergedIntoId !== null) {
    return new InvariantViolationError(
      'This Person record was merged into another. Record against the surviving record.',
      { person_id: personId, merged_into_id: identity.mergedIntoId },
    );
  }

  if (assignment === undefined) {
    return new InvariantViolationError(
      'This person has no pastoral leader, so there is nobody whose statement this would be.',
      { person_id: personId },
    );
  }

  // A Network root is nobody's direct disciple and nobody's downline, so neither
  // capability reaches them through the tree; a Whole Church grant of the confirming
  // one does (sections 27 and 28).
  if (assignment.leaderId === null) {
    return holdsWholeChurch(authority, capabilities.confirm)
      ? { confirmedBy: null, onBehalf: false }
      : denied(authority, capabilities.confirm, personId);
  }

  if (sameId(assignment.leaderId, actor.personId)) {
    return (await covers(capabilities.confirm))
      ? { confirmedBy: assignment.leaderId, onBehalf: false }
      : denied(authority, capabilities.confirm, personId);
  }

  return (await covers(capabilities.onBehalf))
    ? { confirmedBy: assignment.leaderId, onBehalf: true }
    : denied(authority, capabilities.onBehalf, personId);
}

/** {@link filingFor} for a set of people read in one pass, as a list row needs it. */
export async function mayFileEach(
  deps: { authorization: AuthorizationService; hierarchy: HierarchyService },
  executor: Db,
  actor: Actor,
  authority: ActorAuthority,
  capabilities: FilingCapabilities,
  people: readonly PersonForDecision[],
  now: Date,
): Promise<Set<string>> {
  const assignments = await deps.hierarchy.assignmentsAsOf(
    executor,
    people.map((person) => person.id),
    now,
  );
  const allowed = new Set<string>();

  for (const person of people) {
    const filing = await filingFor(
      deps,
      executor,
      actor,
      authority,
      capabilities,
      person.id,
      person,
      assignments.get(person.id),
    );

    if (!(filing instanceof Error)) {
      allowed.add(person.id);
    }
  }

  return allowed;
}

function denied(authority: ActorAuthority, capability: Capability, personId: string): ApiError {
  const held = authority.grants.some((grant) => grant.capability === capability);

  return held
    ? new ScopeDeniedError('This person is outside your scope.', {
        capability,
        person_id: personId,
      })
    : new CapabilityDeniedError(`You do not hold ${capability}.`, { capability });
}

function holdsWholeChurch(authority: ActorAuthority, capability: Capability): boolean {
  return authority.grants.some(
    (grant) => grant.capability === capability && grant.scope.type === ScopeType.WholeChurch,
  );
}
