'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import {
  MINIMUM_SEARCH_LENGTH,
  duplicateCandidates,
  isWithheld,
  type DuplicateCandidate,
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
 * **A withheld candidate says only that they are a possible match**, because
 * section 8 protects every field the matching rules read and three rulings
 * record three attempts at redacting this without leaking the same birthday one
 * field further out. The API marks such a candidate itself, and `isWithheld`
 * reads that flag — with a fail-closed fallback for a candidate carrying no
 * tier, which says less rather than more.
 */
export function PossibleMatches({
  firstName,
  lastName,
  birthDate,
  mobileNumber,
}: {
  firstName: string;
  lastName: string;
  birthDate: string;
  mobileNumber: string;
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

  if (!ready || matches.isPending || matches.isError || matches.data.data.length === 0) {
    // Silent when there is nothing to say. A panel reading "no possible matches"
    // on every record adds a line to dismiss and nothing to decide — and a
    // failed lookup must not imply there are none, so it says nothing either.
    return null;
  }

  return (
    <section aria-labelledby={headingId} className="border-line rounded-md border p-4">
      <h2 id={headingId} className="text-sm font-medium">
        Someone similar is already recorded
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Check before adding. Recording one person twice splits their history in two, and putting
        the two back together is harder than avoiding it.
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
        {[...matches.data.data]
          .sort((a, b) => a.full_name.localeCompare(b.full_name))
          .map((candidate: DuplicateCandidate) => (
          <li key={candidate.id} className="py-3">
            <p className="text-sm font-medium">{candidate.full_name}</p>
            <p className="text-muted font-mono text-sm">{candidate.member_id}</p>

            {isWithheld(candidate) ? (
              <p className="text-muted mt-1 text-sm leading-relaxed">
                A possible match. Their details are visible to the leaders who pastor them.
              </p>
            ) : candidate.reasons?.length ? (
              <ul className="text-muted mt-1 list-inside list-disc text-sm">
                {candidate.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}

            <Link
              href={`/people/${candidate.id}`}
              className="text-accent focus-visible:outline-accent mt-1 inline-flex min-h-11 items-center rounded-md text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Open this record
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
