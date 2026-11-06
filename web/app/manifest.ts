import type { MetadataRoute } from 'next';

/**
 * What a phone shows when somebody adds the site to their home screen (owner's choice of
 * 2026-10-19): DREAMS, under the DfC globe.
 *
 * **The opening screen is the header's emerald** (owner, 2026-11-06). A phone takes one
 * colour for both themes, and black flashed before every light page; the emerald is the top
 * bar's colour in both. **Android gets a padded copy of the globe** (`purpose: 'maskable'`)
 * that fills its circle or rounded square with the words kept inside, rather than shrinking
 * the square logo into a white circle.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DREAMS — Doulos Reporting, Equipping, And Monitoring System',
    short_name: 'DREAMS',
    start_url: '/',
    display: 'standalone',
    background_color: '#006b35',
    theme_color: '#006b35',
    icons: [
      { src: '/dreams-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/dreams-logo.png', sizes: '512x512', type: 'image/png' },
      { src: '/dreams-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
