import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';

/**
 * The signed-in screens share one shell: the sidebar, the phone's bars, the session checks.
 *
 * Drawn here once rather than by each page, so moving between screens swaps only the page
 * and the sidebar, its logo and the idle sign-out stay as they are. When every page drew
 * its own, each click rebuilt the whole shell and the logo blinked (owner, 2026-11-05).
 * `(app)` is a route group: it names no part of any address. The sign-in and emailed-link
 * pages, the privacy page and the entry point sit outside it, with no shell.
 */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
