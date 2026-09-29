'use client';

import { useId } from 'react';

import { FieldError } from '@/components/ui/field';
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
  disabled = false,
  layout = 'stacked',
}: {
  legend: string;
  description?: string;
  name: string;
  options: readonly RadioOption<T>[];
  value: T | '';
  onChange: (value: T) => void;
  required?: boolean;
  error?: string | null;
  /**
   * Shown and not changeable, such as a recorded meeting nobody is editing. Set on
   * the `<fieldset>`, which disables every radio inside it natively — so a keyboard
   * cannot reach them either, rather than only a pointer being refused.
   */
  disabled?: boolean;
  /**
   * `row` puts the choices beside the legend, one line per group, for a roster that
   * asks the same question of many people (the DCC checklist and a Cell meeting). The
   * dot is hidden to fit a 320px phone; the native radio still carries the state,
   * and a thicker border and bold label mark the choice without relying on colour.
   */
  layout?: 'stacked' | 'row';
}) {
  const id = useId();
  const row = layout === 'row';
  const legendId = `${id}-legend`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  const body = (
    <>
      {description ? (
        <p
          id={descriptionId}
          // On a phone the line runs under the choices too, rather than wrapping into
          // a column a word wide beside them.
          className={cn(
            'text-muted text-sm leading-relaxed',
            row && 'col-span-2 sm:col-span-1 sm:col-start-1',
          )}
        >
          {description}
        </p>
      ) : null}

      <div
        className={
          row
            ? 'col-start-2 row-start-1 flex gap-1.5 sm:row-span-2 sm:gap-2'
            : 'mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap'
        }
      >
        {options.map((option) => {
          const checked = value === option.value;

          return (
            <label
              key={option.value}
              className={cn(
                'flex min-h-11 cursor-pointer items-center rounded-md border text-sm transition-colors',
                row
                  ? 'relative w-[4.25rem] justify-center px-1 sm:w-24'
                  : 'flex-1 gap-2.5 px-3 sm:flex-none sm:min-w-32',
                'has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-2',
                'has-[:focus-visible]:outline-offset-2',
                checked
                  ? cn('border-accent bg-raised font-medium', row && 'border-2')
                  : 'border-edge',
                // **Disabled looks disabled.** The pointer and the hover wash said "tap me"
                // on a group that cannot change, so both follow the input's own state.
                'has-[:enabled]:hover:bg-raised has-[:disabled]:cursor-not-allowed',
                'has-[:disabled]:opacity-60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                required={required}
                // A fieldset disables its radios natively; the row layout has no
                // fieldset, so each is disabled itself.
                disabled={row ? disabled : undefined}
                onChange={() => onChange(option.value)}
                // Invisible and covering the whole button, so a tap lands on the radio
                // itself; `sr-only` left it a pixel wide under the label.
                className={
                  row
                    ? 'absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed'
                    : 'size-4 shrink-0'
                }
              />
              {option.label}
            </label>
          );
        })}
      </div>

      {error ? (
        <div className={cn(row && 'col-span-2')}>
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      ) : null}
    </>
  );

  // **The row layout is a `div` with the group role, not a fieldset.** A legend
  // cannot share a grid row with anything in WebKit, so the name would sit above its
  // choices on every iPhone; a labelled group is what a fieldset and legend expose.
  if (row) {
    return (
      <div
        role="group"
        aria-labelledby={legendId}
        aria-describedby={describedBy}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 sm:gap-x-3"
      >
        {/* A name one word too long for the column breaks rather than running under
            the choices, which at 320px inside the DCC card it otherwise does. */}
        <div
          id={legendId}
          // A person's name, so written as it is spelled rather than in the field
          // label's capitals (owner, 2026-09-30).
          className="text-accent col-start-1 text-sm font-bold [overflow-wrap:anywhere]"
        >
          {legend}
        </div>
        {body}
      </div>
    );
  }

  // `aria-describedby` belongs on the `<fieldset>`, which carries an implicit
  // `group` role. It was on the inner `<div>` — a plain container with no role
  // and nothing focusable — so neither the description nor the error was
  // announced when focus reached an option. axe cannot see this: the ids
  // resolve, so `aria-valid-attr-value` passes and the sweep stays green.
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={describedBy} disabled={disabled}>
      <legend className="field-label">{legend}</legend>
      {body}
    </fieldset>
  );
}
