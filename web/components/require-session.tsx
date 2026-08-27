'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useSyncExternalStore } from 'react';

import { hasStoredSession, subscribe } from '@/lib/session';

/**
 * Send anyone without a stored session to sign in.
 *
 * **This is a convenience and never a control.** SKILL.md section 1, principle 4
 * makes the API the sole authority for authorization, and UI filtering never
 * sufficient on its own. Everything behind this component would be refused by
 * the API to a caller holding no token, so what this saves is a pointless round
 * trip and an error screen — not access.
 *
 * The session is read through `useSyncExternalStore` because that is what it is:
 * state living outside React, in `localStorage` and a module variable. The
 * server snapshot is `false` because `localStorage` does not exist while the page
 * is prerendered — reading it during render would say "signed out" on the server
 * and "signed in" in the browser, and React resolves that mismatch by discarding
 * the server's markup.
 *
 * The effect reads `hasStoredSession()` directly rather than the rendered value,
 * so it is deciding on what is actually stored at the moment it runs rather than
 * on a snapshot that may still be the server's.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const present = useSyncExternalStore(subscribe, hasStoredSession, () => false);

  // **Depends on `present`, so it runs again when the session ends underneath
  // the page** — a refused refresh discards the credential, and an effect that
  // only ran on mount left the person on `Loading…` indefinitely with no way
  // back to sign in.
  //
  // It reads `hasStoredSession()` rather than `present`, because during
  // hydration the rendered value is still the server's `false` while
  // `localStorage` already says otherwise, and redirecting on that frame would
  // sign out somebody who is signed in.
  useEffect(() => {
    if (!hasStoredSession()) {
      router.replace('/sign-in');
    }
  }, [present, router]);

  if (!present) {
    // **The wider of the two page widths, not a third one.** This renders first
    // on every screen behind it, so a narrower box here means each of them opens
    // at 448px and jumps to 768 or 1024 once the session resolves — a layout
    // shift on every navigation, from the one component none of them chose.
    return (
      <main id="main" className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
        <p className="text-muted text-sm" role="status">
          Loading…
        </p>
      </main>
    );
  }

  return <>{children}</>;
}
