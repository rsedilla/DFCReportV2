'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { TAB_GRID, TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { ViewSwitch } from '@/components/ui/view-switch';
import { getMe, holdsNetwork, holdsWholeChurch } from '@/lib/me';
import type { RangeKind } from '@/lib/report-range';
import type { TrendFigure } from '@/lib/reports';
import { cn } from '@/lib/utils';

/** The church's *# of People* tab, under Reports for every reader that has one (decision 0376). */
const PEOPLE_TAB = {
  key: 'number-of-people',
  label: '# of People',
  name: 'Number of people',
  path: '/reports/number-of-people',
} as const;

/** The three # figures the Admin's *Counts* tab holds behind its switch (decision 0433). */
const COUNT_KEYS = ['number-of-cells', 'number-of-cell-leaders', 'number-of-people'] as const;
type CountKey = (typeof COUNT_KEYS)[number];
const COUNT_PATHS: Record<CountKey, string> = {
  'number-of-cells': '/reports/number-of-cells',
  'number-of-cell-leaders': '/reports/number-of-cell-leaders',
  'number-of-people': '/reports/number-of-people',
};

/**
 * A whole-church reader's, the Admin's (decision 0292; Filed Reports withdrawn, decision 0340;
 * *# of People* moved here from People, decision 0376). Conquest is an item of the sidebar of
 * its own (decision 0407). **The three # figures are one tab, *Counts*** (decision 0433), as Cell
 * Groups and DCC are one, *Attendance*: Attendance, Counts, Encounter Readiness, Training.
 */
