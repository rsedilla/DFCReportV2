'use client';

import Link from 'next/link';
import type { UseQueryResult } from '@tanstack/react-query';

import { NAME_LINK } from '@/components/awaiting-lists';
import { FailureNotice } from '@/components/ui/failure-notice';
import { categoryLabel, dayOfWeekLabel, type ScheduleClash } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';

/** "30 minutes" or "1 hour 45 minutes". */
function apartLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : null,
    rest > 0 || hours === 0 ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : null,
  ].filter(Boolean);
  return `${parts.join(' ')} apart`;
}

/**
 * *Same Leader, Same Time* (SKILL.md section 10, decision 0392): leaders whose running Cells
 * start less than two hours apart. The rule refuses every new one, so these were entered
 * before it; nothing about them stops working, and Admin fixes each by changing a Cell's day
 * or time or handing a Cell to the person who really leads it.
 */
export function ScheduleClashes({ query }: { query: UseQueryResult<ScheduleClash[]> }) {
  return (
    <section aria-labelledby="clashes-heading" className="mt-4">
      <h2 id="clashes-heading" className="sr-only">
        Same Leader, Same Time
      </h2>
      <p className="text-muted max-w-3xl text-sm leading-relaxed">
        A leader whose Cell Groups start less than 2 hours apart. Fix each by changing one
        Cell&rsquo;s day or time, or by handing a Cell to the person who really leads it.
        Nothing stops working meanwhile.
      </p>

      <div className="mt-4">
        <FailureNotice failure={query.isError ? describeFailure(query.error) : null} />
      </div>

      {query.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : query.data && query.data.length === 0 ? (
        <p className="text-muted mt-4 text-sm">
          No leader&rsquo;s Cell Groups start less than 2 hours apart.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {(query.data ?? []).map((clash) => (
            <li key={clash.leader.person_id} className="border-line rounded-md border p-4">
              <p className="text-sm font-bold">
                <Link href={`/people/${clash.leader.person_id}`} className={NAME_LINK}>
                  {clash.leader.full_name}
                </Link>{' '}
                · {apartLabel(clash.minutes_apart)}
              </p>
              <ul className="divide-line mt-2 divide-y">
                {clash.cells.map((cell) => (
                  <li
                    key={cell.cell_uuid}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm"
                  >
                    <span>
                      <Link href={`/cells/${cell.cell_uuid}/meetings`} className={NAME_LINK}>
                        {cell.category === null
                          ? cell.cell_id
                          : `${categoryLabel(cell.category)} · ${dayOfWeekLabel(cell.day_of_week).slice(0, 3)}`}
                      </Link>{' '}
                      <span className="text-muted font-mono">{cell.cell_id}</span>
                    </span>
                    <span className="whitespace-nowrap">
                      {dayOfWeekLabel(cell.day_of_week)}, {cell.time_of_day}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
