'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A filter that is on or off, such as *Late only* (decision 0416's filter bar): a rounded chip,
 * as Material's filter chips and Shopify Polaris's filter pills are. Its name never changes;
 * `aria-pressed` says whether it is on, and a tick shows it, so the state is never colour alone
 * (1.4.1). 44px tall (2.5.8).
 */
export function FilterChip({
  pressed,
  onChange,
  children,
}: {
  pressed: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-5 text-sm',
        'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
        pressed
          ? 'border-accent bg-accent-tint text-accent font-bold'
          : 'border-edge bg-surface text-ink hover:bg-raised',
      )}
    >
      {pressed ? <Check aria-hidden="true" className="size-4" /> : null}
      {children}
    </button>
  );
}
