'use client';

import { countClasses } from '@/components/ui/frame';
import { cn } from '@/lib/utils';

/**
 * A switch between views of one part of a screen (owner's choice of 2026-10-05): the tabs
 * choose the part, and this chooses how it is shown. It is a pill (decision 0416), so the two
 * levels never look alike: a grey rounded track, the chosen view a white pill with its words
 * bold in the accent. Every segment one size, 8rem, from `lg`; narrower, the segments share
 * the row equally.
 *
 * Buttons pressed and unpressed rather than ARIA tabs, as the tab rows are: each view is the
 * same section of one page. The chosen one is marked by its pill, its weight and its shadow,
 * never by colour alone (1.4.1). Each segment is 44px tall, as the report period controls
 * have always been held to (2.5.8). The outline sits outside the segment, so the chosen one's focus is never
 * hidden by its own fill (2.4.7).
 */
export function ViewSwitch<Key extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  /** `name` is what a screen reader says, where `label` is shorter than words (`#`). */
  options: readonly {
    key: Key;
    label: string;
    name?: string;
    count?: string | null;
  }[];
  value: Key;
  onChange: (key: Key) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        // Narrower than `lg` the segments share the row equally, wrapping to a second row only
        // where five would not fit a phone; from `lg` each is 8rem.
        'border-line bg-raised mt-4 grid w-full grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1 rounded-3xl border p-1',
        'lg:inline-grid lg:w-auto lg:auto-cols-[8rem] lg:grid-flow-col lg:grid-cols-none lg:rounded-full',
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
              'inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full px-2 text-center text-sm leading-tight',
              'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
              pressed
                ? 'bg-surface text-accent font-bold shadow-[0_1px_3px_rgba(0,0,0,0.18)]'
                : 'text-ink hover:bg-surface/60',
            )}
          >
            {option.label}
            {option.count === undefined || option.count === null ? null : (
              // The accent's own count box on every segment: the chosen pill is white.
              <span className={countClasses(false)}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
