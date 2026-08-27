'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { PAGE_WIDTH } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { describeFailure } from '@/lib/messages';
import {
  authenticatedRequest,
  isHalted,
  resumeSession,
  signOut,
  signOutEverywhere,
  subscribe,
} from '@/lib/session';

interface GrantSummary {
  capability: string;
  scope_type: string;
  scope_network: string | null;
  read_only: boolean;
  source: string;
}

interface SessionDescription {
  account_id: string;
  person_id: string;
  email: string | null;
  first_name: string | null;
  capabilities: GrantSummary[];
}

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
 * Section 19 also requires dashboards to differ by role, which this client
 * cannot yet do honestly: `GET /auth/me` returns capabilities and no role, and
 * deriving one here would be this client deciding an authorization question that
 * section 7 reserves to the API — wrongly, in the case that matters, since a
 * `SENIOR_PASTOR` row the server refuses to honour confers nothing and looks
 * from here exactly like one it honours.
 *
 * What this screen does instead is show what the server says about this session.
 * That is worth having on its own: the first time a grant does not behave as an
 * administrator expected, this is the screen that says whether the grant is
 * there, at what scope, and where it came from.
 *
 * **It reports; it does not decide.** Nothing here is consulted before making a
 * request, and no control is hidden on the strength of it.
 */
export default function SessionPage() {
  return (
    <RequireSession>
      <SessionDetail />
    </RequireSession>
  );
}

function SessionDetail() {
  const router = useRouter();

  // Read through the store rather than called once, so that a halt arriving
  // while this page is open changes what the button says.
  const halted = useSyncExternalStore(subscribe, isHalted, () => false);

  const session = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authenticatedRequest<SessionDescription>('/api/v1/auth/me'),
  });

  const endSession = useMutation({
    mutationFn: (scope: 'this-device' | 'everywhere') =>
      scope === 'everywhere' ? signOutEverywhere() : signOut(),
    onSettled: () => router.replace('/sign-in'),
  });

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <h1 className="text-2xl font-semibold tracking-tight">Your session</h1>

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
        What the API reports about the account you are signed in as. Nothing on this screen
        decides what you may do — that is answered by the server on every request.
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
            **A halt is told apart from an ordinary failure, because pressing the
            button means something different in each.**

            After an ordinary failure, retrying costs a request. After a halt it
            re-presents a token whose fate is unknown — and if the earlier attempt
            did reach the server, that is section 6's reuse signal, which ends
            every session on every device. The justification for halting at all is
            that it makes the risk the person's to take knowingly, and a risk taken
            knowingly has to be stated rather than hidden behind the same three
            words.

            Section 1, principle 7: say what will happen, in the words a leader
            would use.
          */}
          {halted ? (
            <p className="text-muted mt-3 text-sm leading-relaxed">
              Trying again may sign you out on every device, including your phone. That happens
              only if the earlier attempt reached the server after all, and you would need to
              sign in again everywhere.
            </p>
          ) : null}

          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => {
              resumeSession();
              void session.refetch();
            }}
          >
            {halted ? 'Try again anyway' : 'Try again'}
          </Button>
        </div>
      ) : (
        <>
          <dl className="border-line mt-8 grid gap-x-6 gap-y-3 border-t pt-6 sm:grid-cols-[10rem_1fr]">
            <dt className="text-sm font-medium">Email</dt>
            <dd className="text-muted text-sm break-words">{session.data.email ?? '—'}</dd>

            <dt className="text-sm font-medium">Account</dt>
            <dd className="text-muted font-mono text-sm break-all">{session.data.account_id}</dd>

            <dt className="text-sm font-medium">Person</dt>
            <dd className="text-muted font-mono text-sm break-all">{session.data.person_id}</dd>
          </dl>

          <h2 className="mt-10 text-base font-medium">Authority</h2>
          <p className="text-muted mt-1 text-sm leading-relaxed">
            Capabilities the API advertises for this account, with the scope each is held at. A
            grant that covers nothing is not listed, because an action refused every time it is
            attempted should not be offered.
          </p>

          {session.data.capabilities.length === 0 ? (
            <p className="text-muted mt-4 text-sm">
              This account is advertised no capabilities.
            </p>
          ) : (
            <div className="border-line mt-4 overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">
                  Capabilities held by this account, with scope, source, and whether the grant is
                  read-only.
                </caption>
                <thead>
                  <tr className="border-line bg-raised border-b">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Capability
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Scope
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {session.data.capabilities.map((grant) => (
                    <tr
                      key={`${grant.capability}:${grant.scope_type}:${grant.source}`}
                      className="border-line border-b last:border-b-0"
                    >
                      <td className="px-3 py-2 font-mono">{grant.capability}</td>
                      <td className="text-muted px-3 py-2">
                        {grant.scope_type}
                        {grant.scope_network ? ` · ${grant.scope_network}` : ''}
                        {grant.read_only ? ' · read only' : ''}
                      </td>
                      <td className="text-muted px-3 py-2">{grant.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h2 className="border-line mt-12 border-t pt-8 text-base font-medium">Sign out</h2>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Signing out ends this device&rsquo;s session. Several devices may be signed in to one
        account at once, so ending them all is a separate action.
      </p>

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
          onClick={() => endSession.mutate('everywhere')}
        >
          Sign out on every device
        </Button>
      </div>
    </main>
  );
}
