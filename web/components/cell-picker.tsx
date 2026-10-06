'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import {
  cellShortName,
  leaderCells,
  listCells,
  type CellIndexPage,
  type CellSummary,
} from '@/lib/cells';
import { describeFailure } from '@/lib/messages';
import { reportingMonthOf } from '@/lib/reporting-month';

/**
 * Choosing the Cell a person joins (SKILL.md section 10), by search rather than by a list
 * of every Cell (owner's choice, 2026-09-30).
 *
 * **Their pastoral leader's Cells come first, found without typing** (owner's choice,
 * 2026-09-21): the Cell a disciple usually joins in G12 is their own leader's. Any other
 * Cell is found by a leader's name or a Cell ID, through the index's own search
 * (decision 0261), so nothing downloads the whole scope first.
 *
 * **A grouping, not a ranking** (decision 0009), and nothing is preselected.
 *
 * **Only the person's Network's Cells, where it is known**: section 10 refuses the other
 * Network's, so offering them offered a choice that always failed. The add route still
 * decides.
 */
export function CellPicker({
  label,
  description,
  leaderId,
  leaderName,
  network,
  excludeId = null,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  leaderId: string | null;
  leaderName: string | null;
  network: 'MENS' | 'WOMENS' | null;
  /** The Cell they are already in, which a move does not offer. */
  excludeId?: string | null;
  selected: CellSummary | null;
  onSelect: (cell: CellSummary | null) => void;
}) {
  const month = reportingMonthOf();
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');

  const offered = (cell: CellSummary) =>
    cell.id !== excludeId && (network === null || cell.network === network);

  const theirs = useQuery({
    queryKey: ['leader-cells', month, leaderId, leaderName],
    queryFn: ({ signal }) => leaderCells(month, leaderId as string, leaderName as string, signal),
    enabled: leaderId !== null && leaderName !== null,
  });
  const leaders = (theirs.data ?? []).filter(offered);

  const pages = useInfiniteQuery<CellIndexPage>({
    queryKey: ['cell-search', month, submitted],
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? null,
    queryFn: ({ pageParam, signal }) =>
      listCells({ month, q: submitted, cursor: pageParam as string | null, limit: 20 }, signal),
    enabled: submitted.trim().length >= 2,
  });
  // A Cell already listed under their leader's is not listed again.
  const found = (pages.data?.pages.flatMap((page) => page.data) ?? []).filter(
    (cell) => offered(cell) && !leaders.some((mine) => mine.id === cell.id),
  );

  // Show more disappears on the last page while it holds focus, so focus moves to the
  // first Cell it loaded rather than falling to the top of the page (section 23).
  const list = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  useEffect(() => {
    const from = focusFrom.current;
    if (from !== null && found.length > from) {
      focusFrom.current = null;
      list.current?.querySelectorAll<HTMLButtonElement>('button')[from]?.focus();
    }
  }, [found.length]);

  if (selected) {
    return (
      <div className="border-line rounded-md border p-4">
        <p className="field-label">{label}</p>
        <p className="mt-1 text-sm">{cellText(selected)}</p>
        <Button variant="secondary" className="mt-3" onClick={() => onSelect(null)}>
          Choose another Cell
        </Button>
      </div>
    );
  }

  return (
    <div className="border-line rounded-md border p-4">
      <p className="field-label">{label}</p>
      <p className="text-muted mt-1 text-sm leading-relaxed">{description}</p>

      {leaders.length > 0 ? (
        <>
          <p className="text-muted mt-4 text-xs font-bold">
            {leaders.length === 1 ? 'Their pastoral leader’s Cell' : 'Their pastoral leader’s Cells'}
          </p>
          <CellList cells={leaders} onSelect={onSelect} />
        </>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field
          label="Find a Cell"
          description="A leader’s name or a Cell ID."
          type="search"
          name="cell_q"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="min-w-0 sm:flex-1"
        />
        <Button
          variant="secondary"
          disabled={term.trim().length < 2}
          onClick={() => setSubmitted(term.trim())}
        >
          Search
        </Button>
      </div>

      {/* Mounted always, contents conditional, so the refusal is announced (section 23). */}
      <div className="mt-3">
        <FailureNotice
          failure={pages.isError && !pages.isFetchNextPageError ? describeFailure(pages.error) : null}
        />
      </div>

      {submitted === '' ? null : pages.isPending ? (
        <p className="text-muted mt-3 text-sm">Searching…</p>
      ) : pages.isError && !pages.isFetchNextPageError ? null : found.length === 0 &&
        !pages.hasNextPage ? (
        <p className="text-muted mt-3 text-sm">No Cell you oversee matches “{submitted}”.</p>
      ) : (
        <>
          <CellList cells={found} onSelect={onSelect} listRef={list} />
          {pages.hasNextPage ? (
            <Button
              variant="secondary"
              className="mt-3"
              disabled={pages.isFetchingNextPage}
              onClick={() => {
                focusFrom.current = found.length;
                void pages.fetchNextPage();
              }}
            >
              {pages.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function CellList({
  cells,
  onSelect,
  listRef,
}: {
  cells: CellSummary[];
  onSelect: (cell: CellSummary) => void;
  listRef?: React.Ref<HTMLUListElement>;
}) {
  return (
    <ul ref={listRef} className="divide-line mt-2 divide-y">
      {cells.map((cell) => (
        <li key={cell.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="text-sm">{cellText(cell)}</span>
          <Button
            variant="secondary"
            aria-label={`Choose ${cell.cell_id}`}
            onClick={() => onSelect(cell)}
          >
            Choose
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** "Young Pro · Sat · led by Ana Reyes (CELL-000011)", as Add a Person named it. */
function cellText(cell: CellSummary): string {
  const name = cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week });
  return `${name} · led by ${cell.leader.full_name} (${cell.cell_id})`;
}
