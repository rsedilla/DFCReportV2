'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { resolveLanding } from '@/lib/landing';
import { getMe } from '@/lib/me';
import { hasStoredSession, signedOutPath } from '@/lib/session';

/**
 * The entry point, which decides where a visitor belongs and goes there.
 *
 * A pure client cannot redirect on the server (SKILL.md section 2 — no API
 * routes, no server actions, and nothing running here at request time), so the
 * decision is made after mount, once `localStorage` is readable. Where a signed-in
 * person belongs depends on their grants (section 19, ruling of 2026-09-14), so it
 * asks the API once before going.
 *
 * It says what it is doing rather than rendering an empty page. The wait is
 * normally imperceptible, but on a slow phone it is not, and a blank screen with
 * a live region that never speaks is the version of this that fails a screen
 * reader silently.
 */
export default function HomePage() {
  const router = useRouter();
  const client = useQueryClient();

  useEffect(() => {
    if (!hasStoredSession()) {
      router.replace(signedOutPath());
      return;
    }

    let cancelled = false;

    // Asked through the shared cache under `['me']`, the key the shell reads, so the screen it
    // lands on draws its sidebar from this answer rather than asking again (owner, 2026-11-06).
    void resolveLanding(() =>
      // No retries: an account that cannot be described lands on Record at once, as before.
      client.fetchQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal), retry: false }),
    ).then((path) => {
      if (!cancelled) {
        router.replace(path);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router, client]);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <h1 className="text-2xl font-semibold tracking-tight">DREAMS</h1>
      <p className="text-muted mt-2 text-sm leading-relaxed" role="status">
        Taking you to the right place…
      </p>
    </main>
  );
}
