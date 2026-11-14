'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import {
  asAt,
  COUNT_COLUMNS,
  CountHead,
  CountsKey,
  CountTiles,
  type CountFigure,
} from '@/components/church-counts';
import {
  FIGURE_CELL,
  FIGURE_HEAD,
  NAME_CELL,
  NAME_HEAD,
  RangeNavigator,
} from '@/components/my-twelve';
import { ShortText } from '@/components/ui/short-text';
import { ReportViewSwitch, type ReportTab } from '@/components/reports-tabs';
import { CONTROL_BAR } from '@/components/ui/frame';
import { KeptFigures } from '@/components/kept-figures';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { describeFailure } from '@/lib/messages';
import { shortNames } from '@/lib/names';
import { usePhone } from '@/lib/phone';
import { getPerson } from '@/lib/people';
import { keepPreviousPeriod } from '@/lib/keep-previous-page';
import { monthFromQuery, monthLabel } from '@/lib/reporting-month';
import { getBranchCounts, getBranchPeople, type ChurchCountFigures } from '@/lib/reports';
import { useScreenAddress } from '@/lib/screen-address';
import { useAsOfToday } from '@/lib/use-as-of-today';
import { LoadingBlocks } from '@/components/ui/loading-blocks';

/** The three # tabs' labels, as the Senior Pastors' (decision 0326). */
const LABEL: Record<CountFigure, string> = {
  CELLS: 'Number of Cell Groups',
  CELL_LEADERS: 'Number of Cell Leaders',
  PEOPLE: 'Number of People',
};

/** Each tab's address, so the month and an opened leader stay on it. */
const PATH: Record<CountFigure, string> = {
  CELLS: '/reports/number-of-cells',
  CELL_LEADERS: '/reports/number-of-cell-leaders',
  PEOPLE: '/reports/number-of-people',
};

/** Each figure’s Reports tab, for its switch (decision 0398). */
const TAB: Record<CountFigure, ReportTab> = {
  CELLS: 'number-of-cells',
  CELL_LEADERS: 'number-of-cell-leaders',
  PEOPLE: 'number-of-people',
};

type Row = {
  leader: {
    id: string;
    member_id: string | null;
    full_name: string | null;
    first_name?: string | null;
    last_name?: string | null;
    title?: string | null;
  } | null;
} & Partial<ChurchCountFigures>;

/**
 * A Full view leader's *# of Cell Groups*, *# of Cell Leaders* and *# of People*, under Reports
 * (decisions 0364, 0376 and 0380): the Senior Pastors' figures one level down, for the reader's
 * own branch.
 *
 * **A month at a time**, counted as theirs is: a month that has ended on its last day, the
 * current one as of now, *As of today, 12 Nov* (decisions 0451 and 0478). The box is the branch, then one row per direct disciple
 * counting them and everyone beneath them, then the leader's own row, adding up to the box. Rows
 * are in first-name order, never sorted by a figure, never numbered or coloured (sections 13
 * and 17). **A name is plain text and opens nothing** (decision 0380).
 */
