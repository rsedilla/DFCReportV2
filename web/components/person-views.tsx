'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { ShowMore } from '@/components/awaiting-lists';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { describeFailure } from '@/lib/messages';
import { getPersonViews, openedWhen } from '@/lib/person-views';

/**
 * Who opened this record (decision 0414): each time somebody read the person's record, from
 * this page or any other screen, newest first, for the Admin alone. Kept a year by the API.
 */
export function PersonViews({ personId }: { personId: string }) {
  const headingId = useId();
  const pages = useInfiniteQuery({
    queryKey: ['person-views', personId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getPersonViews(personId, { cursor: pageParam, limit: 20 }, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = pages.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section aria-labelledby={headingId} className={FRAME}>
      <h2 id={headingId} className="field-label">
        Who opened this record
      </h2>
      <p className="text-muted mt-2 text-sm leading-relaxed">
        Each time somebody opens or looks up this record, newest first. Shown to the Admin only,
        and kept for one year.
      </p>

      <div className="mt-3">
        <FailureNotice failure={pages.isError ? describeFailure(pages.error) : null} />
      </div>

      {pages.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading…</p>
      ) : rows.length === 0 && !pages.isError ? (
        <p className="text-muted mt-3 text-sm">Nobody has opened it yet.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {rows.map((row) => (
            <li key={`${row.viewer.person_id}-${row.viewed_at}`}>
              <span className="font-medium">{row.viewer.full_name}</span>
              {row.relation === 'PASTORAL_LEADER' ? ' (pastoral leader)' : null}
              <span className="text-muted"> · {openedWhen(row.viewed_at)}</span>
            </li>
          ))}
        </ul>
      )}

      <ShowMore pages={pages} />
    </section>
  );
}
