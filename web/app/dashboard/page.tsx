'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { FailureNotice } from '@/components/ui/failure-notice';
import { listCellMeetings, listCells, type CellSummary } from '@/lib/cells';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { awaitingReassignment } from '@/lib/people';
import { getCellMonthlyReport, getDccMonthlyReport } from '@/lib/reports';
import { dayLabel, monthLabel, reportingMonthOf } from '@/lib/reporting-month';

/**
 * How many people needing a leader the dashboard tile shows before deferring to the
 * full list (section 19).
 *
 * A dashboard entry is a prompt to act, not the list itself: section 15 forbids
 * ranking, so a longer tile would be a longer arbitrary slice rather than a more
 * useful one. The screen behind it pages honestly.
 */
const UNPLACED_TILE = 5;

/**
 * Where a signed-in leader lands (SKILL.md section 19).
 *
 * **Outstanding work comes above the numbers, and that is the whole design.**
 * Section 19 is blunt about it: "A dashboard of counts tells a leader nothing to
 * act on." So the first thing on this screen is the meetings awaiting a record,
 * each one a link to the form that resolves it, and the second is the Cells whose
 * coverage line shows something missing. The figures follow.
 *
 * **Every tile carries what it counts, its value, its scope and its period**
 * (section 19). A tile reading `12` and a tile reading `11,480` are the same tile
 * for two different people, and a figure without its scope "cannot be discussed,
 * screenshotted, or compared".
 *
 * **Current-state and period-based figures are in separate sections and never
 * interleaved.** Section 3 draws that line and section 19 says a dashboard is
 * where it is most easily lost: how many Cells you oversee is true today, and how
 * many people attended is true of a month. Putting them in one row invites a
 * reader to compare them.
 *
 * **An open month says so**, because the same tile on the 5th and the 31st shows
 * very different numbers with nothing having happened (sections 17 and 19).
 *
 * **Attendance counts unique people and never occurrences** (section 19, principle
 * 10). Both figures here come from the reporting routes, which count distinct
 * people; nothing on this screen sums attendances.
 *
 * **Two of section 19's five outstanding-work lists have no route yet** and are
 * named here rather than faked: people with no active Cell membership within the
 * actor's scope, and the outcome of a Cell leadership request the actor
 * submitted — the latter being a question `CLAUDE.md` records as open, since
 * section 7 names no capability for such a read. A third is partly served: a
 * **closed** Cell's meetings are not reachable, because the Cells index is
 * `ACTIVE`-only and nothing supplies the identifier.
 *
 * **Nothing here is ranked or colour-graded** (sections 13, 17 and 19). The
 * attention list is filtered rather than sorted, in the order the API returns.
 */
