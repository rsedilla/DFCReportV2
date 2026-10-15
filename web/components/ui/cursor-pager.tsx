'use client';

import { Button } from '@/components/ui/button';

/**
 * Previous and Next under a cursor-paged list. No total and no page number: section 22 pages
 * by cursor and returns neither, so both would be invented.
 */
export function CursorPager({
  label,
  page,
  nextCursor,
  onPrevious,
  onNext,
}: {
  /** What the list is, for the navigation landmark ("Results", "Cells"). */
  label: string;
  page: number;
  nextCursor: string | null | undefined;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav aria-label={label} className="mt-6 flex items-center gap-3">
      <Button variant="secondary" disabled={page === 0} onClick={onPrevious}>
        Previous
      </Button>
      <Button variant="secondary" disabled={!nextCursor} onClick={onNext}>
        Next
      </Button>
    </nav>
  );
}
