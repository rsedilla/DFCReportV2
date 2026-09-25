'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CountCards, ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { describeFailure } from '@/lib/messages';
import { getTrainingCounts } from '@/lib/growth';

/**
 * Training under Reports (decision 0292): the Growth tab's six counts, read only and as of
 * now, with the sentence section 28 requires. Graduations are recorded under Growth.
 */
export default function Page() {
  return (
    <AppShell>
      <Training />
    </AppShell>
  );
}

function Training() {
  const counts = useQuery({
    queryKey: ['training-counts'],
    queryFn: ({ signal }) => getTrainingCounts(signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading
        line={`Training for ${counts.data ? `the ${counts.data.people} ${counts.data.people === 1 ? 'person' : 'people'}` : 'the people'} in your care, as of today.`}
      />
      <ReportsTabs current="training" />
      <div className="mt-6">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>
      <CountCards
        cards={[
          { label: 'Encounter', count: counts.data?.encounter },
          { label: 'Life Class', count: counts.data?.life_class },
          { label: 'SOL 1', count: counts.data?.sol_1 },
          { label: 'SOL 2', count: counts.data?.sol_2 },
          { label: 'SOL 3', count: counts.data?.sol_3 },
          { label: 'None yet', count: counts.data?.not_started },
        ]}
      />
      <p className="text-muted mt-4 text-sm">
        A count of graduations in a period counts only the dated ones.
      </p>
      <p className="mt-6 text-sm">
        <Link href="/growth/training" className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">
          Record graduations in Growth
        </Link>
      </p>
    </main>
  );
}
