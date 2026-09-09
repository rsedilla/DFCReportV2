'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { categoryLabel, dayOfWeekLabel, listCells, type CellSummary } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';
import { reportingMonthOf } from '@/lib/reporting-month';

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

  const cells = useQuery({
    queryKey: ['cells', month, mineOnly],
    queryFn: ({ signal }) =>
      listCells({ month, ledBy: mineOnly ? 'me' : undefined }, signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">Cell Leaders</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        The Cells you oversee, with how many of the month&rsquo;s scheduled meetings have a
        record. The two figures are shown as two; nothing here is scored, ranked, or ordered
        by how much is missing.
      </p>

      <MonthPicker month={month} onChange={setMonth} open={cells.data?.open} />

      <div className="mt-4">
        <Button
          type="button"
          variant="secondary"
          aria-pressed={mineOnly}
          onClick={() => setMineOnly((on) => !on)}
        >
          {mineOnly ? 'Showing only my Cells' : 'Show only my Cells'}
        </Button>
      </div>

      <div className="mt-8">
        <FailureNotice failure={cells.isError ? describeFailure(cells.error) : null} />
      </div>

      {cells.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : cells.data && cells.data.data.length === 0 ? (
        <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
          {mineOnly
            ? 'You do not lead a Cell this month.'
            : 'There are no Cells in your scope this month.'}
        </p>
      ) : cells.data ? (
        <ul className="mt-6 flex flex-col gap-3">
          {cells.data.data.map((cell) => (
            <CellRow key={cell.id} cell={cell} month={month} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}

/**
 * One Cell.
 *
 * A card rather than a table row, because at 320px a five-column table is a
 * horizontal scroll on the screen a leader uses standing up. The heading is the
 * Cell&rsquo;s identifier, which section 10 makes human-readable and stable.
 */
function CellRow({ cell, month }: { cell: CellSummary; month: string }) {
  return (
    <li className="border-line rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-medium">
          {/*
            `inline-flex` with a 24px minimum height, because 2.5.8 measures the
            target and not the text. As inline text at this size the link was 20px
            tall — which is the sort of thing no reader would report and every
            thumb would feel.
          */}
          <Link
            href={`/cells/${cell.id}/meetings?month=${month}`}
            className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {cell.cell_id}
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
        <div className="flex gap-2">
          <dt>Category</dt>
          <dd className="text-ink">{categoryLabel(cell.category)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Meets</dt>
          <dd className="text-ink">
            {dayOfWeekLabel(cell.schedule.day_of_week)}, {cell.schedule.time_of_day}
          </dd>
        </div>
      </dl>
    </li>
  );
}
