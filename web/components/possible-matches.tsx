'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { MatchLink, MatchNote, OtherBranchMatches } from '@/components/archived-match';

import {
  MINIMUM_SEARCH_LENGTH,
  duplicateCandidates,
  shownOnly,
  type ShownCandidate,
} from '@/lib/people';

/**
 * The value after it has stopped changing for `delay` milliseconds.
 *
 * Written here rather than pulled in: it is eight lines, and the 2026-08-21
 * ruling's whole argument is that this repository owns its primitives.
 */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  const serialised = JSON.stringify(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(JSON.parse(serialised) as T), delay);
    return () => clearTimeout(timer);
  }, [serialised, delay]);

  return settled;
}

/**
 * People who may already be recorded, shown **before** the record is submitted
 * (SKILL.md sections 3 and 9).
 *
 * **This is the surface Tier 2 candidates have and creation does not.** Creation
 * can only ever refuse on Tier 1, so section 3 states the consequence plainly:
 * were candidates surfaced only at the moment of creation, "every Tier 2 match
 * would be computed and discarded". Section 9 makes this the first step of
 * registering a VIP, before a leader types a whole record.
 *
 * **It never blocks, and it asks nothing.** Section 3 forbids blocking creation
 * and asks nothing of the encoder for a Tier 2 match — the acknowledgement
 * requirement is Tier 1's alone, and that arrives as a refusal. This is here to
 * be read.
 *
 * **A withheld candidate is one line naming nobody** (decision 0405): somebody with a
 * similar name is recorded in another branch, and the Admin is asked. Section 8 protects
 * every field the matching rules read, and three rulings record three attempts at
 * redacting this without leaking the same birthday one field further out. The API marks
 * such a candidate itself, and `isWithheld` reads that flag — with a fail-closed
 * fallback for a candidate carrying no tier, which says less rather than more.
 *
 * **On Edit details it leaves out the person being edited** (decision 0396), who would
 * otherwise match their own record, and says "saving" where Add Person says "adding".
 */
export function PossibleMatches({
  firstName,
  lastName,
  birthDate,
  mobileNumber,
  excludeId,
}: {
  firstName: string;
  lastName: string;
  birthDate: string;
  mobileNumber: string;
  /** The person being edited, who is never their own duplicate. */
  excludeId?: string;
}) {
  const headingId = useId();
  const first = firstName.trim();
  const last = lastName.trim();

  /**
   * **Two characters in each name, and a pause, before anything is asked.**
   *
   * The comment this replaces claimed a single letter was avoided and then
   * allowed it: `length > 0` is one character, and the API accepts it. That
   * matters more here than on the search screens, because a one-letter surname
   * makes `findDuplicates` load every surname starting with that letter into
   * memory and score it — twice, once for the subject and once for the
   * publishable run — and there was no debounce, so every keystroke of a surname
   * issued one.
   *
   * The delay is what makes this a lookup rather than a search-as-you-type. It
   * costs the encoder nothing: the panel is advisory and they are still typing.
   */
  const debounced = useDebounced(
    { first, last, birthDate, mobileNumber: mobileNumber.trim() },
    400,
  );
  const ready =
    debounced.first.length >= MINIMUM_SEARCH_LENGTH &&
    debounced.last.length >= MINIMUM_SEARCH_LENGTH;

  const matches = useQuery({
    queryKey: [
      'duplicate-candidates',
      debounced.first,
      debounced.last,
      debounced.birthDate,
      debounced.mobileNumber,
    ],
    queryFn: ({ signal }) =>
      duplicateCandidates(
        {
          first_name: debounced.first,
          last_name: debounced.last,
          birth_date: debounced.birthDate || undefined,
          mobile_number: debounced.mobileNumber || undefined,
        },
        signal,
      ),
    enabled: ready,
  });

  const candidates = matches.data?.data ?? [];
  const shown = shownOnly(candidates).filter((candidate) => candidate.id !== excludeId);
  const withheld = candidates.length - shownOnly(candidates).length > 0;

  if (!ready || matches.isPending || matches.isError || (shown.length === 0 && !withheld)) {
    // Silent when there is nothing to say, and never "nobody matches": a match resting on a
    // birthday or mobile number outside the reader's scope is withheld from them (section 3),
    // so an empty list is not evidence that nobody does. A failed lookup says nothing either.
    return null;
  }

  return (
    <section aria-labelledby={headingId} className="border-line rounded-md border p-4">
      <h2 id={headingId} className="text-sm font-medium">
        Someone similar is already recorded
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Check before {excludeId ? 'saving' : 'adding'}. Recording one person twice splits their
        history in two, and putting the two back together is harder than avoiding it.
      </p>

      {/*
        **Rendered in name order, not the order the API returned.** The API sorts
        candidates by tier, and a withheld candidate's tier is withheld precisely
        because it is derived from which rule fired — so with two withheld
        candidates sharing the submitted names, the one listed first is the one
        whose birthday matched. Position would answer the question the redaction
        exists to refuse, which is the same oracle section 3's three rulings
        closed, one field further out.

        This removes the channel from *this* client. The sort itself is in the
        API and reaches every client, so it is raised separately.
      */}
      <ul className="divide-line mt-3 divide-y">
        {[...shown]
          .sort((a, b) => a.full_name.localeCompare(b.full_name))
          .map((candidate: ShownCandidate) => (
          <li key={candidate.id} className="py-3">
            <p className="text-sm font-medium">{candidate.full_name}</p>
            <p className="text-muted font-mono text-sm">{candidate.member_id}</p>

            <MatchNote candidate={candidate} adding={!excludeId} className="mt-1" />

            <MatchLink candidate={candidate} className="mt-1 text-sm" />
          </li>
        ))}
        <OtherBranchMatches candidates={candidates} adding={!excludeId} itemClassName="py-3" />
      </ul>
    </section>
  );
}
