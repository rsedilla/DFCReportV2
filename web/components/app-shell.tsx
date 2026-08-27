'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { RequireSession } from '@/components/require-session';
import { cn } from '@/lib/utils';

/**
 * The frame every signed-in screen sits in.
 *
 * **The navigation carries links and never counts** (SKILL.md section 19). A
 * figure in navigation has to be computed on every page load and arrives
 * stripped of the scope and period that make it readable, which is the same
 * argument section 19 uses to keep leadership-development metrics inside Network
 * Summary rather than giving them their own link.
 *
 * **It lists only destinations that exist.** Section 19 sets out the eventual
 * Leader sidebar — Dashboard, My People, My Network, DCC Attendance, Cell
 * Attendance, Cell Leaders, Network Summary, Search — and most of those are
 * Stage 3 and later. Rendering them now, disabled or dead, teaches people that
 * the navigation lies, and that outlasts the stubs. It grows as routes arrive.
 *
 * There is deliberately no Dashboard entry yet: section 19 requires a dashboard
 * to lead with what needs doing, and nothing generates outstanding work until
 * Cells and attendance exist.
 */
const LINKS = [
  { href: '/people', label: 'People' },
  { href: '/session', label: 'Your session' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <RequireSession>
      <div className="min-h-dvh">
        <header className="border-line border-b">
          <nav
            aria-label="Main"
            className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-5 py-2"
          >
            {LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  // `aria-current` rather than colour alone: which page you are on
                  // is information, and colour is never the only way this
                  // application conveys information (1.4.1).
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md px-3',
                    'text-sm focus-visible:outline-2 focus-visible:outline-offset-2',
                    active ? 'text-ink font-medium underline underline-offset-8' : 'text-muted',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {children}
      </div>
    </RequireSession>
  );
}
