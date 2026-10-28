'use client';

import { useQuery } from '@tanstack/react-query';

import { asAt, COUNT_COLUMNS, type CountFigure } from '@/components/church-counts';
import { RangeNavigator } from '@/components/my-twelve';
import { ReportViewSwitch, type ReportTab } from '@/components/reports-tabs';
import { CONTROL_BAR } from '@/components/ui/frame';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { describeFailure } from '@/lib/messages';
import { getPerson } from '@/lib/people';
import { monthFromQuery } from '@/lib/reporting-month';
import { getBranchCounts, getBranchPeople, type ChurchCountFigures } from '@/lib/reports';
import { useScreenAddress } from '@/lib/screen-address';

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

type Row = { leader: { id: string; member_id: string | null; full_name: string | null } | null } & Partial<ChurchCountFigures>;

/**
 * A Full view leader's *# of Cell Groups*, *# of Cell Leaders* and *# of People*, under Reports
 * (decisions 0364, 0376 and 0380): the Senior Pastors' figures one level down, for the reader's
 * own branch.
 *
 * **A month at a time**, counted as theirs is: a month that has ended on its last day, the
 * current one as of now, *so far*. The box is the branch, then one row per direct disciple
 * counting them and everyone beneath them, then the leader's own row, adding up to the box. Rows
 * are in first-name order, never sorted by a figure, never numbered or coloured (sections 13
 * and 17). **A name is plain text and opens nothing** (decision 0380).
 */
export function BranchCountsPanel({
  figure,
  readerId,
  leader,
  month: asked,
}: {
  figure: CountFigure;
  readerId: string;
  /** A leader in the address, or null for the reader's own branch. */
  leader: string | null;
  /** The month in the address, as the first of it. */
  month: string | null;
}) {
  const go = useScreenAddress();
  const current = monthFromQuery(null);
  // A month that has not begun is not reported (decision 0216); the address opens this one.
  const month = monthFromQuery(asked);
  const subject = leader ?? readerId;
  const columns = COUNT_COLUMNS[figure];

  // *# of People* keeps its own route (decision 0364); the two Cell counts have theirs (0380).
  const counts = useQuery({
    queryKey: ['branch-counts', figure === 'PEOPLE' ? 'people' : 'cells', subject, month],
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
  const value = (figures: Partial<ChurchCountFigures> | null, key: keyof ChurchCountFigures) =>
    figures?.[key] ?? 0;

  return (
    <section aria-label={LABEL[figure]}>
      <div className={`mt-4 ${CONTROL_BAR}`}>
        {/* Monthly or the last 12 months, beside the month (decision 0398). */}
        <ReportViewSwitch tab={TAB[figure]} value="MONTH" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RangeNavigator
            kind="MONTH"
            start={month}
            current={current}
            open={undefined}
            labelled="bare"
            onChange={(next) => go({ month: next })}
          />
          <span className="text-muted text-sm" aria-live="polite">
            {asAt(month, month === current)}
          </span>
        </div>
      </div>

      {leader !== null ? (
        <p className="mt-4 text-sm">
          <TextLink href={month === current ? PATH[figure] : `${PATH[figure]}?month=${month}`}>
            Back to your disciples
          </TextLink>
        </p>
      ) : null}

      <div className="mt-4">
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
      </div>

      {counts.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        data.total === null || data.rows === null ? (
          <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
            This month cannot be counted: the pastoral tree it resolves holds a fault that needs
            repair.
          </p>
        ) : (
          <>
            <h2 className="field-label mt-4">{heading}</h2>
            <dl
              className={
                figure === 'CELLS'
                  ? 'mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4'
                  : 'mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3'
              }
            >
              {columns.map(([key, label]) => (
                <div key={key} className="border-line border p-3">
                  <dt className="text-ink text-sm font-bold">{label}</dt>
                  <dd className="mt-1 text-xl font-bold tabular-nums">
                    {value(data.total, key).toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>

            <Table caption={name === null ? 'Your 12' : `${name}’s 12`} className="mt-6">
              <thead>
                <tr>
                  <HeaderCell style={{ width: columns.length > 1 ? '36%' : '70%' }}>Leader</HeaderCell>
                  {columns.map(([key, label]) => (
                    <HeaderCell
                      key={key}
                      className="text-right"
                      style={{ width: `${(columns.length > 1 ? 64 : 30) / columns.length}%` }}
                    >
                      {label}
                    </HeaderCell>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  // Every other row shaded, to follow a row across, never numbered (owner, 2026-10-09).
                  <tr key={row.leader?.id ?? `unnamed-${index}`} className={`${rowClasses} even:bg-raised`}>
                    <td className="px-3 py-3">
                      {row.leader === null ? (
                        <span className="text-muted">A leader not named here</span>
                      ) : (
                        // A name, not a link (decision 0380).
                        (row.leader.full_name ?? row.leader.member_id ?? 'A leader')
                      )}
                    </td>
                    {columns.map(([key]) => (
                      <td key={key} className="px-3 py-3 text-right tabular-nums">
                        {value(row, key)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className={rowClasses}>
                  <td className="px-3 py-3">{name === null ? 'You' : name}</td>
                  {columns.map(([key]) => (
                    <td key={key} className="px-3 py-3 text-right tabular-nums">
                      {value(data.own, key)}
                    </td>
                  ))}
                </tr>
                <tr className="border-ink border-t-2">
                  <td className="px-3 py-3 font-bold">Total</td>
                  {columns.map(([key]) => (
                    <td key={key} className="px-3 py-3 text-right font-bold tabular-nums">
                      {value(data.total, key)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </Table>
          </>
        )
      ) : null}
    </section>
  );
}
