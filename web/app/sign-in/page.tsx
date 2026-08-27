'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AuthCard } from '@/components/auth-card';
import { FormError } from '@/components/ui/form-error';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { messageFor } from '@/lib/messages';
import { signIn } from '@/lib/session';

/**
 * Sign-in, and the accessibility criterion this screen exists to satisfy.
 *
 * WCAG 2.2 **3.3.8 Accessible Authentication** permits a password only where a
 * mechanism assists the user in completing it, and SKILL.md sections 6 and 23
 * name password managers as that mechanism. So: paste is not blocked, there is
 * no `autoComplete="off"`, the email field is `username` and the password field
 * is `current-password` so a manager can identify both, and there is no
 * `maxLength` truncating what a manager fills. Section 6's password rule is a
 * length rule with no composition requirement for the same reason — a rule
 * forcing a symbol pushes people toward something short enough to retype, which
 * works against the thing conformance rests on.
 *
 * **The refusal is deliberately vague, and that is not sloppiness.** A message
 * distinguishing "no such account" from "wrong password" turns this form into an
 * account enumeration oracle, and section 6 already requires the reset path to
 * answer identically whether or not the address exists. Saying less here keeps
 * the two consistent.
 */
export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signIn(email, password, 'Web browser');
      router.replace('/session');
    } catch (cause) {
      setError(messageFor(cause, 'That email address and password do not match an account.'));
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      intro="G12 Church Management. Accounts arrive with Cell leadership."
      footer={
        <Link
          href="/forgot-password"
          className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          I have forgotten my password
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <FormError>{error}</FormError>

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

        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
