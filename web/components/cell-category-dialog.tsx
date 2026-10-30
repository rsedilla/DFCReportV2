'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  categoryLabel,
  CELL_CATEGORIES,
  changeCellCategory,
  type CellCategory,
} from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/**
 * Changing a Cell's category (SKILL.md section 10, decision 0367), beside Changing when it
 * meets: the same capability, `cell.manage_configuration`, governs both.
 *
 * **It takes effect today, and the dialog says so**, unlike the schedule, which waits for
 * the next month: nothing counts meetings from a category, so no figure moves mid-month. The
 * Cell keeps its ID, and months already past keep the category they had.
 *
 * **The current category is not offered**: changing a Cell to what it already is would
 * record a change where none happened.
 */
export function CellCategoryDialog({
  open,
  onClose,
  onSaved,
  cellId,
  cellHandle,
  current,
}: {
  open: boolean;
  onClose: () => void;
  /** Told the category saved, so the page can say so. */
  onSaved: (category: CellCategory) => void;
  cellId: string;
  cellHandle: string | null;
  current: CellCategory | null;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('');

  const save = useMutation({
    mutationFn: () =>
      changeCellCategory(
        cellId,
        category as CellCategory,
        idempotencyKeyFor('category', cellId, category),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cells'] });
      await queryClient.invalidateQueries({ queryKey: ['cell-meetings', cellId] });
      onSaved(category as CellCategory);
      close();
    },
  });

  function close() {
    save.reset();
    setCategory('');
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={cellHandle ? `Change the category of ${cellHandle}` : 'Change this Cell’s category'}
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (category !== '') {
            save.mutate();
          }
        }}
      >
        {current ? (
          <p className="text-sm">
            It is a <strong>{categoryLabel(current)}</strong> Cell now.
          </p>
        ) : null}

        <RadioGroup
          legend="New category"
          name="category"
          value={category}
          onChange={setCategory}
          options={CELL_CATEGORIES.filter((value) => value !== current).map((value) => ({
            value,
            label: categoryLabel(value),
          }))}
        />

        <p className="text-muted text-sm leading-relaxed">
          It takes effect today. The Cell keeps its ID, and months already past keep the category
          they had.
        </p>

        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />

        {/* A column below `lg`, so each button is full width in the sheet. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
          <Button type="submit" disabled={category === '' || save.isPending}>
            {save.isPending
              ? 'Saving…'
              : category === ''
                ? 'Change category'
                : `Make it ${categoryLabel(category as CellCategory)}`}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
