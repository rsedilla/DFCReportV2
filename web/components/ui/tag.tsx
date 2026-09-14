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
 * indicator (1.4.1). `solid` is `surface` text on `accent` and `outline` is `ink`
 * on `surface` with an `edge` boundary, all pairs `scripts/check-contrast.mjs`
 * already holds.
 */
export function Tag({
  appearance = 'solid',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { appearance?: 'solid' | 'outline' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center border px-1.5 py-0.5 text-[0.6875rem] leading-none font-bold',
        'tracking-[0.07em] whitespace-nowrap uppercase',
        appearance === 'solid'
          ? 'border-accent bg-accent text-surface'
          : 'border-edge text-ink bg-transparent',
        className,
      )}
      {...props}
    />
  );
}
