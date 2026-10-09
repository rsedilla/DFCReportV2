'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { RangeNavigator } from '@/components/my-twelve';
import { CONTROL_BAR } from '@/components/ui/frame';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { describeFailure } from '@/lib/messages';
import { monthFromQuery } from '@/lib/reporting-month';
import { getChurchCounts, type ChurchCountFigures, type ChurchCounts } from '@/lib/reports';
import { useScreenAddress } from '@/lib/screen-address';

type Figure = 'CELLS' | 'CELL_LEADERS' | 'PEOPLE';

const COLUMNS: Record<Figure, readonly [keyof ChurchCountFigures, string][]> = {
  CELLS: [
    // Every Cell is Youth, Young Pro or Couple, so the Cell Groups are their total (owner, 2026-10-09).
    ['cell_groups', 'Total'],
    ['youth', 'Youth'],
    ['young_pro', 'Young Pro'],
    ['couple', 'Couple'],
  ],
  CELL_LEADERS: [['cell_leaders', 'Cell Leaders']],
  PEOPLE: [['people', 'People']],
};

const LABEL: Record<Figure, string> = {
  CELLS: 'Number of Cells',
  CELL_LEADERS: 'Number of Cell Leaders',
  PEOPLE: 'Number of people',
};

/**
 * The Senior Pastors' *Number of Cells*, *Number of Cell Leaders* or *Number of people*
 * (decision 0326, point 3).
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
    <section aria-label={LABEL[figure]}>
      {/* The same ‹ › month control as CG and DCC attendance (owner, 2026-10-09), in the same bar. */}
      <div className={`mt-4 ${CONTROL_BAR}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RangeNavigator
            kind="MONTH"
            start={month}
            current={current}
            open={undefined}
            onChange={(value) => go({ month: value })}
          />
          <span className="text-muted text-sm" aria-live="polite">
            {asAt(month, month === current)}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>

      {counts.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          <h2 className="field-label mt-4">Whole Church</h2>
          <dl
            className={
              figure === 'CELLS'
                ? 'mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4'
                : 'mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3'
            }
          >
            {COLUMNS[figure].map(([key, label]) => (
              <div key={key} className="border-line border p-3">
                <dt className="text-ink text-sm font-bold">{label}</dt>
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
  // No count in the heading (owner, 2026-10-09).
  const heading = `${table.root.full_name ?? 'A Network root'}’s leaders`;

  return (
    <div className="mt-6">
      <h3 className="text-base font-bold tracking-tight">{heading}</h3>

      <Table caption={heading} className="mt-2 hidden lg:block">
        <thead>
          <tr>
            <HeaderCell style={{ width: '36%' }}>Leader</HeaderCell>
            {/* The figures share the rest of the row equally (owner, 2026-10-09). */}
            {COLUMNS[figure].map(([key, label]) => (
              <HeaderCell
                key={key}
                className="text-right"
                style={{ width: `${64 / COLUMNS[figure].length}%` }}
              >
                {label}
              </HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            // Every other row shaded, to follow a row across, never numbered (owner, 2026-10-09).
            <tr key={row.leader.id} className={`${rowClasses} even:bg-raised`}>
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
          <li key={row.leader.id} className="border-line even:bg-raised border-b px-2 py-2">
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
