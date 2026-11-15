'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { PAGE_WIDTH } from '@/components/app-shell';
import { GrowthFilters } from '@/components/growth-controls';

import { CursorPager } from '@/components/ui/cursor-pager';
import { TextLink } from '@/components/ui/text-link';
import { ViewSwitch } from '@/components/ui/view-switch';
import { FailureNotice } from '@/components/ui/failure-notice';
import { TAB_GRID, TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  getConquestBranches,
  getConquestCounts,
  listConquestPeople,
  type ConquestBranches,
  type ConquestFigures,
  type ConquestGoal,
  type ConquestGoalState,
  type ConquestPerson,
} from '@/lib/growth';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { networkChoices, useOwnRootNetwork } from '@/lib/own-network';
import { useCursorPages } from '@/lib/cursor-pages';
import { usePageSize } from '@/lib/page-size';
import { useScreenAddress } from '@/lib/screen-address';
import { cn } from '@/lib/utils';

/**
 * Conquest, an item of the sidebar of its own for holders of `conquest.view_subtree` at Whole
 * Church, by default the Admin and the two Senior Pastors (decision 0407, replacing 0406), read-only (SKILL.md section 27; decisions 0283 to 0286,
 * and the owner's choices of 2026-09-24).
 *
 * **Every goal is worked out from the records**, so there is nothing to tick and no save
 * bar. A goal that looks wrong is corrected where its record lives: a SUYNL lesson, a
 * Cell, or the pastoral tree.
 *
 * **A reached goal shows the month it was first reached, with today's count beneath it,
 * never instead of it** (section 27). One not yet reached shows how far it is, out of its
 * target. Nothing is coloured or graded (sections 17 and 19).
 *
 * **One tab per goal** (decision 0489, owner, 2026-11-14, as Bishop Oriel asked): *Win 3*, *Open
 * a Cell*, *Completion of 12* and *Raise 12 Leaders*. Each shows how many have reached it and then
 * everyone, with their progress on that goal alone, in first-name order (decision 0359) and never
 * by progress (decision 0009). The tab is the address's `goal`, Win 3 where it names none.
 *
 * **The two Senior Pastors' tabs open on their own Network's 12** (decision 0494): a Men · Women ·
 * Both switch, then each root's Primaries with their own goal and their branch's counts, a name
 * with people beneath them going a level down (`leader`, with `trail` for the way back, as on
 * People, decision 0491). A search or *Only my disciples* shows the list as before.
 */
export default function ConquestPage() {
  return (
    <>
      <ConquestTab />
    </>
  );
}

