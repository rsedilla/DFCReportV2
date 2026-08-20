import type { NextConfig } from 'next';

/**
 * The web application is a pure client of /api/v1 (SKILL.md section 2). It holds
 * no API routes and no server actions, and `scripts/check-client-boundary.mjs`
 * fails the build if either appears.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
