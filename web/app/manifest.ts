import type { MetadataRoute } from 'next';

/**
 * What a phone shows when somebody adds the site to their home screen (owner's choice of
 * 2026-10-19): DREAMS, under the DfC globe.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DREAMS — Doulos Reporting, Equipping, And Monitoring System',
    short_name: 'DREAMS',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e0e0e',
    theme_color: '#006b35',
    icons: [
      { src: '/dreams-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/dreams-logo.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
