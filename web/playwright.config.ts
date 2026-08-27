import { defineConfig, devices } from '@playwright/test';

/**
 * The browser harness. It carries two suites, and only the first is section 23's.
 *
 * `e2e/accessibility.spec.ts` discharges SKILL.md section 23: `CLAUDE.md`
 * (Definition of Done, Accessibility) commits to axe-core running in CI over
 * every route from the first real screen, with a violation failing the build.
 * This is that, and it arrives with the screens rather than after them.
 *
 * `e2e/session.spec.ts` pins two section 6 rules about refresh tokens that no
 * amount of looking at the screen would reveal — a sign-out that revokes nothing
 * and a dropped connection that discards a live credential both look exactly
 * like an application that works.
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

  /**
   * **Two engines, and the second one is iOS.**
   *
   * `chromium` runs everything, at all five widths. It is also what covers Edge:
   * Edge is Chromium, so it shares this rendering engine, and a project of its
   * own would re-run the same layout code against the same engine.
   *
   * `webkit` exists because **iOS forces WebKit on every browser it hosts**.
   * Chrome on an iPhone is WebKit, so "we tested Chrome" is not a statement about
   * any iPhone -- and roughly half the device list this application is sized for
   * is iPhones. WebKit is also where the differences are: date inputs, sticky
   * positioning, flex and grid corners, and focus behaviour.
   *
   * It runs the two widths tagged `@cross-browser` rather than all five, and the
   * cost is the reason. This job builds the application and scans every route in
   * two themes; a second engine over five widths roughly doubles it, and the
   * comment above says in terms that it must stay fast enough that nobody is
   * tempted to skip it. The two chosen are the ones that bind -- the narrowest
   * width, where overflow is hardest, and the widest at which anything changes.
   * An engine difference appearing at neither end is the accepted cost, stated
   * rather than discovered.
   *
   * Firefox is deliberately absent. Gecko is a third engine and no phone or
   * tablet in use here runs it, so it would buy a desktop-only check at the same
   * price as the one that covers every iPhone.
   *
   * **The tag lives on the viewport list**, not in a title match here. A `grep`
   * against describe titles silently runs nothing when somebody rewords one, and
   * a browser project that quietly scans zero pages reports the same green as one
   * that scanned everything.
   */
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@cross-browser/ },
  ],

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
      //
      // **The port is 9999 and not 9, and that is not cosmetic.** Port 9 is the
      // discard protocol and is on the browsers' blocked-port list, and WebKit
      // enforces that *before* route interception can see the request: it is
      // refused at the network layer, the mock never fires, and every scan
      // needing a signed-in session renders the signed-out page instead.
      // Chromium intercepts earlier, so the same value worked there and hid it.
      //
      // The comment above was written from Chromium's behaviour and was true of
      // it. A port nobody blocks makes it true of both.
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:9999',
    },
  },
});
