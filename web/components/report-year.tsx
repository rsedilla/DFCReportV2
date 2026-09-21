'use client';

import { useQueries } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { buttonClasses } from '@/components/ui/button';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { getCellMonthlyReport, getDccMonthlyReport, type ReportScope } from '@/lib/reports';
import { hasNotBegun, monthLabel, reportingMonthOf } from '@/lib/reporting-month';
import { describeFailure } from '@/lib/messages';
import { cn } from '@/lib/utils';

/** The months of `year` that have begun, January first, as `YYYY-MM-01`. */
export function monthsBegunIn(year: number): string[] {
  return Array.from(
    { length: 12 },
    (_, index) => `${String(year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}-01`,
  ).filter((month) => !hasNotBegun(month));
}

/** The Manila year of the current month. */
export function currentYear(): number {
  return Number(reportingMonthOf().slice(0, 4));
}

/**
 * The design's "month | year" switch over a report. A radio group, as the coverage switch
 * beside it is, so a screen reader hears one choice of two.
 */
export function PeriodSwitch({
  value,
  onChange,
}: {
  value: 'month' | 'year';
  onChange: (value: 'month' | 'year') => void;
}) {
  const option = (key: 'month' | 'year', label: string) => (
    <label
      className={`focus-within:outline-accent flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm focus-within:outline-2 focus-within:outline-offset-2 ${
        value === key ? 'border-ink bg-ink text-surface' : 'border-line'
      }`}
    >
      <input
        type="radio"
        name="report-period"
        className="sr-only"
        checked={value === key}
        onChange={() => onChange(key)}
      />
      {label}
    </label>
  );

  return (
    <div role="radiogroup" aria-label="Report period" className="mt-6 inline-flex">
      {option('month', 'Month')}
      {option('year', 'Year')}
    </div>
  );
}

/** The year being shown and how to move between years; forward stops at the current one. */
export function YearPicker({ year, onChange }: { year: number; onChange: (year: number) => void }) {
  const nextIsRefused = year + 1 > currentYear();

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(year - 1)}
          aria-label={`Show ${year - 1}`}
          className={cn(buttonClasses('secondary'), 'px-3')}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onChange(year + 1)}
          disabled={nextIsRefused}
          aria-label={`Show ${year + 1}`}
          className={cn(buttonClasses('secondary'), 'px-3')}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>
      <p aria-live="polite" className="text-accent text-sm font-bold">
        {year}
      </p>
    </div>
  );
}

interface MonthRow {
  month: string;
  owed: number;
  filed: number;
  people: number;
  open: boolean;
}

/**
 * A year of one report, one row per month that has begun (SKILL.md section 18, decision
 * 0257; the owner's design, adjusted to the rules).
 *
 * **Each row is that month's own report**, requested and authorized as the monthly report
 * is, so a year needs no rule of its own about whose figures a reader may see. Owed and
 * Filed are the coverage line, never divided (decision 0224).
 *
 * **The year row adds up Owed and Filed and nothing else.** Each obligation falls in one
 * month, so those sum; a person who came in two months is one person for the year, so the
 * people column does not, and it is left empty there rather than added.
 */
export function YearTable({
  report,
  year,
  scope,
}: {
  report: 'dcc' | 'cells';
  year: number;
  scope: ReportScope;
}) {
  const months = monthsBegunIn(year);
  const unit = report === 'dcc' ? 'Sunday records' : 'Cell meetings';

  const results = useQueries({
    queries: months.map((month) => ({
      // Its own key, not the monthly screen's: this caches a row, not the whole report.
      queryKey: ['report-year-row', report, month, scope],
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<MonthRow> => {
        if (report === 'dcc') {
          const data = await getDccMonthlyReport(
            month,
            scope as Exclude<ReportScope, { kind: 'CELL' }>,
            signal,
          );

          return {
            month,
            owed: data.coverage.owed,
            filed: data.coverage.met,
            people: data.unique_people,
            open: data.open,
          };
        }

        const data = await getCellMonthlyReport(
          month,
          scope as Exclude<ReportScope, { kind: 'NETWORK' }>,
          signal,
        );

        return {
          month,
          owed: data.coverage.scheduled,
          filed: data.coverage.recorded,
          people: data.unique_people,
          open: data.open,
        };
      },
      retry: false,
    })),
  });

  if (months.length === 0) {
    return (
      <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
        No month of {year} has begun.
      </p>
    );
  }

  const covered =
    months.length === 1
      ? monthLabel(months[0])
      : `${monthLabel(months[0]).split(' ')[0]} to ${monthLabel(months[months.length - 1])}`;
  const loaded = results.flatMap((result) => (result.data ? [result.data] : []));
  const failed = results.filter((result) => result.isError).length;
  const pending = results.some((result) => result.isPending);
  const owed = loaded.reduce((sum, row) => sum + row.owed, 0);
  const filed = loaded.reduce((sum, row) => sum + row.filed, 0);
  const monthName = (month: string) => monthLabel(month).split(' ')[0];
  // Section 17: a year row that includes an open month is still changing.
  const openMonths = loaded.filter((row) => row.open).map((row) => monthName(row.month));

  return (
    <section aria-labelledby="year-heading" className="mt-8">
      <h2 id="year-heading" className="field-label">
        Month by month, {covered}
      </h2>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Each row is that month&rsquo;s report. Owed and Filed count {unit}; People counts each
        person once in that month.
      </p>

      <Table caption={`${report === 'dcc' ? 'Sunday service' : 'Cell meetings'}, ${covered}`}>
        <thead>
          <tr>
            <HeaderCell>Month</HeaderCell>
            <HeaderCell className="text-right">Owed</HeaderCell>
            <HeaderCell className="text-right">Filed</HeaderCell>
            <HeaderCell className="text-right">People</HeaderCell>
            <HeaderCell>Status</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {months.map((month, index) => {
            const result = results[index];
            const row = result.data;

            return (
              <tr key={month} className={rowClasses}>
                <td className="px-3 py-3">{monthName(month)}</td>
                {row ? (
                  <>
                    <td className="px-3 py-3 text-right tabular-nums">{row.owed}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.filed}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.people}</td>
                    <td className="px-3 py-3">
                      {row.open
                        ? 'Open for submission'
                        : row.owed > row.filed
                          ? `Closed · ${row.owed - row.filed} not filed`
                          : 'Closed'}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="text-muted px-3 py-3">
                    {result.isError ? describeFailure(result.error).message : 'Loading…'}
                  </td>
                )}
              </tr>
            );
          })}
          <tr className="border-edge border-t-2 font-semibold">
            <td className="px-3 py-3">Year so far</td>
            <td className="px-3 py-3 text-right tabular-nums">{pending ? '…' : owed}</td>
            <td className="px-3 py-3 text-right tabular-nums">{pending ? '…' : filed}</td>
            <td className="px-3 py-3" />
            <td className="px-3 py-3 font-normal">
              {openMonths.length > 0 ? `Includes ${new Intl.ListFormat('en-GB').format(openMonths)}, still open` : null}
            </td>
          </tr>
        </tbody>
      </Table>

      {failed > 0 ? (
        <p className="text-muted mt-3 max-w-2xl text-sm leading-relaxed">
          {failed === 1 ? 'One month' : `${failed} months`} could not be read and{' '}
          {failed === 1 ? 'is' : 'are'} not in the year row.
        </p>
      ) : null}
      <p className="text-muted mt-3 max-w-2xl text-sm leading-relaxed">
        The year row adds up Owed and Filed only. Somebody who came in two months is one person for
        the year, so People is not added up.
      </p>
    </section>
  );
}
