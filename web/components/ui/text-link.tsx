import Link from 'next/link';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A link inside prose or beneath a heading — the third primitive, beside
 * `Button` and `Field`.
 *
 * It exists because the same eight utilities were being pasted at every call
 * site, which is how one of them ends up without a focus ring or below the
 * target minimum and nobody notices. A primitive is the difference between a
 * property the application has and a property most of it happens to have.
 *
 * **`min-h-11` and `inline-flex`, so a link that stands alone is a full target**
 * (WCAG 2.5.8). A link *inside a sentence* is exempt under the criterion's own
 * inline exception, and forcing 44px there would put a button-sized gap in the
 * middle of a paragraph — so `inline` drops the height and is used for that
 * case, deliberately rather than by omission.
 */
export function TextLink({
  className,
  inline = false,
  ...props
}: ComponentProps<typeof Link> & { inline?: boolean }) {
  return (
    <Link
      className={cn(
        'text-accent focus-visible:outline-accent rounded-md underline underline-offset-4',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        inline ? 'inline' : 'inline-flex min-h-11 items-center',
        className,
      )}
      {...props}
    />
  );
}
