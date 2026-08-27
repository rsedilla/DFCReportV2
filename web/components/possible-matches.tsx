'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { duplicateCandidates, isWithheld, type DuplicateCandidate } from '@/lib/people';

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
 * field further out. The API marks such a candidate itself; this does not infer
 * it from a missing tier.
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
  const first = firstName.trim();
  const last = lastName.trim();

  // Both names, because the API needs them and because asking on a single
  // letter would search the directory on every keystroke of a surname.
  const ready = first.length > 0 && last.length > 0;

  const matches = useQuery({
    queryKey: ['duplicate-candidates', first, last, birthDate, mobileNumber.trim()],
    queryFn: ({ signal }) =>
      duplicateCandidates(
        {
          first_name: first,
          last_name: last,
          birth_date: birthDate || undefined,
          mobile_number: mobileNumber.trim() || undefined,
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
    <section aria-labelledby="possible-matches" className="border-line rounded-md border p-4">
      <h2 id="possible-matches" className="text-sm font-medium">
        Someone similar is already recorded
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Check before adding. Recording one person twice splits their history in two, and putting
        the two back together is harder than avoiding it.
      </p>

      <ul className="divide-line mt-3 divide-y">
        {matches.data.data.map((candidate: DuplicateCandidate) => (
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
