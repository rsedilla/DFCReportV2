'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ChartColumn,
  Church,
  CircleUserRound,
  ClipboardCheck,
  LayoutGrid,
  type LucideIcon,
  ShieldCheck,
  Sprout,
  Trophy,
  Users,
} from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { isBranchReader } from '@/components/reports-tabs';
import { IdleGuard } from '@/components/idle-guard';
import { RequireSession } from '@/components/require-session';
import { SessionHaltBanner } from '@/components/session-halt-banner';
import { buttonClasses } from '@/components/ui/button';
import { APPLICATION_FULL_NAME, APPLICATION_NAME, LOGO_PATH } from '@/lib/brand';
import { RECORD_PATH, REPORTS_PATH, landingPath } from '@/lib/landing';
import { getMe, holdsNetwork, holdsWholeChurch, holdsWide } from '@/lib/me';
import {
  noReportSection,
  reportSection,
  subscribeReportSection,
  type ReportSection,
} from '@/lib/report-section';
import { pageIsOffered } from '@/lib/screen-guard';
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

const RECORD: NavEntry = {
  href: RECORD_PATH,
  label: 'Record',
  icon: ClipboardCheck,
  matches: [RECORD_PATH, '/dcc'],
};
const REPORTS: NavEntry = {
  href: REPORTS_PATH,
  label: 'Reports',
  icon: ChartColumn,
  // The twelve months are a view of Reports (decisions 0377 and 0380), at `/trends`.
  matches: ['/reports', '/trends'],
};
/** People, Network and Family Tree, one item with a tab each (decisions 0288 and 0341). */
const PEOPLE: NavEntry = {
  href: '/people',
  label: 'People',
  icon: Users,
  matches: ['/people', '/network', '/family-tree'],
};
const CELLS: NavEntry = { href: '/cells', label: 'Cells', icon: LayoutGrid, matches: ['/cells'] };
/** SUYNL and Training, one item with a tab each (SKILL.md sections 19 and 28). */
const GROWTH: NavEntry = {
  href: '/growth/suynl',
  label: 'Growth',
  icon: Sprout,
  matches: ['/growth'],
};
/**
 * Conquest, an item of its own for holders of `conquest.view_subtree` at Whole Church, by
 * default the Admin and the two Senior Pastors (decision 0407), after Growth, which keeps SUYNL
 * and Training.
 */
const CONQUEST: NavEntry = {
  href: '/conquest',
  label: 'Conquest',
  icon: Trophy,
  matches: ['/conquest'],
};
/**
 * A Recording-only account's own Cells (decision 0323): its members, this month's meetings
 * and asking for a new Cell. A Cell's own pages are under `/cells/`, so they are this item's
 * on the recording screens, where there is no other Cells item. Labelled `Cells`, and since
 * decision 0457 the page is titled *Cells* too, with *My Cell* its first tab.
 */
const MY_CELL: NavEntry = {
  href: '/my-cell',
  label: 'Cells',
  icon: LayoutGrid,
  matches: ['/my-cell', '/cells'],
};
/**
 * The Growth SUYNL tab as an item of its own on the recording screens (decision 0323), and
 * for a Full view leader, whose Growth holds SUYNL alone (decision 0383).
 */
const SUYNL: NavEntry = {
  href: '/growth/suynl',
  label: 'SUYNL',
  icon: Sprout,
  matches: ['/growth'],
};
/**
 * **The Senior Pastors' four items** (decision 0488, owner, 2026-11-14): *People*, *Cells*,
 * *Services* and *Conquest*, the reports they read split by what each counts. Record and
 * Reports are not theirs: the Admin keeps the records for both Networks, and they read. Each
 * item owns the addresses of the reports it holds; on the twelve months, `/trends`, the page
 * says which item it is under (`lib/report-section.ts`).
 */
