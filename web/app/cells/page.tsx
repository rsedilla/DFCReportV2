'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { RestartCellDialog } from '@/components/restart-cell-dialog';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  categoryLabel,
  cellShortName,
  closedOnLabel,
  closureReasonLabel,
  dayOfWeekLabel,
  listCells,
  type CellSummary,
} from '@/lib/cells';
import { MINIMUM_SEARCH_LENGTH } from '@/lib/people';
import { describeFailure } from '@/lib/messages';
import { reportingMonthOf } from '@/lib/reporting-month';

/** Ten a page, as the People list pages (decision 0261). */
const PAGE_SIZE = 10;

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * The Cells of the signed-in leader's scope (SKILL.md sections 10, 12, 15 and 19;
 * decision 0226).
 *
 * **This screen is never ordered by coverage and no row is colour-graded.** A list
 * of Cells ordered worst-first is a leaderboard whatever it is called, and it is
 * the ordering a reader reaches for first — which is why the API decides the order
 * and this screen offers no way to change it. Section 13 forbids rank positions and
 * composite scores without qualification, and forbids an ordered leaderboard as a
 * default or landing view; sections 15, 17 and 19 defer to it by name. There is no
 * sort control here and no comparator anywhere in this file.
 *
 * **`Only my Cells` is a filter over one scope, not a second question.** Decision
 * 0226 makes it the narrower of two readings of the same grant, so it can only ever
 * remove rows the unfiltered list would already have shown. The API applies it as an
 * intersection; this screen just asks for it.
 *
 * **Every row's coverage is two figures.** Section 12 puts coverage first in an
 * aggregate view because its denominator is derived from the schedule rather than
 * submitted — recording less makes coverage worse, never better — and section 13
 * forbids turning the two into a percentage. `0 of 4` is a real and unremarkable
 * reading, and a Cell that scheduled nothing reads `0 of 0` (decision 0225).
 *
 * **A table from `lg`, and cards below it.** The same rows in the same order: at 320px a
 * five-column table is a sideways scroll on the screen a leader uses standing up.
 *
 * **The month is a heading, not a detail.** Section 19 requires the period on every
 * figure, and the next month is not offered at all: a period that has not begun is
 * refused by the API (decision 0216), so a control that led there would only ever
 * produce a validation error.
 */
export default function CellsPage() {
  return (
    <AppShell>
      <CellsIndex />
    </AppShell>
  );
}

