import Link from 'next/link';

import { cn } from '@/lib/utils';

const REPORTS = [
  { key: 'cells', label: 'Cells', path: '/reports/cells' },
  { key: 'dcc', label: 'DCC', path: '/reports/dcc' },
] as const;

/**
 * Which report is on screen, and the way to the other (SKILL.md section 19; decision 0245).
 *
 * **Two links, not two tabs.** Each report keeps the address it already had, so the
 * landing page decision 0245 gives a whole-church reader, the sidebar and a saved link
 * all still work. Something that navigates is a link and is announced as one.
 *
 * **The month travels with it**, so switching from the DCC figures for June to the Cell
 * figures opens June rather than the current month.
 *
 * **The current report is a filled block, not a colour alone** (1.4.1), the same marker
 * as the sidebar, and carries `aria-current`.
 */
export function ReportsSwitch({ current, month }: { current: 'cells' | 'dcc'; month: string }) {
  return (
    <ul aria-label="Which report" className="border-edge inline-flex border">
      {REPORTS.map((report) => {
        const active = report.key === current;

        return (
          <li key={report.key}>
            <Link
              href={`${report.path}?month=${month}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center px-5 text-xs font-bold tracking-[0.07em] uppercase',
                'focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
                active ? 'bg-ink text-surface' : 'text-ink hover:bg-raised',
              )}
            >
              {report.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
