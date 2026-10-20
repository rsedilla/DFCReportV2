'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { ViewSwitch } from '@/components/ui/view-switch';
import { getMe, holdsWholeChurch } from '@/lib/me';
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
 * A whole-church reader's six (decision 0292; Filed Reports withdrawn, decision 0340; *# of
 * People* moved here from People, decision 0376).
 */
const TABS = [
  { key: 'cells', label: 'Cell Groups', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC', path: '/reports/dcc' },
  // Named for what it shows (decision 0378); Growth's SUYNL is where lessons are ticked.
  { key: 'suynl', label: 'Encounter Readiness', path: '/reports/suynl' },
  { key: 'training', label: 'Training', path: '/reports/training' },
  { key: 'conquest', label: 'Conquest', path: '/reports/conquest' },
  PEOPLE_TAB,
] as const;

/**
 * A Full view leader's four (decisions 0340, 0360 and 0376), the first two each named a report
 * (decision 0361) and the third for what it shows (decision 0378), the first two laid out as the Senior Pastors' are for the leader's own
 * branch. Training and Conquest are hidden, not withdrawn: their pages still open by address.
 */
const BRANCH_TABS = [
  { key: 'cells', label: 'CG Attendance Reports', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC Attendance Reports', path: '/reports/dcc' },
  { key: 'suynl', label: 'Encounter Readiness', path: '/reports/suynl' },
  PEOPLE_TAB,
] as const;

/**
 * The two Senior Pastors' five tabs (decision 0326, point 3), in place of the six. The first
 * two are the same reports under the names the church uses. **A `#` label keeps its words as
 * the link's name** (owner, 2026-10-09), because a screen reader says `#` as "number sign" or
 * "hash" (section 23).
 */
const SENIOR_PASTOR_TABS = [
  { key: 'cells', label: 'CG Attendance', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC Attendance', path: '/reports/dcc' },
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
  PEOPLE_TAB,
] as const;

export type ReportTab =
  | (typeof TABS)[number]['key']
  | (typeof SENIOR_PASTOR_TABS)[number]['key'];

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
 * **Five links for a whole-church reader, the Senior Pastors' five (decision 0326), or a Full
 * view leader's three (decisions 0340 and 0360), not ARIA tabs.** Each report keeps an address of its own, so the landing page
 * decision 0245 gives a whole-church reader, the sidebar and a saved link all still work, and
 * something that navigates is announced as a link. Equal widths in the Record screen's style
 * (decision 0290): one row from a small screen up, and two on a phone. **A Full view leader's
 * three are sized to their words instead** (decision 0361), in the tab style every other tab row
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
   * months, the screen that was `Trends`. Only their screens offer the switch.
   */
  view?: 'period' | 'trend';
  /** The leader a twelve-month view draws, kept from tab to tab. */
  leader?: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  // Which tabs follow the screens the server names (decision 0323, point 5), never a role.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  const branch = isBranchReader(me.data);
  const tabs: readonly { key: ReportTab; label: string; name?: string; path: string }[] =
    seniorPastor ? SENIOR_PASTOR_TABS : branch ? BRANCH_TABS : TABS;

  // No tabs until the server names the screens, so a Senior Pastor never sees a leader's six
  // flash before their own five (owner, 2026-10-11). The pane stays where it is either way, so
  // the report inside is not remounted when the answer arrives.
  const tabbed = !me.isPending;

  return (
    <>
      {tabbed ? (
        <nav
          aria-label="Which report"
          className={cn(
            // The five labels fit one row from a small screen up (owner, 2026-10-09); a
            // whole-church reader's six take three a row on a phone. A Full view leader's four sit
            // two by two on a phone, equal, and from `sm` in one row sized to their words.
            branch
              ? 'mt-6 grid grid-cols-2 sm:flex'
              : tabs.length === 6
                ? 'mt-6 grid grid-cols-3 sm:grid-cols-6'
                : 'mt-6 grid grid-cols-2 sm:grid-cols-5',
            TAB_ROW,
          )}
        >
          {tabs.map((tab) => {
            const active = tab.key === current;
            const trend = seniorPastor && view === 'trend';
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
      <div className={tabbed ? TAB_PANE : 'mt-6'}>
        {/* The Senior Pastors' figure by period or over its last twelve months, one tab row for
            both (decision 0377), so the sidebar carries no second item for the same five. */}
        {seniorPastor && current in TREND_FIGURE ? (
          <ViewSwitch
            label="Which view"
            even="content"
            options={[
              { key: 'period', label: 'By period' },
              { key: 'trend', label: 'Last 12 months' },
            ]}
            value={view}
            onChange={(next) => {
              const tab = SENIOR_PASTOR_TABS.find((each) => each.key === current)!;
              router.push(next === 'trend' ? trendHref(TREND_FIGURE[tab.key]) : tab.path);
            }}
          />
        ) : null}
        {children}
      </div>
    </>
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
