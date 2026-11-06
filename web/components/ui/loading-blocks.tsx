import { cn } from '@/lib/utils';

/**
 * Grey blocks in the shape of what is loading, in place of a single "Loading…" line that the
 * page then replaces with something many times taller (owner, 2026-11-06). A screen reader is
 * told "Loading…" as before, by a status; the blocks themselves are hidden from it.
 *
 * - `person`: a person's page, the name and the line under it, then two cards.
 * - `form`: three labelled fields, as the edit page has.
 * - `lines`: three lines of a list or a dialog.
 */
export function LoadingBlocks({
  shape,
  className,
}: {
  shape: 'person' | 'form' | 'lines';
  className?: string;
}) {
  return (
    <div className={className}>
      <p role="status" className="sr-only">
        Loading&hellip;
      </p>
      <div aria-hidden="true" data-loading-blocks="">
        {shape === 'person' ? (
          <>
            <Bar className="h-7 w-3/5 max-w-sm" />
            <Bar className="mt-3 h-3.5 w-2/5 max-w-60" />
            <Card lines={['w-4/5', 'w-3/4', 'w-1/2']} />
            <Card lines={['w-11/12', 'w-3/5']} />
          </>
        ) : shape === 'form' ? (
          <div className="flex max-w-xl flex-col gap-6">
            {[0, 1, 2].map((field) => (
              <div key={field}>
                <Bar className="h-3.5 w-28" />
                <Bar className="mt-2 h-11 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <Bar className="h-4 w-4/5" />
            <Bar className="h-4 w-3/4" />
            <Bar className="h-4 w-1/2" />
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ className }: { className: string }) {
  return <div className={cn('bg-line rounded-md', className)} />;
}

function Card({ lines }: { lines: string[] }) {
  return (
    <div className="border-line mt-6 max-w-2xl rounded-lg border p-4">
      <Bar className="h-3 w-2/5" />
      {lines.map((width) => (
        <Bar key={width} className={cn('mt-3 h-4', width)} />
      ))}
    </div>
  );
}
