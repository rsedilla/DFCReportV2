'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { getPerson } from '@/lib/people';

const LINK =
  'focus-visible:outline-accent text-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * Says whose report this is when a leader was opened from the By leader table (decision
 * 0254), with a way back to the reader's own. The report itself is authorized by the API;
 * the name here is courtesy, and a reader refused it sees "one leader" instead.
 */
export function LeaderDrill({
  personId,
  report,
  month,
}: {
  personId: string;
  report: 'dcc' | 'cells';
  month: string;
}) {
  const person = useQuery({
    queryKey: ['person', personId],
    queryFn: ({ signal }) => getPerson(personId, signal),
    retry: false,
  });

  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span>
        Figures for <span className="font-semibold">{person.data?.full_name ?? 'one leader'}</span>{' '}
        and everyone beneath them.
      </span>
      <Link
        href={`/reports/${report}?${new URLSearchParams({ month }).toString()}`}
        className={LINK}
      >
        Back to your report
      </Link>
    </p>
  );
}
