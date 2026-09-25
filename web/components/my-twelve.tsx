import Link from 'next/link';

import { FRAME } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { networkLabel } from '@/lib/people';
import type { CellTwelve, Classification, TwelveFigure } from '@/lib/reports';
import { rangeLabel, shiftRange, type RangeKind } from '@/lib/report-range';
import { cn } from '@/lib/utils';

const STAGES: readonly [keyof Classification, string][] = [
  ['vip', 'VIP'],
  ['second_timer', '2nd timer'],
  ['third_timer', '3rd timer'],
  ['fourth_timer', '4th timer'],
  ['regular', 'Regular'],
];

const PERIODS: readonly [RangeKind, string][] = [
  ['WEEK', 'Weekly'],
  ['MONTH', 'Monthly'],
  ['QUARTER', 'Quarterly'],
  ['YEAR', 'Year'],
];

const WHAT: Record<RangeKind, string> = {
  WEEK: 'in the week',
  MONTH: 'in the month',
  QUARTER: 'in the quarter',
  YEAR: 'in the year',
};

const BY: Record<RangeKind, string> = {
  WEEK: 'its Sunday',
  MONTH: 'its last day',
  QUARTER: 'its last day',
  YEAR: 'its last day',
};

/**
 * Weekly, Monthly, Quarterly and Year, as equal buttons in the Reports tabs' style
 * (decision 0293). Buttons rather than links: each is a view of the same report and address.
 */
