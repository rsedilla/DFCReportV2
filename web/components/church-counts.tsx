'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  FIGURE_CELL,
  FIGURE_HEAD,
  NAME_CELL,
  NAME_HEAD,
  RangeNavigator,
} from '@/components/my-twelve';
import { CountsSwitch, ReportViewSwitch, type ReportTab } from '@/components/reports-tabs';
import { CONTROL_BAR } from '@/components/ui/frame';
import { ViewSwitch } from '@/components/ui/view-switch';
import { getMe } from '@/lib/me';
import { KeptFigures } from '@/components/kept-figures';
import { FailureNotice } from '@/components/ui/failure-notice';
import { ShortText } from '@/components/ui/short-text';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { describeFailure } from '@/lib/messages';
import { shortNames } from '@/lib/names';
import { usePhone } from '@/lib/phone';
import { keepPreviousPeriod } from '@/lib/keep-previous-page';
import { asOfTodayLabel, monthFromQuery, monthLabel } from '@/lib/reporting-month';
import { useAsOfToday } from '@/lib/use-as-of-today';
import { getChurchCounts, type ChurchCountFigures, type ChurchCounts } from '@/lib/reports';
import { useScreenAddress } from '@/lib/screen-address';
import { cn } from '@/lib/utils';

export type CountFigure = 'CELLS' | 'CELL_LEADERS' | 'PEOPLE';
type Figure = CountFigure;

/** Each figure’s Reports tab, for its switch (decision 0398). */
const TAB: Record<CountFigure, ReportTab> = {
  CELLS: 'number-of-cells',
  CELL_LEADERS: 'number-of-cell-leaders',
  PEOPLE: 'number-of-people',
};

/** Each # tab's columns, shared with a Full view leader's branch (decision 0380). */
export const COUNT_COLUMNS: Record<Figure, readonly [keyof ChurchCountFigures, string][]> = {
  CELLS: [
    // Every Cell is J12 Kids, Youth, Young Pro or Couple, so the Cell Groups are their total
    // (owner, 2026-10-09), and the four run youngest to oldest after it (decision 0431).
    ['cell_groups', 'Total'],
    ['j12_kids', 'J12 Kids'],
    ['youth', 'Youth'],
    ['young_pro', 'Young Pro'],
    ['couple', 'Couple'],
  ],
  CELL_LEADERS: [['cell_leaders', 'Cell Leaders']],
  PEOPLE: [['people', 'People']],
};

/** Each # tab's headings on a phone (decision 0451), its key said under the table. */
const COLUMN_SHORT: Partial<Record<keyof ChurchCountFigures, string>> = {
  j12_kids: 'J12',
  youth: 'Y',
  young_pro: 'YP',
  couple: 'C',
};

/** What the short headings stand for, under a table that uses them (decision 0451). */
export function CountsKey({ figure }: { figure: Figure }) {
  return figure === 'CELLS' ? (
    <p className="text-muted mt-2 text-xs lg:hidden">Y = Youth · YP = Young Pro · C = Couple</p>
  ) : null;
}

/** A # tab's heading cell, short on a phone and said in full (decision 0451). */
export function CountHead({
  label,
  column,
  phone,
}: {
  label: string;
  column: keyof ChurchCountFigures;
  phone: boolean;
}) {
  return phone ? <ShortText full={label} short={COLUMN_SHORT[column] ?? null} /> : <>{label}</>;
}

/**
 * A # tab's figures as tiles (decision 0451): the label above a large figure, the first tile
 * saying when it is as of — *As of today* while the month runs, *As of 31 October 2026* once it
 * has ended. A tab with one figure gives it the whole row; *# of Cell Groups* keeps its total
 * across the top and the four two by two on a phone, five on a line wider (decision 0431).
 */
