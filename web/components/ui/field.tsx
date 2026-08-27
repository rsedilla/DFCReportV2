'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * A labelled text input, and the two accessibility rules that shape it.
 *
 * **3.3.8 Accessible Authentication.** SKILL.md section 23: a password is a
 * cognitive function test, and the criterion permits one only where a mechanism
 * assists the user in completing it. Password manager support *is* that
 * mechanism, so this component blocks nothing a manager needs — there is no
 * `onPaste` handler anywhere in this repository, no `autoComplete="off"` on a
 * credential, and no split-character inputs. `autoComplete` is a required prop
 * rather than an optional one, because a manager that cannot identify the field
 * is a manager that does not fill it, and an omission is invisible in review.
 *
 * **1.4.1 and section 23's `field-invalid` rule.** Colour is never the only
 * indicator. An invalid field always renders its message as text, and the
 * message is associated with the input through `aria-describedby` rather than
 * merely sitting near it. `field-invalid` marks the state of an input and
 * nothing else: it is never applied to a meeting status, a coverage figure or a
 * leader, whatever it would seem to fit.
 *
 * The border uses `edge` rather than `line`. `line` is decorative and exempt
 * from 1.4.11; the boundary of a control is not, and reaching for the wrong one
 * on a form field is the mistake that pair of tokens exists to prevent.
 */
export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
  label: string;
  /** Required. See the note above on password managers. */
  autoComplete: string;
  /** Guidance shown before the field is touched, such as a length rule. */
  description?: ReactNode;
  /** When set, the field is invalid and this is why, in words. */
  error?: string | null;
  ref?: Ref<HTMLInputElement>;
};

export function Field({
  label,
  description,
  error,
  className,
  ...props
}: FieldProps & { className?: string }) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <LabelPrimitive.Root htmlFor={id} className="text-sm font-medium">
        {label}
      </LabelPrimitive.Root>

      {description ? (
        <p id={descriptionId} className="text-muted text-sm leading-relaxed">
          {description}
        </p>
      ) : null}

      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'border-edge bg-surface text-ink min-h-11 rounded-md border px-3 text-base',
          'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
          'aria-[invalid=true]:border-field-invalid',
        )}
        {...props}
      />

      {error ? (
        <p id={errorId} className="text-field-invalid text-sm leading-relaxed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
