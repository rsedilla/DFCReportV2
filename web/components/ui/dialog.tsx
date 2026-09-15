'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A modal dialog, on the native `<dialog>` element.
 *
 * **A sheet from the bottom edge below `lg`, and centred from `lg`** (owner's choice of
 * 2026-09-15, step 2 of the clean-up). Every dialog behaves the same way because they all
 * come through here: on a phone or a tablet it is pinned to the bottom edge, full width,
 * within a thumb's reach, and scrolls inside itself when its content is taller than the
 * screen. `lg` is where the bottom tab bar gives way to the sidebar, so the two change at
 * one width. A caller lays its buttons out in a column below `lg`, so each is full width.
 *
 * **Native for the reason the radio group is native** (decision 0072). `showModal()`
 * makes the rest of the page inert, moves focus inside, and closes on Escape, which is
 * what a headless package would reimplement. What it lacks is styling, and that is the
 * only part this adds.
 *
 * **`open` is the page's state and the element follows it.** Escape closes the element
 * without asking React, so its `close` event reports back through `onClose`, and the
 * page's state agrees with what is on screen.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={cn(
        'bg-surface text-ink border-edge backdrop:bg-black/50',
        // The sheet: the bottom margin removed so the top-layer box sits on the bottom edge,
        // and the safe area kept clear below the last button.
        'mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none overflow-y-auto border-0 border-t-2 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
        'lg:m-auto lg:max-h-[calc(100dvh-4rem)] lg:w-[min(32rem,calc(100%-2rem))] lg:border lg:p-6',
      )}
    >
      <h2 id={titleId} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </dialog>
  );
}