function CellsIndex() {
  const [month, setMonth] = useState(() => reportingMonthOf());
  const [mineOnly, setMineOnly] = useState(false);
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<'ACTIVE' | 'CLOSED'>('ACTIVE');
  const [restarting, setRestarting] = useState<CellSummary | null>(null);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const closed = view === 'CLOSED';
  const cells = useQuery({
    queryKey: ['cells', month, mineOnly, submitted, cursors[page], PAGE_SIZE, view],
    queryFn: ({ signal }) =>
      listCells(
        {
          month,
          ledBy: mineOnly ? 'me' : undefined,
          q: submitted === '' ? undefined : submitted,
          cursor: cursors[page],
          limit: PAGE_SIZE,
          state: view,
        },
        signal,
      ),
  });

  const trimmed = term.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MINIMUM_SEARCH_LENGTH;

  /** Any narrowing starts the list again: a cursor belongs to one set of rows. */
  function restart(change: () => void) {
    change();
    setCursors([null]);
    setPage(0);
  }

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">Cells</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        The Cells you oversee, with how many of the month&rsquo;s scheduled meetings have a
        record. The two figures are shown as two; nothing here is scored, ranked, or ordered
        by how much is missing.
      </p>

      <p className="mt-4">
        {/*
          Section 15 puts the people-without-a-Cell list in this module, so it is reached
          from here as well as from the dashboard.
        */}
        <Link href="/cells/people-without-a-cell" className={`${LINK} text-sm`}>
          People without a Cell
        </Link>
      </p>

      {/*
        **The search narrows the whole scope, on the server** (decision 0261): a church-wide
        reader holds hundreds of Cells, and a filter over the page on screen would search ten
        of them. It never reorders the list, which decision 0009 forbids.
      */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooShort) {
            restart(() => setSubmitted(trimmed));
          }
        }}
        className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end"
        noValidate
      >
        <Field
          label="Search by Cell ID or leader"
          type="search"
          name="q"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="min-w-0 sm:flex-1"
        />
        <Button type="submit" disabled={tooShort}>
          {trimmed === '' && submitted !== '' ? 'Show all' : 'Search'}
        </Button>
      </form>

      {/*
        **Two views of one list, never a mixed one** (decision 0266): every count of Cells
        means active Cells unless it says otherwise (section 10), so a closed Cell is shown
        only where the reader has asked for closed ones.
      */}
      <div className="mt-6">
        <RadioGroup
          legend="Show"
          name="view"
          value={view}
          onChange={(next) => restart(() => setView(next))}
          options={[
            { value: 'ACTIVE', label: 'Running Cells' },
            { value: 'CLOSED', label: 'Closed Cells' },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4">
        {/*
          No month in the closed view: it lists when a Cell closed and whether it may
          restart, and neither is a figure for a period.
        */}
        {closed ? (
          <span />
        ) : (
          <MonthPicker
            month={month}
            onChange={(next) => restart(() => setMonth(next))}
            open={cells.data?.open}
          />
        )}
        <Button
          type="button"
          variant="secondary"
          className="mt-6"
          aria-pressed={mineOnly}
          onClick={() => restart(() => setMineOnly((on) => !on))}
        >
          {closed
            ? mineOnly
              ? 'Showing only Cells I led'
              : 'Show only Cells I led'
            : mineOnly
              ? 'Showing only my Cells'
              : 'Show only my Cells'}
        </Button>
      </div>

      <div className="mt-8">
        <FailureNotice failure={cells.isError ? describeFailure(cells.error) : null} />
      </div>

      {cells.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : cells.data && cells.data.data.length === 0 ? (
        <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
          {submitted !== ''
            ? `No Cell in your scope matches “${submitted}”.`
            : closed
              ? mineOnly
                ? 'No Cell you led has closed.'
                : 'No Cell in your scope has closed.'
              : mineOnly
              ? 'You do not lead a Cell this month.'
              : 'There are no Cells in your scope this month.'}
        </p>
      ) : cells.data && closed ? (
        <>
          <Table caption="Closed Cells in your scope" className="mt-6 hidden lg:block">
            <thead>
              <tr>
                <HeaderCell>Cell</HeaderCell>
                <HeaderCell>Last leader</HeaderCell>
                <HeaderCell>Closed</HeaderCell>
                <HeaderCell>Why</HeaderCell>
                <HeaderCell>
                  <span className="sr-only">Restart</span>
                </HeaderCell>
              </tr>
            </thead>
            <tbody>
              {cells.data.data.map((cell) => (
                <tr key={cell.id} className={rowClasses}>
                  <td className="px-3 py-3">
                    <span className="font-medium">
                      {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
                    </span>
                    <span className="text-muted block font-mono text-xs">{cell.cell_id}</span>
                  </td>
                  <td className="px-3 py-3">{cell.leader.full_name}</td>
                  <td className="px-3 py-3">
                    {cell.closed_on ? closedOnLabel(cell.closed_on) : ''}
                  </td>
                  <td className="px-3 py-3">
                    {cell.closure_reason ? closureReasonLabel(cell.closure_reason) : ''}
                  </td>
                  <td className="px-3 py-3">
                    <RestartAction
                      cell={cell}
                      sent={sent.has(cell.id)}
                      onRestart={() => setRestarting(cell)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          <ul className="mt-6 flex flex-col gap-3 lg:hidden">
            {cells.data.data.map((cell) => (
              <ClosedCellCard
                key={cell.id}
                cell={cell}
                sent={sent.has(cell.id)}
                onRestart={() => setRestarting(cell)}
              />
            ))}
          </ul>

          <nav aria-label="Closed Cells" className="mt-6 flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={!cells.data.next_cursor}
              onClick={() => {
                const next = cells.data?.next_cursor;
                if (!next) {
                  return;
                }
                setCursors((current) => [...current.slice(0, page + 1), next]);
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </nav>
        </>
      ) : cells.data ? (
        <>
          <Table caption="Cells in your scope" className="mt-6 hidden lg:block">
            <thead>
              <tr>
                <HeaderCell>Cell</HeaderCell>
                <HeaderCell>Leader</HeaderCell>
                <HeaderCell>Members</HeaderCell>
                <HeaderCell>Meets</HeaderCell>
                <HeaderCell>Recorded</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {cells.data.data.map((cell) => (
                <tr key={cell.id} className={rowClasses}>
                  <td className="px-3 py-3">
                    <Link
                      href={`/cells/${cell.id}/meetings?month=${month}`}
                      className={`${LINK} font-medium`}
                    >
                      {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
                    </Link>
                    <span className="text-muted block font-mono text-xs">{cell.cell_id}</span>
                  </td>
                  <td className="px-3 py-3">{cell.leader.full_name}</td>
                  <td className="px-3 py-3">{cell.member_count}</td>
                  <td className="px-3 py-3">
                    {dayOfWeekLabel(cell.schedule.day_of_week)}, {cell.schedule.time_of_day}
                  </td>
                  <td className="px-3 py-3">
                    <CoverageFigure
                      recorded={cell.coverage.recorded}
                      scheduled={cell.coverage.scheduled}
                      unit="meetings"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          <ul className="mt-6 flex flex-col gap-3 lg:hidden">
            {cells.data.data.map((cell) => (
              <CellCard key={cell.id} cell={cell} month={month} />
            ))}
          </ul>

          {/* No total and no page number: section 22 pages by cursor and returns neither. */}
          <nav aria-label="Cells" className="mt-6 flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={!cells.data.next_cursor}
              onClick={() => {
                const next = cells.data?.next_cursor;
                if (!next) {
                  return;
                }
                setCursors((current) => [...current.slice(0, page + 1), next]);
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </nav>
        </>
      ) : null}

      {restarting ? (
        <RestartCellDialog
          open
          cell={restarting}
          onClose={() => setRestarting(null)}
          onSent={(cellId) => setSent((current) => new Set(current).add(cellId))}
        />
      ) : null}
    </main>
  );
}

/**
 * What a closed Cell offers, in words (section 23: never colour alone). Whether a
 * restart is offered is the server's answer (`may_restart`); this only says which of
 * the other states holds.
 */
function RestartAction({
  cell,
  sent,
  onRestart,
}: {
  cell: CellSummary;
  sent: boolean;
  onRestart: () => void;
}) {
  if (cell.restarted_as) {
    return <span className="text-muted text-sm">Restarted as {cell.restarted_as}</span>;
  }
  if (sent) {
    return <span className="text-muted text-sm">Sent for approval</span>;
  }
  if (cell.may_restart) {
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={onRestart}
        aria-label={`Restart ${cell.cell_id}`}
      >
        Restart…
      </Button>
    );
  }
  return null;
}

/** One closed Cell, below `lg`. */
function ClosedCellCard({
  cell,
  sent,
  onRestart,
}: {
  cell: CellSummary;
  sent: boolean;
  onRestart: () => void;
}) {
  return (
    <li className="border-line border p-4">
      <h2 className="text-base font-medium">
        {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
        <span className="text-muted block font-mono text-xs">{cell.cell_id}</span>
      </h2>
      <dl className="text-muted mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt>Last leader</dt>
          <dd className="text-ink">{cell.leader.full_name}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Closed</dt>
          <dd className="text-ink">{cell.closed_on ? closedOnLabel(cell.closed_on) : ''}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Why</dt>
          <dd className="text-ink">
            {cell.closure_reason ? closureReasonLabel(cell.closure_reason) : ''}
          </dd>
        </div>
      </dl>
      <div className="mt-3">
        <RestartAction cell={cell} sent={sent} onRestart={onRestart} />
      </div>
    </li>
  );
}

/**
 * One Cell, below `lg`. The heading is the Cell&rsquo;s identifier, which section 10
 * makes human-readable and stable.
 */
function CellCard({ cell, month }: { cell: CellSummary; month: string }) {
  return (
    <li className="border-line border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-medium">
          {/*
            `inline-flex` with a 24px minimum height, because 2.5.8 measures the
            target and not the text.
          */}
          <Link href={`/cells/${cell.id}/meetings?month=${month}`} className={LINK}>
            {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
          </Link>
          <span className="text-muted block font-mono text-xs">{cell.cell_id}</span>
        </h2>
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
        {/* The table's Members column, which the cards had left out (decision 0261). */}
        <div className="flex gap-2">
          <dt>Members</dt>
          <dd className="text-ink tabular-nums">{cell.member_count}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Meets</dt>
          <dd className="text-ink">
            {dayOfWeekLabel(cell.schedule.day_of_week)}, {cell.schedule.time_of_day}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>Category</dt>
          <dd className="text-ink">{categoryLabel(cell.category)}</dd>
        </div>
      </dl>
    </li>
  );
}
