import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { mockAccepted, mockSignInRefused, mockSignedIn } from './mock-api';

/**
 * axe-core over every route, in both themes, with a violation failing the build.
 *
 * `CLAUDE.md` (Definition of Done, Accessibility) makes this one of the three
 * things that make SKILL.md section 23's WCAG 2.2 AA claim checkable rather than
 * aspirational. The other two are the palette check, which runs in lint and needs
 * no browser, and the part a pull request has to state in words because nothing
 * can automate it.
 *
 * **A green run here is the floor, not the ceiling.** Automated rules catch a
 * minority of AA — roughly a third by most counts — and none of the four criteria
 * the pull request template asks about can be seen from here: focus visible
 * (2.4.7), focus not obscured (2.4.11), target size (2.5.8), and accessible
 * authentication (3.3.8). 2.5.8 is *partly* reachable and is asserted separately
 * below, because a mis-tap on a phone is a wrong attendance record (section 23).
 *
 * **Both themes, because the palette has two and a leader does not choose which
 * one they get.** `prefers-color-scheme` is the browser's, so a contrast defect
 * that exists only in dark mode is invisible to a light-mode-only sweep.
 */

const THEMES = ['light', 'dark'] as const;

/**
 * Every route, and the state worth scanning it in.
 *
 * A route's *initial* render is not the only thing a person sees. A form error
 * appears after a submission and would never be scanned by a sweep that only
 * loads pages, so the states that render new content are listed here as their
 * own entries.
 */
const SCANS = [
  { name: 'landing', route: '/' },
  { name: 'sign-in', route: '/sign-in' },
  {
    name: 'sign-in, refused',
    route: '/sign-in',
    async arrange(page: import('@playwright/test').Page) {
      await mockSignInRefused(page);
      await page.getByLabel('Email address').fill('nobody@example.invalid');
      await page.getByLabel('Password').fill('not the right password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      // Scoped to the form: Next renders its own route announcer as a
      // `role="alert"` live region on every page, so an unscoped lookup matches
      // two things.
      await expect(page.locator('form').getByRole('alert')).toContainText('do not match');
    },
  },
  { name: 'forgot-password', route: '/forgot-password' },
  {
    name: 'forgot-password, sent',
    route: '/forgot-password',
    async arrange(page: import('@playwright/test').Page) {
      await mockAccepted(page, '**/api/v1/auth/forgot-password');
      await page.getByLabel('Email address').fill('someone@example.invalid');
      await page.getByRole('button', { name: 'Email me a link' }).click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    },
  },
  { name: 'activate', route: '/activate?token=example-activation-token' },
  { name: 'activate, link missing its token', route: '/activate' },
  { name: 'reset-password', route: '/reset-password?token=example-reset-token' },
  {
    name: 'session',
    route: '/session',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Your session' })).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
    },
  },
  {
    // The halt: a failure notice, a warning paragraph, and a control that says
    // something different from the one on any other screen. It renders new
    // content, so it is its own entry — which is the rule this list already
    // states and which the commit that added the state did not follow.
    name: 'session, halted',
    route: '/session',
    async before(page: import('@playwright/test').Page) {
      await page.addInitScript(() => {
        window.localStorage.setItem('dfc.refresh_token', 'test-refresh-token');
      });
      await page.route('**/api/v1/auth/refresh', (route) => route.abort('failed'));
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('button', { name: 'Try again anyway' })).toBeVisible();
    },
  },
] as const;

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const scan of SCANS) {
      test(`${scan.name} has no axe violations`, async ({ page }) => {
        if ('before' in scan && scan.before) {
          await scan.before(page);
        }

        await page.goto(scan.route);

        if ('arrange' in scan && scan.arrange) {
          await scan.arrange(page);
        }

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(
          results.violations.map((violation) => ({
            id: violation.id,
            help: violation.help,
            nodes: violation.nodes.map((node) => node.target.join(' ')),
          })),
        ).toEqual([]);
      });
    }
  });
}

