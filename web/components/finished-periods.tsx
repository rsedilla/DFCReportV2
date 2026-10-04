import { FRAME } from '@/components/ui/frame';
import { nextOpensLine, opensOnLabel, type LeaderReach } from '@/lib/finished-periods';
import { rangeLabel, shiftRange } from '@/lib/report-range';

/**
 * The lines decision 0310 adds for a reader without Reports at Whole Church, on Quarterly and
 * Year. Each says what the screen did and when the next period opens; none is a figure.
 */

const NOUN = { QUARTER: 'quarter', YEAR: 'year' } as const;

/** Under the period's controls, on the last finished period: when the next one opens. */
export function NextOpens({ kind, start }: { kind: 'QUARTER' | 'YEAR'; start: string }) {
  return <p className="text-muted mt-2 text-sm">{nextOpensLine(kind, start)}</p>;
}

/** Above the controls, when the address asked for a period outside the reader's reach. */
export function MovedNotice({
  kind,
  asked,
  moved,
}: {
  kind: 'QUARTER' | 'YEAR';
  asked: string;
  moved: 'LATER' | 'EARLIER';
}) {
  const why =
    moved === 'LATER'
      ? `opens on ${opensOnLabel(shiftRange(kind, asked, 1), kind === 'YEAR')}`
      : 'is earlier than you can see here';

  return (
    <p role="status" className="border-line bg-raised mt-6 border px-4 py-3 text-sm">
      {rangeLabel(kind, asked)} {why}, so this is the latest {NOUN[kind]} you can see.
    </p>
  );
}

/** In place of the controls and the figures, when no period of this kind is offered yet. */
export function NotYetOffered({
  kind,
  reach,
}: {
  kind: 'QUARTER' | 'YEAR';
  reach: Extract<LeaderReach, { kind: 'none' }>;
}) {
  const title =
    reach.first === null
      ? `${kind === 'YEAR' ? 'Year' : 'Quarterly'} isn’t available yet`
      : kind === 'YEAR'
        ? `Year opens on ${opensOnLabel(shiftRange(kind, reach.first, 1), true)}`
        : `${rangeLabel(kind, reach.first)} opens on ${opensOnLabel(shiftRange(kind, reach.first, 1), false)}`;
  const line =
    reach.first === null
      ? `It opens once the first ${NOUN[kind]} of DCC records has finished.`
      : kind === 'YEAR'
        ? 'A year is shown once it has finished. Until then, Quarterly shows each finished quarter.'
        : 'A quarter is shown once it has finished.';

  return (
    <section aria-labelledby="not-yet-heading" className={`mt-6 ${FRAME}`}>
      <h2 id="not-yet-heading" className="font-bold">
        {title}
      </h2>
      <p className="text-muted mt-1 text-sm">{line}</p>
    </section>
  );
}