export function PeriodTabs({
  value,
  onChange,
}: {
  value: RangeKind;
  onChange: (value: RangeKind) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Report period"
      className="border-line mt-4 grid grid-cols-2 border-b sm:grid-cols-4"
    >
      {PERIODS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'focus-visible:outline-accent inline-flex min-h-11 items-center justify-center border border-b-0 px-3 text-center',
            'text-xs font-bold tracking-[0.08em] uppercase focus-visible:outline-2 focus-visible:-outline-offset-2',
            value === key ? 'bg-ink text-surface border-ink' : 'border-line text-ink hover:bg-raised',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The period being shown and the way to the one before and after it. Forward stops at the
 * current period, because a period that has not begun is not reported (decision 0216).
 */
export function RangeNavigator({
  kind,
  start,
  current,
  open,
  onChange,
}: {
  kind: RangeKind;
  start: string;
  current: string;
  open: boolean | undefined;
  onChange: (start: string) => void;
}) {
  const button =
    'border-line focus-visible:outline-accent inline-flex min-h-11 min-w-11 items-center justify-center border text-lg focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={button}
        aria-label="The period before"
        onClick={() => onChange(shiftRange(kind, start, -1))}
      >
        ‹
      </button>
      <button
        type="button"
        className={button}
        aria-label="The period after"
        disabled={start >= current}
        onClick={() => onChange(shiftRange(kind, start, 1))}
      >
        ›
      </button>
      <span className="text-accent text-sm font-bold">{rangeLabel(kind, start)}</span>
      {open === undefined ? null : (
        <span className="border-edge border px-2 py-0.5 text-xs font-bold tracking-[0.07em] uppercase">
          {open ? 'Open for submission' : 'Closed for submission'}
        </span>
      )}
    </div>
  );
}

/**
 * My 12 (SKILL.md sections 9, 12, 13, 17 and 20; decisions 0293 and 0294).
 *
 * **The subject's direct disciples, then their own row, then the total**, each a count of
 * different people who came in the period, once each, split by the stage each had reached by
 * its last day. The own row is the subject's own Cell groups for Cell Groups, and the subject
 * alone for DCC, whose attendance nobody records for themselves. Rows are in the API's order
 * (surname, or Network for a whole-church reader), never numbered, never sorted by a figure,
 * never coloured (section 13). Each name opens that
 * leader's report, which shows their 12. A whole-church reader's rows are the Network roots,
 * labelled by their Network, since that reader disciples neither.
 *
 * **Each row is that leader's own figure**, so somebody at Cells in two branches is in both
 * rows; a line takes off each count beyond a person's first, and another adds those in no
 * row, so the People column adds up to the total in plain sight.
 */
export function TwelveTable({
  twelve,
  kind,
  subjectName,
  openHref,
  where = 'a Cell',
}: {
  /** `own.cells` is present for Cell Groups; DCC's own row is the subject alone. */
  twelve: Omit<CellTwelve, 'own' | 'coverage'> & {
    own: (TwelveFigure & { cells?: number }) | null;
  };
  kind: RangeKind;
  /** What people came to: "a Cell" or "DCC". */
  where?: string;
  /** Null for the reader's own view; the leader's name when one was opened. */
  subjectName: string | null;
  openHref: (leaderId: string) => string;
}) {
  const cell = 'px-3 py-3 text-right tabular-nums';
  const own = twelve.own;
  const byNetwork = twelve.rows.length > 0 && twelve.rows.every((row) => row.network);
  const title =
    subjectName !== null ? `${subjectName}’s 12` : byNetwork ? 'The Networks' : 'My 12';
  const ownLabel =
    own === null
      ? null
      : own.cells === undefined
        ? (subjectName ?? 'You')
        : `${subjectName === null ? 'You' : subjectName} · ${
          own.cells === 0
            ? `no Cell of ${subjectName === null ? 'your' : 'their'} own`
            : own.cells === 1
              ? `${subjectName === null ? 'your' : 'their'} own Cell group`
              : `${subjectName === null ? 'your' : 'their'} own Cell groups (${own.cells})`
        }`;

  return (
    <section aria-labelledby="twelve-heading" className={FRAME}>
      <h2 id="twelve-heading" className="field-label">
        {title} · where people are in their journey
      </h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Different people who came to {where} {WHAT[kind]}, once each, at the stage they had
        reached by {BY[kind]}{twelve.open ? ', or so far while it is open' : ''}. Open a name
        to see their 12.
      </p>

      <Table caption={title} className="mt-3">
        <thead>
          <tr>
            <HeaderCell>{byNetwork ? 'Network' : 'Leader'}</HeaderCell>
            {STAGES.map(([key, label]) => (
              <HeaderCell key={key} className="text-right">
                {label}
              </HeaderCell>
            ))}
            <HeaderCell className="text-right">People</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {twelve.rows.map((row, index) => (
            <tr key={row.leader?.id ?? `unnamed-${index}`} className={rowClasses}>
              <td className="px-3 py-3">
                {row.leader === null ? (
                  <span className="text-muted">A leader outside your reach</span>
                ) : (
                  <Link
                    href={openHref(row.leader.id)}
                    className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {row.network ? networkLabel(row.network) : row.leader.full_name}
                  </Link>
                )}
              </td>
              {STAGES.map(([key]) => (
                <td key={key} className={cell}>
                  {row.classification[key]}
                </td>
              ))}
              <td className={`${cell} font-bold`}>{row.unique_people}</td>
            </tr>
          ))}

          {own === null ? null : (
            <tr className={rowClasses}>
              <td className="px-3 py-3">{ownLabel}</td>
              {own.cells === 0 ? (
                <td className="text-muted px-3 py-3" colSpan={STAGES.length + 1} />
              ) : (
                <>
                  {STAGES.map(([key]) => (
                    <td key={key} className={cell}>
                      {own.classification[key]}
                    </td>
                  ))}
                  <td className={`${cell} font-bold`}>{own.unique_people}</td>
                </>
              )}
            </tr>
          )}

          {twelve.overlap === 0 ? null : (
            <tr className={rowClasses}>
              <td className="text-muted px-3 py-3 italic" colSpan={STAGES.length + 1}>
                Counted in more than one row
              </td>
              <td className={`${cell} text-muted italic`}>−{twelve.overlap}</td>
            </tr>
          )}

          {twelve.elsewhere === 0 ? null : (
            <tr className={rowClasses}>
              <td className="text-muted px-3 py-3 italic" colSpan={STAGES.length + 1}>
                {subjectName === null && twelve.own === null ? 'In no row' : 'Elsewhere in this branch'}
              </td>
              <td className={`${cell} text-muted italic`}>+{twelve.elsewhere}</td>
            </tr>
          )}

          <tr className="border-edge border-t-2 font-bold">
            <td className="px-3 py-3">Total</td>
            {STAGES.map(([key]) => (
              <td key={key} className={cell}>
                {twelve.total.classification[key]}
              </td>
            ))}
            <td className={cell}>{twelve.total.unique_people}</td>
          </tr>
        </tbody>
      </Table>

      {kind === 'MONTH' ? null : (
        <p className="text-muted mt-3 text-sm">
          Periods are never added together: somebody who came in three{' '}
          {kind === 'WEEK' ? 'weeks counts once in the month' : 'months counts once here'}.
        </p>
      )}
    </section>
  );
}