const GOALS: readonly {
  goal: ConquestGoal;
  key: keyof ConquestPerson['goals'];
  label: string;
  target: number | null;
}[] = [
  { goal: 'WIN_3', key: 'win_3', label: 'Win 3', target: 3 },
  { goal: 'OPEN_A_CELL', key: 'open_a_cell', label: 'Open a Cell', target: null },
  { goal: 'COMPLETION_OF_12', key: 'completion_of_12', label: 'Completion of 12', target: 12 },
  { goal: 'RAISE_12_LEADERS', key: 'raise_12_leaders', label: 'Raise 12 Leaders', target: 12 },
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
  const tab = GOALS.find((entry) => entry.goal === (isGoal(chosen) ? chosen : 'WIN_3'))!;

  // The Senior Pastors' tables (decision 0494), wherever no search or Only my disciples is asked.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const senior = me.data?.screens === 'SENIOR_PASTOR';
  const branchView = senior && !q && !mine;
  const own = useOwnRootNetwork(senior);
  const asked = search.get('network');
  const choice: 'MENS' | 'WOMENS' | 'BOTH' | null =
    asked === 'MENS' || asked === 'WOMENS' || asked === 'BOTH'
      ? asked
      : own.settled
        ? (own.network ?? 'BOTH')
        : null;
  const leader = search.get('leader');
  const trail = (search.get('trail') ?? '').split(',').filter(Boolean);
  const branches = useQuery({
    queryKey: ['conquest-branches', leader, choice],
    queryFn: ({ signal }) =>
      getConquestBranches(
        leader
          ? { leaderId: leader }
          : { network: choice === 'MENS' || choice === 'WOMENS' ? choice : undefined },
        signal,
      ),
    enabled: branchView && (leader !== null || choice !== null),
  });

  const pageSize = usePageSize();
  // A new size starts the list again, so no row is skipped between two page lengths. Every tab
  // lists the same people, so changing tab keeps the page.
  const pages = useCursorPages(`${q}|${mine}|${pageSize}`);

  const counts = useQuery({
    queryKey: ['conquest-counts'],
    queryFn: ({ signal }) => getConquestCounts(signal),
  });
  const people = useQuery({
    queryKey: ['conquest-people', q, mine, pages.cursor, pageSize],
    queryFn: ({ signal }) =>
      listConquestPeople({ q, mine, cursor: pages.cursor, limit: pageSize }, signal),
    // A Senior Pastor reads their tables instead, until they search (decision 0494); asked once
    // who is reading is known, so the tables are not preceded by a list.
    enabled: me.isFetched && !branchView,
  });

  const rows = people.data?.data ?? [];
  // A tab keeps the search and Only my disciples.
  const tabHref = (goal: ConquestGoal) => {
    const params = new URLSearchParams();
    if (goal !== 'WIN_3') {
      params.set('goal', goal);
    }
    if (q) {
      params.set('q', q);
    }
    if (mine) {
      params.set('mine', '1');
    }
    // The Senior Pastors' Network and the leader opened are kept from tab to tab (decision 0494).
    for (const key of ['network', 'leader', 'trail']) {
      const value = search.get(key);
      if (value) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return query ? `/conquest?${query}` : '/conquest';
  };

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Conquest</h1>
        <p className="text-muted text-sm">
          {counts.data
            ? `${counts.data.people} ${counts.data.people === 1 ? 'person' : 'people'} you oversee, as of today.`
            : 'The people you oversee, as of today.'}
        </p>
      </div>

      <nav
        aria-label="Which goal"
        // Two by two on a phone, one row of four from `lg` (decision 0489).
        className={cn('mt-6', TAB_GRID, TAB_ROW, 'lg:grid-cols-4')}
      >
        {GOALS.map((entry) => (
          <Link
            key={entry.goal}
            href={tabHref(entry.goal)}
            aria-current={entry.goal === tab.goal ? 'page' : undefined}
            className={tabClasses(entry.goal === tab.goal)}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      <div className={TAB_PANE}>
        <GrowthFilters
          submitted={q}
          mine={mine}
          onSearch={(term) => go({ q: term })}
          onMine={(next) => go({ mine: next ? '1' : null })}
        />

        {/* How many have reached this tab's goal: a count to read, not a filter (decision 0489). */}
        <div className="border-edge bg-surface mt-4 flex flex-col items-start border p-3 sm:max-w-64">
          <span className="text-accent text-xs font-bold tracking-[0.08em] uppercase">
            {tab.label}
          </span>
          <span className="mt-1 text-2xl font-bold tabular-nums">
            {(branchView ? branches.data?.total[tab.key] : counts.data?.[tab.key]) ?? '\u2013'}
          </span>
          <span className="text-muted pt-1 text-xs">Reached</span>
        </div>

        {branchView ? (
          <SeniorBranches
            tab={tab}
            choice={choice}
            ownNetwork={own.network}
            settled={own.settled}
            leader={leader}
            trail={trail}
            branches={branches}
            onNetwork={(next) => go({ network: next, leader: null, trail: null })}
          />
        ) : null}

        <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
          Goals fill in by themselves from lessons, Cells and leaders. If one looks wrong, fix the
          record behind it.
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

        <div className={cn('mt-4', branchView && 'hidden')}>
          {people.isPending ? (
            <p className="text-muted text-sm">Loading&hellip;</p>
          ) : people.isError ? null : rows.length === 0 ? (
            <p className="text-sm">Nobody here matches.</p>
          ) : (
            <>
              <Table caption={`${tab.label} for the people you oversee`} className="hidden lg:block">
                <thead>
                  <tr>
                    <HeaderCell>Person</HeaderCell>
                    <HeaderCell>{tab.label}</HeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.person_id} className={rowClasses}>
                      <td className="px-3 py-3 align-top">
                        <PersonName row={row} />
                      </td>
                      <td className="px-3 py-3 align-top text-sm">
                        <GoalCell state={row.goals[tab.key]} target={tab.target} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              {/* A phone: each person with this goal beside or under the name. */}
              <ul className="border-line divide-line divide-y border-t border-b lg:hidden">
                {rows.map((row) => (
                  <li
                    key={row.person_id}
                    className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3"
                  >
                    <PersonName row={row} />
                    <span className="text-sm">
                      <span className="sr-only">{tab.label}: </span>
                      <GoalCell state={row.goals[tab.key]} target={tab.target} />
                    </span>
                  </li>
                ))}
              </ul>

              <CursorPager
                label="Results"
                page={pages.page}
                nextCursor={people.data.next_cursor}
                onPrevious={pages.previous}
                onNext={() => pages.next(people.data.next_cursor)}
              />
            </>
          )}
        </div>
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

/** "Mar 2026", from a `YYYY-MM-DD` day. */
function monthOf(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

type Tab = (typeof GOALS)[number];
type BranchTable = ConquestBranches['tables'][number];

/** Names seen on the way down, so the way back can name the leader above without a read. */
const seenNames = new Map<string, string>();
function remember(data: ConquestBranches | undefined) {
  for (const table of data?.tables ?? []) {
    if (table.root.full_name) {
      seenNames.set(table.root.id, table.root.full_name);
    }
    for (const row of table.rows) {
      if (row.leader.full_name) {
        seenNames.set(row.leader.id, row.leader.full_name);
      }
    }
  }
}

/**
 * The Senior Pastors' tables (decision 0494): the Network switch, then each root's 12, or the
 * leader opened. Each row carries the person's own progress on the tab's goal, how many in their
 * branch have reached it, and how many people the branch holds; the owner's own row and a Total
 * close it, and *Others* follows where it is not 0, so it adds up to the box.
 */
function SeniorBranches({
  tab,
  choice,
  ownNetwork,
  settled,
  leader,
  trail,
  branches,
  onNetwork,
}: {
  tab: Tab;
  choice: 'MENS' | 'WOMENS' | 'BOTH' | null;
  ownNetwork: 'MENS' | 'WOMENS' | null;
  settled: boolean;
  leader: string | null;
  trail: string[];
  branches: { data?: ConquestBranches; isPending: boolean; isError: boolean; error: unknown };
  onNetwork: (next: 'MENS' | 'WOMENS' | 'BOTH') => void;
}) {
  const search = useSearchParams();
  const data = branches.data;
  remember(data);
  // An address on this tab, the Network kept, as People keeps it (decision 0491).
  const href = (changes: { leader: string | null; trail: string[] }) => {
    const params = new URLSearchParams();
    if (tab.goal !== 'WIN_3') {
      params.set('goal', tab.goal);
    }
    const network = search.get('network');
    if (network) {
      params.set('network', network);
    }
    if (changes.leader) {
      params.set('leader', changes.leader);
    }
    if (changes.trail.length > 0) {
      params.set('trail', changes.trail.join(','));
    }
    const query = params.toString();
    return query ? `/conquest?${query}` : '/conquest';
  };
  const drill = (id: string) => href({ leader: id, trail: leader ? [...trail, leader] : [] });
  const parentId = trail.length > 0 ? trail[trail.length - 1] : null;

  return (
    <section aria-label={`${tab.label} by leader`} className="mt-4">
      {leader === null ? (
        settled && choice !== null ? (
          <ViewSwitch<'MENS' | 'WOMENS' | 'BOTH'>
            label="Which Network"
            className="mt-0 w-full lg:w-auto"
            options={networkChoices(ownNetwork)}
            value={choice}
            onChange={onNetwork}
          />
        ) : null
      ) : (
        <p className="text-sm">
          <TextLink href={href({ leader: parentId, trail: trail.slice(0, -1) })}>
            {parentId
              ? `Back to ${seenNames.get(parentId) ?? 'the leader above'}`
              : 'Back to Conquest'}
          </TextLink>
        </p>
      )}

      <div className="mt-4">
        <FailureNotice failure={branches.isError ? describeFailure(branches.error) : null} />
      </div>

      {branches.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          {leader === null ? (
            <h2 className="field-label mt-4">
              {data.network === 'WOMENS'
                ? 'Women’s Network'
                : data.network === 'MENS'
                  ? 'Men’s Network'
                  : 'Whole Church'}
            </h2>
          ) : null}
          {data.tables.map((table) => (
            <BranchTableView
              key={table.root.id}
              tab={tab}
              table={table}
              drilled={leader !== null}
              drill={drill}
            />
          ))}
          {leader === null && (data.others.people !== 0 || data.others[tab.key] !== 0) ? (
            <p className="mt-2 text-sm">
              Others: {data.others[tab.key]} reached, of {data.others.people}{' '}
              {data.others.people === 1 ? 'person' : 'people'}.
            </p>
          ) : null}
          <p className="text-muted mt-2 text-sm">
            A name opens that leader&rsquo;s 12, each with their {tab.label}.
          </p>
        </>
      ) : null}
    </section>
  );
}

function BranchTableView({
  tab,
  table,
  drilled,
  drill,
}: {
  tab: Tab;
  table: BranchTable;
  drilled: boolean;
  drill: (id: string) => string;
}) {
  const rootName = table.root.full_name ?? 'This leader';
  const heading = drilled ? `${rootName}’s 12` : `${rootName}’s leaders`;
  const sum = (key: keyof ConquestFigures) =>
    table.own[key] + table.rows.reduce((all, row) => all + row[key], 0);
  const total = { reached: sum(tab.key), people: sum('people') };
  const name = (row: BranchTable['rows'][number]) =>
    row.has_disciples ? (
      <Link
        href={drill(row.leader.id)}
        className="focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {row.leader.full_name ?? 'A leader'}
      </Link>
    ) : (
      <span className="font-medium">{row.leader.full_name ?? 'A leader'}</span>
    );

  return (
    <div className="mt-4">
      <h3 className="font-semibold">{heading}</h3>
      <Table caption={heading} className="mt-2 hidden lg:block">
        <thead>
          <tr>
            <HeaderCell>{drilled ? 'Leader' : 'Primaries'}</HeaderCell>
            <HeaderCell>Their {tab.label}</HeaderCell>
            <HeaderCell className="text-right">Reached</HeaderCell>
            <HeaderCell className="text-right">People</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.leader.id} className={rowClasses}>
              <td className="px-3 py-3 align-top">{name(row)}</td>
              <td className="px-3 py-3 align-top text-sm">
                <GoalCell state={row.goals[tab.key]} target={tab.target} />
              </td>
              <td className="px-3 py-3 text-right align-top tabular-nums">{row[tab.key]}</td>
              <td className="px-3 py-3 text-right align-top tabular-nums">{row.people}</td>
            </tr>
          ))}
          <tr className={rowClasses}>
            <td className="px-3 py-3 align-top">{rootName}</td>
            <td className="px-3 py-3 align-top text-sm">
              <GoalCell state={table.own.goals[tab.key]} target={tab.target} />
            </td>
            <td className="px-3 py-3 text-right align-top tabular-nums">{table.own[tab.key]}</td>
            <td className="px-3 py-3 text-right align-top tabular-nums">{table.own.people}</td>
          </tr>
          <tr className={rowClasses}>
            <td className="px-3 py-3 font-bold">Total</td>
            <td className="px-3 py-3" />
            <td className="px-3 py-3 text-right font-bold tabular-nums">{total.reached}</td>
            <td className="px-3 py-3 text-right font-bold tabular-nums">{total.people}</td>
          </tr>
        </tbody>
      </Table>

      {/* A phone: each leader with their goal and their branch beneath the name. */}
      <ul className="border-line divide-line mt-2 divide-y border-t border-b lg:hidden">
        {table.rows.map((row) => (
          <li key={row.leader.id} className="py-3">
            {name(row)}
            <BranchLine tab={tab} figures={row} goals={row.goals} />
          </li>
        ))}
        <li className="py-3">
          <span className="font-medium">{rootName}</span>
          <BranchLine tab={tab} figures={table.own} goals={table.own.goals} />
        </li>
        <li className="py-3 text-sm font-bold">
          Total: {total.reached} reached, of {total.people}{' '}
          {total.people === 1 ? 'person' : 'people'}
        </li>
      </ul>
    </div>
  );
}

function BranchLine({
  tab,
  figures,
  goals,
}: {
  tab: Tab;
  figures: ConquestFigures;
  goals: BranchTable['own']['goals'];
}) {
  return (
    <span className="mt-1 block text-sm">
      <span className="block">
        Their {tab.label}: <GoalCell state={goals[tab.key]} target={tab.target} />
      </span>
      <span className="text-muted block">
        {figures[tab.key]} reached, of {figures.people} {figures.people === 1 ? 'person' : 'people'}
      </span>
    </span>
  );
}
