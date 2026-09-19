import Link from 'next/link';
import type { ReactNode } from 'react';

import { notRecordableLabel, type DccEvent } from '@/lib/dcc';

/**
 * What one Sunday says beside its coverage figure on the DCC report (SKILL.md
 * section 9; decisions 0227, 0228 and 0229).
 *
 * A removed Sunday
 * names its reason, because section 9 requires a removal to record a decision and a row
 * saying only "removed" records none. A Sunday with records still owed links to the
 * attention list behind it (decision 0228). Otherwise, a Sunday nobody can record says
 * why. It is not an error and carries no warning colour.
 *
 * Returns `null` where there is nothing to say, so a caller can leave out its wrapper.
 */
export function dccEventNote(event: DccEvent): ReactNode {
  if (event.removed) {
    return (
      <span className="text-muted text-sm leading-relaxed">
        No service was held.
        {event.removal_reason ? ` ${event.removal_reason}` : ''}
      </span>
    );
  }

  if (event.coverage && event.coverage.met < event.coverage.owed) {
    return (
      <Link
        href={`/dcc/${event.id}/gaps`}
        className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        See who still has to record
      </Link>
    );
  }

  if (event.not_recordable_reason) {
    return <span className="text-muted text-sm">{notRecordableLabel(event.not_recordable_reason)}.</span>;
  }

  return null;
}
