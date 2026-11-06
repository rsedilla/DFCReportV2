import type { ReactNode } from 'react';

import { pageTurnProps } from '@/lib/keep-previous-page';

/**
 * A report's figures while another period of it loads (owner, 2026-11-06): the figures already
 * shown stay, faded and `aria-busy`, under a line naming the period that is loading, instead of
 * the page blanking to Loading and jumping. The line is a status, so a screen reader is told.
 * When `kept` is false this is the figures and nothing else.
 */
export function KeptFigures({
  kept,
  loading,
  children,
}: {
  kept: boolean;
  /** The period being loaded, as the screen names it ("April 2026"). */
  loading: string;
  children: ReactNode;
}) {
  return (
    <>
      {kept ? (
        <p role="status" className="text-muted mt-6 text-sm">
          Loading {loading}&hellip;
        </p>
      ) : null}
      <div {...pageTurnProps(kept)}>{children}</div>
    </>
  );
}
