'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { Button, buttonClasses } from '@/components/ui/button';
import { CursorPager } from '@/components/ui/cursor-pager';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { Field } from '@/components/ui/field';
import { CellApprovals } from '@/components/cell-approvals';
import { CloseCellDialog } from '@/components/close-cell-dialog';
import { RestartCellDialog } from '@/components/restart-cell-dialog';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  categoryLabel,
  cellShortName,
  closedOnLabel,
  closureReasonLabel,
  dayOfWeekLabel,
  getCellCounts,
  listCells,
  type CellSummary,
  type QuietMonth,
} from '@/lib/cells';
import { listApprovalRequests } from '@/lib/cell-approvals';
import { useCursorPages } from '@/lib/cursor-pages';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { reportingMonthOf } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';
import { useSearchTerm } from '@/lib/search-term';
import { cn } from '@/lib/utils';

/** Ten a page, as the People list pages (decision 0261). */
const PAGE_SIZE = 10;

/** The page's tabs, each a view of one address (decision 0366). */
const VIEWS = ['ACTIVE', 'FEW', 'QUIET', 'CLOSED', 'APPROVE'] as const;
type CellsView = (typeof VIEWS)[number];

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
  const viewParam = search.get('view');
  const viewInAddress: CellsView = VIEWS.includes(viewParam as CellsView)
    ? (viewParam as CellsView)
    : 'ACTIVE';
  // The radio follows the click at once and the address a moment later, because a control
  // that waits for a navigation to show what was chosen reads as a control that missed it.
  // The address still decides, which is what makes Back and a reload work: the block below
  // takes whatever it says.
  const [view, setView] = useState(viewInAddress);
  const { term, setTerm, trimmed, tooShort, buttonLabel } = useSearchTerm(submitted);
  // Any narrowing — including one arrived at by pressing Back — starts the list again.
  const asked = `${month}|${String(mineOnly)}|${submitted}|${viewInAddress}`;
  const pages = useCursorPages(asked);

  // Adjusted while rendering rather than in an effect, which is React's own answer for state
  // that follows something from outside: an effect would render the old list once first.
  const [lastAsked, setLastAsked] = useState(asked);
  if (lastAsked !== asked) {
    setLastAsked(asked);
    setTerm(submitted);
    setView(viewInAddress);
  }
  const [restarting, setRestarting] = useState<CellSummary | null>(null);
  const [closing, setClosing] = useState<CellSummary | null>(null);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  // Offered only where the route would answer; the route still decides (section 1, principle 4).
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const mayCreate = holdsWholeChurch(me.data, 'cell.approve_leadership');
  // **The administrator's lists** (decision 0366): *Under 3 Member Cells*, *Inactive (3+
  // Months) Cells* and *Closed Cells* are offered to an account holding `cell.manage_lifecycle`
  // at Whole Church, which is who closes a Cell (decision 0355) and the same answer the server
  // gives as `may_close`. A Full view leader holds it over their own branch and sees Active
  // Cells alone. Keyed on a capability's reach, never on a role (decision 0323, point 5).
  const administers = holdsWholeChurch(me.data, 'cell.manage_lifecycle');
  // Cells to Approve (decision 0352): for an account that may decide Cell leadership requests,
  // at Whole Church or, ticked Approves Cells, over its own branch.
  const approver = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'cell.approve_leadership',
  );
  const offered: readonly CellsView[] = [
    'ACTIVE',
    ...(administers ? (['FEW', 'QUIET', 'CLOSED'] as const) : []),
    ...(approver ? (['APPROVE'] as const) : []),
  ];
  // A view the account is not offered opens Active Cells, once the server has named the
  // account's screens; until then the address is taken at its word.
  const shown: CellsView = me.data === undefined || offered.includes(view) ? view : 'ACTIVE';
  const closed = shown === 'CLOSED';
  const fewOnly = shown === 'FEW';
  // Section 15's *No meeting in 3 months* (decision 0355).
  const quietOnly = shown === 'QUIET';
  // *Only my Cells* belongs to the two views carrying it: the cards on Active Cells and the
  // button on Closed Cells.
  const mineApplies = shown === 'ACTIVE' || closed;
  const approvals = useQuery({
    queryKey: ['cell-approvals'],
    queryFn: ({ signal }) => listApprovalRequests(signal),
    enabled: approver,
  });
  const cells = useQuery({
    queryKey: ['cells', month, mineOnly && mineApplies, submitted, pages.cursor, PAGE_SIZE, shown],
    queryFn: ({ signal }) =>
      listCells(
        {
          month,
          ledBy: mineOnly && mineApplies ? 'me' : undefined,
          q: submitted === '' ? undefined : submitted,
          cursor: pages.cursor,
          limit: PAGE_SIZE,
          state: closed ? 'CLOSED' : 'ACTIVE',
          fewerThanThree: fewOnly,
          noMeeting: quietOnly,
        },
        signal,
      ),
    enabled: shown !== 'APPROVE',
  });
  // The number is the church-wide setting's (decision 0355), known once the Inactive list has
  // answered; three until then, which is the setting's seeded value and which nothing in the
  // product can change today.
  const quietMonths = cells.data?.no_meeting_months ?? [];
  const quietCount = (quietOnly ? quietMonths.length : 0) || 3;
  const quietLabel = `${quietCount} months`;
  const everyTab: [CellsView, string, number | null][] = [
    ['ACTIVE', 'Active Cells', null],
    ['FEW', 'Under 3 Member Cells', null],
    ['QUIET', `Inactive (${quietCount}+ Months) Cells`, null],
    ['CLOSED', 'Closed Cells', null],
    ['APPROVE', 'Cells to Approve', approvals.data?.length ?? null],
  ];
  const tabs = everyTab.filter(([key]) => offered.includes(key));

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cells</h1>
          <p className="text-muted text-sm">Your Cells and this month&rsquo;s meetings.</p>
        </div>
        {mayCreate ? (
          <Link href="/cells/new" className={buttonClasses('primary')}>
            New Cell
          </Link>
        ) : null}
      </div>

      {/*
        **Views of one list, never a mixed one** (decision 0266): every count of Cells means
        active Cells unless it says otherwise (section 10), so a closed Cell is shown only
        where the reader has asked for closed ones. Section 15's two lists are tabs of their
        own beside them, the administrator's (decision 0366), and the chosen tab opens into
        the pane holding everything of it (owner's choice of 2026-10-05). Buttons pressed and
        unpressed, as Record's lists are: each is a view of this one address. **The row wraps**,
        so on a phone no tab runs off the edge. None until the server names the account's
        screens, so no account sees another's tabs flash.
      */}
      <div
        role="group"
        aria-label="Which Cells"
        className={cn('mt-6 flex min-h-11 flex-wrap items-end', TAB_ROW)}
      >
        {me.data === undefined ? null : tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={shown === key}
            onClick={() => {
              setView(key);
              go({ view: key === 'ACTIVE' ? null : key, mine: null });
            }}
            className={cn(tabClasses(shown === key), 'inline-flex items-center gap-2')}
          >
            {label}
            {/* A count of 0 shows no box, as on Record's tabs (decision 0349). */}
            {count ? (
              <span className="inline-block min-w-5 border border-current px-1 text-center leading-4 tabular-nums">
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className={TAB_PANE}>
        {shown === 'APPROVE' ? (
          <CellApprovals wholeChurch={holdsWholeChurch(me.data, 'cell.approve_leadership')} />
        ) : (
        <>
        {/* Every control in one bar, above the table (owner's choice, 2026-09-22). */}
        <div className={`mt-4 ${CONTROL_BAR}`}>
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
            {buttonLabel}
          </Button>
        </form>

          {/*
            No month in the closed view: it lists when a Cell closed and whether it may
            restart, and neither is a figure for a period.
          */}
          {/* Nor with *No meeting in 3 months*, whose window is its own (decision 0355). */}
          {closed || quietOnly ? null : (
            <MonthPicker
              month={month}
              onChange={(next) => go({ month: next })}
              open={cells.data?.open}
            />
          )}
          {/*
            One control per job (owner's choice of 2026-10-05): among active Cells the cards
            below are the filter, so this is offered for closed Cells alone.
          */}
          {closed ? (
            <Button
              type="button"
              variant="secondary"
              aria-pressed={mineOnly}
              onClick={() => go({ mine: mineOnly ? null : '1' })}
            >
              {mineOnly ? 'Showing only Cells I led' : 'Show only Cells I led'}
            </Button>
          ) : null}
        </div>

        {/* The totals belong to Active Cells, the list they count (decision 0366). */}
        {shown === 'ACTIVE' ? (
          <CellTotals
            current={submitted === '' && month === reportingMonthOf()}
            mineOnly={mineOnly}
            onChoose={(mine) => go({ mine: mine ? '1' : null, month: null, view: null, q: null })}
          />
        ) : null}

        <div className="mt-8">
          <FailureNotice failure={cells.isError ? describeFailure(cells.error) : null} />
        </div>

        {cells.isPending ? (
          <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
        ) : cells.data && cells.data.data.length === 0 ? (
          <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
            {submitted !== ''
              ? `No Cell you oversee matches “${submitted}”.`
              : closed
                ? mineOnly && mineApplies
                  ? 'No Cell you led has closed.'
                  : 'No Cell you oversee has closed.'
                : quietOnly
                  ? `No Cell you oversee has gone the last ${quietLabel} without a meeting. A Cell newer than that, or whose leader still has time to record, is not listed.`
                  : fewOnly
                  ? 'Every Cell you oversee has at least 3 members.'
                  : mineOnly && mineApplies
                ? 'You do not lead a Cell this month.'
                : 'There are no Cells you oversee this month.'}
          </p>
        ) : cells.data && closed ? (
          <>
            <Table caption="Closed Cells you oversee" className="mt-6 hidden lg:block">
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
                    </td>
                    <td className="px-3 py-3">{cell.leader.full_name}</td>
                    <td className="px-3 py-3">
                      {cell.closed_on ? closedOnLabel(cell.closed_on) : ''}
                    </td>
                    <td className="px-3 py-3">
                      {cell.closure_reason ? closureReasonLabel(cell.closure_reason) : ''}
                      {cell.closure_explanation ? (
                        <span className="text-muted mt-1 block text-sm">
                          {cell.closure_explanation}
                        </span>
                      ) : null}
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

            <CursorPager
              label="Closed Cells"
              page={pages.page}
              nextCursor={cells.data.next_cursor}
              onPrevious={pages.previous}
              onNext={() => pages.next(cells.data?.next_cursor)}
            />
          </>
        ) : cells.data && quietOnly ? (
          <>
            <QuietCells
              cells={cells.data.data}
              months={quietMonths}
              month={month}
              onClose={(cell) => setClosing(cell)}
            />
            <CursorPager
              label="Cells with no meeting"
              page={pages.page}
              nextCursor={cells.data.next_cursor}
              onPrevious={pages.previous}
              onNext={() => pages.next(cells.data?.next_cursor)}
            />
          </>
        ) : cells.data ? (
          <>
            <Table caption="Cells you oversee" className="mt-6 hidden lg:block">
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

            <CursorPager
              label="Cells"
              page={pages.page}
              nextCursor={cells.data.next_cursor}
              onPrevious={pages.previous}
              onNext={() => pages.next(cells.data?.next_cursor)}
            />
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

        {closing ? (
          <CloseCellDialog
            open
            cell={{
              id: closing.id,
              name: cellShortName({ ...closing, day_of_week: closing.schedule.day_of_week }),
              leaderName: closing.leader.full_name,
            }}
            onClose={() => setClosing(null)}
            onClosed={() => undefined}
          />
        ) : null}
        </>
        )}
      </div>
    </main>
  );
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
  // Both totals in one request, counted on the server rather than by reading every Cell
  // with its figures (decision 0309).
  const counts = useQuery({
    queryKey: ['cells-counts'],
    queryFn: ({ signal }) => getCellCounts(signal),
  });

  // Every figure carries its scope (section 19), and a whole-church reader's is the church.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const scopeLabel = holdsWholeChurch(me.data, 'cell.view_subtree')
    ? 'Whole Church'
    : 'People you oversee';

  const cards = [
    { mine: true, label: 'Cells you lead', value: counts.data?.led_by_me, scope: 'Your own Cells' },
    { mine: false, label: 'Cells you oversee', value: counts.data?.in_scope, scope: scopeLabel },
  ];

  // A total that failed to load says why, rather than showing a bare dash.
  const failed = counts.isError ? counts.error : null;

  return (
    <>
    {failed ? (
      <div className="mt-6">
        <FailureNotice failure={describeFailure(failed)} />
      </div>
    ) : null}
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
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

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Jul 2026", from a `YYYY-MM-01` month. A fixed list rather than `Intl`, whose short
 * September is "Sept" in one engine and "Sep" in another.
 */
function shortMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);

  return `${SHORT_MONTHS[monthNumber - 1]} ${year}`;
}

/**
 * One month of a quiet Cell, in Section 13's words (decision 0355): how many meetings were
 * recorded as *Did not meet* and how many are *Not recorded*. Never a colour.
 */
function quietMonthText(entry: QuietMonth): string {
  const parts = [
    entry.did_not_meet > 0 ? `Did not meet ${entry.did_not_meet}` : null,
    entry.not_recorded > 0 ? `Not recorded ${entry.not_recorded}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : 'No meeting due';
}

/**
 * Section 15's *No meeting in 3 months* (decision 0355): the running Cells of the reader's
 * scope with no meeting held in the window, each month shown so a quiet Cell is told from one
 * nobody reports on. **Read-only for whoever may not close** — a Primary sees what is
 * happening in their branch and acts by talking to the administrator; `may_close` is the
 * server's answer, and only then is *Close this Cell* offered. Ordered by Cell ID, never by
 * how quiet a Cell is.
 */
function QuietCells({
  cells,
  months,
  month,
  onClose,
}: {
  cells: CellSummary[];
  months: string[];
  month: string;
  onClose: (cell: CellSummary) => void;
}) {
  const anyMayClose = cells.some((cell) => cell.may_close);

  return (
    <>
      <p className="text-muted mt-6 text-sm leading-relaxed">
        No meeting held in{' '}
        {months.length > 0
          ? `${shortMonthLabel(months[0])} to ${shortMonthLabel(months[months.length - 1])}`
          : 'the last 3 months'}
        . A meeting moved to another day that happened counts as held, and a Cell whose leader
        still has time to record is not listed.
      </p>

      <Table caption="Cells with no meeting held" className="mt-4 hidden lg:block">
        <thead>
          <tr>
            <HeaderCell>Cell</HeaderCell>
            <HeaderCell>Leader</HeaderCell>
            <HeaderCell>Members</HeaderCell>
            {months.map((each) => (
              <HeaderCell key={each}>{shortMonthLabel(each)}</HeaderCell>
            ))}
            {anyMayClose ? (
              <HeaderCell>
                <span className="sr-only">Close</span>
              </HeaderCell>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {cells.map((cell) => {
            const name = cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week });

            return (
              <tr key={cell.id} className={rowClasses}>
                <td className="px-3 py-3">
                  <Link href={`/cells/${cell.id}/meetings?month=${month}`} className={`${LINK} font-medium`}>
                    {name}
                  </Link>
                </td>
                <td className="px-3 py-3">{cell.leader.full_name}</td>
                <td className="px-3 py-3">{cell.member_count}</td>
                {(cell.no_meeting ?? []).map((entry) => (
                  <td key={entry.month} className="px-3 py-3 text-sm">
                    {quietMonthText(entry)}
                  </td>
                ))}
                {anyMayClose ? (
                  <td className="px-3 py-3">
                    {cell.may_close ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => onClose(cell)}
                        aria-label={`Close this Cell, ${name}, led by ${cell.leader.full_name}`}
                      >
                        Close this Cell
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </Table>

      <ul className="mt-4 flex flex-col gap-3 lg:hidden">
        {cells.map((cell) => {
          const name = cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week });

          return (
            <li key={cell.id} className="border-line border p-4">
              <h2 className="text-base font-medium">
                <Link href={`/cells/${cell.id}/meetings?month=${month}`} className={LINK}>
                  {name}
                </Link>
              </h2>
              <p className="text-muted mt-1 text-sm">
                {cell.leader.full_name} · {cell.member_count}{' '}
                {cell.member_count === 1 ? 'member' : 'members'}
              </p>
              <dl className="mt-3 grid gap-1 text-sm">
                {(cell.no_meeting ?? []).map((entry) => (
                  <div key={entry.month} className="flex gap-2">
                    <dt className="text-muted">{shortMonthLabel(entry.month)}</dt>
                    <dd>{quietMonthText(entry)}</dd>
                  </div>
                ))}
              </dl>
              {cell.may_close ? (
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onClose(cell)}
                    aria-label={`Close this Cell, ${name}, led by ${cell.leader.full_name}`}
                  >
                    Close this Cell
                  </Button>
                </div>
              ) : null}
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
    return (
      <span className="text-muted text-sm">
        Restarted as{' '}
        {cellShortName({
          cell_id: cell.restarted_as,
          category: cell.restarted_as_category ?? null,
          day_of_week: cell.restarted_as_day_of_week ?? null,
        })}
      </span>
    );
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
        aria-label={`Restart ${cellShortName({
          ...cell,
          day_of_week: cell.schedule.day_of_week,
        })}, led by ${cell.leader.full_name}`}
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
      {/* What the Senior Pastors read (decision 0355); none on a Cell closed before it. */}
      {cell.closure_explanation ? (
        <p className="text-muted mt-2 text-sm leading-relaxed">{cell.closure_explanation}</p>
      ) : null}
      <div className="mt-3">
        <RestartAction cell={cell} sent={sent} onRestart={onRestart} />
      </div>
    </li>
  );
}

/** One Cell, below `lg`. */
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
