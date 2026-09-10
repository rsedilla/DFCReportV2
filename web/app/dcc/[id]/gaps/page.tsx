'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { FailureNotice } from '@/components/ui/failure-notice';
import { getCoverageGaps, notRecordableLabel } from '@/lib/dcc';
import { describeFailure } from '@/lib/messages';
import { dayLabel } from '@/lib/reporting-month';

/**
 * Who still owes a record for one Sunday (SKILL.md sections 9, 13, 14, 15 and 19;
 * decision 0228).
 *
 * **This is the drill-down without which the coverage figure is a dashboard of
 * counts.** Section 19 says a count with nothing to act on tells a leader nothing,
 * and `7 of 8` is exactly that until somebody can see which one is missing.
 *
 * **It is an attention list on section 15's terms, which is what makes naming
 * leaders defensible rather than a leaderboard.** Filtered to the actor's own
 * scope, ordered by name, never by how far behind anybody is, and carrying no
 * grade. Decision 0228 makes the scope the whole of the constraint: the same data
 * shown church-wide and ordered by how many records are missing is the leaderboard
 * section 13 exists to prevent. So there is no sort control here and no count of
 * how many each person owes.
 *
 * **Nothing new is disclosed.** Every roster line already carries its responsible
 * leader, and decision 0194 settles that the DCC roster publishes per-person
 * figures by design. This is the same fact one level up, about people the actor may
 * already see.
 *
 * **A Sunday nobody could have recorded yet has no gaps rather than every leader in
 * it** — a removed Sunday and one whose day has not begun both owe nothing
 * (decision 0229), and an entry no act can resolve is what section 15 says an
 * attention list must never carry.
 */
export default function CoverageGapsPage() {
  return (
    <AppShell>
      <Gaps />
    </AppShell>
  );
}

function Gaps() {
  const params = useParams<{ id: string }>();

  const gaps = useQuery({
    queryKey: ['coverage-gaps', params.id],
    queryFn: ({ signal }) => getCoverageGaps(params.id, signal),
  });

  const event = gaps.data?.event ?? null;

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href="/dcc"
          className="focus-visible:outline-accent text-muted inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to the calendar
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">
        {event ? `Still to record — ${dayLabel(event.event_date)}` : 'Still to record'}
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        The leaders in your scope who owe a record for this Sunday and have not filed one.
        Listed by name; nothing here counts or ranks how far behind anybody is.
      </p>

      <div className="mt-8">
        <FailureNotice failure={gaps.isError ? describeFailure(gaps.error) : null} />
      </div>

      {gaps.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : gaps.data && event ? (
        <>
          {!event.recordable && event.not_recordable_reason ? (
            <p className="border-line mt-6 max-w-2xl rounded-lg border p-4 text-sm leading-relaxed">
              Nobody owes a record for this Sunday: {notRecordableLabel(event.not_recordable_reason)}.
            </p>
          ) : null}

          {gaps.data.data.length === 0 ? (
            <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
              Everyone in your scope who owed a record for this Sunday has filed one.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {gaps.data.data.map((leader) => (
                <li key={leader.person_id} className="border-line rounded-lg border p-4">
                  <h2 className="text-base font-medium">{leader.full_name}</h2>
                  <p className="text-muted mt-1 text-sm">{leader.member_id}</p>
                </li>
              ))}
            </ul>
          )}

          {gaps.data.next_cursor !== null ? (
            <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
              More leaders owe a record than fit one page.
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
