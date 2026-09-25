'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ChartColumn,
  CircleUserRound,
  ClipboardCheck,
  LayoutGrid,
  type LucideIcon,
  Sprout,
  Users,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { RequireSession } from '@/components/require-session';
import { RECORD_PATH, REPORTS_PATH } from '@/lib/landing';
import { getMe } from '@/lib/me';
import { cn } from '@/lib/utils';

/**
 * One sidebar entry, and every path that counts as being inside it.
 *
 * **An entry can own more than one prefix.** `Record` is the Dashboard and also
 * `/dcc`, the reader's month of records owed, so being on `/dcc/...` is being on
 * Record. `Reports` owns the six report tabs (decision 0292) the same way.
 */
interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  matches: readonly (string | RegExp)[];
}

/**
 * How much of `pathname` one of an entry's matches covers, or -1 where it does not match.
 *
 * A string is a prefix that owns itself and everything beneath it. A pattern is for a
 * screen whose address sits under another entry's prefix but belongs to this one — so
 * it counts the length it matched, which is longer than the prefix it has to beat.
 */
function matchedLength(pathname: string, match: string | RegExp): number {
  if (typeof match === 'string') {
    return pathname === match || pathname.startsWith(`${match}/`) ? match.length : -1;
  }

  return match.exec(pathname)?.[0].length ?? -1;
}

/**
 * **A Cell's meeting screens are recording, so they are Record's** (ruling of
 * 2026-09-14), although their address begins with `/cells/`. The pattern matches a
 * Cell's list of meetings and every meeting beneath it, and nothing else under a Cell.
 */
const CELL_MEETINGS = /^\/cells\/[^/]+\/meetings(?=\/|$)/;

const RECORD: NavEntry = {
  href: RECORD_PATH,
  label: 'Record',
  icon: ClipboardCheck,
  matches: [RECORD_PATH, '/dcc', CELL_MEETINGS],
};
const REPORTS: NavEntry = {
  href: REPORTS_PATH,
  label: 'Reports',
  icon: ChartColumn,
  matches: ['/reports'],
};
/** People and Network, one item with a tab each (decision 0288). */
const PEOPLE: NavEntry = {
  href: '/people',
  label: 'People',
  icon: Users,
  matches: ['/people', '/network'],
};
const CELLS: NavEntry = { href: '/cells', label: 'Cells', icon: LayoutGrid, matches: ['/cells'] };
/** SUYNL and Training, one item with a tab each (SKILL.md sections 19 and 28). */
const GROWTH: NavEntry = {
  href: '/growth/suynl',
  label: 'Growth',
  icon: Sprout,
  matches: ['/growth'],
};
const ACCOUNT: NavEntry = {
  href: '/session',
  label: 'Account and session',
  icon: CircleUserRound,
  matches: ['/session'],
};

/** The application's name, at the top of the sidebar (owner's choice, 2026-09-15). */
const APPLICATION_NAME = 'G12 Church Management';

