'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { describeGrants } from '@/lib/capability-labels';
import { getMe, roleLabel } from '@/lib/me';
import { getPerson } from '@/lib/people';
import { describeFailure } from '@/lib/messages';
import {
  forgetSession,
  isHalted,
  signOut,
  signOutEverywhere,
  subscribe,
} from '@/lib/session';

/**
 * Where a signed-in person lands, until there is a Dashboard worth landing on.
 *
 * **This is deliberately not a Dashboard, and is not named like one.** SKILL.md
 * section 19 requires a dashboard to lead with what needs doing — meetings
 * awaiting a record, Cells needing attention, people with no Cell membership —
 * and none of those exist yet, because Cells and attendance are Stage 3 and 4. A
 * screen of empty tiles teaches people that the landing screen is worth
 * skipping, and that habit outlives the emptiness.
 *
 * Section 19 also requires dashboards to differ by role, which this client still
 * does not do: `GET /auth/me` names the roles the server honours (decision 0263),
 * and what a client may do with that field beyond displaying it is not settled —
 * decision 0245 rests the sidebar on capabilities rather than on a role, and that
 * ground is untouched.
 *
 * What this screen does instead is show what the server says about this session.
 * That is worth having on its own: the first time a grant does not behave as an
 * administrator expected, this is the screen that says whether the grant is
 * there, and how far it reaches.
 *
 * **It reports; it does not decide.** Nothing here is consulted before making a
 * request, and no control is hidden on the strength of it.
 */
export default function SessionPage() {
  // `AppShell`, not a bare `RequireSession`. The navigation lists this screen as
  // one of its two destinations, and it was rendering no navigation — so
  // arriving here left no way back except the browser's own button. `AppShell`
  // includes `RequireSession`, so nothing is lost by using it.
  return (
    <AppShell>
      <SessionDetail />
    </AppShell>
  );
}

