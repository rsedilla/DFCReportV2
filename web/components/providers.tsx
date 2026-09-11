'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { ApiRequestError } from '@/lib/api-client';
import { SessionHaltedError, hasStoredSession, subscribe } from '@/lib/session';

/**
 * Server state, and the one retry rule worth setting deliberately.
 *
 * TanStack Query retries a failed query by default. That is right for a dropped
 * connection and wrong for every refusal this API makes: SKILL.md section 22
 * gives stable machine-readable codes, and `CAPABILITY_DENIED`, `SCOPE_DENIED`
 * and `VALIDATION_FAILED` are decisions the rules reached. Retrying one asks the
 * same question three times and gets the same answer, having tripled the load on
 * an endpoint that is rate limited (section 24).
 *
 * The split follows the one section 22 already draws for the idempotency store:
 * a 4xx is this request's outcome, and a 5xx carries no decision. `RESOURCE_BUSY`
 * is the deliberate exception — it is a 503 precisely so that it is *not* stored
 * against an idempotency key, and section 22 defines it as "retry after a short
 * delay".
 *
 * A client is created per mount rather than at module scope, so two tabs of a
 * test harness cannot share one cache.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) => {
              if (failureCount >= 2) {
                return false;
              }
              // A halted session is a decision, not a transient failure. It is
              // raised without a network call and retrying cannot change it —
              // only `resumeSession`, wired to a control the person presses,
              // can. Retrying here would also make the halt look transient in
              // the interface, which is the opposite of what it is.
              if (error instanceof SessionHaltedError) {
                return false;
              }
              if (error instanceof ApiRequestError) {
                return error.status >= 500;
              }
              // A transport failure. Retrying the *query* is fine; what must not
              // be retried automatically is presenting a refresh token whose
              // outcome is unknown, and `lib/session.ts` refuses that itself
              // rather than relying on this policy staying as it is.
              return true;
            },
            staleTime: 30_000,
          },
          // A write is never retried automatically. Section 22 requires an
          // `Idempotency-Key` on every authenticated write so that a *client*
          // may retry safely, and the key is minted per call site; retrying here
          // would either replay one key, which is correct but invisible, or mint
          // a second, which is the duplicate the header exists to prevent.
          mutations: { retry: false },
        },
      }),
  );

  useForgetCacheAcrossSessions(client);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Everything cached is forgotten whenever the session changes hands.
 *
 * **A cache outlives a sign-out, and nothing else here was clearing it.** Every
 * query key in this application names what it asks for and never who is asking —
 * `['me']`, `['cells', month, ...]`, `['dcc-report', month, scope]` — so after a
 * sign-out and a sign-in as somebody else, the previous person's answers keep
 * rendering until each key passes `staleTime`. Found by using the application:
 * signing out of one Senior Pastor and in as the other showed the first one's
 * name and a link to their pastoral network for half a minute.
 *
 * **The API was never wrong, which is what makes this easy to miss.** Every
 * request carried the new token and `GET /auth/me` answered with the new person
 * throughout; a reload corrected it. Section 7 decides what a person may see, and
 * this is the one place that decision can be undone after the fact — a Cell Leader
 * signing in after a Senior Pastor on a shared phone would be shown Whole Church
 * figures the API is refusing them, which is exactly the usage Section 23
 * describes.
 *
 * **Keyed on whether a session is stored, not on who holds it.** A token refresh
 * keeps that answer `true` and must not discard a cache mid-use; a sign-out makes
 * it `false` and a sign-in makes it `true`, and both edges clear. Clearing on the
 * way in as well as on the way out is deliberate: a tab that never observed the
 * sign-out still starts the new session with nothing inherited.
 *
 * Fixing it in each page would mean every future page remembering; there is one
 * cache and one place a session changes, so the rule lives at that seam.
 */
function useForgetCacheAcrossSessions(client: QueryClient): void {
  const wasSignedIn = useRef<boolean | null>(null);

  useEffect(() => {
    wasSignedIn.current = hasStoredSession();

    return subscribe(() => {
      const signedIn = hasStoredSession();
      if (signedIn === wasSignedIn.current) {
        return;
      }
      wasSignedIn.current = signedIn;
      client.clear();
    });
  }, [client]);
}
