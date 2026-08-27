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
 * Inline links inside a sentence are exempt under the criterion's own
 * "inline" exception; nothing in these screens relies on that, so the exception
 * is not implemented and every target is measured.
 */
test('every interactive target meets the 24px minimum', async ({ page }) => {
  await mockSignedIn(page);

  for (const route of ['/sign-in', '/forgot-password', '/activate?token=t', '/session']) {
    await page.goto(route);

    const targets = page.locator('button, a[href], input, select, textarea');
    const count = await targets.count();
    expect(count, `${route} renders no interactive targets`).toBeGreaterThan(0);

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
      } else if (/^page\.tsx?$/.test(entry.name)) {
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
