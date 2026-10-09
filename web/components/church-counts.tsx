'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { describeFailure } from '@/lib/messages';
import { rangeLabel, shiftRange } from '@/lib/report-range';
import { monthFromQuery } from '@/lib/reporting-month';
import { getChurchCounts, type ChurchCountFigures, type ChurchCounts } from '@/lib/reports';
import { useScreenAddress } from '@/lib/screen-address';

type Figure = 'CELLS' | 'PEOPLE';

const COLUMNS: Record<Figure, readonly [keyof ChurchCountFigures, string][]> = {
  CELLS: [
    ['cell_groups', 'Cell Groups'],
    ['youth', 'Youth'],
    ['young_pro', 'Young Pro'],
    ['couple', 'Couple'],
    ['cell_leaders', 'Cell Leaders'],
  ],
  PEOPLE: [['people', 'People']],
};

/**
 * The Senior Pastors' *Number of Cells* or *Number of people* (decision 0326, point 3).
 *
 * **A month at a time, with previous and next**: a month that has ended is counted on its last
 * day, and the current month as of now, *so far*. The whole church first, then one table for
 * each root's direct leaders, the Men's root first, then *Others*, so the rows and *Others*
 * add up to the whole church. Rows are in surname order, never sorted by a figure, never
 * numbered or coloured (sections 13 and 17); each name opens that leader's branch.
 */
export function ChurchCountsPanel({
  figure,
  month: asked,
}: {
  figure: Figure;
  /** The month in the address, as the first of it. */
  month: string | null;
}) {
  const go = useScreenAddress();
  const current = monthFromQuery(null);
  // A month that has not begun is not reported (decision 0216); the address opens this one.
  const month = monthFromQuery(asked);

  const counts = useQuery({
    queryKey: ['church-counts', month],
    queryFn: ({ signal }) => getChurchCounts(month, signal),
  });
  const data = counts.data;

  return (
    <section aria-label={figure === 'CELLS' ? 'Number of Cells' : 'Number of people'}>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => go({ month: shiftRange('MONTH', month, -1) })}>
          Previous month
        </Button>
        <p className="text-sm font-bold" aria-live="polite">
          {rangeLabel('MONTH', month)}
          <span className="text-muted font-normal"> · {asAt(month, month === current)}</span>
        </p>
        <Button
          variant="secondary"
          disabled={month === current}
          onClick={() => go({ month: shiftRange('MONTH', month, 1) })}
        >
          Next month
        </Button>
      </div>

      <div className="mt-4">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>

      {counts.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          <dl
            className={
              figure === 'CELLS'
                ? 'mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'
                : 'mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3'
            }
          >
            {COLUMNS[figure].map(([key, label]) => (
              <div key={key} className="border-line border p-3">
                <dt className="text-muted text-sm">{label} · Whole Church</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">
                  {data.whole_church[key].toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>

          {data.tables === null ? (
            <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
              The leaders&rsquo; tables cannot be shown for this month: the pastoral tree it
              resolves holds a fault that needs repair. The whole church&rsquo;s figures above
              stand.
            </p>
          ) : (
            <>
              {data.tables.map((table) => (
                <CountTable key={table.root.id} figure={figure} table={table} />
              ))}
              {data.others ? <OthersLine figure={figure} others={data.others} /> : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

/** The month's instant, in words: *as at today, so far* or *as at 31 October 2026*. */
function asAt(month: string, current: boolean): string {
  if (current) {
    return 'as at today, so far';
  }
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0));

  return `as at ${last.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

function CountTable({
  figure,
  table,
}: {
  figure: Figure;
  table: NonNullable<ChurchCounts['tables']>[number];
}) {
  const heading = `${table.root.full_name ?? 'A Network root'}’s ${table.rows.length} ${
    table.rows.length === 1 ? 'leader' : 'leaders'
  }`;

  return (
    <div className="mt-6">
      <h3 className="text-base font-bold tracking-tight">{heading}</h3>

      <Table caption={heading} className="mt-2 hidden lg:block">
        <thead>
          <tr>
            <HeaderCell>Leader</HeaderCell>
            {COLUMNS[figure].map(([key, label]) => (
              <HeaderCell key={key} className="text-right">
                {label}
              </HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.leader.id} className={rowClasses}>
              <td className="px-3 py-3">
                <BranchLink leader={row.leader} />
              </td>
              {COLUMNS[figure].map(([key]) => (
                <td key={key} className="px-3 py-3 text-right tabular-nums">
                  {row[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>

      {/* On a phone each leader is two short lines (owner, 2026-10-08). */}
      <ul className="mt-2 flex flex-col lg:hidden">
        {table.rows.map((row) => (
          <li key={row.leader.id} className="border-line border-b py-2">
            <BranchLink leader={row.leader} />
            <p className="text-muted text-sm tabular-nums">
              {COLUMNS[figure].map(([key, label]) => `${label} ${row[key]}`).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OthersLine({ figure, others }: { figure: Figure; others: ChurchCountFigures }) {
  return (
    <div className="mt-6">
      <h3 className="text-base font-bold tracking-tight">Others</h3>
      <p className="text-muted mt-1 max-w-2xl text-sm">
        The two Network roots, and anyone in neither table.
      </p>
      <p className="mt-2 text-sm tabular-nums">
        {COLUMNS[figure].map(([key, label]) => `${label} ${others[key]}`).join(' · ')}
      </p>
    </div>
  );
}

function BranchLink({
  leader,
}: {
  leader: { id: string; member_id: string | null; full_name: string | null };
}) {
  return (
    <Link
      href={`/network?focus=${leader.id}`}
      className="focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {leader.full_name ?? leader.member_id ?? 'A leader'}
    </Link>
  );
}