/**
 * WCAG 2.5.8: every interactive target is at least 24 by 24 CSS pixels.
 *
 * axe does not check this, and section 23 names it because Cell attendance is
 * recorded by tapping down a roster on a phone, often standing up. It is checked
 * here rather than left to the pull request's own statement, because it is one
 * of the four that *is* partly measurable, and this repository's standing
 * complaint about itself is rules with nothing able to fail on them.
 *
 * **One state relies on the criterion's own inline exception**, and it is named
 * in `TARGET_EXEMPT` below rather than quietly skipped. The exception is not
 * implemented as a rule — deciding whether a link is "inline" from the DOM is
 * guesswork — so a state that needs it is listed, with its reason, and the guard
 * beneath makes the list exhaustive.
 */
/**
 * Each route, the control that proves it has finished rendering, and how many
 * targets it owns.
 *
 * **The count is stated per route rather than asserted to be non-zero**, and
 * that is the whole of what makes this test non-vacuous. The skip link lives in
 * the root layout, so it matches on *every* route: a `> 0` guard is satisfied by
 * the layout alone and can never fail. Worse, `/session` renders `Loading…` with
 * no controls until `RequireSession` settles, so a sweep that measured
 * immediately would have passed on the skip link and never measured either
 * sign-out button.
 *
 * Targets are counted inside `<main>`, which excludes the skip link; it is
 * measured separately below, in the state it is offered in.
 */
const TARGET_SWEEP = [
  { name: 'sign-in', route: '/sign-in', settle: 'Sign in', minimum: 4 },
  { name: 'forgot-password', route: '/forgot-password', settle: 'Email me a link', minimum: 3 },
  {
    name: 'activate',
    route: '/activate?token=example-activation-token',
    settle: 'Activate account',
    minimum: 2,
  },
  {
    name: 'reset-password',
    route: '/reset-password?token=example-reset-token',
    settle: 'Save new password',
    minimum: 2,
  },
  { name: 'session', route: '/session', settle: 'Sign out on every device', minimum: 2 },
] as const;

/**
 * States deliberately not measured, each with the reason it is exempt.
 *
 * Nothing may leave `SCANS` without appearing in one of these two lists — the
 * guard below enforces it, so this cannot decay into "every state somebody
 * remembered", which is the failure the route walker further down was written to
 * prevent one list over.
 */
const TARGET_EXEMPT: { name: string; why: string }[] = [
  {
    name: 'landing',
    why: 'It renders no interactive target at all: a heading and a status line, while it redirects.',
  },
  {
    name: 'forgot-password, sent',
    why: 'Its only target is the "Back to sign in" link, measured on /forgot-password itself.',
  },
  {
    name: 'sign-in, refused',
    why: 'Same targets as /sign-in, which is measured; the refusal adds text, not controls.',
  },
  {
    name: 'session, halted',
    why:
      'Its three controls are the same Button primitive measured on /session and /sign-in — the ' +
      'two sign-out buttons are literally the /session entry\'s, and "Try again anyway" differs ' +
      'from "Try again" only in its label. The state is still axe-scanned, which is what the ' +
      'extra paragraph and the changed control name are worth checking for.',
  },
  {
    name: 'activate, link missing its token',
    why:
      'Its one control is a "request a password reset" link inside a sentence, which is exempt ' +
      'under 2.5.8\'s own inline exception. Giving it a 44px box would put a button-sized gap in ' +
      'the middle of a paragraph.',
  },
];

test('every interactive target meets the 24px minimum', async ({ page }) => {
  await mockSignedIn(page);

  for (const { route, settle, minimum } of TARGET_SWEEP) {
    await page.goto(route);
    await expect(page.getByRole('button', { name: settle })).toBeVisible();

    const targets = page.locator('main button, main a[href], main input, main select, main textarea');
    const count = await targets.count();
    expect(count, `${route} renders fewer targets than it owns`).toBeGreaterThanOrEqual(minimum);

    for (let index = 0; index < count; index += 1) {
      const target = targets.nth(index);
      if (!(await target.isVisible())) {
        continue;
      }

      // Measured focused, because a target is only required to meet 2.5.8 in the
      // state it is actually offered in. A skip link is one pixel until focus
      // reaches it and 44px once it has, and measuring it hidden would report a
      // failure for the state in which nobody can activate it. For every other
      // control focus changes nothing about its box.
      await target.focus().catch(() => {});

      const box = await target.boundingBox();
      const description = await target.evaluate(
        (node) => `${node.tagName.toLowerCase()}: ${(node.textContent ?? '').trim().slice(0, 40)}`,
      );

      expect(box, `${route} — ${description} has no box`).not.toBeNull();
      expect(box!.width, `${route} — ${description} is ${box!.width}px wide`).toBeGreaterThanOrEqual(24);
      expect(box!.height, `${route} — ${description} is ${box!.height}px tall`).toBeGreaterThanOrEqual(24);
    }
  }
});

