'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { Button, ICON_BUTTON } from '@/components/ui/button';
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
 * **A title bar with a close button, and the buttons always in view** (owner, 2026-11-20,
 * decision 0500). The title and its × stay at the top while the content scrolls, and a
 * caller's buttons sit in `DialogActions`, which stays at the bottom, so the main action is
 * never below the fold. On a phone the sheet may grow to the full height of the screen.
 * The × closes as Escape does, through the same `close` event. The first focus is still the
 * control marked `data-autofocus`, and otherwise the first control below the title bar, so
 * the × never takes it.
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
  describedBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The element that says what the dialog is about, read with its title. */
  describedBy?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
      // The bars measured now that the dialog shows, before a first focus scrolls anything.
      keepClear(dialog, barRef.current, bodyRef.current);
      // The control a dialog marks as its safe answer takes the first focus, rather than
      // whichever control comes first; without one, the first control below the title bar,
      // and with none, the title itself, so the × never takes it.
      const first =
        dialog.querySelector<HTMLElement>('[data-autofocus]') ??
        bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        titleRef.current;
      first?.focus();
      if (document.activeElement !== first) {
        titleRef.current?.focus();
      }
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // 2.4.11: the two bars are sticky, so the dialog keeps their height clear when it scrolls a
  // focused control into view, and a control is never hidden under either. Measured, because
  // the button bar's height depends on its buttons and on the width.
  useEffect(() => {
    const dialog = ref.current;
    const bar = barRef.current;
    const body = bodyRef.current;
    if (!open || !dialog || !bar || !body) {
      return;
    }
    const observer = new ResizeObserver(() => keepClear(dialog, bar, body));
    observer.observe(bar);
    observer.observe(body);
    return () => observer.disconnect();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onClose={onClose}
      className={cn(
        'bg-surface text-ink border-edge backdrop:bg-black/50',
        // The sheet: the bottom margin removed so the top-layer box sits on the bottom edge.
        // It may reach the full height below the status bar, and a short one stays short.
        'mx-0 mt-auto mb-0 max-h-[calc(100dvh-env(safe-area-inset-top))] w-full max-w-none overflow-y-auto border-0 border-t-2 p-0',
        'pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]',
        'lg:m-auto lg:max-h-[calc(100dvh-4rem)] lg:w-[min(36rem,calc(100%-2rem))] lg:border lg:px-0',
      )}
    >
      <div ref={barRef} className="bg-surface border-line sticky top-0 z-10 flex items-start justify-between gap-3 border-b px-5 pt-4 pb-3 lg:px-6">
        <h2 ref={titleRef} id={titleId} tabIndex={-1} className="pt-2 text-lg font-semibold tracking-tight outline-none">
          {title}
        </h2>
        <Button
          variant="secondary"
          className={cn(ICON_BUTTON, 'w-11 shrink-0 px-0')}
          aria-label="Close"
          onClick={() => ref.current?.close()}
        >
          <X aria-hidden="true" className="size-5" />
        </Button>
      </div>
      <div ref={bodyRef} className="px-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-6">
        {children}
      </div>
    </dialog>
  );
}

/** Keeps the height of the title bar and the button bar clear when the dialog scrolls (2.4.11). */
function keepClear(dialog: HTMLDialogElement, bar: HTMLElement | null, body: HTMLElement | null) {
  if (!bar || !body) {
    return;
  }
  const actions = body.querySelector<HTMLElement>('[data-dialog-actions]');
  dialog.style.scrollPaddingTop = `${bar.offsetHeight + 8}px`;
  dialog.style.scrollPaddingBottom = `${(actions?.offsetHeight ?? 0) + 8}px`;
}

/** What can take focus, for the first focus when no control is marked. */
const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]';

/**
 * A dialog's buttons, kept in view at the bottom while the content above them scrolls
 * (decision 0500). A column below `lg`, so each button is full width in the sheet, and a
 * row from `lg`. It is the last thing in the dialog, and takes back the space below it.
 */
export function DialogActions({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      data-dialog-actions
      className={cn(
        'bg-surface border-line sticky bottom-0 z-10 -mx-5 mt-4 -mb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-3 border-t px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
        'lg:-mx-6 lg:-mb-6 lg:flex-row lg:flex-wrap lg:items-center lg:px-6 lg:pb-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
