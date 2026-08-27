'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { apiRequest } from '@/lib/api-client';
import { describeFailure, fieldErrorFor, type Failure } from '@/lib/messages';
import { cn } from '@/lib/utils';

/**
 * Setting a password, shared by activation and by reset.
 *
 * Both are `POST { token, password }` against SKILL.md section 6's two
 * unauthenticated routes, and both are the same screen with different wording,
 * so they are one component rather than two that drift.
 *
 * **The length rule is stated and not re-implemented, deliberately.** Section 6
 * puts it at 12 characters minimum and 128 maximum, counted in *characters*, and
 * the 2026-08-24 ruling records a live defect from having two copies of it: the
 * DTO and the service shared the constants but not the counting rule, so
 * `class-validator` counted UTF-16 units while section 6 counted characters and a
 * 128-code-point passphrase was refused by one and accepted by the other.
 *
 * A third copy here would be the same mistake again, and worse — an HTML
 * `minLength` attribute counts UTF-16 units, so it would block submission of a
 * password the API accepts, with no message and nothing to diagnose. So this
 * form carries **no** `minLength`, **no** `maxLength` and no length check. It
 * describes the rule to the person typing, submits, and renders whatever the API
 * answers. One implementation, in the place section 6 puts it.
 *
 * `maxLength` is refused for a second reason as well: section 6 forbids
 * truncating a password to fit, because a silently shortened password is no
 * stronger than its first *n* characters and the holder cannot tell.
 *
 * On 3.3.8, as on sign-in: paste is not blocked, `autoComplete` is
 * `new-password` so a manager offers to generate and store one, and there is no
 * confirm-password field — retyping a generated password is exactly the
 * cognitive function test the criterion exists to remove, and a manager fills
 * one field correctly or not at all.
 */
export function SetPasswordForm({
  path,
  submitLabel,
  successTitle,
  successBody,
}: {
  path: '/api/v1/auth/activate' | '/api/v1/auth/reset-password';
  submitLabel: string;
  successTitle: string;
  successBody: string;
}) {
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div>
        <h2 className="text-base font-medium">{successTitle}</h2>
        <p className="text-muted mt-2 text-sm leading-relaxed">{successBody}</p>
        {/*
          A link, not a button. This navigates, and a screen reader should be
          told so — and a link can be opened in a new tab, which a button that
          pushes a route cannot.
        */}
        <Link href="/sign-in" className={cn(buttonClasses(), 'mt-6 w-full')}>
          Go to sign in
        </Link>
      </div>
    );
  }

  // A link arriving without its token is a broken link rather than a refusal,
  // and saying so is more use than letting the person type a password that
  // cannot be submitted.
  if (!token) {
    return (
      <div>
        {/*
          Not `field-invalid`: a link that arrived without its token is a fact
          about the link, not a refusal of anything the person typed. Section 23
          scopes that token to a form field failing validation.
        */}
        <FailureNotice
          failure={{
            message:
              'This link is missing its token, so it cannot be used. Links expire, and some mail clients shorten them.',
            aboutInput: false,
          }}
        />
        <p className="text-muted mt-4 text-sm leading-relaxed">
          Ask for a new link, or{' '}
          <Link href="/forgot-password" className="text-accent underline underline-offset-4">
            request a password reset
          </Link>
          .
        </p>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setPasswordError(null);
    setSubmitting(true);

    try {
      await apiRequest<void>(path, { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (cause) {
      // **A refusal the API attached to the password goes on the password.**
      // That is the one case section 23 settles `field-invalid` for, and the
      // only one this form can produce: section 6's length rule answers
      // `VALIDATION_FAILED` naming the field. Anything else — a spent link, a
      // server error, a dropped connection — is not about the input and is
      // shown without that colour.
      const onField = fieldErrorFor(cause, 'password');
      if (onField !== null) {
        setPasswordError(onField);
      } else {
        setFailure(describeFailure(cause, 'This link is no longer valid. Ask for a new one.'));
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <FailureNotice failure={failure} />

      <Field
        label="New password"
        type="password"
        name="password"
        autoComplete="new-password"
        required
        value={password}
        error={passwordError}
        onChange={(event) => setPassword(event.target.value)}
        description="At least 12 characters. There is no requirement to include a digit, a symbol or a capital — length is what matters, and a password manager is the easiest way to hold a long one."
      />

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
