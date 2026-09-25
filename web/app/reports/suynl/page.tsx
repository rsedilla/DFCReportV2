'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CountCards, ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { describeFailure } from '@/lib/messages';
import { getSuynlCounts } from '@/lib/growth';

/**
 * SUYNL under Reports (decision 0292): the Growth tab's three counts, read only and as of
 * now, from the same route under the same capability. Lessons are ticked under Growth.
 */
export default function Page() {
  return (
    <AppShell>
      <Suynl />
    </AppShell>
  );
}

function Suynl() {
  const counts = useQuery({ queryKey: ['suynl-counts'], queryFn: ({ signal }) => getSuynlCounts(signal) });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading
        line={`SUYNL for ${counts.data ? `the ${counts.data.people} ${counts.data.people === 1 ? 'person' : 'people'}` : 'the people'} in your care, as of today.`}
      />
      <ReportsTabs current="suynl" />
      <div className="mt-6">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>
      <CountCards
        cards={[
          { label: 'Not started', count: counts.data?.not_started },
          { label: 'In progress', count: counts.data?.in_progress },
          { label: 'Graduated', count: counts.data?.graduated },
        ]}
      />
      <p className="mt-6 text-sm">
        <Link href="/growth/suynl" className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">
          Tick lessons in Growth
        </Link>
      </p>
    </main>
  );
}
