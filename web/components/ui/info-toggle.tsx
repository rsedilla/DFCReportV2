'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * An ⓘ that opens a short note on a tap or a click, and closes on a second one, on Escape,
 * or on a tap anywhere else (decision 0454).
 *
 * **A tap, not a hover.** A tooltip that waits for a pointer to hover never opens on a phone
 * or an iPad, which have no hover, so this is a button the reader presses, a "toggletip".
 * The note is never the only place what it says can be found: Record's rows each carry their
 * own deadline, and the note restates the rule they follow.
 *
 * The button names what it opens and says whether it is open (`aria-expanded`), and the note
 * follows it in the reading order, so a screen reader reaches it next. Focus stays on the
 * button, and Escape returns there.
 */
export function InfoToggle({
  label,
  children,
  className,
  small = false,
}: {
  /** What the button opens, for a screen reader: "About this page". */
  label: string;
  /** 24px rather than 32px, beside a field's label; still WCAG 2.5.8's minimum target. */
  small?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <span ref={wrapper} className={cn('relative inline-flex align-middle', className)}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={noteId}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'border-accent text-accent inline-flex cursor-pointer items-center justify-center rounded-full border-2',
          'font-serif font-bold italic',
          small ? 'size-6 text-sm' : 'size-8 text-base',
          'hover:bg-accent-tint focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
          open && 'bg-accent-tint',
        )}
      >
        <span aria-hidden="true">i</span>
      </button>
      <span
        id={noteId}
        hidden={!open}
        className="border-line bg-surface text-ink absolute top-[calc(100%+0.5rem)] left-0 z-20 w-[min(22rem,calc(100vw-3rem))] rounded-xl border p-4 text-left text-sm leading-relaxed font-normal tracking-normal shadow-lg"
      >
        {children}
      </span>
    </span>
  );
}
