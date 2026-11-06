import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';

import './globals.css';

/**
 * One typeface, Archivo, for headings and body alike, self-hosted by `next/font`
 * at build time.
 *
 * `next/font` downloads the files and serves them from this origin, so no
 * request leaves for a font host at run time and there is no layout shift while
 * one arrives. The fallback stack in `globals.css` is what renders if the face
 * never loads, which is the case on a leader's phone on a poor connection.
 */
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-archivo',
});

/**
 * DREAMS, Doulos Reporting, Equipping, And Monitoring System (owner's choice of 2026-10-19;
 * Equipping for Evaluation, 2026-10-30).
 * The tab and home-screen icons are `app/icon.png` and `app/apple-icon.png`, the DfC globe.
 */
export const metadata: Metadata = {
  title: 'DREAMS',
  applicationName: 'DREAMS',
  description: 'Doulos Reporting, Equipping, And Monitoring System.',
};

/**
 * Responsive from the beginning. Leaders open this on their phones, installed to the home screen
 * rather than from an app store (decision 0424), so mobile web is the surface rather than
 * preparation for another (SKILL.md section 23).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // **The page runs to the screen's edges, and its bars keep clear of what the phone draws there**
  // (decision 0439).
  // Without `cover`, iOS reports every safe-area inset as zero, so in the installed app the
  // home indicator sat over the tab bar's labels while `env(safe-area-inset-bottom)` asked for
  // room it was never given (owner, 2026-11-04). The bottom inset is taken by the tab bar, the
  // page's bottom padding, the Save bars and a dialog; the side insets, which a phone turned
  // sideways has, by the body, the tab bar and a dialog. Zoom is left on (WCAG 1.4.4), unlike the many
  // apps that pair `cover` with turning it off.
  viewportFit: 'cover',
  // **The phone's browser bar is the header's emerald** (owner, 2026-11-06), before the site is
  // installed as well as after; the manifest's `theme_color` reaches only the installed app.
  // One colour, because the top bar is emerald in both themes.
  themeColor: '#006b35',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // **Scroll padding for what is pinned** (2.4.11 Focus Not Obscured). When focus
    // moves to a control, the browser scrolls it into view clear of anything fixed
    // over the page rather than underneath it. Below `lg` that is the bar across the
    // top, and along the bottom the tab bar with a recording screen's Save bar
    // stacked above it. At `lg` the sidebar sits beside the page, so only the Save
    // bar remains, at the bottom. These are sized for the Save bar as it usually is;
    // `usePinnedBarPadding` (`lib/pinned-bar.ts`) raises the bottom while a bar is taller.
    <html
      lang="en"
      className={`${archivo.variable} scroll-pt-16 scroll-pb-40 lg:scroll-pt-0 lg:scroll-pb-28`}
    >
      <body>
        {/*
          A skip link, and the reason it is the first focusable thing in the
          document. Section 23 commits to a keyboard path that works end to end,
          and 2.4.11 asks that the focused control never be entirely obscured —
          both of which are decided by what focus reaches first. It is visible
          only while focused, which is what makes it a keyboard affordance rather
          than a visual one.
        */}
        {/*
          Every visual class is behind `focus:`, and that is load-bearing rather
          than tidy. `sr-only` hides an element by clipping it to one pixel with
          `padding: 0`; a padding utility written *outside* the variant overrides
          that padding while the clip stays, leaving an 18px box sitting in the
          layout instead of a hidden one. Unfocused, this is `sr-only` and
          nothing else.
        */}
        <a
          href="#main"
          className={
            'sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 ' +
            'focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-md focus:border ' +
            'focus:border-edge focus:bg-surface focus:px-4 focus:text-sm focus:font-medium ' +
            'focus:text-ink focus-visible:outline-accent focus-visible:outline-2 ' +
            'focus-visible:outline-offset-2'
          }
        >
          Skip to main content
        </a>

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
