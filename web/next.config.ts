import type { NextConfig } from 'next';

/**
 * The API's origin, which is the one place besides this site a page may talk to.
 *
 * Read from `NEXT_PUBLIC_API_URL` at build time, the variable `lib/api-client.ts` builds
 * every request from, so the policy and the client cannot name different places.
 */
function apiOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (!configured) {
    return null;
  }
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

/**
 * One fixed policy for every page (owner's choice of 2026-09-28).
 *
 * **What it is for.** The refresh token lives in the browser's storage (SKILL.md section
 * 6), so what matters most is that nothing on a page can send it anywhere: `connect-src`
 * names this site and the API and nothing else, and `img-src` allows no other host an
 * image request could smuggle it to. No script loads from another site, and no other site
 * may frame this one.
 *
 * **What it does not do.** Inline scripts are allowed, because Next.js writes its own into
 * every page; refusing them would need a per-request nonce and would stop pages being
 * pre-built and cached, which was the option not chosen. So an injected script could still
 * run, but it would have nowhere to send what it read.
 *
 * `'unsafe-eval'` and the websocket are for `next dev` alone, which needs both for
 * reloading; the production build is served without them.
 */
function contentSecurityPolicy(): string {
  const development = process.env.NODE_ENV === 'development';
  const api = apiOrigin();
  const connect = ["'self'", api, development ? 'ws:' : null].filter(Boolean).join(' ');

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // `data:` for the second step's QR code, which is drawn as a data URL.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * The web application is a pure client of /api/v1 (SKILL.md section 2). It holds
 * no API routes and no server actions, and `scripts/check-client-boundary.mjs`
 * fails the build if either appears.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          // The API already sends this for the same domain; the pages now agree with it.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=(), usb=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
