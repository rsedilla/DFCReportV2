'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { ApiRequestError } from '@/lib/api-client';

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
              if (error instanceof ApiRequestError) {
                return error.status >= 500;
              }
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

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