export function BranchCountsPanel({
  figure,
  readerId,
  leader,
  month: asked,
  backLabel = 'Back to your disciples',
  backNetwork = null,
  drill,
}: {
  figure: CountFigure;
  readerId: string;
  /** A leader in the address, or null for the reader's own branch. */
  leader: string | null;
  /** The month in the address, as the first of it. */
  month: string | null;
  /** The way back's words where a leader is open: the Senior Pastors' go back to People. */
  backLabel?: string;
  /** Kept on the way back: the Senior Pastors' Men, Women or Both (decision 0490). */
  backNetwork?: string | null;
  /**
   * Where a leader's name opens their own 12, for a leader with people beneath them (decision
   * 0490, the Senior Pastors'). Without it every name is plain text (decision 0380).
   */
  drill?: (leaderId: string) => string;
}) {
  const go = useScreenAddress();
  const phone = usePhone();
  const today = useAsOfToday();
  const current = monthFromQuery(null);
  // A month that has not begun is not reported (decision 0216); the address opens this one.
  const month = monthFromQuery(asked);
  const subject = leader ?? readerId;
  const columns = COUNT_COLUMNS[figure];

  // *# of People* keeps its own route (decision 0364); the two Cell counts have theirs (0380).
  const countsKey = ['branch-counts', figure === 'PEOPLE' ? 'people' : 'cells', subject, month];
  const counts = useQuery({
    queryKey: countsKey,
    // Another month keeps the counts shown, faded, until its own arrive (owner, 2026-11-06).
    placeholderData: keepPreviousPeriod(countsKey, [3]),
    queryFn: async ({ signal }) => {
      if (figure === 'PEOPLE') {
        const people = await getBranchPeople(subject, month, signal);
        return {
          total: people.total === null ? null : { people: people.total },
          own: people.own === null ? null : { people: people.own },
          rows: people.rows as Row[] | null,
        };
      }
      const cells = await getBranchCounts(subject, month, signal);
      return { total: cells.total, own: cells.own, rows: cells.rows as Row[] | null };
    },
  });
  const opened = useQuery({
    queryKey: ['person', leader],
    queryFn: ({ signal }) => getPerson(leader!, signal),
    enabled: leader !== null,
  });
  const name = leader === null ? null : (opened.data?.full_name ?? 'This leader');
  const heading = name === null ? 'Your Disciples' : `${name}’s Disciples`;
  const data = counts.data;
  // Short names only where there are several figures to fit beside them (decision 0451).
  const short =
    phone && columns.length > 1 && data?.rows
      ? shortNames(data.rows.map((row) => row.leader ?? { full_name: null }))
      : null;
  const value = (figures: Partial<ChurchCountFigures> | null, key: keyof ChurchCountFigures) =>
    figures?.[key] ?? 0;

  return (
    <section aria-label={LABEL[figure]}>
      <div className={`mt-4 ${CONTROL_BAR}`}>
        {/* Monthly or the last 12 months, beside the month (decision 0398). */}
        <ReportViewSwitch tab={TAB[figure]} value="MONTH" />
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 lg:w-auto">
          <RangeNavigator
            kind="MONTH"
            start={month}
            current={current}
            open={undefined}
            labelled="bare"
            onChange={(next) => go({ month: next })}
          />
        </div>
      </div>

      {leader !== null ? (
        <p className="mt-4 text-sm">
          <TextLink
            href={(() => {
              const query = new URLSearchParams({
                ...(month === current ? {} : { month }),
                ...(backNetwork ? { network: backNetwork } : {}),
              }).toString();
              return query ? `${PATH[figure]}?${query}` : PATH[figure];
            })()}
          >
            {backLabel}
          </TextLink>
        </p>
      ) : null}

      <div className="mt-4">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>

      <KeptFigures kept={counts.isPlaceholderData} loading={monthLabel(month)}>
      {counts.isPending ? (
        <LoadingBlocks shape="rows" className="mt-4" />
      ) : data ? (
        data.total === null || data.rows === null ? (
          <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
            This month cannot be counted: the pastoral tree it resolves holds a fault that needs
            repair.
          </p>
        ) : (
          <>
            <h2 className="field-label mt-4">{heading}</h2>
            <CountTiles
              figure={figure}
              value={(key) => value(data.total, key)}
              asOf={asAt(month, month === current, today)}
            />

            {/* The figures in equal columns, short headings and names on a phone where there are
                several figures (decision 0451). */}
            <Table
              caption={name === null ? 'Your 12' : `${name}’s 12`}
              className="mt-6"
              tableClassName="table-fixed"
            >
              <thead>
                <tr>
                  <HeaderCell
                    className={NAME_HEAD}
                    style={{ width: columns.length > 1 ? '36%' : '70%' }}
                  >
                    Leader
                  </HeaderCell>
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
                {data.rows.map((row, index) => (
                  // Every other row shaded, to follow a row across, never numbered (owner, 2026-10-09).
                  <tr key={row.leader?.id ?? `unnamed-${index}`} className={rowClasses}>
                    <td className={NAME_CELL}>
                      {row.leader === null ? (
                        <span className="text-muted">A leader not named here</span>
                      ) : drill && value(row, 'people') > 1 ? (
                        // **The Senior Pastors go down a level from a name with people beneath it**
                        // (decision 0490): a count of one is the leader alone, and stays a name.
                        <Link
                          href={drill(row.leader.id)}
                          className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {row.leader.full_name ?? row.leader.member_id ?? 'A leader'}
                        </Link>
                      ) : (
                        // A name, not a link (decision 0380), short on a phone where there are
                        // several figures beside it (decision 0451).
                        <ShortText
                          full={row.leader.full_name ?? row.leader.member_id ?? 'A leader'}
                          short={short?.[index] ?? null}
                        />
                      )}
                    </td>
                    {columns.map(([key]) => (
                      <td key={key} className={FIGURE_CELL}>
                        {value(row, key)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className={rowClasses}>
                  <td className={NAME_CELL}>{name === null ? 'You' : name}</td>
                  {columns.map(([key]) => (
                    <td key={key} className={FIGURE_CELL}>
                      {value(data.own, key)}
                    </td>
                  ))}
                </tr>
                <tr className="border-ink border-t-2">
                  <td className={`${NAME_CELL} font-bold`}>Total</td>
                  {columns.map(([key]) => (
                    <td key={key} className={`${FIGURE_CELL} font-bold`}>
                      {value(data.total, key)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </Table>
            <CountsKey figure={figure} />
          </>
        )
      ) : null}
      </KeptFigures>
    </section>
  );
}