const TABS = [
  { key: 'cells', label: 'Cell Groups', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC', path: '/reports/dcc' },
  { key: 'number-of-cells', label: 'Counts', path: '/reports/number-of-cells' },
  // Named for what it shows (decision 0378); Growth's SUYNL is where lessons are ticked.
  { key: 'suynl', label: 'Encounter Readiness', path: '/reports/suynl' },
  { key: 'training', label: 'Training', path: '/reports/training' },
] as const;

/** The two # tabs the Senior Pastors and a Full view leader share (decisions 0326 and 0380). */
const CELL_COUNT_TABS = [
  {
    key: 'number-of-cells',
    label: '# of Cell Groups',
    name: 'Number of Cell Groups',
    path: '/reports/number-of-cells',
  },
  {
    key: 'number-of-cell-leaders',
    label: '# of Cell Leaders',
    name: 'Number of Cell Leaders',
    path: '/reports/number-of-cell-leaders',
  },
] as const;

/**
 * A Full view leader's five (decision 0380): the Senior Pastors' five, for the leader's own
 * branch. Encounter Readiness, Training and Conquest are hidden, not withdrawn: their pages
 * are kept and do not open for them (decision 0379).
 */
const BRANCH_TABS = [
  { key: 'cells', label: 'CG Attendance', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC Attendance', path: '/reports/dcc' },
  ...CELL_COUNT_TABS,
  PEOPLE_TAB,
] as const;

/**
 * The two Senior Pastors' five tabs (decision 0326, point 3), in place of a whole-church
 * reader's. The first
 * two are the same reports under the names the church uses. **A `#` label keeps its words as
 * the link's name** (owner, 2026-10-09), because a screen reader says `#` as "number sign" or
 * "hash" (section 23).
 */
const SENIOR_PASTOR_TABS = [
  { key: 'cells', label: 'CG Attendance', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC Attendance', path: '/reports/dcc' },
  ...CELL_COUNT_TABS,
  PEOPLE_TAB,
] as const;

export type ReportTab =
  | (typeof TABS)[number]['key']
  | (typeof SENIOR_PASTOR_TABS)[number]['key'];

/** A tab as a figure of the twelve-month view (decisions 0377 and 0459). */
const TREND_FIGURE: Record<(typeof SENIOR_PASTOR_TABS)[number]['key'], TrendFigure> = {
  cells: 'CG',
  dcc: 'DCC',
  'number-of-cells': 'CELLS',
  'number-of-cell-leaders': 'CELL_LEADERS',
  'number-of-people': 'PEOPLE',
};

/** The address of one figure's twelve months, keeping the leader drawn. */
export function trendHref(figure: TrendFigure, leader?: string | null): string {
  const query = new URLSearchParams({
    ...(figure === 'CG' ? {} : { figure }),
    ...(leader ? { leader } : {}),
  }).toString();
  return query ? `/trends?${query}` : '/trends';
}

/**
 * Which report is on screen, and the way to the others (SKILL.md section 19; decision 0292).
 *
 * **Five links for a whole-church reader, the Senior Pastors' five (decision 0326), or a Full
 * view leader's five (decision 0380), not ARIA tabs.** Each report keeps an address of its own, so the landing page
 * decision 0245 gives a whole-church reader, the sidebar and a saved link all still work, and
 * something that navigates is announced as a link. Equal widths in the Record screen's style
 * (decision 0290): one row from a small screen up, and two on a phone. **A Full view leader's
 * five are sized to their words instead** (decision 0361), in the tab style every other tab row
 * uses, a long label wrapping inside its tab on a phone.
 *
 * **The month travels** to the reports that have one, so switching from the DCC figures for
 * June to the Cell figures opens June rather than the current month. The Growth reports
 * are as of now and take none.
 *
 * **The current report is a filled block, not a colour alone** (1.4.1), and carries
 * `aria-current`. It opens into the pane that holds everything of that report (owner's
 * choice of 2026-10-05), so its period switch and controls read as its own.
 */
export function ReportsTabs({
  current,
  month,
  view = 'period',
  leader,
  children,
}: {
  current: ReportTab;
  month?: string;
  /**
   * The two views of one figure (decisions 0377 and 0459): by period, or its last twelve
   * months, the screen that was `Trends`, so each tab's link keeps the view. The switch between
   * them is the report's own (decision 0398), beside its month.
   */
  view?: 'period' | 'trend';
  /** The leader a twelve-month view draws, kept from tab to tab. */
  leader?: string | null;
  children: ReactNode;
}) {
  // Which tabs follow the screens the server names (decision 0323, point 5), never a role.
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  const branch = isBranchReader(me.data);
  const tabs: readonly { key: ReportTab; label: string; name?: string; path: string }[] =
    seniorPastor ? SENIOR_PASTOR_TABS : branch ? BRANCH_TABS : TABS;

  // No tabs until the server names the screens, so a Senior Pastor never sees a whole-church reader's five
  // flash before their own five (owner, 2026-10-11). The pane stays where it is either way, so
  // the report inside is not remounted when the answer arrives.
  const tabbed = !me.isPending;
  // **Cell Groups and DCC are one tab, *Attendance*** (ruling of 2026-11-02, decision 0420, the
  // owner's layout): a switch inside it chooses which, and each keeps its own address.
  const attendance = current === 'cells' || current === 'dcc';
  // The Admin's *Counts* holds the three # figures (decision 0433).
  const counts = !seniorPastor && !branch && (COUNT_KEYS as readonly string[]).includes(current);
  const rowTabs = tabs.flatMap((tab) =>
    tab.key === 'dcc'
      ? []
      : tab.key === 'cells'
        ? [{ ...tab, label: 'Attendance', name: undefined }]
        : [tab],
  );
  // All five figures have Yearly for every reader of them (decisions 0443 and 0459), so a tab
  // that has one keeps the graph; the Admin's Encounter Readiness and Training have none.
  const keepsTrend = (key: ReportTab) => view === 'trend' && key in TREND_FIGURE;
  const hrefOf = (tab: { key: ReportTab; path: string }) => {
    const dated =
      tab.key === 'cells' ||
      tab.key === 'dcc' ||
      tab.key === 'number-of-cells' ||
      tab.key === 'number-of-cell-leaders' ||
      tab.key === 'number-of-people';
    return keepsTrend(tab.key)
      ? trendHref(TREND_FIGURE[tab.key as keyof typeof TREND_FIGURE], leader)
      : month && dated
        ? `${tab.path}?month=${month}`
        : tab.path;
  };

  return (
    <>
      {tabbed ? (
        <nav
          aria-label="Which report"
          // Every tab one size, for every reader (decision 0416).
          className={cn('mt-6', TAB_GRID, TAB_ROW)}
        >
          {rowTabs.map((tab) => {
            const active =
              tab.key === 'cells'
                ? attendance
                : tab.key === 'number-of-cells' && !seniorPastor && !branch
                  ? counts
                  : tab.key === current;

            return (
              <Link
                key={tab.key}
                href={hrefOf(tab)}
                aria-current={active ? 'page' : undefined}
                aria-label={tab.name}
                className={tabClasses(active)}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      <div className={tabbed ? TAB_PANE : 'mt-6'}>
        {tabbed && attendance ? (
          <ViewSwitch<'cells' | 'dcc'>
            label="Which attendance"
            options={[
              { key: 'cells', label: 'Cell Group' },
              { key: 'dcc', label: 'DCC' },
            ]}
            value={current}
            onChange={(next) => {
              const tab = tabs.find((each) => each.key === next);
              if (next !== current && tab) {
                router.push(hrefOf(tab));
              }
            }}
          />
        ) : null}
        {children}
      </div>
    </>
  );
}

const PERIOD_LABEL: Record<RangeKind, string> = {
  WEEK: 'Weekly',
  MONTH: 'Monthly',
  QUARTER: 'Quarterly',
  YEAR: 'Year',
};

/**
 * The lengths each tab offers beside its last twelve months (decision 0398): Attendance's
 * Weekly and Monthly for every reader, the quarter and the calendar year withdrawn (decision
 * 0443), and a count's month.
 */
export function periodsOf(tab: ReportTab): readonly RangeKind[] {
  return tab === 'cells' || tab === 'dcc' ? ['WEEK', 'MONTH'] : ['MONTH'];
}

/** Yearly's small graph, so the button says what it opens (owner, 2026-11-05). */
const GRAPH_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d="M4 19h16" />
    <path d="M4 15l4-6 4 2 4-5 4 4" />
  </svg>
);

/**
 * The Admin's *Counts* switch, *Cell Groups*, *Cell Leaders* and *People* (decision 0433): each
 * figure keeps its own address and the month travels, as Attendance's *Cell Group* and *DCC* do.
 * It sits in the figure's control bar, and on the graph stays on the graph (decision 0459). Renders nothing
 * for the Senior Pastors and a Full view leader, whose three # figures are tabs of their own.
 */
export function CountsSwitch({
  tab,
  month,
  trend = false,
  leader,
}: {
  tab: ReportTab;
  month: string;
  /** On the twelve months, so choosing another count keeps the graph (decision 0459). */
  trend?: boolean;
  /** The leader the graph draws, kept from count to count. */
  leader?: string | null;
}) {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  if (me.data === undefined || me.data.screens === 'SENIOR_PASTOR' || isBranchReader(me.data)) {
    return null;
  }
  if (!(COUNT_KEYS as readonly string[]).includes(tab)) {
    return null;
  }

  return (
    <ViewSwitch<CountKey>
      label="Which count"
      className="mt-0"
      options={[
        { key: 'number-of-cells', label: 'Cell Groups' },
        { key: 'number-of-cell-leaders', label: 'Cell Leaders' },
        { key: 'number-of-people', label: 'People' },
      ]}
      value={tab as CountKey}
      onChange={(next) => {
        if (next !== tab) {
          router.push(
            trend ? trendHref(TREND_FIGURE[next], leader) : `${COUNT_PATHS[next]}?month=${month}`,
          );
        }
      }}
    />
  );
}

/**
 * One switch for the length (decision 0398, amending 0377; the Admin's by decision 0459): the
 * report's lengths and its last twelve months side by side, in place of a *By period* or *Last
 * 12 months* row above the lengths. Choosing a length opens that tab by period; *Last 12
 * months* opens the twelve months, where the period's month stepper has nothing to step.
 * Renders nothing for a reader whose tabs have no twelve months.
 */
export function ReportViewSwitch({
  tab,
  value,
  onPeriod,
  leader,
}: {
  tab: ReportTab;
  /** The length on screen, or `TREND` for the twelve months. */
  value: RangeKind | 'TREND';
  /** Another length of the same tab; left out, it opens the tab's own address. */
  onPeriod?: (kind: RangeKind) => void;
  /** The leader a twelve-month view draws, kept from tab to tab. */
  leader?: string | null;
}) {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  const attendance = tab === 'cells' || tab === 'dcc';
  // Attendance's switch is every reader's (decision 0443); a count's, the Senior Pastors', a
  // Full view leader's and a whole-church reader's (decision 0459), whose counts have twelve
  // months.
  if (
    me.data === undefined ||
    !(tab in TREND_FIGURE) ||
    !(
      attendance ||
      seniorPastor ||
      isBranchReader(me.data) ||
      holdsWholeChurch(me.data, 'reports.view_subtree') ||
      holdsNetwork(me.data, 'reports.view_subtree') !== null
    )
  ) {
    return null;
  }
  const path = SENIOR_PASTOR_TABS.find((each) => each.key === tab)!.path;

  const options: { key: RangeKind | 'TREND'; label: string; icon?: ReactNode }[] = [
    ...periodsOf(tab).map((key) => ({ key, label: PERIOD_LABEL[key] })),
    { key: 'TREND', label: 'Yearly', icon: GRAPH_ICON },
  ];

  const switcher = (
    <ViewSwitch<RangeKind | 'TREND'>
      label="Report period"
      // Attendance's sits on the line beside Cell Group and DCC (decision 0443); a count's, in
      // its control bar beside the month. One size, as every switch is (decision 0416).
      className={attendance ? 'lg:ml-2' : 'mt-0'}
      options={options}
      value={value}
      onChange={(next) => {
        if (next === value) {
          return;
        }
        if (next === 'TREND') {
          router.push(trendHref(TREND_FIGURE[tab as keyof typeof TREND_FIGURE], leader));
        } else if (onPeriod && value !== 'TREND') {
          onPeriod(next);
        } else {
          router.push(next === 'MONTH' ? path : `${path}?period=${next.toLowerCase()}`);
        }
      }}
    />
  );

  // No note about Yearly (decision 0451): its button carries a graph, and opening it shows one.
  return switcher;
}

/**
 * A reader of their own branch's reports, a Full view leader (decision 0340): holding
 * `reports.view_subtree`, short of Whole Church, whose screens are not the Senior Pastors'.
 * Keyed on the capability and the server's screens, never on a role (decision 0323, point 5).
 */
export function isBranchReader(me: Parameters<typeof holdsWholeChurch>[0]): boolean {
  return (
    me !== undefined &&
    me.screens !== 'SENIOR_PASTOR' &&
    me.capabilities.some((grant) => grant.capability === 'reports.view_subtree') &&
    !holdsWholeChurch(me, 'reports.view_subtree') &&
    holdsNetwork(me, 'reports.view_subtree') === null
  );
}

/**
 * The heading every report shares, with its one line beside it. The line is not shown on a
 * phone (decision 0451): the tabs under it say what each report is, and the rows start higher.
 */
export function ReportsHeading({ line }: { line: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <p className="text-muted hidden text-sm lg:block">{line}</p>
    </div>
  );
}

/** Spelled out whole so Tailwind sees each class: the cards fill the row, as on Growth. */
const COLUMNS: Record<number, string> = {
  3: 'sm:grid-cols-3',
  4: 'lg:grid-cols-4',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

/**
 * A Growth tab's counts under Reports, read only (decision 0292): the same figures as the
 * Growth tab's cards, without the filter, because Reports files and changes nothing.
 */
export function CountCards({
  cards,
}: {
  cards: readonly { label: string; count: number | undefined }[];
}) {
  return (
    <dl className={cn('mt-6 grid grid-cols-2 gap-3', COLUMNS[cards.length] ?? COLUMNS[6])}>
      {cards.map((card) => (
        <div key={card.label} className="bg-surface border-edge border p-3">
          <dt className="text-accent text-xs font-bold tracking-[0.08em] uppercase">{card.label}</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums">{card.count ?? '–'}</dd>
        </div>
      ))}
    </dl>
  );
}
