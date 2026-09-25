'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CountCards, ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { describeFailure } from '@/lib/messages';
import { getConquestCounts } from '@/lib/growth';

/**
 * Conquest under Reports (decision 0292): the Growth tab's four counts, read only and as of
 * now. Each person's goals are under Growth.
 */
export default function Page() {
  return (
    <AppShell>
      <Conquest />
    </AppShell>
  );
}

function Conquest() {
  const counts = useQuery({
    queryKey: ['conquest-counts'],
    queryFn: ({ signal }) => getConquestCounts(signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading
        line={`The four goals for ${counts.data ? `the ${counts.data.people} ${counts.data.people === 1 ? 'person' : 'people'}` : 'the people'} in your care, as of today.`}
      />
      <ReportsTabs current="conquest" />
      <div className="mt-6">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>
      <CountCards
        cards={[
          { label: 'Win 3', count: counts.data?.win_3 },
          { label: 'Open a cell', count: counts.data?.open_a_cell },
          { label: 'Completion of 12', count: counts.data?.completion_of_12 },
          { label: 'Raise 12 leaders', count: counts.data?.raise_12_leaders },
        ]}
      />
      <p className="mt-6 text-sm">
        <Link href="/growth/conquest" className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">
          See each person in Growth
        </Link>
      </p>
    </main>
  );
}
