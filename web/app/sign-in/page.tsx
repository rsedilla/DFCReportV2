'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { AuthCard } from '@/components/auth-card';
import { SecondStep } from '@/components/second-step';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { TextLink } from '@/components/ui/text-link';
import { resolveLanding } from '@/lib/landing';
import { describeFailure, type Failure } from '@/lib/messages';
import { forgetEndedByAge, signIn, type SecondStepChallenge } from '@/lib/session';

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
  const [failure, setFailure] = useState<Failure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // An administrator or Senior Pastor is asked for a second step after the password
  // (SKILL.md section 6, decision 0302).
  const [challenge, setChallenge] = useState<SecondStepChallenge | null>(null);
  // Signed out for a spell without activity (decision 0435): said once, above the form.
  // Read from the address in the browser, which the prerendered page does not know.
  const idle = useSyncExternalStore(never, signedOutIdle, () => false);
  // Signed out by the session's age (decision 0450): 7 or 30, from the address, or 0.
  const ageDays = useSyncExternalStore(never, signedOutByAge, () => 0);
  // The note is cleared once read, so this tab is not sent back here saying it again.
  useEffect(() => forgetEndedByAge(), []);

  async function arrive() {
    router.replace(await resolveLanding());
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setSubmitting(true);

    try {
      const second = await signIn(email, password, 'Web browser');
      if (second !== null) {
        setPassword('');
        setChallenge(second);
        return;
      }
      // Section 19 decides where a person lands (ruling of 2026-09-14): Record for
      // a leader, Reports for a whole-church reader. This is one of the two places a
      // signed-in person arrives from, and the home page is the other, so both ask
      // `resolveLanding` rather than each naming a route.
      await arrive();
    } catch (cause) {
      // The one caller that passes `credentialRefusal`: this form is the only
      // place where `UNAUTHENTICATED` means "what you typed was refused" rather
      // than "your session ended".
      setFailure(
        describeFailure(cause, {
          credentialRefusal: email.includes('@')
            ? 'That email address and password do not match an account.'
            : 'That username and password do not match an account.',
        }),
      );
      setSubmitting(false);
    }
  }

  if (challenge !== null) {
    return (
      <SecondStep
        start={challenge}
        onDone={() => void arrive()}
        onSignInAgain={(message) => {
          setChallenge(null);
          setSubmitting(false);
          setFailure(message === '' ? null : { message, aboutInput: false });
        }}
      />
    );
  }

  return (
    <AuthCard
      brand
      title="Welcome. Sign in to continue."
      footer={
        <>
          <TextLink href="/forgot-password">I have forgotten my password</TextLink>
          {/* The Data Privacy Act notice, for the leaders signing in (decision 0412). */}
          <p className="text-muted mt-6 text-xs leading-relaxed">
            DREAMS holds the personal information of the members of Doulos For Christ World
            Harvest Ministry, children among them, under the Data Privacy Act of 2012 (RA 10173). Use it only to care for the people
            you lead.{' '}
            <TextLink inline href="/privacy">
              Privacy Notice
            </TextLink>
          </p>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {idle && failure === null ? (
          <p
            role="status"
            className="border-accent bg-accent-tint text-ink rounded-lg border p-3 text-sm leading-relaxed"
          >
            You were signed out after 30 minutes without activity, to keep members&rsquo;
            details safe. Sign in again to continue.
          </p>
        ) : null}
        {ageDays > 0 && failure === null ? (
          <p
            role="status"
            className="border-accent bg-accent-tint text-ink rounded-lg border p-3 text-sm leading-relaxed"
          >
            It has been {ageDays} days since you signed in on this device. Sign in again to
            continue, to keep members&rsquo; details safe.
          </p>
        ) : null}
        <FailureNotice failure={failure} />

        {/* Either one signs in (decision 0337); `username` so a password manager fills it. */}
        <Field
          label="Email or username"
          type="text"
          name="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
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

/** The address does not change under the page, so there is nothing to subscribe to. */
function never(): () => void {
  return () => {};
}

function signedOutIdle(): boolean {
  return new URLSearchParams(window.location.search).get('reason') === 'idle';
}

/** The days since signing in, where the session ended by its age; 0 otherwise. */
function signedOutByAge(): number {
  const query = new URLSearchParams(window.location.search);
  const days = Number(query.get('days'));
  return query.get('reason') === 'age' && (days === 7 || days === 30) ? days : 0;
}
