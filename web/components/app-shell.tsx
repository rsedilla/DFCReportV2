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

  // **One entry is current, and it is the most specific one that matches.**
  //
  // A prefix test alone marked two: My Network is `/people/{id}/network`, which
  // starts with `/people/`, so People claimed the page as well. Both rendered
  // underlined and both carried `aria-current="page"` — which is not a highlight
  // that looks wrong but a second answer to "where am I", announced to a screen
  // reader as two current pages.
  //
  // The prefix test itself is right and is kept: a person's profile is
  // `/people/{id}` and belongs under People, which an exact match would lose. What
  // was missing is that a longer match beats a shorter one, so `/people/{id}/network`
  // resolves to My Network and `/people/{id}` still resolves to People.
  //
  // It is computed once here rather than per link, because "the most specific match"
  // is a question about the whole list and cannot be answered from inside a `map`.
  const currentHref = links.reduce<string | null>((best, link) => {
    const matches = pathname === link.href || pathname.startsWith(`${link.href}/`);

    if (!matches) {
      return best;
    }

    return best === null || link.href.length > best.length ? link.href : best;
  }, null);

  return (
    <RequireSession>
      {/*
        **One navigation, arranged two ways by the width of the window** (SKILL.md
        section 19, "The sidebar is navigation"). Below `lg` it is the bar across the
        top it has always been; at `lg` and above it stands beside the page as the
        sidebar that section describes.

        **Width, never the device.** Nothing here asks what a phone is: a phone turned
        landscape is wider than a narrow laptop window, someone half-screening a browser
        wants the narrow layout, and an installed PWA is a window like any other. The
        breakpoint is the only question asked.

        **One list rendered once.** The links are built above and the same markup serves
        both arrangements, so a link cannot exist in one layout and not the other, and
        nothing is hidden from a screen reader to make a layout work.
      */}
      <div className="min-h-dvh lg:flex">
        <header className="border-line border-b lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
          <nav
            aria-label="Main"
            className={cn(
              'mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-5 py-2',
              'lg:mx-0 lg:h-dvh lg:max-w-none lg:flex-col lg:flex-nowrap',
              'lg:items-stretch lg:gap-0.5 lg:overflow-y-auto lg:py-6',
            )}
          >
            {links.map((link) => {
              const active = link.href === currentHref;

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
                    // The sidebar is a column, so a link fills its width and the
                    // target grows rather than staying a word-shaped strip (2.5.8).
                    'lg:w-full',
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

        {/*
          `min-w-0` so a wide table inside a page scrolls within its own container
          rather than stretching this column and pushing the sidebar off screen —
          the rule every page already follows for itself, applied to the flex child
          that now holds them.
        */}
        <div className="lg:min-w-0 lg:flex-1">{children}</div>
      </div>
    </RequireSession>
  );
}
