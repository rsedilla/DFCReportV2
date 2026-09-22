'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { CoverageFigure } from '@/components/coverage-figure';
import { Button } from '@/components/ui/button';
import { dccEventNote } from '@/components/dcc-event-note';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { behindOf, dayOfWeekLabel, listAllCells, type CellSummary } from '@/lib/cells';
import { listDccEvents, type DccEvent } from '@/lib/dcc';
import { describeFailure } from '@/lib/messages';
import { dayLabel } from '@/lib/reporting-month';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/** Ten rows a page, as on the Cells and People lists. */
const PAGE_SIZE = 10;

/**
 * The coverage line of a report, broken down one row per Cell or per Sunday (SKILL.md
 * sections 9, 12, 13 and 17; decisions 0224, 0225, 0226, 0227 and 0229).
 *
 * **No total row, deliberately.** These rows come from the Cells index and the DCC
 * calendar, which are read under the Cell and DCC viewing capabilities, while the line
 * above them is the report's own figure, read under the reporting capability for the
 * period. The two agree when the actor's scope is the same for both, and nothing here
 * can show that it is, so the rows are listed and never summed into a second figure
 * that could disagree with the first.
 *
 * **Nothing is ranked or colour-graded** (sections 13, 17 and 19). The Cells come in the
 * order the index returns, which ranks nobody (decision 0226), and the Sundays in date
 * order. Every coverage line is two figures; the Behind column beside it is a count of
 * meetings, never a division of them (decision 0267).
 *
 * **A table from `lg`, and cards below it**, the same rows in the same order, as on the
 * Cells and DCC screens.
 *
 * **The Cells page ten at a time and the Sundays do not.** Section 2 records roughly 800
 * Cells, so a whole-church reader had every one of them in one table; a month holds four
 * or five Sundays whatever the scope, so that table is bounded by the calendar.
 */
