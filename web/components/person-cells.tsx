'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { MoveCellDialog } from '@/components/move-cell-dialog';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { cellShortName, getPersonCells } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';

/**
 * Where a person stands in the Cells, and the one thing to do about it (SKILL.md
 * section 10; decision 0248).
 *
 * **Belonging and leading are shown apart**, because the route returns them apart. A
 * Cell's leader holds no membership row, and whether they should is open, so a leader
 * reads as leading their Cell and is not offered a Cell to join.
 *
 * **No link into the Cell.** Decision 0248 shows a Cell led outside the reader's scope,
 * and the routes under `/cells/{id}` resolve through that Cell's leader, so a link
 * would open a refusal.
 */
export function PersonCells({
  personId,
  personName,
  note,
  className = 'mt-8',
}: {
  personId: string;
  personName: string;
  /** Spacing from what comes before; the person page's column sets its own. */
  className?: string;
  /** A line under the heading, for a screen where a move could be mistaken for part of Save. */
  note?: string;
}) {
  const headingId = useId();
  const [moving, setMoving] = useState(false);

  const cells = useQuery({
    queryKey: ['person-cells', personId],
    queryFn: ({ signal }) => getPersonCells(personId, signal),
  });

  return (
    <section aria-labelledby={headingId} className={`${FRAME} ${className}`}>
      <h2 id={headingId} className="field-label">
        Cell
      </h2>
      {note ? <p className="text-muted mt-1 text-sm leading-relaxed">{note}</p> : null}

      {cells.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : cells.isError ? (
        <div className="mt-3">
          <FailureNotice failure={describeFailure(cells.error)} />
        </div>
      ) : (
        <>
          {cells.data.membership ? (
            <p className="mt-3 text-sm">
              <span className="font-medium">{cellShortName(cells.data.membership)}</span>
              <span className="text-muted">
                {' '}
                · {cells.data.membership.cell_id}
                {cells.data.membership.leader
                  ? ` · led by ${cells.data.membership.leader.full_name}`
                  : ''}
              </span>
            </p>
          ) : cells.data.leads.length === 0 ? (
            <p className="text-muted mt-3 text-sm">Not in a Cell.</p>
          ) : null}

          {cells.data.leads.length > 0 ? (
            <p className="mt-3 text-sm">
              Leads{' '}
              {cells.data.leads
                .map((cell) =>
                  cellShortName(cell) === cell.cell_id
                    ? cell.cell_id
                    : `${cellShortName(cell)} (${cell.cell_id})`,
                )
                .join(', ')}
            </p>
          ) : null}

          {cells.data.membership || cells.data.leads.length === 0 ? (
            <Button variant="secondary" className="mt-4" onClick={() => setMoving(true)}>
              {cells.data.membership ? 'Move to another Cell' : 'Add to a Cell'}
            </Button>
          ) : null}

          <MoveCellDialog
            open={moving}
            onClose={() => setMoving(false)}
            personId={personId}
            personName={personName}
            current={cells.data.membership}
          />
        </>
      )}
    </section>
  );
}
