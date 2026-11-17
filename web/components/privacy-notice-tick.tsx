'use client';

import { useId } from 'react';

import { TextLink } from '@/components/ui/text-link';

/**
 * The box an account holder ticks to say they read the Privacy Notice (decision 0496): at
 * activation and on the one-time screen. It starts empty and nothing ticks it for them.
 *
 * The notice opens in a new tab, so a password already typed is not lost; the link says so.
 * The box is 24 by 24 pixels (2.5.8) and the whole label toggles it.
 */
export function PrivacyNoticeTick({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const inputId = useId();

  return (
    <div className="flex items-start gap-3">
      <input
        id={inputId}
        type="checkbox"
        className="accent-accent mt-0.5 size-6 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={inputId} className="text-sm leading-relaxed">
        I have read the{' '}
        <TextLink inline href="/privacy" target="_blank" rel="noopener">
          Privacy Notice<span className="sr-only"> (opens in a new tab)</span>
        </TextLink>
        , and I will use DREAMS only to care for the people I lead.
      </label>
    </div>
  );
}
