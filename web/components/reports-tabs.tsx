'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { ConquestLink } from '@/components/conquest-link';
import { TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { ViewSwitch } from '@/components/ui/view-switch';
import { getMe, holdsWholeChurch } from '@/lib/me';
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

/**
 * A whole-church reader's five (decision 0292; Filed Reports withdrawn, decision 0340; *# of
 * People* moved here from People, decision 0376). Conquest is a link above them rather than a
 * tab (decision 0406).
 */
const TABS = [
  { key: 'cells', label: 'Cell Groups', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC', path: '/reports/dcc' },
  // Named for what it shows (decision 0378); Growth's SUYNL is where lessons are ticked.
  { key: 'suynl', label: 'Encounter Readiness', path: '/reports/suynl' },
  { key: 'training', label: 'Training', path: '/reports/training' },
  PEOPLE_TAB,
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
  | (typeof SENIOR_PASTOR_TABS)[number]['key']
  | 'conquest';

/** A Senior Pastor's tab as a figure of the twelve-month view (decision 0377). */
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
 * **Five links for a whole-church reader, with Conquest a link above them (decision 0406), the
 * Senior Pastors' five (decision 0326), or a Full view leader's five (decision 0380), not ARIA
 * tabs.** Each report keeps an address of its own, so the landing page
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
   * The Senior Pastors' two views of one figure (decision 0377): by period, or its last twelve
   * months, the screen that was `Trends`, so each tab's link keeps the view. The switch between
   * them is the report's own (decision 0398), beside its month.
   */
  view?: 'period' | 'trend';
  /** The leader a twelve-month view draws, kept from tab to tab. */
  leader?: string | null;
  children: ReactNode;
}) {
  // Which tabs follow the screens the server names (decision 0323, point 5), never a role.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  const branch = isBranchReader(me.data);
  const tabs: readonly { key: ReportTab; label: string; name?: string; path: string }[] =
    seniorPastor ? SENIOR_PASTOR_TABS : branch ? BRANCH_TABS : TABS;

  // No tabs until the server names the screens, so a Senior Pastor never sees a whole-church reader's five
  // flash before their own five (owner, 2026-10-11). The pane stays where it is either way, so
  // the report inside is not remounted when the answer arrives.
  const tabbed = !me.isPending;

  // The whole-church reader's way to Conquest (decision 0406); nobody else's tabs carry it.
  const conquest = tabbed && !seniorPastor && !branch;

  return (
    <>
      {conquest ? <ConquestLink href="/reports/conquest" current={current === 'conquest'} /> : null}
      {tabbed ? (
        <nav
          aria-label="Which report"
          className={cn(
            // The five labels fit one row from a small screen up (owner, 2026-10-09). A
            // whole-church reader's five take three a row on a phone, as their six did, and the
            // Senior Pastors' two. A Full view leader's five sit two by two on a phone, equal,
            // and from `sm` in one row sized to their words.
            conquest ? 'mt-2' : 'mt-6',
            branch
              ? 'grid grid-cols-2 sm:flex'
              : seniorPastor
                ? 'grid grid-cols-2 sm:grid-cols-5'
                : 'grid grid-cols-3 sm:grid-cols-5',
            TAB_ROW,
          )}
        >
          {tabs.map((tab) => {
            const active = tab.key === current;
            const trend = (seniorPastor || branch) && view === 'trend';
            const dated =
              tab.key === 'cells' ||
              tab.key === 'dcc' ||
              tab.key === 'number-of-cells' ||
              tab.key === 'number-of-cell-leaders' ||
              tab.key === 'number-of-people';

            return (
              <Link
                key={tab.key}
                href={
                  trend
                    ? trendHref(TREND_FIGURE[tab.key as keyof typeof TREND_FIGURE], leader)
                    : month && dated
                      ? `${tab.path}?month=${month}`
                      : tab.path
                }
                aria-current={active ? 'page' : undefined}
                aria-label={tab.name}
                className={
                  branch
                    ? // Tighter below `sm`, so the three fit a 320px phone with their words wrapped,
                      // with room to spare for a wider font: `px-2` left 3px too few on Linux.
                      cn(tabClasses(active), 'px-1.5')
                    : cn(
                        'focus-visible:outline-accent inline-flex min-h-11 items-center justify-center border border-b-0 px-3 py-2 text-center',
                        'text-sm font-bold focus-visible:outline-2 focus-visible:-outline-offset-2',
                        active ? 'bg-accent text-surface border-accent' : 'border-line text-ink hover:bg-raised',
                      )
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      <div className={tabbed ? TAB_PANE : 'mt-6'}>{children}</div>
    </>
  );
}

const PERIOD_LABEL: Record<RangeKind, string> = {
  WEEK: 'Weekly',
  MONTH: 'Monthly',
  QUARTER: 'Quarterly',
  YEAR: 'Year',
};

/** The lengths each tab offers beside its last twelve months (decision 0398). */
export function periodsOf(tab: ReportTab, seniorPastor: boolean): readonly RangeKind[] {
  if (tab !== 'cells' && tab !== 'dcc') {
    return ['MONTH'];
  }
  // A Full view leader's Weekly and Monthly (decision 0380); the Senior Pastors' four.
  return seniorPastor ? ['WEEK', 'MONTH', 'QUARTER', 'YEAR'] : ['WEEK', 'MONTH'];
}

/**
 * The Senior Pastors' and a Full view leader's one switch (decision 0398, amending 0377): the
 * report's lengths and its last twelve months side by side, in place of a *By period* or *Last
 * 12 months* row above the lengths. Choosing a length opens that tab by period; *Last 12
 * months* opens the twelve months, where the period's month stepper has nothing to step.
 * Renders nothing for any other reader, whose tabs have no twelve months.
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
  if (!(seniorPastor || isBranchReader(me.data)) || !(tab in TREND_FIGURE)) {
    return null;
  }
  const path = SENIOR_PASTOR_TABS.find((each) => each.key === tab)!.path;
  const periods = periodsOf(tab, seniorPastor);

  const options: { key: RangeKind | 'TREND'; label: string }[] = [
    ...periods.map((key) => ({ key, label: PERIOD_LABEL[key] })),
    { key: 'TREND', label: 'Last 12 months' },
  ];

  return (
    <ViewSwitch<RangeKind | 'TREND'>
      label="Report period"
      // Every button one width, as wide as *Last 12 months*, in one row from `sm` up. On a phone
      // two a row and *Last 12 months* the whole last row, so no label breaks (decision 0398).
      className="mt-0 grid w-full grid-cols-2 sm:flex sm:w-auto sm:flex-nowrap"
      options={options.map((option, index) => ({
        ...option,
        className: cn(
          'justify-center px-2 text-center sm:w-29',
          // Alone on its row only where the lengths fill theirs: a # tab's two share one.
          options.length % 2 === 1 && option.key === 'TREND' && 'col-span-2',
          // The grid's rows and columns share one border, as the row's buttons do.
          index >= 2 && '-mt-px sm:mt-0',
          index > 0 && index % 2 === 0 && 'ml-0 sm:-ml-px',
        ),
      }))}
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
    !holdsWholeChurch(me, 'reports.view_subtree')
  );
}

/** The heading every report shares, with its one line beside it. */
export function ReportsHeading({ line }: { line: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <p className="text-muted text-sm">{line}</p>
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
