'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { GrowthCards, GrowthFilters, GrowthTabs } from '@/components/growth-controls';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  getConquestCounts,
  listConquestPeople,
  type ConquestGoal,
  type ConquestGoalState,
  type ConquestPerson,
} from '@/lib/growth';
import { describeFailure } from '@/lib/messages';
import { usePageSize } from '@/lib/page-size';
import { useScreenAddress } from '@/lib/screen-address';

/**
 * The Conquest tab of Growth, read-only (SKILL.md section 27; decisions 0283 to 0286,
 * and the owner's choices of 2026-09-24).
 *
 * **Every goal is worked out from the records**, so there is nothing to tick and no save
 * bar. A goal that looks wrong is corrected where its record lives: a SUYNL lesson, a
 * Cell, or the pastoral tree.
 *
 * **A reached goal shows the month it was first reached, with today's count beneath it,
 * never instead of it** (section 27). One not yet reached shows how far it is, out of its
 * target. Nothing is coloured or graded (sections 17 and 19).
 */
export default function ConquestPage() {
  return (
    <AppShell>
      <ConquestTab />
    </AppShell>
  );
}

const GOALS: readonly {
  goal: ConquestGoal;
  key: keyof ConquestPerson['goals'];
  label: string;
  target: number | null;
}[] = [
  { goal: 'WIN_3', key: 'win_3', label: 'Win 3', target: 3 },
  { goal: 'OPEN_A_CELL', key: 'open_a_cell', label: 'Open a cell', target: null },
  { goal: 'COMPLETION_OF_12', key: 'completion_of_12', label: 'Completion of 12', target: 12 },
  { goal: 'RAISE_12_LEADERS', key: 'raise_12_leaders', label: 'Raise 12 leaders', target: 12 },
];

function isGoal(value: string | null): value is ConquestGoal {
  return GOALS.some((entry) => entry.goal === value);
}

function ConquestTab() {
  const search = useSearchParams();
  const go = useScreenAddress();
  const q = search.get('q') ?? '';
  const mine = search.get('mine') === '1';
  const chosen = search.get('goal');
  const goal = isGoal(chosen) ? chosen : null;

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const pageSize = usePageSize();
  // A new size starts the list again, so no row is skipped between two page lengths.
  const filterKey = `${q}|${mine}|${goal ?? ''}|${pageSize}`;
  const [lastFilter, setLastFilter] = useState(filterKey);
  if (lastFilter !== filterKey) {
    setLastFilter(filterKey);
    setCursors([null]);
    setPage(0);
  }

  const counts = useQuery({
    queryKey: ['conquest-counts'],
    queryFn: ({ signal }) => getConquestCounts(signal),
  });
  const people = useQuery({
    queryKey: ['conquest-people', q, mine, goal, cursors[page], pageSize],
    queryFn: ({ signal }) =>
      listConquestPeople(
        { q, mine, goal: goal ?? undefined, cursor: cursors[page], limit: pageSize },
        signal,
      ),
  });

  const rows = people.data?.data ?? [];
  const cards = GOALS.map((entry) => ({
    step: entry.goal,
    label: entry.label,
    count: counts.data?.[entry.key],
  }));

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">Growth</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        As of now, for the people in your care.
        {counts.data
          ? ` ${counts.data.people} ${counts.data.people === 1 ? 'person' : 'people'}.`
          : ''}
      </p>

      <GrowthTabs current="/growth/conquest" />

      <GrowthCards cards={cards} selected={goal} onSelect={(next) => go({ goal: next })} />

      <GrowthFilters
        submitted={q}
        mine={mine}
        onSearch={(term) => go({ q: term })}
        onMine={(next) => go({ mine: next ? '1' : null })}
      />

      <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
        Worked out from SUYNL lessons, Cells and the pastoral tree. If a goal looks wrong, correct
        the record it comes from.
      </p>

      <div className="mt-4">
        <FailureNotice
          failure={
            people.isError
              ? describeFailure(people.error)
              : counts.isError
                ? describeFailure(counts.error)
                : null
          }
        />
      </div>

      <div className="mt-4">
        {people.isPending ? (
          <p className="text-muted text-sm">Loading&hellip;</p>
        ) : people.isError ? null : rows.length === 0 ? (
          <p className="text-sm">Nobody here matches.</p>
        ) : (
          <>
            <Table caption="Conquest goals for the people in your care" className="hidden lg:block">
              <thead>
                <tr>
                  <HeaderCell>Person</HeaderCell>
                  {GOALS.map((entry) => (
                    <HeaderCell key={entry.goal}>{entry.label}</HeaderCell>
                  ))}
                  <HeaderCell className="text-right">Goals</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.person_id} className={rowClasses}>
                    <td className="px-3 py-3 align-top">
                      <PersonName row={row} />
                    </td>
                    {GOALS.map((entry) => (
                      <td key={entry.goal} className="px-3 py-3 align-top text-sm">
                        <GoalCell state={row.goals[entry.key]} target={entry.target} />
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right align-top text-sm tabular-nums">
                      {reachedCount(row)} of 4
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <ul className="border-line divide-line divide-y border-t border-b lg:hidden">
              {rows.map((row) => (
                <li key={row.person_id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <PersonName row={row} />
                    <span className="text-sm tabular-nums">{reachedCount(row)} of 4</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
                    {GOALS.map((entry) => (
                      <div key={entry.goal} className="contents">
                        <dt className="font-medium">{entry.label}</dt>
                        <dd>
                          <GoalCell state={row.goals[entry.key]} target={entry.target} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>

            <nav aria-label="Results" className="mt-6 flex items-center gap-3">
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={!people.data.next_cursor}
                onClick={() => {
                  const next = people.data.next_cursor;
                  if (!next) return;
                  setCursors((current) => [...current.slice(0, page + 1), next]);
                  setPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </div>
    </main>
  );
}

function PersonName({ row }: { row: ConquestPerson }) {
  return (
    <div>
      <Link
        href={`/people/${row.person_id}`}
        className="focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {row.full_name}
      </Link>
      <span className="text-muted block font-mono text-xs">{row.member_id}</span>
    </div>
  );
}

/**
 * "Reached Mar 2026" with "11 of 12 now" beneath it, or "7 of 12 so far" (owner's
 * choice of 2026-09-24). Past its target, the count reads "13 now".
 */
function GoalCell({ state, target }: { state: ConquestGoalState; target: number | null }) {
  const count =
    target === null || state.now === undefined
      ? null
      : state.now > target
        ? `${state.now} now`
        : `${state.now} of ${target}`;

  if (state.reached_on === null) {
    return <span className="text-muted">{count === null ? 'Not yet' : `${count} so far`}</span>;
  }

  return (
    <>
      <span className="block">Reached {monthOf(state.reached_on)}</span>
      {count === null ? null : (
        <span className="text-muted block">{count.endsWith('now') ? count : `${count} now`}</span>
      )}
    </>
  );
}

function reachedCount(row: ConquestPerson): number {
  return GOALS.filter((entry) => row.goals[entry.key].reached_on !== null).length;
}

/** "Mar 2026", from a `YYYY-MM-DD` day. */
function monthOf(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
