import { ApiError, ApiErrorCode } from '../errors/api-error';
import { isUniqueViolation, violatedConstraint } from '../errors/postgres-errors';
import { canonicalId } from '../identifiers';

import { filingFor, type FilerOf, type Filing, type FilingCapabilities } from './growth-filing';

import type { ActorAuthority } from '../../auth/authorization/authorization.service';
import type { Actor } from '../../auth/authorization/authorization.service';
import type { Db } from '../../database/database.module';
import type { PersonForDecision } from '../../people/people.read.service';

/**
 * What the SUYNL and Training saves share (SKILL.md sections 14, 22 and 28; decisions 0279,
 * 0280 and 0282). Each keeps its own rules: what a line means, when it needs a reason, and
 * how its conflict reads. Until 2026-10-14 these were written out in both.
 */

/** The identifiers once each, compared canonically, in the order first named. */
export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Map(ids.map((id) => [canonicalId(id), id])).values()];
}

/** Whether the actor is withdrawing somebody else's statement (section 14). */
export function onBehalfOf(confirmedBy: string | null, actorPersonId: string): boolean {
  return confirmedBy !== null && canonicalId(confirmedBy) !== canonicalId(actorPersonId);
}

/**
 * Whether the row a line was made against is still the current one (decision 0282): both
 * absent, or the same row. A line that disagrees is stale and is answered with a conflict.
 */
export function seenIsCurrent(
  seenId: string | null | undefined,
  currentId: string | null,
): boolean {
  const seen = seenId ?? null;
  return (
    (seen === null ? null : canonicalId(seen)) ===
    (currentId === null ? null : canonicalId(currentId))
  );
}

/**
 * Who each person's row is filed for, decided for every person before anything is written,
 * so a save is all or nothing; the first refusal in the order the client sent is the one
 * thrown.
 */
export async function filingsFor(
  deps: Parameters<typeof filingFor>[0],
  trx: Db,
  actor: Actor,
  authority: ActorAuthority,
  capabilities: FilingCapabilities,
  personIds: readonly string[],
  identities: ReadonlyMap<string, PersonForDecision>,
  assignments: ReadonlyMap<string, { leaderId: string | null }>,
  filerOf?: FilerOf,
): Promise<Map<string, Filing>> {
  const filings = new Map<string, Filing>();

  for (const personId of personIds) {
    const key = canonicalId(personId);
    if (filings.has(key)) {
      continue;
    }

    const filing = await filingFor(
      deps,
      trx,
      actor,
      authority,
      capabilities,
      personId,
      identities.get(personId),
      assignments.get(personId),
      undefined,
      filerOf,
    );

    if (filing instanceof Error) {
      throw filing;
    }

    filings.set(key, filing);
  }

  return filings;
}

/**
 * A save that lost a race on a first record (section 22, *Write conflicts*): re-read what is
 * now committed and answer on it — a conflict where a line now disagrees, otherwise
 * `RESOURCE_BUSY`, since the identical body resubmitted writes nothing. Any other error is
 * thrown as it came.
 */
export async function answerLostRace<Change, Stored>(
  error: unknown,
  oneCurrentIndex: string,
  changes: readonly Change[],
  reread: () => Promise<Stored>,
  isStale: (change: Change, stored: Stored) => boolean,
  conflictFor: (change: Change, stored: Stored) => Promise<ApiError>,
  busyMessage: string,
): Promise<never> {
  if (!isUniqueViolation(error) || violatedConstraint(error) !== oneCurrentIndex) {
    throw error;
  }

  const stored = await reread();
  const stale = changes.find((change) => isStale(change, stored));

  if (stale !== undefined) {
    throw await conflictFor(stale, stored);
  }

  throw new ApiError(ApiErrorCode.RESOURCE_BUSY, busyMessage, {});
}
