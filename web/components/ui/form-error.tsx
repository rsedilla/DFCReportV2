'use client';

import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A form-level failure: something the whole submission was refused for, rather
 * than something wrong with one field.
 *
 * **The live region is always in the document, and only its contents change.**
 * A region inserted at the same moment as its text is frequently not announced,
 * because assistive technology has nothing to observe a change against. This is
 * the ordinary way an error message becomes invisible to exactly the person who
 * most needs it, and it cannot be seen in a screenshot or caught by axe.
 *
 * **On the colour.** This carries `field-invalid`, which SKILL.md section 23
 * settles as the one token of its kind and scopes to "a form field failing
 * validation". A form-level message is a hair outside that wording and inside
 * its reasoning: it is a statement about input the person just typed, made to
 * them, and resolved by them in the next few seconds — never a durable judgement
 * about a person, a Cell, or a figure, which is what sections 13, 17 and 19
 * forbid. On sign-in it is form-level *because* it must not say which field was
 * wrong, so it is a field message that a security rule detached from its field.
 *
 * It is never the only indicator. The text carries the meaning; the icon is
 * decorative and hidden from assistive technology, because an icon is not text
 * and colour alone fails 1.4.1.
 */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" aria-live="assertive">
      {children ? (
        <p className="text-field-invalid flex items-start gap-2 text-sm leading-relaxed">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{children}</span>
        </p>
      ) : null}
    </div>
  );
}
