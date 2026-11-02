import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * A short word or two set apart from the text around it.
 *
 * **The two appearances are named for how they look, never for what they mean.**
 * There is no `status`, `tone` or `severity` prop, and none is to be added: a tag
 * named for a judgement is the palette's forbidden token arriving one layer up
 * (SKILL.md section 23), and the button's refusal of `variant="destructive"` is the
 * same rule.
 *
 * Which facts carry `solid` is settled in `docs/DESIGN_RECONCILIATION.md` rather
 * than here: a neutral fact such as a period being open, or a person's stage, with
 * every stage the same colour. **Anything about records awaiting entry is
 * `outline`** — a word, never a colour — because sections 13, 17 and 19 forbid
 * encoding meeting status, coverage or a leader in colour.
 *
 * The words carry the meaning in both appearances, so colour is never the only
 * indicator (1.4.1). `solid` is `accent` text on `accent-tint` and `outline` is `ink`
 * on `surface` inside a `line` rule, pairs `scripts/check-contrast.mjs` already holds.
 */
export function Tag({
  appearance = 'solid',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { appearance?: 'solid' | 'outline' }) {
  return (
    <span
      className={cn(
        // A pill with its words as written (decision 0423).
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs leading-none font-semibold',
        'whitespace-nowrap',
        appearance === 'solid'
          ? 'border-accent-tint bg-accent-tint text-accent'
          : 'border-line text-ink bg-surface',
        className,
      )}
      {...props}
    />
  );
}
