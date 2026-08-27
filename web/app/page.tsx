'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { hasStoredSession } from '@/lib/session';

/**
 * The entry point, which decides where a visitor belongs and goes there.
 *
 * A pure client cannot redirect on the server (SKILL.md section 2 — no API
 * routes, no server actions, and nothing running here at request time), so the
 * decision is made after mount, once `localStorage` is readable.
 *
 * It says what it is doing rather than rendering an empty page. The wait is
 * normally imperceptible, but on a slow phone it is not, and a blank screen with
 * a live region that never speaks is the version of this that fails a screen
 * reader silently.
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(hasStoredSession() ? '/session' : '/sign-in');
  }, [router]);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <h1 className="text-2xl font-semibold tracking-tight">G12 Church Management</h1>
      <p className="text-muted mt-2 text-sm leading-relaxed" role="status">
        Taking you to the right place…
      </p>
    </main>
  );
}