export function CountTiles({
  figure,
  value,
  asOf,
}: {
  figure: Figure;
  value: (key: keyof ChurchCountFigures) => number;
  asOf: string;
}) {
  const columns = COUNT_COLUMNS[figure];
  return (
    <dl
      className={
        figure === 'CELLS'
          ? 'mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5'
          : 'mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3'
      }
    >
      {columns.map(([key, label], index) => (
        <div
          key={key}
          className={cn(
            'border-line border p-3',
            figure === 'CELLS' && key === 'cell_groups' && 'col-span-2 sm:col-span-1',
          )}
        >
          <dt className="text-ink text-sm font-bold">{label}</dt>
          <dd
            className={cn(
              'mt-1 font-bold tabular-nums',
              columns.length === 1 ? 'text-4xl leading-tight' : 'text-xl',
            )}
          >
            {value(key).toLocaleString()}
          </dd>
          {index === 0 ? (
            <dd className="text-muted mt-1 text-xs" aria-live="polite">
              {asOf}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

const LABEL: Record<Figure, string> = {
  CELLS: 'Number of Cell Groups',
  CELL_LEADERS: 'Number of Cell Leaders',
  PEOPLE: 'Number of people',
};

/**
 * The Senior Pastors' *Number of Cell Groups*, *Number of Cell Leaders* or *Number of people*
 * (decision 0326, point 3).
 *
 * **A month at a time, with previous and next**: a month that has ended is counted on its last
 * day, and the current month as of now, *As of today* (decision 0451). The whole church first, then one table for
 * each root's direct leaders, the Men's root first, then *Others*, so the rows and *Others*
 * add up to the whole church. Rows are in first-name order, never sorted by a figure, never
 * numbered or coloured (sections 13 and 17); each name opens that leader's page (decision 0364),
 * except on the Senior Pastors' *People*, where it opens that Primary's 12 here (decision 0490).
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
  const today = useAsOfToday();
  const current = monthFromQuery(null);
  // A month that has not begun is not reported (decision 0216); the address opens this one.
  const month = monthFromQuery(asked);

  // **The Senior Pastors' *People* has a Men · Women · Both switch** (decision 0490), the
  // reader's own Network first and chosen when the page opens, then the other, then Both. Each
  // Network shows its total and its root's 12, Both the whole church and both tables.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const switched = figure === 'PEOPLE' && me.data?.screens === 'SENIOR_PASTOR';
  const askedNetwork = useSearchParams().get('network');
  // The church's figures name the roots, so the reader's own Network is read from them: the
  // current month's, once, under the key Both itself uses, so a month change does not unsettle
  // the choice and Both is not asked for twice.
  const both = useQuery({
    queryKey: ['church-counts', current, null],
    queryFn: ({ signal }) => getChurchCounts(current, signal),
    enabled: switched,
  });
  const ownNetwork =
    both.data?.tables?.find((table) => table.root.id === me.data?.person_id)?.network ?? null;
  // Until the church's figures say which root the reader is, no choice is made; a reader who is
  // neither root opens on Both.
  const choice: 'MENS' | 'WOMENS' | 'BOTH' | null = !switched
    ? null
    : askedNetwork === 'MENS' || askedNetwork === 'WOMENS' || askedNetwork === 'BOTH'
      ? askedNetwork
      : both.isFetched
        ? (ownNetwork ?? 'BOTH')
        : null;
  const network = choice === 'MENS' || choice === 'WOMENS' ? choice : undefined;

  const countsKey = ['church-counts', month, network ?? null];
  const counts = useQuery({
    queryKey: countsKey,
    // Another month keeps the counts shown, faded, until its own arrive (owner, 2026-11-06).
    placeholderData: keepPreviousPeriod(countsKey, [1]),
    queryFn: ({ signal }) => getChurchCounts(month, signal, network),
    // A Senior Pastor's waits for their own Network to be known, so Both does not flash first.
    enabled: !switched || choice !== null,
  });
  const data = counts.data;
  const order: ('MENS' | 'WOMENS')[] = ownNetwork === 'WOMENS' ? ['WOMENS', 'MENS'] : ['MENS', 'WOMENS'];

  return (
    <section aria-label={LABEL[figure]}>
      {/* The same ‹ › month control as CG and DCC attendance (owner, 2026-10-09), in the same bar. */}
      <div className={`mt-4 ${CONTROL_BAR}`}>
        {/* The Admin's Counts switch, on the month's row (decision 0433). */}
        <CountsSwitch tab={TAB[figure]} month={month} />
        {/* Monthly or the last 12 months, beside the month (decisions 0398 and 0459). */}
        <ReportViewSwitch tab={TAB[figure]} value="MONTH" />
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 lg:w-auto">
          <RangeNavigator
            kind="MONTH"
            start={month}
            current={current}
            open={undefined}
            labelled="bare"
            onChange={(value) => go({ month: value })}
          />
        </div>
        {/* Drawn once the reader's own Network is known, so no choice shows that is not made. */}
        {switched && choice !== null && both.isFetched ? (
          <ViewSwitch<'MENS' | 'WOMENS' | 'BOTH'>
            label="Which Network"
            className="mt-0 w-full lg:w-auto"
            options={[
              ...order.map((key) => ({
                key,
                label: key === 'MENS' ? 'Men' : 'Women',
                name: key === 'MENS' ? 'Men’s Network' : 'Women’s Network',
              })),
              { key: 'BOTH' as const, label: 'Both', name: 'Both Networks, the whole church' },
            ]}
            value={choice}
            onChange={(next) => go({ network: next })}
          />
        ) : null}
      </div>

      <div className="mt-4">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>

      <KeptFigures kept={counts.isPlaceholderData} loading={monthLabel(month)}>
      {counts.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          <h2 className="field-label mt-4">
            {data.network === 'WOMENS'
              ? 'Women’s Network'
              : data.network === 'MENS'
                ? 'Men’s Network'
                : 'Whole Church'}
          </h2>
          <CountTiles
            figure={figure}
            value={(key) => data.whole_church[key]}
            asOf={asAt(month, month === current, today)}
          />

          {data.tables === null ? (
            <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
              The leaders&rsquo; tables cannot be shown for this month: the pastoral tree it
              resolves holds a fault that needs repair. The whole church&rsquo;s figures above
              stand.
            </p>
          ) : (
            <>
              {data.tables.map((table) => (
                <CountTable
                  key={table.root.id}
                  figure={figure}
                  table={table}
                  // A Primary's 12 opens for the month and the Network on screen (decision 0490).
                  drill={
                    switched
                      ? (id) =>
                          `/reports/number-of-people?${new URLSearchParams({
                            leader: id,
                            ...(month === current ? {} : { month }),
                            ...(askedNetwork && choice ? { network: choice } : {}),
                          }).toString()}`
                      : undefined
                  }
                />
              ))}
              {data.others ? <OthersLine figure={figure} others={data.others} /> : null}
            </>
          )}
        </>
      ) : null}
      </KeptFigures>
    </section>
  );
}

/**
 * The month's instant, in words: *As of today, 12 Nov* or *As of 31 October 2026* (decision 0451,
 * which dropped *so far* and moved it into the first tile; dated by decision 0478). `today` is
 * `useAsOfToday()`'s label, so it moves on when the app comes back after midnight.
 */
export function asAt(month: string, current: boolean, today: string = asOfTodayLabel()): string {
  if (current) {
    return today;
  }
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0));

  return `As of ${last.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

function CountTable({
  figure,
  table,
  drill,
}: {
  figure: Figure;
  table: NonNullable<ChurchCounts['tables']>[number];
  /** A Primary's name opens their 12 here, at this address, rather than their own page (decision 0490). */
  drill?: (leaderId: string) => string;
}) {
  const phone = usePhone();
  // No count in the heading (owner, 2026-10-09).
  const heading = `${table.root.full_name ?? 'A Network root'}’s leaders`;
  const columns = COUNT_COLUMNS[figure];
  // Short names only where there are several figures to fit beside them (decision 0451).
  const short =
    phone && columns.length > 1 ? shortNames(table.rows.map((row) => row.leader)) : null;

  return (
    <div className="mt-6">
      <h3 className="text-base font-bold tracking-tight">{heading}</h3>

      {/* One table at every width (decision 0451, replacing the owner's two lines a leader on a
          phone of 2026-10-08): the figures in equal columns beside each name. */}
      <Table caption={heading} className="mt-2" tableClassName="table-fixed">
        <thead>
          <tr>
            <HeaderCell className={NAME_HEAD} style={{ width: columns.length > 1 ? '36%' : '70%' }}>
              Primaries
            </HeaderCell>
            {/* The figures share the rest of the row equally (owner, 2026-10-09). */}
            {columns.map(([key, label]) => (
              <HeaderCell
                key={key}
                className={FIGURE_HEAD}
                style={{ width: `${(columns.length > 1 ? 64 : 30) / columns.length}%` }}
              >
                <CountHead label={label} column={key} phone={phone} />
              </HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            // Every other row shaded, to follow a row across, never numbered (owner, 2026-10-09).
            <tr key={row.leader.id} className={rowClasses}>
              <td className={NAME_CELL}>
                <BranchLink
                  leader={row.leader}
                  short={short?.[index] ?? null}
                  href={drill?.(row.leader.id)}
                />
              </td>
              {columns.map(([key]) => (
                <td key={key} className={FIGURE_CELL}>
                  {row[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <CountsKey figure={figure} />
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
        {COUNT_COLUMNS[figure].map(([key, label]) => `${label} ${others[key]}`).join(' · ')}
      </p>
    </div>
  );
}

function BranchLink({
  leader,
  short,
  href,
}: {
  leader: { id: string; member_id: string | null; full_name: string | null };
  /** The name a phone shows where the table has several figures (decision 0451). */
  short: string | null;
  href?: string;
}) {
  const full = leader.full_name ?? leader.member_id ?? 'A leader';
  const shortened = short !== null && short !== full;
  return (
    <Link
      // A short name keeps the words it shows first in its name, so speaking them selects it
      // (decision 0451; WCAG 2.5.3).
      aria-label={shortened ? `${short}, ${full}` : undefined}
      // The person's page, Branch having left People (decision 0364), unless the table says
      // otherwise: the Senior Pastors' *People* opens a Primary's 12 (decision 0490).
      href={href ?? `/people/${leader.id}`}
      // The accent, as every Primary's name on Reports (owner, 2026-10-09).
      className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {shortened ? short : full}
    </Link>
  );
}