/**
 * How wide a screen's content is allowed to get, and why there are two.
 *
 * **A laptop is wider than anything worth reading across.** Left unconstrained, a
 * form field on a 1920px display becomes a 1900px input and a paragraph runs to
 * 200 characters a line, which is harder to read than the same thing on a phone.
 * So content stops widening. Below `lg` the page centres it; from `lg` it starts 40px
 * from the sidebar and the spare width falls to the right, as the owner's design draws
 * it (owner's choice, 2026-09-22), rather than opening a gap that grows with the screen.
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
  READING: 'mx-auto max-w-3xl px-5 py-8 sm:py-12 lg:mx-0 lg:px-10',
  INDEX: 'mx-auto max-w-5xl px-5 py-8 sm:py-12 lg:mx-0 lg:px-10',
} as const;

/**
 * The frame every signed-in screen sits in.
 *
 * **Five items, and the split is between recording and reading** (SKILL.md section
 * 19, ruling of 2026-09-14; Network became a tab of People by decision 0288). What a person fills in is under `Record`; what they
 * read is under `Reports`. Each module keeps its own name; the label is what
 * reaches it.
 *
 * **The navigation carries links and never counts** (section 19). A figure in
 * navigation has to be computed on every page load and arrives stripped of the
 * scope and period that make it readable.
 *
 * **One order for every account** (decision 0277). Where a person lands still follows
 * the reach of `reports.view_subtree`, and that rule lives in `lib/landing.ts`.
 *
 * **Two arrangements by width, one navigation** (UI-2, owner's choices of
 * 2026-09-15). Below `lg` (1024px) — phones and tablets — the items are a tab bar
 * fixed to the bottom of the screen, within a thumb's reach, under a slim bar that
 * names the section and holds the account button. At `lg` and above they stand in
 * the sidebar. It is one `<nav>` restyled rather than two, so there is exactly one
 * landmark named Main at every width and nothing to keep in step.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // **Shares the cache with every screen that already asks.** The key is the one
  // `getMe` is queried under elsewhere, so this adds a cache read rather than a
  // request per page.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  const links = [RECORD, REPORTS, PEOPLE, CELLS, GROWTH];

  // **One entry is current, and it is the one whose match covers most of the address.**
  //
  // A prefix test alone marks two: a Cell's meeting screens are Record's, and their
  // address begins with `/cells/`, so Cells would claim the page as well — a second
  // answer to "where am I", announced to a screen reader as two current pages. A longer
  // match beats a shorter one, so `/cells/{id}/meetings` resolves to Record and
  // `/cells/{id}` still resolves to Cells.
  //
  // *This cited Network as the collision until 2026-09-17, when that item moved from
  // `/people/{id}/network` to `/network` and stopped colliding with anything. The
  // mechanism is still load-bearing for the pair above; only the example had gone
  // stale. One consequence is deliberate and is worth saying rather than discovering:
  // `/people/{id}/network`, the path page for one person, now resolves to People rather
  // than to Network. It is defended on which entry owns the address, and deliberately not
  // on where the viewer came from — that reason was written here and is false, because
  // the page is reached from three places and one of them is the dashboard, which is
  // Record.*
  let current: NavEntry | null = null;
  let longest = -1;

  for (const link of [...links, ACCOUNT]) {
    for (const match of link.matches) {
      const length = matchedLength(pathname, match);

      if (length > longest) {
        longest = length;
        current = link;
      }
    }
  }

  function renderItem(link: NavEntry) {
    const active = link.href === current?.href;
    const Icon = link.icon;

    return (
      <Link
        key={link.href}
        href={link.href}
        // `aria-current` rather than colour alone: which page you are on is
        // information, and colour is never the only way this application conveys
        // information (1.4.1).
        aria-current={active ? 'page' : undefined}
        className={cn(
          'focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2',
          'lg:focus-visible:outline-offset-2',
          // **A tab below `lg`**: an equal share of the bar, the icon over the word,
          // and 56px tall against the 44px minimum a phone held standing up needs
          // (2.5.8). `min-w-0` so the tabs share 320px without pushing past it.
          // `flex-auto`: each tab starts from its own label's width and shares what is left,
          // so a long label (Reports) is not squeezed to the width of a short one (Cells).
          'flex min-h-14 min-w-0 flex-auto flex-col items-center justify-center gap-1 px-1',
          // Sentence case at 11px (owner's choice, 2026-09-24): capitals at 10px cut four
          // labels off when there were six.
          'text-[0.6875rem] leading-none font-bold',
          // **An item at `lg`**: a full-width row of the sidebar, the icon dropped.
          'lg:min-h-11 lg:flex-none lg:flex-row lg:justify-start lg:px-3',
          'lg:text-[0.8125rem] lg:tracking-[0.08em] lg:uppercase',
          // **The current item is red on a pale red, with a bar** (owner's choice,
          // 2026-09-22): along the top of a tab, down the left of a sidebar row. The bar
          // is a change of shape and not of hue alone (1.4.1), and `accent` on
          // `accent-tint` is listed in `check-contrast.mjs` for both themes.
          active
            ? 'bg-accent-tint text-accent shadow-[inset_0_3px_0_var(--accent)] lg:shadow-[inset_3px_0_0_var(--accent)]'
            : 'text-ink hover:bg-raised',
        )}
      >
        <Icon aria-hidden="true" strokeWidth={1.5} className="size-5 shrink-0 lg:hidden" />
        <span className="max-w-full truncate">{link.label}</span>
      </Link>
    );
  }

  const accountActive = current?.href === ACCOUNT.href;

  return (
    <RequireSession>
      <div className="min-h-dvh lg:flex">
        {/*
          **The bar across the top below `lg`.** It names where you are and holds the
          account, which is not a navigation item (ruling of 2026-09-14). The section
          name is a paragraph rather than a heading: every screen carries its own
          `h1`, and a second heading above it would be announced as the page's title.
        */}
        <header className="bg-surface border-line sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b pr-1.5 pl-5 lg:hidden">
          <p className="truncate text-base font-bold tracking-tight">
            {current?.label ?? APPLICATION_NAME}
          </p>
          <Link
            href={ACCOUNT.href}
            aria-current={accountActive ? 'page' : undefined}
            className={cn(
              'focus-visible:outline-accent inline-flex size-11 shrink-0 items-center justify-center',
              'focus-visible:outline-2 focus-visible:-outline-offset-2',
              accountActive
                ? 'bg-accent-tint text-accent shadow-[inset_0_-3px_0_var(--accent)]'
                : 'text-ink hover:bg-raised',
            )}
          >
            <CircleUserRound aria-hidden="true" strokeWidth={1.5} className="size-6" />
            <span className="sr-only">{ACCOUNT.label}</span>
          </Link>
        </header>

        <div className="lg:border-line lg:w-60 lg:shrink-0 lg:border-r">
          <div className="lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto lg:px-3 lg:py-6">
            <p className="hidden px-3 pb-6 text-lg leading-tight font-bold tracking-tight lg:block">
              {APPLICATION_NAME}
            </p>

            <nav
              aria-label="Main"
              className={cn(
                'bg-surface border-edge fixed inset-x-0 bottom-0 z-30 flex border-t',
                // The phone's home indicator sits over the bottom few pixels; the
                // inset is zero wherever there is none.
                'pb-[env(safe-area-inset-bottom)]',
                'lg:static lg:flex-col lg:gap-0.5 lg:border-t-0 lg:bg-transparent lg:pb-0',
              )}
            >
              {links.map((link) => renderItem(link))}
            </nav>

            {/*
              **The account is not a navigation item** (ruling of 2026-09-14). At `lg`
              it sits under the person's name at the foot of the sidebar; below `lg` it
              is the button in the bar across the top, and this block is not rendered.
            */}
            <div className="lg:border-line hidden lg:mt-auto lg:flex lg:flex-col lg:border-t lg:pt-4">
              {me.data?.first_name ? (
                <p className="text-ink px-3 text-sm">{me.data.first_name}</p>
              ) : null}
              <Link
                href={ACCOUNT.href}
                aria-current={accountActive ? 'page' : undefined}
                className={cn(
                  'focus-visible:outline-accent inline-flex min-h-11 items-center px-3 text-xs',
                  'underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2',
                  accountActive ? 'text-ink font-medium' : 'text-muted hover:text-ink',
                )}
              >
                {ACCOUNT.label}
              </Link>
            </div>
          </div>
        </div>

        {/*
          `min-w-0` so a wide table inside a page scrolls within its own container
          rather than stretching this column and pushing the sidebar off screen.

          **Below `lg` the page stops short of the tab bar**, by the bar's height and
          the home-indicator inset, so the last thing on a page can be scrolled clear
          of it rather than sitting underneath (2.4.11).
        */}
        <div className="min-w-0 pb-[calc(3.5625rem+env(safe-area-inset-bottom))] lg:flex-1 lg:pb-0">
          {children}
        </div>
      </div>
    </RequireSession>
  );
}
