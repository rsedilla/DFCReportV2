import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
