'use client';

import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/utils';

/**
 * A button, owned by this repository rather than supplied by a framework.
 *
 * The 2026-08-21 UI ruling refuses any component framework carrying its own
 * design system. The objection that makes it a rule is not the styling engine:
 * those frameworks express state as `error`, `success`, `warning` and
 * `severity`, and hand that vocabulary to whoever writes the next screen as the
 * default — which makes the use SKILL.md sections 13, 17 and 19 forbid the easy
 * one. There is no `variant="destructive"` here, and none is to be added.
 *
 * Two conformance properties are built in rather than left to call sites:
 *
 * - **2.5.8 Target Size.** `min-h-11` is 44px against a 24px floor. Section 23
 *   sets the floor because Cell attendance is recorded by tapping down a roster
 *   on a phone, often standing, where a mis-tap is a wrong attendance record.
 * - **2.4.7 Focus Visible.** The ring is `accent` at a 2px offset, so it lands
 *   on the page background rather than on the button, and is checked against
 *   both surfaces by `scripts/check-contrast.mjs`.
 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
  ref?: Ref<HTMLButtonElement>;
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-surface border-accent',
  secondary: 'bg-surface text-ink border-edge hover:bg-raised',
  quiet: 'bg-transparent text-ink border-transparent hover:bg-raised',
};

/**
 * The classes, separately from the element.
 *
 * Something that *navigates* is a link and must be announced as one, whatever it
 * looks like; something that *acts* is a button. A `<button>` that pushes a route
 * tells a screen reader the wrong thing about what will happen. So a link that
 * should look like a button borrows the classes from here rather than a second
 * set that drifts from these.
 */
export function buttonClasses(variant: NonNullable<ButtonProps['variant']> = 'primary'): string {
  return cn(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4',
    'text-sm font-medium transition-colors',
    'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
  );
}

export function Button({ className, variant = 'primary', type, ...props }: ButtonProps) {
  return (
    <button
      // An unspecified `type` inside a form is `submit`, which is how a
      // secondary action silently submits the form it sits in.
      type={type ?? 'button'}
      className={cn(buttonClasses(variant), className)}
      {...props}
    />
  );
}
