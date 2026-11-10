import type { ReactNode } from 'react';

/**
 * One thing an administrator can do to a record (decision 0462): what it is for on the left,
 * its button on the right, a rule between rows. On a phone the button goes under the words.
 * `below` holds what the action says back, a refusal or a confirmation, under the row.
 */
export function ActionRow({
  title,
  description,
  children,
  below,
}: {
  title: string;
  description: string;
  children: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className={ACTION_ROW}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-muted mt-0.5 text-sm leading-relaxed">{description}</p>
        </div>
        <div className="shrink-0 sm:*:min-w-44">{children}</div>
      </div>
      {below}
    </div>
  );
}

/** The rule and the room of a row, for a row that has opened into a form or a question. */
export const ACTION_ROW = 'border-line border-t py-3.5 first:border-t-0';