/**
 * The skip link, measured on its own because it is the one target that lives
 * outside `<main>` and the one whose size depends on being focused.
 *
 * It is `sr-only` until focus reaches it. Every visual class sits behind
 * `focus:` deliberately: a padding utility written outside the variant overrides
 * `sr-only`'s `padding: 0` while the clip stays, which left an 18px box in the
 * layout rather than a hidden one. That is what this pins.
 */
test('the skip link is hidden until focused, and a full target once it is', async ({ page }) => {
  await page.goto('/sign-in');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });

  const hidden = await skipLink.boundingBox();
  expect(hidden, 'the skip link has no box').not.toBeNull();
  expect(hidden!.height, 'the skip link is not visually hidden before focus').toBeLessThanOrEqual(2);

  await skipLink.focus();

  const shown = await skipLink.boundingBox();
  expect(shown!.height, 'the focused skip link is below the 24px minimum').toBeGreaterThanOrEqual(24);
  expect(shown!.width, 'the focused skip link is below the 24px minimum').toBeGreaterThanOrEqual(24);
});

/**
 * The guard that keeps the 2.5.8 sweep honest.
 *
 * `SCANS` has a route walker holding it to the router's own directory. Without
 * an equivalent here, `TARGET_SWEEP` degrades into whichever states somebody
 * remembered — and a state added to `SCANS` would be scanned by axe, which
 * cannot see target size, and measured by nothing.
 */
test('every scanned state is either measured for target size or exempt with a reason', () => {
  // Keyed by the scan's name, not its route: two states share `/sign-in`, and
  // `/activate` differs from `/activate?token=…` in exactly the way that matters
  // here. A route comparison would call one of each pair covered by the other.
  const measured = new Set<string>(TARGET_SWEEP.map((entry) => entry.name));
  const exempt = new Set(TARGET_EXEMPT.map((entry) => entry.name));

  for (const scan of SCANS) {
    const covered = measured.has(scan.name) || exempt.has(scan.name);
    expect(
      covered,
      `"${scan.name}" (${scan.route}) is scanned by axe but neither measured for WCAG 2.5.8 ` +
        `nor listed in TARGET_EXEMPT with a reason.`,
    ).toBe(true);
  }

  // An exemption for a state that no longer exists is a reason nobody can check.
  for (const entry of TARGET_EXEMPT) {
    expect(
      SCANS.some((scan) => scan.name === entry.name),
      `TARGET_EXEMPT lists "${entry.name}", which is not a scanned state.`,
    ).toBe(true);
  }
});

/**
 * The guard that keeps "every route" true.
 *
 * Without it, adding a route adds a screen nothing scans, and the commitment
 * quietly becomes "every route somebody remembered". This reads the router's own
 * directory rather than a list, so the two cannot disagree.
 */
test('every route in the app directory is scanned', async () => {
  // `__dirname` rather than `import.meta.url`: Playwright transpiles a spec to
  // CommonJS, where `import.meta` is a syntax error and the whole file silently
  // fails to load as "no tests found".
  const appDirectory = resolve(__dirname, '..', 'app');

  async function routesUnder(directory: string, prefix: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const found: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // A route group `(name)` organises files without appearing in the URL.
        const segment = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`;
        found.push(...(await routesUnder(join(directory, entry.name), segment)));
        // Every extension Next resolves, not only the two this repository
        // happens to use. A `page.js` added later would otherwise emit no route,
        // fail no assertion, and never be scanned — the one way this walker can
        // fail *open*.
      } else if (/^page\.(tsx|ts|jsx|js|mjs)$/.test(entry.name)) {
        found.push(prefix === '' ? '/' : prefix);
      }
    }

    return found;
  }

  const declared = new Set(SCANS.map((scan) => scan.route.split('?')[0]));
  const actual = await routesUnder(appDirectory, '');

  expect(actual.length).toBeGreaterThan(0);
  for (const route of actual) {
    expect(
      declared.has(route),
      `${route} is a route and is not in SCANS, so axe never sees it. ` +
        `CLAUDE.md commits to axe-core over every route.`,
    ).toBe(true);
  }
});
