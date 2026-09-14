'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { RequireSession } from '@/components/require-session';
import { RECORD_PATH, REPORTS_PATH, readsWholeChurch } from '@/lib/landing';
import { getMe } from '@/lib/me';
import { cn } from '@/lib/utils';

/**
 * One sidebar entry, and every path that counts as being inside it.
 *
 * **An entry can own more than one prefix.** `Record` is the Dashboard and also the
 * DCC calendar a leader records Sundays from, so being on `/dcc/...` is being on
 * Record. `Reports` owns both figures pages the same way.
 */
interface NavEntry {
  href: string;
  label: string;
  matches: readonly string[];
}

/**
 * The frame every signed-in screen sits in.
 *
 * **Five items, and the split is between recording and reading** (SKILL.md section
 * 19, ruling of 2026-09-14). What a person fills in is under `Record`; what they
 * read is under `Reports`. Each module keeps its own name; the label is what
 * reaches it.
 *
 * **The navigation carries links and never counts** (section 19). A figure in
 * navigation has to be computed on every page load and arrives stripped of the
 * scope and period that make it readable.
 *
 * **Which arrangement a person sees follows the reach of `reports.view_subtree`**,
 * not a role, because `/auth/me` returns grants and no role. The rule lives in
 * `lib/landing.ts` beside the landing path it also decides, so the first item and
 * the screen a person lands on cannot disagree.
 */
const RECORD: NavEntry = { href: RECORD_PATH, label: 'Record', matches: [RECORD_PATH, '/dcc'] };
const REPORTS: NavEntry = { href: REPORTS_PATH, label: 'Reports', matches: ['/reports'] };
const PEOPLE: NavEntry = { href: '/people', label: 'People', matches: ['/people'] };
const CELLS: NavEntry = { href: '/cells', label: 'Cells', matches: ['/cells'] };
const ACCOUNT: NavEntry = { href: '/session', label: 'Account and session', matches: ['/session'] };

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

  // **Network appears once the viewer's own identity is known, and not before.** It
  // is the only entry whose destination depends on who is looking, and a link to
  // `/people/undefined/network` exists in the same sense a dead one does.
  const network: NavEntry | null =
    me.data === undefined
      ? null
      : {
          href: `/people/${me.data.person_id}/network`,
          label: 'Network',
          matches: [`/people/${me.data.person_id}/network`],
        };

  const ordered = readsWholeChurch(me.data)
    ? [REPORTS, RECORD, network, PEOPLE, CELLS]
    : [RECORD, REPORTS, PEOPLE, CELLS, network];
  const links = ordered.filter((link): link is NavEntry => link !== null);

  // **One entry is current, and it is the one owning the longest matching prefix.**
  //
  // A prefix test alone marks two: Network is `/people/{id}/network`, which starts
  // with `/people/`, so People would claim the page as well — a second answer to
  // "where am I", announced to a screen reader as two current pages. A longer match
  // beats a shorter one, so `/people/{id}/network` resolves to Network and
  // `/people/{id}` still resolves to People.
  let currentHref: string | null = null;
  let longest = -1;

  for (const link of [...links, ACCOUNT]) {
    for (const prefix of link.matches) {
      const inside = pathname === prefix || pathname.startsWith(`${prefix}/`);

      if (inside && prefix.length > longest) {
        longest = prefix.length;
        currentHref = link.href;
      }
    }
  }

  function renderLink(link: NavEntry, placement: 'item' | 'footer' = 'item') {
    const active = link.href === currentHref;

    return (
      <Link
        key={link.href}
        href={link.href}
        // `aria-current` rather than colour alone: which page you are on is
        // information, and colour is never the only way this application conveys
        // information (1.4.1).
        aria-current={active ? 'page' : undefined}
        className={cn(
          'focus-visible:outline-accent inline-flex min-h-11 items-center px-3',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          // The sidebar is a column, so a link fills its width and the target grows
          // rather than staying a word-shaped strip (2.5.8).
          'lg:w-full',
          placement === 'item'
            ? cn(
                // **The design's navigation item: square, uppercase, tracked.** A
                // preview of the redesign's look ahead of UI-1, applied here alone.
                'rounded-none text-[13px] font-semibold tracking-[0.08em] uppercase',
                // **The current item is a filled block, which is a change of shape and
                // not of hue alone** (1.4.1), with the heavier weight as a second cue.
                // `surface` on `ink` is listed in `check-contrast.mjs` for both themes,
                // where it flips to a light block with dark text.
                active ? 'bg-ink text-surface font-bold' : 'text-ink hover:bg-raised',
              )
            : cn(
                'rounded-md text-xs underline underline-offset-4',
                active ? 'text-ink font-medium' : 'text-muted hover:text-ink',
              ),
        )}
      >
        {link.label}
      </Link>
    );
  }

  return (
    <RequireSession>
      {/*
        **One navigation, arranged two ways by the width of the window.** Below `lg`
        it is the bar across the top; at `lg` and above it stands beside the page as
        the sidebar section 19 describes. Width, never the device.
      */}
      <div className="min-h-dvh lg:flex">
        <header className="border-line border-b lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
          <div
            className={cn(
              'mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-5 py-2',
              'lg:sticky lg:top-0 lg:mx-0 lg:h-dvh lg:max-w-none lg:flex-col lg:flex-nowrap',
              'lg:items-stretch lg:overflow-y-auto lg:py-6',
            )}
          >
            <nav
              aria-label="Main"
              className="flex flex-wrap items-center gap-1 lg:flex-col lg:items-stretch lg:gap-0.5"
            >
              {links.map((link) => renderLink(link))}
            </nav>

            {/*
              **The account is not a navigation item** (ruling of 2026-09-14). It sits
              under the person's name at the foot of the sidebar, and at the end of the
              bar below `lg`, where there is no foot to put it in.
            */}
            <div className="flex items-center gap-1 lg:border-line lg:mt-auto lg:flex-col lg:items-stretch lg:border-t lg:pt-4">
              {me.data?.first_name ? (
                <p className="text-ink hidden px-3 text-sm lg:block">{me.data.first_name}</p>
              ) : null}
              {renderLink(ACCOUNT, 'footer')}
            </div>
          </div>
        </header>

        {/*
          `min-w-0` so a wide table inside a page scrolls within its own container
          rather than stretching this column and pushing the sidebar off screen.
        */}
        <div className="lg:min-w-0 lg:flex-1">{children}</div>
      </div>
    </RequireSession>
  );
}
