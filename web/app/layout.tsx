import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';

import './globals.css';

/**
 * One typeface, self-hosted by `next/font` at build time.
 *
 * `next/font` downloads the files and serves them from this origin, so no
 * request leaves for a font host at run time and there is no layout shift while
 * one arrives. The fallback stack in `globals.css` is what renders if the face
 * never loads, which is the case on a leader's phone on a poor connection.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'G12 Church Management',
  description: 'People, pastoral hierarchy, DCC and Cell attendance, and reporting.',
};

/**
 * Responsive from the beginning. Leaders will open this on their phones long
 * before a native app exists, so mobile web is a current surface rather than
 * preparation for the future (SKILL.md section 23).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
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
