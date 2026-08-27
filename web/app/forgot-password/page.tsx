'use client';

import Link from 'next/link';
import { useState } from 'react';

import { AuthCard } from '@/components/auth-card';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { apiRequest } from '@/lib/api-client';
import { describeFailure, type Failure } from '@/lib/messages';

/**
 * Requesting a password reset link (SKILL.md section 6).
 *
 * **The confirmation is identical whether or not the address has an account, and
 * this screen must not undo that.** The API answers the same either way — that
 * is section 6's rule, and it is the whole reason the endpoint exists in the
 * shape it does. A client that rendered "we have sent you a link" in one case
 * and "no such account" in the other would reintroduce the account enumeration
 * the API went to some trouble to prevent, from the outside.
 *
 * So the success state is reached for every answer the API gives, and the
 * wording below is careful to promise nothing that would reveal which happened:
 * "if that address has an account", not "check your inbox".
 *
 * The one thing that does surface an error is a failure to *reach* the API, or a
 * rate limit. Neither says anything about whether the address exists.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setSubmitting(true);

    try {
      await apiRequest<void>('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setSent(true);
    } catch (cause) {
      setFailure(describeFailure(cause, 'Could not send the link. Try again shortly.'));
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      intro={sent ? undefined : 'We will email you a link to choose a new one.'}
      footer={
        <Link
          href="/sign-in"
          className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div>
          <h2 className="text-base font-medium">Check your email</h2>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            If that address has an account, a link to choose a new password is on its way. The
            link can be used once, and it expires.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <FailureNotice failure={failure} />

          <Field
            label="Email address"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Email me a link'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
