import { defineConfig, devices } from '@playwright/test';

/**
 * The browser harness that discharges SKILL.md section 23.
 *
 * `CLAUDE.md` (Definition of Done, Accessibility) commits to axe-core running in
 * CI over every route from the first real screen, with a violation failing the
 * build. This is that, and it arrives with the screens rather than after them.
 *
 * **It runs against the production build, not `next dev`.** Development mode
 * injects overlays and error affordances of its own, and an accessibility check
 * should be looking at what a leader's phone is served.
 *
 * **The API is mocked at the network layer** (`e2e/mock-api.ts`), so this job
 * needs no database, no API process and no seeded account. axe inspects rendered
 * DOM — it cannot tell whether the JSON came from PostgreSQL, so an end-to-end
 * stack would buy nothing for this criterion and cost a service dependency in a
 * job that must stay fast enough that nobody is tempted to skip it. The
 * integration risk that leaves uncovered is real and belongs to a different
 * check than the accessibility one.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // The build is part of the command, not a step somebody runs first.
    // `NEXT_PUBLIC_*` is inlined into the client bundle at **build** time, so an
    // environment set only for `start` reaches the server process and not the
    // JavaScript the browser runs — which presents as every request failing
    // before it is made, and looks nothing like a missing variable.
    command: 'npm run build && npm run start -- --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Never reached: every request is intercepted before it leaves the page.
      // It is set because `lib/api-client.ts` refuses to construct a URL without
      // it, which is the behaviour that stops a real deployment shipping unset.
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:9',
    },
  },
});
