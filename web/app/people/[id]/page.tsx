'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { describeFailure } from '@/lib/messages';
import { ageFrom, civilStatusLabel, getPerson, sexLabel } from '@/lib/people';
import { cn } from '@/lib/utils';

/**
 * One person's record (SKILL.md sections 3 and 8).
 *
 * **Reaching this screen for somebody outside your pastoral scope is a refusal,
 * not a redaction.** `GET /people/{id}` is guarded on the target, so the API
 * answers `NOT_FOUND` — section 8's search returns an identity-only row for such
 * a person, and this endpoint returns nothing at all. The screen therefore says
 * the record is not available *to you* rather than that it does not exist, which
 * is what search has already shown the viewer to be false.
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
          <FailureNotice
            failure={describeFailure(person.error)}
          />
          <p className="text-muted mt-4 max-w-xl text-sm leading-relaxed">
            If you found this person by searching, their record exists — their details are
            visible to the leaders who pastor them. Ask the leader named on the search result.
          </p>
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
              value={
                ageFrom(person.data.birth_date) === null
                  ? null
                  : `${ageFrom(person.data.birth_date)}`
              }
              absent="Needs a birthday"
            />
            <Detail label="Mobile number" value={person.data.mobile_number} absent="Not recorded" />
          </dl>
        </>
      )}
    </main>
  );
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