export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const month = reportingMonthOf();

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // Section 20's attention list (decision 0232). It takes no month: the list asks
  // about now, so it is deliberately not keyed on the period the figures below use.
  //
  // One more than the tile shows, so "is there more than this" is answered by the
  // read rather than by a second request — the same trick the collection endpoints
  // use one layer down, and section 22 returns no total to ask instead.
  const unplaced = useQuery({
    queryKey: ['awaiting-reassignment', 'dashboard'],
    queryFn: ({ signal }) => awaitingReassignment({ limit: UNPLACED_TILE + 1 }, signal),
  });

  const mine = useQuery({
    queryKey: ['cells', month, true],
    queryFn: ({ signal }) => listCells({ month, ledBy: 'me' }, signal),
  });

  const scoped = useQuery({
    queryKey: ['cells', month, false],
    queryFn: ({ signal }) => listCells({ month }, signal),
  });

  // One request per Cell the actor leads, because a meeting awaiting a record is
  // a property of a meeting rather than of the Cell — the index carries the two
  // coverage figures and never which meetings are missing.
  const meetings = useQueries({
    queries: (mine.data?.data ?? []).map((cell) => ({
      queryKey: ['cell-meetings', cell.id, month],
      queryFn: ({ signal }: { signal: AbortSignal }) => listCellMeetings(cell.id, month, signal),
    })),
  });

  /**
   * The scope the figures are read at, and why it is not always the actor.
   *
   * **A Whole Church grant is read as Whole Church.** Keying every tile on the
   * signed-in person's own subtree is right for a leader and wrong for anybody
   * holding a church-wide grant who is not themselves in the pastoral tree —
   * section 5 permits exactly that for an administrator, and section 20 then
   * places them in no subtree at all. The tiles read `0` while the attention
   * list above them showed real Cells, which is the disagreement this fixes.
   */
  const reportScope = holdsWholeChurch(me.data, 'reports.view_subtree')
    ? ({ kind: 'WHOLE_CHURCH' } as const)
    : ({ kind: 'LEADER', person_id: me.data?.person_id ?? '' } as const);

  const scopeLabel = holdsWholeChurch(me.data, 'reports.view_subtree')
    ? 'Whole Church'
    : 'People you oversee';

  const cellFigures = useQuery({
    queryKey: ['cell-report', month, reportScope],
    queryFn: ({ signal }) => getCellMonthlyReport(month, reportScope, signal),
    enabled: me.data !== undefined,
  });

  const dccFigures = useQuery({
    queryKey: ['dcc-report', month, reportScope],
    queryFn: ({ signal }) => getDccMonthlyReport(month, reportScope, signal),
    enabled: me.data !== undefined,
  });

  const awaiting = (mine.data?.data ?? []).flatMap((cell, index) => {
    const entries = meetings[index]?.data?.meetings ?? [];

    return entries
      .filter((entry) => entry.meeting === null)
      .map((entry) => ({ cell, date: entry.scheduled_date }));
  });

  const needingAttention = (scoped.data?.data ?? []).filter(
    (cell) => cell.coverage.recorded < cell.coverage.scheduled,
  );

  // **Every query on this page, not the three it started with.** Section 19 puts
  // outstanding work above the figures precisely so a leader can trust it, and a
  // failed load that renders as an empty list says "nothing to do" on this screen's
  // authority. `meetings` is the one that matters most: without it a failed
  // `listCellMeetings` yields an empty `awaiting` and prints "Nothing outstanding
  // for your own Cells this month", which is the opposite of the truth.
  const meetingsFailed = meetings.find((query) => query.isError);

  const failure = mine.isError
    ? describeFailure(mine.error)
    : meetingsFailed
      ? describeFailure(meetingsFailed.error)
      : scoped.isError
        ? describeFailure(scoped.error)
        : unplaced.isError
          ? describeFailure(unplaced.error)
          : cellFigures.isError
            ? describeFailure(cellFigures.error)
            : dccFigures.isError
              ? describeFailure(dccFigures.error)
              : me.isError
                ? describeFailure(me.error)
                : null;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">
        {me.data?.first_name ? `Welcome, ${me.data.first_name}` : 'Dashboard'}
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        What needs doing comes first. The figures below it are for {monthLabel(month)}, and
        their scope is {scopeLabel}.
      </p>

      <div className="mt-8">
        <FailureNotice failure={failure} />
      </div>

      <section className="mt-8" aria-labelledby="awaiting-heading">
        <h2 id="awaiting-heading" className="text-lg font-medium">
          Meetings awaiting a record
        </h2>
        {mine.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : awaiting.length === 0 ? (
          <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
            Nothing outstanding for your own Cells this month.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {awaiting.map(({ cell, date }) => (
              <li key={`${cell.id}-${date}`} className="border-line rounded-lg border p-4">
                {/*
                  Each entry carries the action that resolves it (section 19),
                  which is the recording form for that meeting rather than a
                  count of how many are missing.
                */}
                <Link
                  href={`/cells/${cell.id}/meetings/${date}`}
                  className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm text-base font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {cell.cell_id} — {dayLabel(date)}
                </Link>
                <p className="text-muted mt-1 text-sm">Record who was there</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="attention-heading">
        <h2 id="attention-heading" className="text-lg font-medium">
          Cells with meetings still to record
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Within your scope, in no particular order. This is a filter, not a ranking.
        </p>
        {scoped.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : needingAttention.length === 0 ? (
          <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
            Every Cell in your scope has recorded all of this month&rsquo;s meetings.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {needingAttention.map((cell) => (
              <AttentionRow key={cell.id} cell={cell} month={month} />
            ))}
          </ul>
        )}
      </section>

      {/*
        Section 19's fifth outstanding-work entry, and section 20 requires the list
        behind it (decision 0232). It sits with the other outstanding work rather than
        with the figures because it is something to do, not something to read.

        **Undated, so it is above the period heading rather than under it.** The list
        asks about now: somebody reassigned last week needs no action today, whatever a
        past month's chain looked like. Putting it below would attach it to the month
        selector and make it look like a figure for a period, which is exactly the line
        section 3 draws and section 19 says a dashboard is where it is most easily lost.
      */}
      <section className="mt-10" aria-labelledby="unplaced-heading">
        <h2 id="unplaced-heading" className="text-lg font-medium">
          People needing a leader
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Their own pastoral leader no longer holds an assignment. Listed by name, never by
          how long they have waited.
        </p>
        {unplaced.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : unplaced.data && unplaced.data.data.length === 0 ? (
          <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
            Everyone in your scope has a pastoral leader who is still in place.
          </p>
        ) : unplaced.data ? (
          <>
            <ul className="mt-4 flex flex-col gap-3">
              {unplaced.data.data.slice(0, UNPLACED_TILE).map((person) => (
                <li key={person.id} className="border-line rounded-lg border p-4">
                  {/*
                    The action that resolves it (section 19) is the reassignment, which
                    lives on the person's place in the tree.
                  */}
                  <Link
                    href={`/people/${person.id}/network`}
                    className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm text-base font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {person.full_name}
                  </Link>
                  <p className="text-muted mt-1 text-sm">
                    Was under {person.former_leader.full_name}
                  </p>
                </li>
              ))}
            </ul>
            {/*
              **Unconditional, and it was not.** The link was shown only when the tile
              overflowed, so with one to five people waiting — the ordinary case — the
              screen had no route into it from anywhere in the application. The
              coverage ledger cannot see that: it asks whether every route has a
              screen and never whether every screen can be reached, which is decision
              0213's own blind spot one direction over.
            */}
            <p className="mt-4">
              <Link
                href="/people/awaiting-reassignment"
                className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {unplaced.data.data.length > UNPLACED_TILE || unplaced.data.next_cursor !== null
                  ? 'See everyone waiting for a leader'
                  : 'Open the full list'}
              </Link>
            </p>
          </>
        ) : null}
      </section>

      {/*
        Period-based figures, kept apart from the current-state section below.
        Section 3 draws that line and section 19 says a dashboard is where it is
        most easily lost.
      */}
      <section className="mt-12" aria-labelledby="period-heading">
        <h2 id="period-heading" className="text-lg font-medium">
          {monthLabel(month)}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Tile
            counts="Cell attendance"
            value={cellFigures.data ? String(cellFigures.data.unique_people) : '—'}
            unit="people attended"
            scope={scopeLabel}
            period={periodLabel(month, cellFigures.data?.open)}
            href="/reports/cells"
          />
          <Tile
            counts="DCC attendance"
            value={dccFigures.data ? String(dccFigures.data.unique_people) : '—'}
            unit="people attended"
            scope={scopeLabel}
            period={periodLabel(month, dccFigures.data?.open)}
            href="/reports/dcc"
          />
          <Tile
            counts="Cell recording coverage"
            value={
              cellFigures.data ? (
                <CoverageFigure
                  recorded={cellFigures.data.coverage.recorded}
                  scheduled={cellFigures.data.coverage.scheduled}
                  unit="meetings recorded"
                />
              ) : (
                '—'
              )
            }
            scope={scopeLabel}
            period={periodLabel(month, cellFigures.data?.open)}
            href="/reports/cells"
          />
          <Tile
            counts="DCC recording coverage"
            value={
              dccFigures.data ? (
                <CoverageFigure
                  recorded={dccFigures.data.coverage.met}
                  scheduled={dccFigures.data.coverage.owed}
                  unit="records filed"
                />
              ) : (
                '—'
              )
            }
            scope={scopeLabel}
            period={periodLabel(month, dccFigures.data?.open)}
            href="/reports/dcc"
          />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="current-heading">
        <h2 id="current-heading" className="text-lg font-medium">
          As things stand today
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Tile
            counts="Cells you lead"
            value={mine.data ? String(mine.data.data.length) : '—'}
            scope="Your own Cells"
            period="As of today"
            href="/cells?led_by=me"
          />
          <Tile
            counts="Cells in your scope"
            value={scoped.data ? String(scoped.data.data.length) : '—'}
            scope={scopeLabel}
            period="As of today"
            href="/cells"
          />
        </div>
      </section>
    </main>
  );
}

/** Section 17: a period still open for submission is still changing. */
function periodLabel(month: string, open: boolean | undefined): string {
  if (open === undefined) {
    return monthLabel(month);
  }

  return open ? `${monthLabel(month)} · still open` : `${monthLabel(month)} · closed`;
}

/**
 * One tile, carrying the four things section 19 requires of every one.
 *
 * The scope and period are not decoration and are not optional props: a figure
 * without them cannot be discussed or compared, which is that section's own
 * reason. They are required by this component's type so a tile cannot be added
 * without them.
 */
function Tile({
  counts,
  value,
  unit,
  scope,
  period,
  href,
}: {
  counts: string;
  value: React.ReactNode;
  unit?: string;
  scope: string;
  period: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="border-line focus-visible:outline-accent block rounded-lg border p-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <p className="text-muted text-sm">{counts}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {unit ? <p className="text-muted text-sm">{unit}</p> : null}
      <p className="text-muted mt-3 text-sm">
        {scope} · {period}
      </p>
    </Link>
  );
}

function AttentionRow({ cell, month }: { cell: CellSummary; month: string }) {
  return (
    <li className="border-line rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-medium">
          <Link
            href={`/cells/${cell.id}/meetings?month=${month}`}
            className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {cell.cell_id}
          </Link>
        </h3>
        <CoverageFigure
          recorded={cell.coverage.recorded}
          scheduled={cell.coverage.scheduled}
          unit="meetings recorded"
        />
      </div>
      <p className="text-muted mt-2 text-sm">Led by {cell.leader.full_name}</p>
    </li>
  );
}
