'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { RequireSession } from '@/components/require-session';
import { getMe } from '@/lib/me';
import { cn } from '@/lib/utils';

/**
 * Where My Network sits: directly after People, which is section 19's order —
 * Dashboard, My People, My Network — and is also the pairing a reader expects,
 * since both are about people rather than about Cells or figures.
 */
const MY_NETWORK_AFTER = 2;

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
 * Attendance, Cell Leaders, Network Summary, Search — and most of those were
 * Stage 3 and later. Rendering them before their route exists, disabled or dead,
 * teaches people that the navigation lies, and that outlasts the stubs. It grows
 * as routes arrive.
 *
 * **My Network arrived late by that rule's own terms**, and is added here rather
 * than left: `/people/[id]/network` has existed since the screens block, so the
 * entry has been due since then and nothing recorded it as owed. It is the one
 * link that needs the viewer's own identity, which is why it is built from
 * `getMe` rather than sitting in the static list beside the others.
 *
 * **Search is not a separate entry and is not missing.** Section 19 lists it, and
 * People *is* the search: the screen's whole content is a search field over the
 * church-wide directory (section 8). A second entry pointing at the same screen
 * would be navigation describing itself twice.
 *
 * **Network Summary stays absent**, deferred past the pilot with the five views
 * behind it, which `docs/ROADMAP.md` records.
 *
 * **Dashboard is first, which section 19 requires**: it is "the first item in the
 * sidebar and the screen every user lands on". *This paragraph said there was
 * deliberately no Dashboard entry, on the ground that nothing generated
 * outstanding work until Cells and attendance existed. Both now do, and the entry
 * arrived with them.*
 */
const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/people', label: 'People' },
  { href: '/cells', label: 'Cell Leaders' },
  { href: '/dcc', label: 'DCC Attendance' },
  { href: '/reports/cells', label: 'Cell Attendance' },
  { href: '/reports/dcc', label: 'DCC Figures' },
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
 * Two values for a page of content, where there were four.
 *
 * - `READING` (`max-w-3xl`, 768px) for anything read or filled in: a profile, a
 *   form, the session description.
 * - `INDEX` (`max-w-5xl`, 1024px) for a list or a table, where the extra width
 *   buys columns rather than longer lines.
 *
 * **`READING` is not a reading measure**, and it was described as one here in
 * error. Less its padding it is a 728px column, which at the body size is
 * nearer 90 characters than the 60–75 that is comfortable. Prose is kept short
 * by the `max-w-xl`/`max-w-2xl` on the paragraphs themselves, which is where a
 * measure belongs — a page width also has to hold a form and a definition list.
 *
 * **The unauthenticated screens are a third width and are not counted here.**
 * `auth-card.tsx` and the landing screen are centred cards on an empty page
 * rather than pages of content. `require-session.tsx` deliberately uses the
 * wider of the two above rather than a card width: it renders first on every
 * screen behind it, so a narrow box there means each of them opens at one width
 * and jumps to another.
 */
export const PAGE_WIDTH = {
  READING: 'mx-auto max-w-3xl px-5 py-8 sm:py-12',
  INDEX: 'mx-auto max-w-5xl px-5 py-8 sm:py-12',
} as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // **Shares the cache with every screen that already asks.** The key is the one
  // `getMe` is queried under elsewhere, so this adds a cache read rather than a
  // request per page.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // **My Network appears once the viewer's own identity is known, and not before.**
  // It is the only entry whose destination depends on who is looking, and the rule
  // above is that this list holds destinations that exist — a link to
  // `/people/undefined/network` exists in the same sense a dead one does.
  const links =
    me.data === undefined
      ? LINKS
      : [
          ...LINKS.slice(0, MY_NETWORK_AFTER),
          { href: `/people/${me.data.person_id}/network`, label: 'My Network' },
          ...LINKS.slice(MY_NETWORK_AFTER),
        ];

  return (
    <RequireSession>
      <div className="min-h-dvh">
        <header className="border-line border-b">
          <nav
            aria-label="Main"
            className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-5 py-2"
          >
            {links.map((link) => {
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
                    // **`accent` carries the current page, and the underline and weight
                    // stay.** They are not decoration left over from an earlier version:
                    // 1.4.1 forbids colour as the only carrier of information, so
                    // removing either would make this an accessibility defect rather
                    // than a tidier class list. `aria-current` above covers assistive
                    // technology and the underline covers a sighted reader who cannot
                    // separate the two hues.
                    //
                    // `accent` on `surface` is a pair `check-contrast.mjs` already holds
                    // in both themes, because `body` is `bg-surface` and this header
                    // declares no background of its own. Using the token in this new
                    // position therefore adds no pair — which is the one thing that
                    // check cannot notice for itself.
                    active
                      ? 'text-accent font-medium underline underline-offset-8'
                      : 'text-muted',
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
