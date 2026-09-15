'use client';

import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';

import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/**
 * A labelled choice from a list too long for radios, on the native `<select>`.
 *
 * The same shape as `Field`: a red label, a description tied to the control with
 * `aria-describedby`, and an error given in words. The boundary is `edge` for the
 * reason `Field` gives: the edge of a control is not decorative (1.4.11).
 */
export function SelectField({
  label,
  description,
  error,
  className,
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  label: string;
  description?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>

      {description ? (
        <p id={descriptionId} className="text-muted text-sm leading-relaxed">
          {description}
        </p>
      ) : null}

      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'border-edge bg-surface text-ink min-h-11 rounded-md border px-3 text-base',
          'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
          'aria-[invalid=true]:border-field-invalid aria-[invalid=true]:border-2',
        )}
        {...props}
      >
        {children}
      </select>

      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
