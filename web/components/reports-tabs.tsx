import Link from 'next/link';

import { cn } from '@/lib/utils';

const TABS = [
  { key: 'cells', label: 'Cell Groups', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC', path: '/reports/dcc' },
  { key: 'suynl', label: 'SUYNL', path: '/reports/suynl' },
  { key: 'training', label: 'Training', path: '/reports/training' },
  { key: 'conquest', label: 'Conquest', path: '/reports/conquest' },
  { key: 'filed', label: 'Filed reports', path: '/reports/filed' },
] as const;

export type ReportTab = (typeof TABS)[number]['key'];

/**
 * Which report is on screen, and the way to the others (SKILL.md section 19; decision 0292).
 *
 * **Six links, not ARIA tabs.** Each report keeps an address of its own, so the landing page
 * decision 0245 gives a whole-church reader, the sidebar and a saved link all still work, and
 * something that navigates is announced as a link. Equal widths in the Record screen's style
 * (decision 0290): six in a row from `lg`, three below it and two on a phone.
 *
 * **The month travels** to the reports that have one, so switching from the DCC figures for
 * June to Filed reports opens June rather than the current month. The three Growth reports
 * are as of now and take none.
 *
 * **The current report is a filled block, not a colour alone** (1.4.1), and carries
 * `aria-current`.
 */
export function ReportsTabs({ current, month }: { current: ReportTab; month?: string }) {
  return (
    <nav
      aria-label="Which report"
      className="border-line mt-6 grid grid-cols-2 border-b sm:grid-cols-3 lg:grid-cols-6"
    >
      {TABS.map((tab) => {
        const active = tab.key === current;
        const dated = tab.key === 'cells' || tab.key === 'dcc' || tab.key === 'filed';

        return (
          <Link
            key={tab.key}
            href={month && dated ? `${tab.path}?month=${month}` : tab.path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'focus-visible:outline-accent inline-flex min-h-11 items-center justify-center border border-b-0 px-3 py-2 text-center',
              'text-xs font-bold tracking-[0.08em] uppercase focus-visible:outline-2 focus-visible:-outline-offset-2',
              active ? 'bg-accent text-surface border-accent' : 'border-line text-ink hover:bg-raised',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
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
