import {
  type Actor,
  type AuthorizationService,
} from '../../auth/authorization/authorization.service';
import { type Capability } from '../../auth/authorization/capabilities';
import { unresolvableCursor } from '../cursor';
import { ValidationFailedError } from '../errors/api-error';
import { canonicalId, isUuid } from '../identifiers';
import { isStorableText } from '../text/storable-text';
import { normalizeName } from '../../people/duplicate-matching';
import { SEARCH_MINIMUM } from '../../people/dto/people.dto';

import type { Db } from '../../database/database.module';
import type { HierarchyService } from '../../hierarchy/hierarchy.service';
import type { PeopleReadService } from '../../people/people.read.service';
import type { PersonRecord, SearchCursor } from '../../people/people.shared';

/** What a Growth tab's list is asked for (SKILL.md section 28). */
export interface GrowthListQuery {
  q?: string;
  /** Only the actor's own direct disciples. */
  mine?: boolean;
  cursor?: string;
  limit?: number;
}

/**
 * Who a Growth tab lists: every current Person the actor's viewing grant reaches, as
 * things stand now (decisions 0278 and 0279), in name order. `null` is the whole
 * church, which is never enumerated.
 */
export async function growthPopulation(
  deps: { authorization: AuthorizationService },
  actor: Actor,
  viewCapability: Capability,
): Promise<ReadonlySet<string> | null> {
  const membership = await deps.authorization.scopeMembership(actor, viewCapability);
  return membership.kind === 'WHOLE_CHURCH' ? null : membership.personIds;
}

/**
 * One page of a Growth tab's list, narrowed by a count card where one is chosen
 * (decision 0281): `include` keeps only those people, `exclude` leaves them out.
 */
export async function growthPage(
  deps: { people: PeopleReadService; hierarchy: HierarchyService },
  executor: Db,
  actor: Actor,
  population: ReadonlySet<string> | null,
  query: GrowthListQuery,
  narrowing: { include?: ReadonlySet<string>; exclude?: ReadonlySet<string> },
  now: Date,
): Promise<{ rows: PersonRecord[]; nextCursor: string | null }> {
  if (query.q !== undefined && normalizeName(query.q).replace(/\s+/g, '').length < SEARCH_MINIMUM) {
    throw new ValidationFailedError('Enter at least two letters of a name.', { field: 'q' });
  }

  let restrictTo = population;

  if (query.mine === true) {
    restrictTo = intersect(
      restrictTo,
      new Set(
        (await deps.hierarchy.directChildrenAsOf(executor, actor.personId, now)).map(canonicalId),
      ),
    );
  }

  if (narrowing.include !== undefined) {
    restrictTo = intersect(restrictTo, narrowing.include);
  }

  const { rows, nextCursor } = await deps.people.searchByName(
    query.q ?? null,
    query.limit ?? 50,
    decodeCursor(query.cursor),
    restrictTo,
    { memberId: true, currentOnly: true, exclude: narrowing.exclude },
  );

  return { rows, nextCursor: encodeCursor(nextCursor) };
}

function intersect(
  left: ReadonlySet<string> | null,
  right: ReadonlySet<string>,
): ReadonlySet<string> {
  if (left === null) {
    return right;
  }

  const canonicalRight = new Set([...right].map(canonicalId));
  return new Set([...left].filter((id) => canonicalRight.has(canonicalId(id))));
}

function decodeCursor(value: string | undefined): SearchCursor | null {
  if (value === undefined || value === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      isStorableText((parsed as SearchCursor).lastName) &&
      isStorableText((parsed as SearchCursor).firstName) &&
      typeof (parsed as SearchCursor).id === 'string' &&
      isUuid((parsed as SearchCursor).id)
    ) {
      return parsed as SearchCursor;
    }
  } catch {
    // An unreadable value and a value of the wrong shape are refused alike, below.
  }

  throw unresolvableCursor();
}

function encodeCursor(cursor: SearchCursor | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