export function CoverageByCell({
  month,
  behindOnlyAtFirst = false,
}: {
  month: string;
  /** `?behind=1`: opened from the Record page, filtered to the Cells behind. */
  behindOnlyAtFirst?: boolean;
}) {
  // The same query as the report's Cell picker, so the two share one request.
  const cells = useQuery({
    queryKey: ['cells-all', month],
    queryFn: ({ signal }) => listAllCells(month, signal),
  });

  const [page, setPage] = useState(0);
  const [behindOnly, setBehindOnly] = useState(behindOnlyAtFirst);

  // **Behind is the meetings that have come and have no record** (decision 0267) — never
  // the whole month's schedule, which counts meetings that have not happened (decision
  // 0239) and is why a filter keyed on it was built and removed on 2026-09-20.
  const all = cells.data ?? [];
  const behindCount = all.filter((cell) => behindOf(cell.coverage) > 0).length;
  const rows = behindOnly ? all.filter((cell) => behindOf(cell.coverage) > 0) : all;
  // A page that no longer exists is the first one: the month changes the set underneath it.
  const start = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1)) * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);

  return (
    <section aria-labelledby="coverage-by-cell-heading" className="mt-6">
      <h2 id="coverage-by-cell-heading" className="field-label">
        Coverage by Cell
      </h2>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Each Cell in your scope, ten at a time, in the order the Cells list gives them. The
        rows are not added up here: the line at the top is the report&rsquo;s own figure. A
        Cell is behind when a meeting whose day has come has no record.
      </p>

      {cells.data && cells.data.length > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          aria-pressed={behindOnly}
          onClick={() => {
            setBehindOnly((on) => !on);
            setPage(0);
          }}
        >
          {/* A fixed label with `aria-pressed`, so a screen reader hears one state, once. */}
          Show only Cells behind
        </Button>
      ) : null}

      <div className="mt-4">
        <FailureNotice failure={cells.isError ? describeFailure(cells.error) : null} />
      </div>

      {cells.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : cells.data && cells.data.length === 0 ? (
        <p className="text-muted mt-4 text-sm">There are no Cells in your scope this month.</p>
      ) : cells.data && rows.length === 0 ? (
        <p className="text-muted mt-4 text-sm">
          No Cell in your scope is behind: every meeting that has come has a record.
        </p>
      ) : cells.data ? (
        <>
          <Table caption="Recording coverage for each Cell" className="mt-4 hidden lg:block">
            <thead>
              <tr>
                <HeaderCell>Cell</HeaderCell>
                <HeaderCell>Leader</HeaderCell>
                <HeaderCell>Meets</HeaderCell>
                <HeaderCell>Recorded</HeaderCell>
                <HeaderCell>Behind</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {shown.map((cell) => (
                <tr key={cell.id} className={rowClasses}>
                  <td className="px-3 py-3">
                    <Link href={meetingsHref(cell, month)} className={`${LINK} font-medium`}>
                      {cell.cell_id}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{cell.leader.full_name}</td>
                  <td className="px-3 py-3">
                    {dayOfWeekLabel(cell.schedule.day_of_week)}, {cell.schedule.time_of_day}
                  </td>
                  <td className="px-3 py-3">
                    <CoverageFigure
                      recorded={cell.coverage.recorded}
                      scheduled={cell.coverage.scheduled}
                      unit="meetings recorded"
                    />
                  </td>
                  <td className="px-3 py-3">{behindLabel(cell)}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <ul className="mt-4 flex flex-col gap-3 lg:hidden">
            {shown.map((cell) => (
              <li key={cell.id} className="border-line border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-base font-medium">
                    <Link href={meetingsHref(cell, month)} className={LINK}>
                      {cell.cell_id}
                    </Link>
                  </h3>
                  <CoverageFigure
                    recorded={cell.coverage.recorded}
                    scheduled={cell.coverage.scheduled}
                    unit="meetings recorded"
                  />
                </div>
                <dl className="text-muted mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt>Leader</dt>
                    <dd className="text-ink">{cell.leader.full_name}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Meets</dt>
                    <dd className="text-ink">
                      {dayOfWeekLabel(cell.schedule.day_of_week)}, {cell.schedule.time_of_day}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Behind</dt>
                    <dd className="text-ink">{behindLabel(cell)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          {/*
            **How many Cells of this list are behind, not a figure of the report.** It counts
            rows of the Cells list in scope, every page of it, by decision 0267's predicate,
            and it is in words beside its complement rather than as a share of anything.
          */}
          <p className="text-muted mt-4 text-sm">
            {behindCount} behind · {all.length - behindCount} not behind
          </p>

          <div className="mt-6 flex gap-3">
            {start > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
            ) : null}
            {start + PAGE_SIZE < rows.length ? (
              <Button type="button" variant="secondary" onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** In words, and only where it is above zero (sections 13 and 23: never colour alone). */
function behindLabel(cell: CellSummary): string {
  const behind = behindOf(cell.coverage);
  return behind === 0 ? 'None' : `${behind} behind`;
}

function meetingsHref(cell: CellSummary, month: string): string {
  return `/cells/${cell.id}/meetings?month=${month}`;
}

/**
 * The DCC coverage line, one row per Sunday of the month.
 *
 * **A removed Sunday keeps its row** and says it is not counted, because section 9 asks
 * a report covering the month to explain four Sundays where the calendar holds five. A
 * Sunday nobody could record yet reads in words rather than as a zero (decision 0229).
 *
 * The caller leaves this out when a Network is chosen: the calendar's figures are not
 * narrowed by Network, so a row here would count people the report above does not.
 */
export function CoverageBySunday({ month }: { month: string }) {
  // The same query as /dcc, your month, so moving between the two reads it once.
  const events = useQuery({
    queryKey: ['dcc-events', month],
    queryFn: ({ signal }) => listDccEvents(month, signal),
  });

  return (
    <section aria-labelledby="coverage-by-sunday-heading" className="mt-6">
      <h2 id="coverage-by-sunday-heading" className="field-label">
        Coverage by Sunday
      </h2>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Each Sunday of the month, with the records filed for it across your scope. The rows
        are not added up here: the line at the top is the report&rsquo;s own figure.
      </p>

      <div className="mt-4">
        <FailureNotice failure={events.isError ? describeFailure(events.error) : null} />
      </div>

      {events.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : events.data && events.data.data.length === 0 ? (
        <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
          The calendar holds no Sundays for this month.
        </p>
      ) : events.data ? (
        <>
          <Table caption="Records filed for each Sunday" className="mt-4 hidden lg:block">
            <thead>
              <tr>
                <HeaderCell>Sunday</HeaderCell>
                <HeaderCell>Records filed</HeaderCell>
                <HeaderCell>Details</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {events.data.data.map((event) => (
                <tr key={event.id} className={rowClasses}>
                  <td className="px-3 py-3">
                    <Link href={`/dcc/${event.id}`} className={`${LINK} font-medium`}>
                      {dayLabel(event.event_date)}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <SundayFigure event={event} />
                  </td>
                  <td className="px-3 py-3">
                    <SundayDetails event={event} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          <ul className="mt-4 flex flex-col gap-3 lg:hidden">
            {events.data.data.map((event) => (
              <li key={event.id} className="border-line border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-base font-medium">
                    <Link href={`/dcc/${event.id}`} className={LINK}>
                      {dayLabel(event.event_date)}
                    </Link>
                  </h3>
                  <SundayFigure event={event} />
                </div>
                <p className="mt-2 max-w-2xl">
                  <SundayDetails event={event} />
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function SundayFigure({ event }: { event: DccEvent }) {
  return (
    <CoverageFigure
      recorded={event.coverage?.met ?? null}
      scheduled={event.coverage?.owed ?? null}
      unit="records filed"
      nothingOwed={event.removed ? 'No records owed — no service' : 'No records owed yet'}
    />
  );
}

function SundayDetails({ event }: { event: DccEvent }) {
  return (
    <>
      {dccEventNote(event)}
      {event.removed ? <span className="text-muted text-sm"> Not counted this month.</span> : null}
    </>
  );
}
