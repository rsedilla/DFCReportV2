import Image from 'next/image';
import type { ReactNode } from 'react';

import { APPLICATION_FULL_NAME, APPLICATION_NAME, LOGO_PATH } from '@/lib/brand';

/**
 * The frame every unauthenticated screen sits in.
 *
 * `<main id="main">` is what the skip link in `app/layout.tsx` targets, and each
 * of these screens has exactly one heading, so the document outline is one level
 * deep and reads in order.
 *
 * Nothing sticky sits above it. WCAG 2.4.11 asks that the focused control never
 * be *entirely* obscured, and the ordinary way to breach that is a sticky header
 * a focused field scrolls under. These screens are short enough not to need one,
 * which is worth stating because the first screen that does need one inherits
 * the obligation rather than the layout.
 */
export function AuthCard({
  title,
  intro,
  children,
  footer,
  brand = false,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** The logo and the name above the heading, on the sign-in screen (owner, 2026-10-19). */
  brand?: boolean;
}) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      {brand ? (
        // Decorative: the name beside it says the same. Not a heading, so the screen keeps one.
        <div className="mb-7 text-center">
          <Image
            src={LOGO_PATH}
            alt=""
            width={120}
            height={120}
            unoptimized
            priority
            className="mx-auto size-30 rounded-3xl"
          />
          <p className="mt-3.5 text-3xl font-bold tracking-wide">{APPLICATION_NAME}</p>
          <p className="text-muted mt-1 text-[0.8125rem]">{APPLICATION_FULL_NAME}</p>
        </div>
      ) : null}
      <h1 className="text-center text-2xl font-semibold tracking-tight">{title}</h1>

      {intro ? <p className="text-muted mt-2 text-center text-sm leading-relaxed">{intro}</p> : null}

      {/*
        The heading and the footer are centred; the form is not. Labels and
        validation messages stay left-aligned because a centred label leaves the
        eye no fixed edge to return to down a column of fields, which costs most
        on the small screens section 23 treats as a current surface.
      */}
      <div className="mt-8">{children}</div>

      {footer ? (
        <div className="border-line mt-8 border-t pt-6 text-center text-sm">{footer}</div>
      ) : null}
    </main>
  );
}