const SENIOR_PASTOR_ITEMS: Record<ReportSection, NavEntry> = {
  people: {
    href: '/reports/number-of-people',
    label: 'People',
    icon: Users,
    matches: ['/reports/number-of-people'],
  },
  cells: {
    href: '/reports/cells',
    label: 'Cells',
    icon: LayoutGrid,
    // A Cell's meetings and members, which lead back here, are under it too.
    matches: [
      '/reports/cells',
      '/reports/number-of-cells',
      '/reports/number-of-cell-leaders',
      '/cells',
    ],
  },
  services: { href: '/reports/dcc', label: 'Services', icon: Church, matches: ['/reports/dcc'] },
};
/** The Admin area (decision 0419): set apart from the items above, never one of them. */
const ADMIN: NavEntry = { href: '/admin', label: 'Admin', icon: ShieldCheck, matches: ['/admin'] };
const ACCOUNT: NavEntry = {
  href: '/session',
  // Short, and the page's own title (decision 0445, replacing *Account and session*).
  label: 'My Account',
  icon: CircleUserRound,
  matches: ['/session'],
};

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
 * Four values for a page of content.
 *
 * - `READING` (`max-w-7xl`, 1280px) for anything filled in: a form, a recording screen,
 *   the session description. It was 768px until decision 0410, which gave a form the
 *   width a list has and arranged it in sections instead (`components/form-section.tsx`),
 *   so the width buys a second column rather than longer inputs.
 * - `NARROW` (`max-w-3xl`, 768px) for a page read top to bottom that holds no list and
 *   no form of many fields: Account, and the chain on Where they sit.
 * - `RECORD` (`max-w-5xl`, 1024px) for one person's page, which is read rather
 *   than filled in and carries short tables of its own.
 * - `INDEX` (`max-w-7xl`, 1280px) for a list or a table, where the extra width
 *   buys columns rather than longer lines (decision 0402). It was 1024px until then,
 *   which left a third of a 1536px laptop empty beside every list.
 *
 * **`READING` is not a reading measure.** Prose is kept short by the
 * `max-w-xl`/`max-w-2xl` on the paragraphs themselves, which is where a measure
 * belongs — a page width also has to hold a form and a definition list.
 *
 * **The unauthenticated screens are a third width and are not counted here.**
 * `auth-card.tsx` and the landing screen are centred cards on an empty page
 * rather than pages of content. `require-session.tsx` deliberately uses the
 * wider of the two above rather than a card width: it renders first on every
 * screen behind it, so a narrow box there means each of them opens at one width
 * and jumps to another.
 */
export const PAGE_WIDTH = {
  READING: 'mx-auto max-w-7xl px-5 py-8 sm:py-12 lg:mx-0 lg:px-10',
  NARROW: 'mx-auto max-w-3xl px-5 py-8 sm:py-12 lg:mx-0 lg:px-10',
  RECORD: 'mx-auto max-w-5xl px-5 py-8 sm:py-12 lg:mx-0 lg:px-10',
  INDEX: 'mx-auto max-w-7xl px-5 py-8 sm:py-12 lg:mx-0 lg:px-10',
} as const;

/**
 * The frame every signed-in screen sits in.
 *
 * **Up to six items, and the split is between recording and reading** (SKILL.md section
 * 19, ruling of 2026-09-14; Network became a tab of People by decision 0288). What a person fills in is under `Record`; what they
 * read is under `Reports`. Each module keeps its own name; the label is what
 * reaches it.
 *
 * **The navigation carries links and never counts** (section 19). A figure in
 * navigation has to be computed on every page load and arrives stripped of the
 * scope and period that make it readable.
 *
 * **A Recording-only account has four items** (decisions 0323 and 0371): `Record · People ·
 * Cells · SUYNL`, its `Cells` opening its own Cells on the page titled *My Cell*. **The two Senior Pastors have three**, `Record · Reports · Conquest` (decisions 0326, 0377 and 0407), their twelve months being a view of Reports.
 * A Full view leader has five, the fifth reading `SUYNL` (decision 0383), and the Admin six, `Conquest` the sixth (decision 0407). Where a person lands is decided in
 * `lib/landing.ts` (decisions 0372 and 0419).
 *
 * **Two arrangements by width, one navigation** (UI-2, owner's choices of
 * 2026-09-15). Below `lg` (1024px) — phones and tablets — the items are a tab bar
 * fixed to the bottom of the screen, within a thumb's reach, under a slim bar that
 * carries the application's name and holds the account button (decision 0439). At `lg` and above they stand in
 * the sidebar. It is one `<nav>` restyled rather than two, so there is exactly one
 * landmark named Main at every width and nothing to keep in step.
 */
