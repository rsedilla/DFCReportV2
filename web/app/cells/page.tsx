'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR } from '@/components/ui/frame';
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
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { reportingMonthOf } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';
import { cn } from '@/lib/utils';

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
  // What the reader is looking at lives in the address, so Back steps back through the
  // month, the search, the filter and the view, and a reload opens the same list.
  const search = useSearchParams();
  const go = useScreenAddress();
  const month = search.get('month') ?? reportingMonthOf();
  const mineOnly = search.get('mine') === '1';
  const submitted = search.get('q') ?? '';
  const viewInAddress: 'ACTIVE' | 'CLOSED' = search.get('view') === 'CLOSED' ? 'CLOSED' : 'ACTIVE';
  // The radio follows the click at once and the address a moment later, because a control
  // that waits for a navigation to show what was chosen reads as a control that missed it.
  // The address still decides, which is what makes Back and a reload work: the block below
  // takes whatever it says.
  const [view, setView] = useState(viewInAddress);
  // What is being typed is not yet what is being asked, so it stays here; it follows the
  // address, which is what Back and a reload change underneath it.
  const [term, setTerm] = useState(submitted);
  // Paging is deliberately not in the address: a cursor belongs to one set of rows, and an
  // address carrying one would break as soon as the rows behind it changed. Any narrowing —
  // including one arrived at by pressing Back — starts the list again.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);

  // Adjusted while rendering rather than in an effect, which is React's own answer for state
  // that follows something from outside: an effect would render the old list once first.
  const asked = `${month}|${String(mineOnly)}|${submitted}|${viewInAddress}`;
  const [lastAsked, setLastAsked] = useState(asked);
  if (lastAsked !== asked) {
    setLastAsked(asked);
    setTerm(submitted);
    setView(viewInAddress);
    setCursors([null]);
    setPage(0);
  }
  const [restarting, setRestarting] = useState<CellSummary | null>(null);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const closed = view === 'CLOSED';
  // Offered only where the route would answer; the route still decides (section 1, principle 4).
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const mayCreate = holdsWholeChurch(me.data, 'cell.approve_leadership');
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


  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Cells</h1>
        {/* Section 15 puts the people-without-a-Cell list in this module (owner's choice of
            2026-09-25: a button beside New Cell). */}
        <div className="flex flex-wrap gap-3">
          <Link href="/cells/people-without-a-cell" className={buttonClasses('secondary')}>
            People without a Cell
          </Link>
          {mayCreate ? (
            <Link href="/cells/new" className={buttonClasses('primary')}>
              New Cell
            </Link>
          ) : null}
        </div>
      </div>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Your Cells, and this month&rsquo;s meetings recorded.
      </p>

      <CellTotals
        current={!closed && submitted === '' && month === reportingMonthOf()}
        mineOnly={mineOnly}
        onChoose={(mine) => go({ mine: mine ? '1' : null, month: null, view: null, q: null })}
      />

      {/* Every control in one bar, above the table (owner's choice, 2026-09-22). */}
      <div className={`mt-6 ${CONTROL_BAR}`}>
      {/*
        **The search narrows the whole scope, on the server** (decision 0261): a church-wide
        reader holds hundreds of Cells, and a filter over the page on screen would search ten
        of them. It never reorders the list, which decision 0009 forbids.
      */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooShort) {
            go({ q: trimmed });
          }
        }}
        className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end lg:w-auto lg:min-w-72 lg:flex-1"
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
        <RadioGroup
          legend="Show"
          name="view"
          value={view}
          onChange={(next) => {
            setView(next);
            go({ view: next === 'CLOSED' ? 'CLOSED' : null });
          }}
          options={[
            { value: 'ACTIVE', label: 'Running Cells' },
            { value: 'CLOSED', label: 'Closed Cells' },
          ]}
        />

        {/*
          No month in the closed view: it lists when a Cell closed and whether it may
          restart, and neither is a figure for a period.
        */}
        {closed ? null : (
          <MonthPicker
            month={month}
            onChange={(next) => go({ month: next })}
            open={cells.data?.open}
          />
        )}
        <Button
          type="button"
          variant="secondary"
          aria-pressed={mineOnly}
          onClick={() => go({ mine: mineOnly ? null : '1' })}
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
 * How many running Cells, counted through every page, since the list returns no total
 * (section 22).
 */
async function countCells(month: string, mine: boolean, signal?: AbortSignal): Promise<number> {
  let count = 0;
  let cursor: string | null = null;

  do {
    const page = await listCells(
      { month, ledBy: mine ? 'me' : undefined, cursor, limit: 200 },
      signal,
    );
    count += page.data.length;
    cursor = page.next_cursor;
  } while (cursor !== null);

  return count;
}

/**
 * The two totals, as of today, at the head of the list they count (decision 0289). Each
 * is also the filter that shows those Cells, the way the Growth tabs' cards are, and the
 * one matching what the list shows is marked as pressed.
 */
function CellTotals({
  current,
  mineOnly,
  onChoose,
}: {
  /** The list is today's running Cells, unsearched, so a total describes it. */
  current: boolean;
  mineOnly: boolean;
  onChoose: (mine: boolean) => void;
}) {
  const month = reportingMonthOf();
  const mine = useQuery({
    queryKey: ['cells-count', month, true],
    queryFn: ({ signal }) => countCells(month, true, signal),
  });
  const scoped = useQuery({
    queryKey: ['cells-count', month, false],
    queryFn: ({ signal }) => countCells(month, false, signal),
  });

  // Every figure carries its scope (section 19), and a whole-church reader's is the church.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const scopeLabel = holdsWholeChurch(me.data, 'cell.view_subtree')
    ? 'Whole Church'
    : 'The Cells you oversee';

  const cards = [
    { mine: true, label: 'Cells you lead', value: mine.data, scope: 'Your own Cells' },
    { mine: false, label: 'Cells in your scope', value: scoped.data, scope: scopeLabel },
  ];

  // A total that failed to load says why, rather than showing a bare dash.
  const failed = mine.isError ? mine.error : scoped.isError ? scoped.error : null;

  return (
    <>
    {failed ? (
      <div className="mt-6">
        <FailureNotice failure={describeFailure(failed)} />
      </div>
    ) : null}
    <ul className="mt-6 grid gap-3 sm:grid-cols-2">
      {cards.map((card) => {
        const pressed = current && mineOnly === card.mine;

        return (
          <li key={card.label}>
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => onChoose(card.mine)}
              className={cn(
                'bg-surface flex h-full min-h-11 w-full flex-col items-start border p-3 text-left',
                'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
                pressed
                  ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]'
                  : 'border-edge hover:bg-raised',
              )}
            >
              <span className="text-accent text-xs font-bold tracking-[0.08em] uppercase">
                {card.label}
              </span>
              <span className="mt-1 text-2xl font-bold tabular-nums">{card.value ?? '–'}</span>
              <span className="text-muted mt-auto pt-1 text-xs">{card.scope} · as of today</span>
            </button>
          </li>
        );
      })}
    </ul>
    </>
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
