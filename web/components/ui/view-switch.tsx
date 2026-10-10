'use client';

import { cn } from '@/lib/utils';

/**
 * A small switch between views of one part of a screen (owner's choice of 2026-10-05): big
 * uppercase tabs choose the part, and this chooses how it is shown. Sentence case and only
 * as wide as its words, so it never reads as another row of tabs.
 *
 * Buttons pressed and unpressed rather than ARIA tabs, as the tab rows are: each view is the
 * same section of one page. The chosen one is filled, not marked by colour alone (1.4.1),
 * and each button is 44px tall, as the report period controls have always been held to. The outline sits outside the
 * button, so the filled one's focus is never hidden by its own fill (2.4.7).
 */
export function ViewSwitch<Key extends string>({
  label,
  options,
  value,
  onChange,
  className,
  even = false,
}: {
  label: string;
  /** `name` is what a screen reader says, where `label` is shorter than words (`#`). */
  options: readonly { key: Key; label: string; name?: string; count?: string | null }[];
  value: Key;
  onChange: (key: Key) => void;
  className?: string;
  /** Every button the same width (owner, 2026-10-09), for a switch whose words differ in length. */
  even?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        even ? 'mt-4 grid w-full max-w-lg auto-cols-fr grid-flow-col' : 'mt-4 flex flex-wrap',
        className,
      )}
    >
      {options.map((option) => {
        const pressed = option.key === value;

        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={pressed}
            aria-label={option.name}
            onClick={() => onChange(option.key)}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 border px-3.5 text-sm',
              even && 'min-w-0 justify-center px-2 text-center leading-tight',
              '-ml-px first:ml-0 first:rounded-l-md last:rounded-r-md',
              'focus-visible:outline-accent focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2',
              pressed
                ? 'bg-accent text-surface border-accent relative'
                : 'border-line text-ink hover:bg-raised',
            )}
          >
            {option.label}
            {option.count === undefined || option.count === null ? null : (
              <span className="inline-block min-w-5 border border-current px-1 text-center leading-4 tabular-nums">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
