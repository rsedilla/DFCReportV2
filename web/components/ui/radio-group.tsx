'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * A single choice from a short, fixed list.
 *
 * **Built on native radios rather than a headless package**, and that is the
 * accessible choice rather than the lazy one. A group of `<input type="radio">`
 * inside a `<fieldset>` already has the roving arrow-key focus, the group
 * semantics and the form participation that a library would reimplement; what it
 * lacks is styling, which is the only part this adds. The 2026-08-21 ruling asks
 * for headless primitives owned by this repository, and a native control is the
 * most headless primitive there is.
 *
 * **The target is the whole option, not the dot.** Each choice is a `<label>`
 * wrapping its input, so the entire row is clickable — which is what WCAG 2.5.8
 * measures, and which matters most on the phone a leader is holding while
 * standing up (section 23). The visible dot stays small because making it 24px
 * to satisfy a mis-measured test changed nothing anybody could actually tap.
 *
 * **Selection is never signalled by colour alone.** The radio's own checked state
 * carries it; the border is a second, redundant cue (1.4.1).
 */
export interface RadioOption<T extends string> {
  value: T;
  label: string;
}

export function RadioGroup<T extends string>({
  legend,
  description,
  name,
  options,
  value,
  onChange,
  required,
  error,
}: {
  legend: string;
  description?: string;
  name: string;
  options: readonly RadioOption<T>[];
  value: T | '';
  onChange: (value: T) => void;
  required?: boolean;
  error?: string | null;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  // `aria-describedby` belongs on the `<fieldset>`, which carries an implicit
  // `group` role. It was on the inner `<div>` — a plain container with no role
  // and nothing focusable — so neither the description nor the error was
  // announced when focus reached an option. axe cannot see this: the ids
  // resolve, so `aria-valid-attr-value` passes and the sweep stays green.
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={describedBy}>
      <legend className="text-sm font-medium">{legend}</legend>

      {description ? (
        <p id={descriptionId} className="text-muted text-sm leading-relaxed">
          {description}
        </p>
      ) : null}

      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {options.map((option) => {
          const checked = value === option.value;

          return (
            <label
              key={option.value}
              className={cn(
                'flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-md border px-3',
                'text-sm transition-colors sm:flex-none sm:min-w-32',
                'has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-2',
                'has-[:focus-visible]:outline-offset-2',
                checked ? 'border-accent bg-raised font-medium' : 'border-edge hover:bg-raised',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                required={required}
                onChange={() => onChange(option.value)}
                className="size-4 shrink-0"
              />
              {option.label}
            </label>
          );
        })}
      </div>

      {error ? (
        <p id={errorId} className="text-field-invalid text-sm leading-relaxed">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
