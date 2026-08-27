'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { ApiRequestError } from '@/lib/api-client';
import { describeFailure } from '@/lib/messages';
import { NEGATIVE_AGE, ageFrom, civilStatusLabel, getPerson, sexLabel } from '@/lib/people';
import { cn } from '@/lib/utils';

/**
 * One person's record (SKILL.md sections 3 and 8).
 *
 * **Reaching this screen for somebody outside your pastoral scope is a refusal,
 * not a redaction, and the code is `SCOPE_DENIED`.** `GET /people/{id}` is
 * guarded on the target, so the guard refuses with 403 — deliberately *not*
 * `NOT_FOUND`, which section 22 declines to substitute here "because Section 8
 * already discloses minimal identity church-wide by design". Search has already
 * shown this viewer that the person exists; pretending otherwise on the next
 * screen would contradict it.
 *
 * So the explanation below is shown for that code and no other. Rendering it on
 * every failure asserted a domain fact for a mistyped id, a merged-away record,
 * a server error and a dropped connection alike — and it is false of all four.
 *
 * **Age is derived here and never stored.** Section 3 keeps the birthday as the
 * authoritative value precisely because it cannot go stale, and the API returns
 * no age at all — a client that wants one computes it.
 *
 * **A missing birthday is ordinary and is shown as such.** The 2026-08-24 ruling
 * made it optional, and gave the reason: a mandatory field people cannot fill
 * gets filled with fictions, and a fabricated date is worse than none because two
 * of the three Tier 1 duplicate rules read it — so an invented birthday makes the
 * matcher refuse a real person. Somebody may also simply have declined to give
 * it, which is a decision rather than a gap, so nothing here nags.
 */
export default function PersonPage() {
  return (
    <AppShell>
      <PersonDetail />
    </AppShell>
  );
}

function PersonDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const person = useQuery({
    queryKey: ['person', id],
    queryFn: ({ signal }) => getPerson(id, signal),
  });

  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
      <p className="text-sm">
        <Link
          href="/people"
          className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to people
        </Link>
      </p>

      {person.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading…</p>
      ) : person.isError ? (
        <div className="mt-6">
          <FailureNotice failure={describeFailure(person.error)} />

          {person.error instanceof ApiRequestError && person.error.code === 'SCOPE_DENIED' ? (
            <p className="text-muted mt-4 max-w-xl text-sm leading-relaxed">
              This person&rsquo;s record exists — their details are visible to the leaders who
              pastor them. Ask the leader named on the search result.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">{person.data.full_name}</h1>
          <p className="text-muted mt-1 font-mono text-sm">{person.data.member_id}</p>

          <div className="mt-6">
            <Link href={`/people/${id}/edit`} className={cn(buttonClasses('secondary'))}>
              Edit details
            </Link>
          </div>

          <dl className="border-line mt-8 grid gap-x-6 gap-y-4 border-t pt-6 sm:grid-cols-[12rem_1fr]">
            <Detail label="First name" value={person.data.first_name} />
            <Detail label="Middle name" value={person.data.middle_name} />
            <Detail label="Last name" value={person.data.last_name} />
            <Detail label="Sex" value={sexLabel(person.data.sex)} />
            <Detail label="Civil status" value={civilStatusLabel(person.data.civil_status)} />
            <Detail
              label="Birthday"
              value={person.data.birth_date}
              // Not "unknown" and not "missing": section 3 permits no birthday,
              // and somebody may have chosen not to give one.
              absent="Not recorded"
            />
            <Detail
              label="Age"
              value={ageLabel(person.data.birth_date)}
              // Only where no birthday is recorded. A birthday that *is*
              // recorded but cannot yield an age says so instead — see
              // `ageLabel` — because "needs a birthday" beside a displayed
              // birthday contradicts the line above it.
              absent="Needs a birthday"
            />
            <Detail label="Mobile number" value={person.data.mobile_number} absent="Not recorded" />
          </dl>
        </>
      )}
    </main>
  );
}

/**
 * The age, or why there is not one.
 *
 * Three outcomes rather than two: an age, no birthday at all, and a birthday
 * that cannot produce an age because it is in the future. The third is a
 * mis-keyed year, and calling it "needs a birthday" beside the date it was
 * derived from tells the reader something the record disproves.
 */
function ageLabel(birthDate: string | null): string | null {
  const age = ageFrom(birthDate);

  if (age === null) {
    return null;
  }

  return age === NEGATIVE_AGE ? 'Birthday is in the future — check the year' : `${age}`;
}

function Detail({
  label,
  value,
  absent = '—',
}: {
  label: string;
  value: string | null;
  absent?: string;
}) {
  return (
    <>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className={value ? 'text-sm' : 'text-muted text-sm'}>{value || absent}</dd>
    </>
  );
}
