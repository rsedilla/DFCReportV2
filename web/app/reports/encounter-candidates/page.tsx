'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { describeFailure } from '@/lib/messages';
import { getEncounterCandidates, type EncounterCandidates } from '@/lib/reports';

/**
 * The Senior Pastors' *Encounter candidates* (SKILL.md sections 19 and 28, decision 0326): one
 * total, as of today, of current people with four or more SUYNL lessons who have not yet been
 * to the Encounter or graduated Life Class, then each root's direct leaders with theirs, then
 * *Others*. A count only: it refuses nobody (section 28).
 */
export default function EncounterCandidatesPage() {
  return (
    <AppShell>
      <Candidates />
    </AppShell>
  );
}

function Candidates() {
  const candidates = useQuery({
    queryKey: ['encounter-candidates'],
    queryFn: ({ signal }) => getEncounterCandidates(signal),
  });
  const data = candidates.data;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="Who is ready to be brought to the Encounter, as of today." />
      <ReportsTabs current="encounter-candidates">
        <div className="mt-4">
          <FailureNotice failure={candidates.isError ? describeFailure(candidates.error) : null} />
        </div>

        {candidates.isPending ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : data ? (
          <>
            <div className="border-line mt-4 max-w-sm border p-3">
              <span className="text-muted block text-sm">Encounter candidates · Whole Church</span>
              <span className="mt-1 block text-xl font-bold tabular-nums">
                {data.total.toLocaleString()}
              </span>
              <span className="text-muted mt-1 block text-xs">
                4 or more SUYNL lessons, not yet at the Encounter · as of today
              </span>
            </div>

            {data.tables.map((table) => (
              <CandidateTable key={table.root.id} table={table} />
            ))}

            <div className="mt-6">
              <h3 className="text-base font-bold tracking-tight">Others</h3>
              <p className="text-muted mt-1 max-w-2xl text-sm">
                The two Network roots, and anyone in neither table.
              </p>
              <p className="mt-2 text-sm tabular-nums">Encounter candidates {data.others}</p>
            </div>
          </>
        ) : null}
      </ReportsTabs>
    </main>
  );
}

function CandidateTable({ table }: { table: EncounterCandidates['tables'][number] }) {
  const heading = `${table.root.full_name ?? 'A Network root'}’s ${table.rows.length} ${
    table.rows.length === 1 ? 'leader' : 'leaders'
  }`;

  return (
    <div className="mt-6">
      <h3 className="text-base font-bold tracking-tight">{heading}</h3>
      <Table caption={heading} className="mt-2">
        <thead>
          <tr>
            <HeaderCell>Leader</HeaderCell>
            <HeaderCell className="text-right">Encounter candidates</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.leader.id} className={rowClasses}>
              <td className="px-3 py-3">
                <Link
                  href={`/network?focus=${row.leader.id}`}
                  className="focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {row.leader.full_name ?? row.leader.member_id ?? 'A leader'}
                </Link>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{row.candidates}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
