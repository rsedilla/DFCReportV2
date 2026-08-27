'use client';

import { CircleAlert, Info } from 'lucide-react';

import type { Failure } from '@/lib/messages';

/**
 * One live region for anything that failed, and one place the colour is decided.
 *
 * **The live region is always in the document, and only its contents change.**
 * A region inserted at the same moment as its text is frequently not announced,
 * because assistive technology has nothing to observe a change against. This is
 * the ordinary way an error message becomes invisible to exactly the person who
 * most needs it, and it cannot be seen in a screenshot or caught by axe.
 *
 * **On the colour.** `field-invalid` is carried only where the failure is a
 * refusal of what the person just submitted (`Failure.aboutInput`, set in
 * `lib/messages.ts` from the error code). Everything else — a server error, a
 * dropped connection, a link that arrived without its token — is rendered
 * without it.
 *
 * SKILL.md section 23 scopes that token to a form field failing validation and
 * calls it the only one of its kind, arguing it from what such a message is: a
 * statement about an input, made to the person who just typed it, resolved by
 * them in seconds. On a sign-in refusal that reasoning holds exactly, and the
 * message is form-level only because a security rule detached it from its field.
 * On a failed page load none of it holds, and reaching for the one token that
 * exists because it is the one token that exists is the drift section 23
 * predicts.
 *
 * It is never the only indicator. The text carries the meaning; the icon is
 * decorative and hidden from assistive technology, because an icon is not text
 * and colour alone fails 1.4.1.
 */
export function FailureNotice({ failure }: { failure: Failure | null }) {
  const Icon = failure?.aboutInput ? CircleAlert : Info;

  return (
    <div role="alert" aria-live="assertive">
      {failure ? (
        <p
          className={
            'flex items-start gap-2 text-sm leading-relaxed ' +
            (failure.aboutInput ? 'text-field-invalid' : 'text-ink')
          }
        >
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{failure.message}</span>
        </p>
      ) : null}
    </div>
  );
}
