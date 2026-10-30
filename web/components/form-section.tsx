import type { ReactNode } from 'react';

/**
 * The layout of a page that is filled in (decision 0410).
 *
 * **A form is a column of sections.** Each section has a short title, and a line saying what
 * it is for, on the left, and its fields on the right; sections are divided by a rule. On a
 * phone and below `lg` the title sits above the fields and every page is one column, as before.
 * A form that holds this layout carries `data-form-layout`, which sets its field labels in
 * sentence case rather than small capitals (`globals.css`).
 */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-line grid gap-x-10 gap-y-3 border-t py-7 first:border-t-0 first:pt-2 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        {description ? (
          <p className="text-muted mt-1.5 max-w-[34ch] text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </section>
  );
}

/** Two related fields side by side from `lg` up, one above the other below it. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 lg:grid-cols-2 lg:gap-x-8">{children}</div>;
}

/** Where a form's button sits: under the fields column, after a rule. */
export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="border-line flex flex-wrap items-center gap-4 border-t pt-6 lg:pl-[18.5rem]">
      {children}
    </div>
  );
}
