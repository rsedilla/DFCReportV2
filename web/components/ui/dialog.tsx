'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A modal dialog, on the native `<dialog>` element.
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
      className="bg-surface text-ink border-edge m-auto w-[min(32rem,calc(100%-2rem))] border p-6 backdrop:bg-black/50"
    >
      <h2 id={titleId} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </dialog>
  );
}