/**
 * Five grey places, shaped as the items are at each width: an icon over a word on a phone's tab
 * bar, an icon before a word in the sidebar. Five is the most common set. Hidden from a screen
 * reader, which is told nothing until the real items arrive.
 */
function NavPlaceholders() {
  return Array.from({ length: 5 }, (_, index) => (
    <span
      key={index}
      aria-hidden="true"
      data-nav-placeholder=""
      className="flex min-h-14 min-w-0 flex-auto flex-col items-center justify-center gap-1.5 lg:min-h-11 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:px-3"
    >
      <span className="bg-tabbar-edge lg:bg-sidebar-ink/25 h-6 w-7 rounded-md lg:size-5" />
      <span className="bg-tabbar-edge lg:bg-sidebar-ink/25 h-2.5 w-11 rounded-full lg:w-24" />
    </span>
  ));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // **Shares the cache with every screen that already asks.** The key is the one
  // `getMe` is queried under elsewhere, so this adds a cache read rather than a
  // request per page.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // **Which items, by the screens the server names** (decision 0323, replacing decision
  // 0277's one order for every account). **None until `/auth/me` answers**: showing one
  // account's set as a placeholder flashed five items on a reload before a Recording-only
  // leader's four replaced them (owner, 2026-10-11). An unanswered request still shows
  // today's items rather than none.
  //
  // **`Conquest` follows its capability rather than the screens** (decision 0407, by owner
  // ruling): it is the last item of any account holding `conquest.view_subtree` at Whole Church,
  // which today is the Admin and the two Senior Pastors.
  const conquest =
    me.data !== undefined &&
    (holdsWholeChurch(me.data, 'conquest.view_subtree') ||
      holdsNetwork(me.data, 'conquest.view_subtree') !== null)
      ? [CONQUEST]
      : [];
  // **The Admin area follows `accounts.manage` at Whole Church** (decision 0419), by default the
  // Admin alone, or across one Network, a Network Admin's (decision 0469). Its Accounts reads
  // carry that capability; its other reads keep their own guards.
  const administers = me.data !== undefined && holdsWide(me.data, 'accounts.manage');
  const links = me.isPending
    ? []
    : [
        ...(me.data?.screens === 'RECORDING'
          ? [RECORD, PEOPLE, MY_CELL, SUYNL]
          : me.data?.screens === 'SENIOR_PASTOR'
            ? [SENIOR_PASTOR_ITEMS.people, SENIOR_PASTOR_ITEMS.cells, SENIOR_PASTOR_ITEMS.services]
            : isBranchReader(me.data)
              ? [RECORD, REPORTS, PEOPLE, CELLS, SUYNL]
              : [RECORD, REPORTS, PEOPLE, CELLS, GROWTH]),
        ...conquest,
      ];

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
  // **A page not on this account's screens does not open** (decision 0379): a typed address or
  // an old link meets a note naming the account's screens and the way to its start screen.
  // Until the server names the screens the page shows, and the API decides as always: a halted
  // session never gets that answer, and a blank screen there would hide the way to sign in again.
  const offered = me.data === undefined || pageIsOffered(me.data, pathname);

  let current: NavEntry | null = null;
  let longest = -1;
  // The twelve months name their figure in the query; the page says which item holds it.
  const trendSection = useSyncExternalStore(
    subscribeReportSection,
    reportSection,
    noReportSection,
  );

  if (offered && me.data?.screens === 'SENIOR_PASTOR' && pathname === '/trends' && trendSection) {
    current = SENIOR_PASTOR_ITEMS[trendSection];
    longest = Number.MAX_SAFE_INTEGER;
  }

  // On the note no item is current: the page is none of them.
  for (const link of offered ? [...links, ACCOUNT, ...(administers ? [ADMIN] : [])] : []) {
    for (const match of link.matches) {
      const length = matchedLength(pathname, match);

      if (length > longest) {
        longest = length;
        current = link;
      }
    }
  }

  // **The browser tab names the page** (decision 0484, WCAG 2.4.2): the current sidebar item,
  // then the application's name, so a screen reader is told where a click went.
  const pageTitle = current === null ? APPLICATION_NAME : `${current.label} – ${APPLICATION_NAME}`;

  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

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
          // On the light tab bar, the current item's dark green; on the emerald sidebar, white,
          // as the current item is there: the accent all but vanishes on emerald.
          'focus-visible:outline-tabbar-current-ink lg:focus-visible:outline-sidebar-current-ink',
          'focus-visible:outline-2 focus-visible:-outline-offset-2',
          'lg:focus-visible:outline-offset-2',
          // **A tab below `lg`**: an equal share of the bar, the icon over the word,
          // and 56px tall against the 44px minimum a phone held standing up needs
          // (2.5.8). `min-w-0` so the tabs share 320px without pushing past it.
          // `flex-auto`: each tab starts from its own label's width and shares what is left,
          // so a long label (Reports) is not squeezed to the width of a short one (Cells).
          // 2px each side, so the Admin's six words fit 320px whole wherever the font renders a
          // pixel wider (the Linux browser the build runs did, at 12px).
          'flex min-h-14 min-w-0 flex-auto flex-col items-center justify-center gap-1 px-0.5',
          // Sentence case at 12px (owner, 2026-11-04, decision 0439; 11px from 2026-09-24): the
          // Admin's six labels still fit 320px, which accessibility.spec.ts checks whole. Grey,
          // and the current one extra bold.
          'text-xs leading-none font-semibold',
          // **An item at `lg`**: a full-width row of the sidebar, its icon before its words
          // (owner, 2026-11-05, decision 0444).
          'lg:min-h-11 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:px-3',
          // Its words as written, on a rounded row (decision 0423).
          'lg:rounded-lg lg:text-[0.9375rem] lg:font-semibold',
          // **In the sidebar the current item is white on a darker emerald, with a white bar
          // down the left of its row, and the others mint on emerald** (owner, 2026-10-19,
          // replacing red on pale red). The bar is a change of shape and not of hue alone
          // (1.4.1), and each pair is listed in `check-contrast.mjs`.
          // **On a phone (decision 0439)** the current tab is an extra bold dark green word with
          // its icon on a pale green pill, the others grey. Its weight is what tells it apart
          // without colour (1.4.1), with `aria-current`; the pill is too pale against the bar to
          // count as a shape on its own. The sidebar keeps the emerald rows above.
          active
            ? 'text-tabbar-current-ink font-extrabold lg:bg-sidebar-current lg:text-sidebar-current-ink lg:font-semibold lg:shadow-[inset_3px_0_0_var(--sidebar-current-ink)]'
            : 'text-tabbar-ink lg:text-sidebar-ink lg:hover:bg-sidebar-current',
        )}
      >
        {/* 24px, the size both phone platforms give a tab icon, and the current one on its pill
            (owner, 2026-11-04). In the sidebar the same icon, 20px and in the words' colour, with
            no pill: the current row is marked by its darker emerald and its bar (decision 0444). */}
        <span
          aria-hidden="true"
          className={cn(
            'flex h-8 w-full max-w-16 shrink-0 items-center justify-center rounded-full',
            'lg:size-5 lg:max-w-none lg:rounded-none',
            active && 'bg-tabbar-pill lg:bg-transparent',
          )}
        >
          <Icon strokeWidth={1.5} className="size-6 lg:size-5" />
        </span>
        <span data-tab-label className="max-w-full truncate">
          {link.label}
        </span>
      </Link>
    );
  }

  const accountActive = current?.href === ACCOUNT.href;
  const adminActive = current?.href === ADMIN.href;

  const names = links.map((link) => link.label);
  const screensLine =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      : names.join('');

  return (
    <RequireSession>
      {/* A browser session signs out after thirty minutes idle (decision 0435). */}
      <IdleGuard />
      <div className="bg-raised min-h-dvh lg:flex">
        {/*
          **The bar across the top below `lg`.** It carries the application's name and the
          DfC globe, and holds the account, which is not a navigation item (ruling of
          2026-09-14). It named the section until decision 0439, when the owner saw "People"
          twice on one screen: the page's own `h1` says where you are and the tab bar's
          pill which section, as the installed apps leaders know show their name here. The
          name is a paragraph rather than a heading, so it is not announced as the page's
          title.
        */}
        <header className="bg-sidebar border-sidebar text-sidebar-current-ink sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b pr-1.5 pl-5 lg:hidden">
          <p className="flex min-w-0 items-center gap-2 text-base font-bold tracking-tight">
            {/* Decorative: the name beside it says the same, so it is announced once. */}
            <Image
              src={LOGO_PATH}
              alt=""
              width={28}
              height={28}
              unoptimized
              priority
              className="size-7 shrink-0 rounded-md"
            />
            <span className="truncate">{APPLICATION_NAME}</span>
          </p>
          {/* **On a phone the Admin area is a button here, beside the account** (decision 0419),
              not a seventh button of the bar along the bottom. */}
          {administers ? (
            <Link
              href={ADMIN.href}
              aria-current={adminActive ? 'page' : undefined}
              className={cn(
                'focus-visible:outline-sidebar-current-ink ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-sm font-bold',
                'focus-visible:outline-2 focus-visible:-outline-offset-2',
                adminActive
                  ? 'bg-sidebar-current shadow-[inset_0_-3px_0_var(--sidebar-current-ink)]'
                  : 'hover:bg-sidebar-current',
              )}
            >
              <ShieldCheck aria-hidden="true" strokeWidth={1.5} className="size-6" />
              {ADMIN.label}
            </Link>
          ) : null}
          <Link
            href={ACCOUNT.href}
            aria-current={accountActive ? 'page' : undefined}
            className={cn(
              'focus-visible:outline-sidebar-current-ink inline-flex size-11 shrink-0 items-center justify-center',
              'focus-visible:outline-2 focus-visible:-outline-offset-2',
              accountActive
                ? 'bg-sidebar-current text-sidebar-current-ink shadow-[inset_0_-3px_0_var(--sidebar-current-ink)]'
                : 'text-sidebar-current-ink hover:bg-sidebar-current',
            )}
          >
            <CircleUserRound aria-hidden="true" strokeWidth={1.5} className="size-6" />
            <span className="sr-only">{ACCOUNT.label}</span>
          </Link>
        </header>

        <div className="lg:bg-sidebar lg:w-60 lg:shrink-0">
          <div className="lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto lg:px-3 lg:py-6">
            {/* The DfC globe beside the name (owner's choice of 2026-10-19). The image is
                decorative: the name beside it says the same, so it is announced once. */}
            <p className="text-sidebar-current-ink hidden items-center gap-3 px-3 pb-6 lg:flex">
              <Image
                src={LOGO_PATH}
                alt=""
                width={48}
                height={48}
                unoptimized
                priority
                className="size-12 shrink-0 rounded-xl"
              />
              <span>
                <span className="block text-xl leading-tight font-bold tracking-wide">
                  {APPLICATION_NAME}
                </span>
                <span className="mt-0.5 block text-[0.6875rem] leading-snug font-medium">
                  {APPLICATION_FULL_NAME}
                </span>
              </span>
            </p>

            <nav
              aria-label="Main"
              className={cn(
                // A light bar under the emerald top bar (design E, owner, 2026-11-04); the
                // sidebar it becomes at `lg` sits on the emerald column.
                'bg-tabbar border-tabbar-edge fixed inset-x-0 bottom-0 z-30 flex border-t',
                // The phone's home indicator sits over the bottom few pixels; the
                // inset is zero wherever there is none, and is reported at all only
                // because the viewport is `cover` (app/layout.tsx). Turned sideways, the
                // phone's corners and camera take the sides too.
                'pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
                'lg:static lg:flex-col lg:gap-0.5 lg:border-t-0 lg:bg-transparent lg:pb-0',
              )}
            >
              {/* Grey places for the items while `/auth/me` has not answered (owner, 2026-11-06), so
                  the bar or the sidebar does not stand empty and then fill. Which items an account
                  has still waits for the answer (owner, 2026-10-11). */}
              {me.isPending ? <NavPlaceholders /> : links.map((link) => renderItem(link))}
            </nav>

            {/*
              **The account is not a navigation item** (ruling of 2026-09-14). At `lg`
              it sits under the person's name at the foot of the sidebar; below `lg` it
              is the button in the bar across the top, and this block is not rendered.
            */}
            {/* **On a laptop the Admin area is the last item, below a rule** (decision 0419), apart
                from the daily items above it. Its own landmark, so Main still lists those alone. */}
            {administers ? (
              <div className="lg:border-sidebar-ink/40 hidden lg:mt-auto lg:flex lg:flex-col lg:border-t lg:pt-4 lg:pb-4">
                <p className="text-sidebar-ink px-3 pb-1 text-[0.6875rem] font-medium">
                  For the administrator
                </p>
                <nav aria-label="Administration" className="flex flex-col">
                  {renderItem(ADMIN)}
                </nav>
              </div>
            ) : null}
            <div
              className={cn(
                'lg:border-sidebar-ink/40 hidden lg:flex lg:flex-col lg:border-t lg:pt-4',
                administers ? null : 'lg:mt-auto',
              )}
            >
              {/* **One row, the whole of it the link** (decision 0445): the person's first
                  initial in a white circle, their name, and *My Account* under it, marked as the
                  current page as a sidebar item is. */}
              <Link
                href={ACCOUNT.href}
                aria-current={accountActive ? 'page' : undefined}
                className={cn(
                  'focus-visible:outline-sidebar-current-ink flex min-h-13 items-center gap-3 rounded-lg px-3 py-1.5',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                  accountActive
                    ? 'bg-sidebar-current text-sidebar-current-ink shadow-[inset_3px_0_0_var(--sidebar-current-ink)]'
                    : 'text-sidebar-ink hover:bg-sidebar-current',
                )}
              >
                <span
                  aria-hidden="true"
                  className="bg-sidebar-current-ink text-sidebar flex size-9 shrink-0 items-center justify-center rounded-full text-[0.9375rem] font-bold"
                >
                  {(me.data?.first_name ?? '').trim().charAt(0).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  {me.data?.first_name ? (
                    <span className="text-sidebar-current-ink truncate text-[0.9375rem] font-semibold">
                      {me.data.first_name}
                    </span>
                  ) : null}
                  <span className="text-[0.8125rem]">{ACCOUNT.label}</span>
                </span>
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
          {/* The Account page says the same beside its own button, so it is not repeated there. */}
          {accountActive ? null : <SessionHaltBanner />}
          {offered ? (
            children
          ) : (
            <main id="main" className={PAGE_WIDTH.READING}>
              <h1 className="text-2xl font-semibold tracking-tight">
                This page isn&rsquo;t part of your screens
              </h1>
              <p className="text-muted mt-3 max-w-xl text-sm leading-relaxed">
                Your screens are {screensLine}.
              </p>
              <p className="mt-6">
                <Link href={landingPath(me.data)} className={buttonClasses('primary')}>
                  Go to your start screen
                </Link>
              </p>
            </main>
          )}
        </div>
      </div>
    </RequireSession>
  );
}
