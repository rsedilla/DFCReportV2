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

/**
 * How wide a screen's content is allowed to get, and why there are two.
 *
 * **A laptop is wider than anything worth reading across.** Left unconstrained, a
 * form field on a 1920px display becomes a 1900px input and a paragraph runs to
 * 200 characters a line, which is harder to read than the same thing on a phone.
 * So content stops widening and the page centres it — the same layout from a
 * 1024px laptop to a 4K display, with more margin rather than more line.
 *
 * Two values, not four. Slice 2 arrived with `max-w-md`, `2xl`, `3xl` and `5xl`
 * across six screens, three of them arbitrary.
 *
 * - `READING` (`max-w-3xl`, 768px) for anything read or filled in: a profile, a
 *   form, the session description. It keeps a line of prose near the 60–75
 *   characters that is comfortable to read.
 * - `INDEX` (`max-w-5xl`, 1024px) for a list or a table, where the extra width
 *   buys columns rather than longer lines.
 *
 * The sign-in card keeps its own narrower width in `auth-card.tsx`: it is a
 * centred card on an empty page rather than a page of content, and it is the one
 * screen with no navigation around it.
 */
export const PAGE_WIDTH = {
  READING: 'mx-auto max-w-3xl px-5 py-8 sm:py-12',
  INDEX: 'mx-auto max-w-5xl px-5 py-8 sm:py-12',
} as const;

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