function SessionDetail() {
  const router = useRouter();

  // Read through the store rather than called once, so that a halt arriving
  // while this page is open changes what the button says.
  const halted = useSyncExternalStore(subscribe, isHalted, () => false);

  const session = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: ({ signal }) => getMe(signal),
  });

  // The name and Member ID, from the person's own record: `/auth/me` carries the first
  // name only. Every role may read its own record; if this fails the first name stands.
  const person = useQuery({
    queryKey: ['person', session.data?.person_id],
    queryFn: ({ signal }) => getPerson(session.data!.person_id, signal),
    enabled: session.data !== undefined,
  });

  const [endingEverywhere, setEndingEverywhere] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (endingEverywhere) {
      confirmRef.current?.focus();
    }
  }, [endingEverywhere]);

  const endSession = useMutation({
    mutationFn: (scope: 'this-device' | 'everywhere') =>
      scope === 'everywhere' ? signOutEverywhere() : signOut(),
    onSettled: () => router.replace('/sign-in'),
  });

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <h1 className="text-2xl font-semibold tracking-tight">Account and session</h1>

      {/*
        The greeting comes from `/auth/me`, so it names the person the server
        believes is signed in rather than anything this client remembered. It is
        rendered only once that has arrived — a greeting that says "Welcome," on
        its own while a request is in flight is worse than no greeting.
      */}
      {session.data?.first_name ? (
        <p className="mt-1 text-lg">Welcome, {session.data.first_name}</p>
      ) : null}

      <p className="text-muted mt-2 text-sm leading-relaxed">
        Who you are signed in as, and what this account lets you do.
      </p>

      {session.isPending ? (
        <p className="text-muted mt-8 text-sm">Loading your session…</p>
      ) : session.isError ? (
        <div className="mt-8">
          {/*
            A failed page load is not a refusal of anything typed, so it carries
            no `field-invalid` (section 23). `describeFailure` decides that from
            the error code rather than leaving it to whichever component renders
            the message.
          */}
          <FailureNotice failure={describeFailure(session.error)} />

          {/*
            **A halt is told apart from an ordinary failure, because retrying means
            something different in each.** After an ordinary failure it costs a
            request. After a halt the client has already made the one re-presentation
            section 6 serves, and another would end every session on every device, so
            the only way on is signing in again on this device.
          */}
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => {
              if (halted) {
                forgetSession();
                router.replace('/sign-in');
              } else {
                void session.refetch();
              }
            }}
          >
            {halted ? 'Sign in again' : 'Try again'}
          </Button>
        </div>
      ) : (
        <>
          <dl className="border-line mt-8 grid gap-x-6 gap-y-3 border-t pt-6 sm:grid-cols-[10rem_1fr]">
            <dt className="text-sm font-medium">Signed in as</dt>
            <dd className="text-muted text-sm">
              {person.data
                ? `${person.data.full_name} · ${person.data.member_id}`
                : (session.data.first_name ?? '—')}
            </dd>

            <dt className="text-sm font-medium">Email</dt>
            <dd className="text-muted text-sm break-words">{session.data.email ?? '—'}</dd>

            {/*
              The role the server honours, never one worked out here (decision 0263).
              A role row this system refuses to honour confers nothing and arrives
              filtered out, so an account holding only such a row reads as having none
              rather than as a Senior Pastor whose every request is refused.
            */}
            <dt className="text-sm font-medium">
              {(session.data.roles ?? []).length === 1 ? 'Role' : 'Roles'}
            </dt>
            <dd className="text-muted text-sm">
              {(session.data.roles ?? []).length === 0
                ? 'None'
                : (session.data.roles ?? []).map(roleLabel).join(', ')}
            </dd>
          </dl>

          {/*
            The account's grants in plain words, grouped by how far each reaches (audit of
            2026-10-06). The server checks every action; nothing here grants anything.
          */}
          <h2 className="mt-10 text-base font-medium">What you can do</h2>
          {session.data.capabilities.length === 0 ? (
            <p className="text-muted mt-2 text-sm">This account has no permissions yet.</p>
          ) : (
            <dl className="border-line mt-4 grid gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-[12rem_1fr]">
              {describeGrants(session.data.capabilities).map((group) => (
                <div key={group.reach} className="contents">
                  <dt className="text-sm font-medium">{group.reach}</dt>
                  <dd className="text-muted text-sm leading-relaxed">
                    <ul>
                      {group.actions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      <h2 className="mt-10 text-base font-medium">Your password</h2>
      {/*
        **What is true of this deployment, rather than of the flow that exists.** The
        sign-in screen's reset does send a link, and no email provider is configured: the
        two transports that exist write to a log or to a development outbox, and section 6
        deliberately withholds a reset token from that outbox (ruling of 2026-09-11). A
        reset token is stored as a digest, so nobody can read one out of the database
        either. Saying "use the reset link" would send a leader to a dead end, and telling
        them to sign out first would cost them a working session on the way.
      */}
      <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
        There is no change-password screen. The sign-in screen offers &ldquo;I have forgotten
        my password&rdquo;, which sends a reset link by email and, once used, signs out every
        device on the account &mdash; but no email provider is configured yet, so that link
        is not delivered. Until one is, a forgotten password cannot be reset from inside the
        product.
      </p>

      <h2 className="border-line mt-12 border-t pt-8 text-base font-medium">Sign out</h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Signing out ends this device&rsquo;s session. Several devices may be signed in to one
        account at once, so ending them all is a separate action.
      </p>

      {/*
        **The question is on the second button only** (the owner's design, 2026-09-20).
        Signing out of this device is undone by signing back in; ending every other
        device's session is not, and section 6 makes that a revocation across the
        account. A dialog on the harmless one teaches people to dismiss dialogs.
      */}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={endSession.isPending}
          onClick={() => endSession.mutate('this-device')}
        >
          Sign out
        </Button>
        <Button
          variant="secondary"
          disabled={endSession.isPending}
          onClick={() => setEndingEverywhere(true)}
        >
          Sign out on every device&hellip;
        </Button>
      </div>

      {/*
        **The trigger stays where it is and the question opens below it.** A first version
        put the confirm in the trigger's own slot, where a double-click landed its second
        click on `Yes` — a revocation section 6 makes immediate and account-wide, reached
        by a gesture nobody meant. A second click on the trigger now re-opens the panel
        that is already open.

        Focus moves to the confirmation when it opens and back to the trigger when it is
        declined, because a control that replaces the page's focus with nothing leaves a
        keyboard user tabbing from the top of the document (section 23, 2.4.3 and 2.4.7).
      */}
      {endingEverywhere ? (
        <div className="border-line mt-4 max-w-2xl border p-4">
          <p className="text-sm leading-relaxed">
            Every device signed in to this account is signed out, including any phone you are
            not holding. Nothing else about the account changes.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              ref={confirmRef}
              disabled={endSession.isPending}
              onClick={() => endSession.mutate('everywhere')}
            >
              Yes, sign out everywhere
            </Button>
            <Button
              variant="secondary"
              disabled={endSession.isPending}
              onClick={() => setEndingEverywhere(false)}
            >
              Keep them
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
