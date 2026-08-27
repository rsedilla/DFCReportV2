import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  PERSON_IN_SCOPE,
  mockAccepted,
  mockDuplicateRefusal,
  mockPeople,
  mockPossibleMatches,
  mockSignInRefused,
  mockSignedIn,
} from './mock-api';

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
      // The greeting, asserted rather than assumed: settling on the heading and
      // the table would scan and pass on a page where it never rendered, and the
      // client's guard on it is a truthiness check that fails silent.
      await expect(page.getByText('Welcome, Marilou')).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
    },
  },
  {
    name: 'people, before searching',
    route: '/people',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
    },
  },
  {
    // The state the whole screen exists for: one row the viewer pastors and one
    // they do not, so section 8's redaction is scanned rather than assumed.
    name: 'people, with results',
    route: '/people',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByLabel('Search by name').fill('an');
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByText('Marilou Reyes Santos')).toBeVisible();
      await expect(page.getByText('Details visible to their own leaders')).toBeVisible();
    },
  },
  {
    name: 'person profile',
    route: `/people/${PERSON_IN_SCOPE.id}`,
    pattern: '/people/[id]',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Marilou Reyes Santos' })).toBeVisible();
    },
  },
  {
    name: 'edit a person',
    route: `/people/${PERSON_IN_SCOPE.id}/edit`,
    pattern: '/people/[id]/edit',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    },
  },
  {
    name: 'add a person',
    route: '/people/new',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await expect(page.getByRole('heading', { name: 'Add a person' })).toBeVisible();
    },
  },
  {
    // The pre-flight lookup (section 3, section 9 step 1) — the only surface a
    // Tier 2 candidate has, since creation can refuse on Tier 1 alone. One
    // candidate carries reasons and one is withheld by section 8.
    name: 'add a person, possible matches',
    route: '/people/new',
    pattern: '/people/new',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockPossibleMatches(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByLabel('First name').fill('Marilou');
      await page.getByLabel('Last name').fill('Santos');
      await expect(
        page.getByRole('heading', { name: 'Someone similar is already recorded' }),
      ).toBeVisible();
      await expect(page.getByText('Same first and last name')).toBeVisible();
      // Two withheld candidates, and the second carries a tier as well as the
      // flag. It must still read as withheld — which only `possible_match` can
      // decide, so this is what pins the client reading the flag rather than
      // inferring the same fact from an absent tier.
      await expect(
        page.getByText('Their details are visible to the leaders who pastor them.'),
      ).toHaveCount(2);
    },
  },
  {
    // The duplicate refusal, which is the reason the create screen has the shape
    // it has. One candidate carries reasons and one is withheld.
    name: 'add a person, duplicate candidates',
    route: '/people/new',
    pattern: '/people/new',
    async before(page: import('@playwright/test').Page) {
      await mockSignedIn(page);
      await mockDuplicateRefusal(page);
      await mockPeople(page);
    },
    async arrange(page: import('@playwright/test').Page) {
      await page.getByLabel('First name').fill('Marilou');
      await page.getByLabel('Last name').fill('Santos');
      await page.getByRole('radio', { name: 'Female' }).check();
      await page.getByRole('radio', { name: 'Married' }).check();
      await page.getByLabel('Search for a leader by name').fill('an');
      await page.getByRole('button', { name: 'Find' }).click();
      await page.getByRole('button', { name: 'Choose' }).first().click();
      await page.getByRole('button', { name: 'Add person' }).click();
      await expect(
        page.getByRole('heading', { name: 'Is this someone already recorded?' }),
      ).toBeVisible();
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
  // The search box, the Search button and the "Add a person" link. The nav lives
  // in the header, outside `<main>`, and is counted on no route.
  { name: 'people, before searching', route: '/people', settle: 'Search', minimum: 3 },
  // 5 Field inputs, 5 radios (2 sex + 3 civil status), the leader search input,
  // its Find button, and the submit button.
  { name: 'add a person', route: '/people/new', settle: 'Find', minimum: 13 },
  {
    name: 'person profile',
    route: `/people/${PERSON_IN_SCOPE.id}`,
    // A link, not a button: this screen's controls are all navigation, which is
    // what they should be.
    settleRole: 'link' as const,
    settle: 'Edit details',
    minimum: 2,
  },
  {
    name: 'edit a person',
    route: `/people/${PERSON_IN_SCOPE.id}/edit`,
    settle: 'Save changes',
    // Back link, 5 Field inputs, 3 civil-status radios, Save, Cancel.
    minimum: 11,
  },
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
    name: 'people, with results',
    why:
      'Adds result rows and pagination controls to the measured /people state. Each row is a ' +
      'link carrying min-h-11, and the controls are the same Button primitive; the search form ' +
      'itself is measured under "people, before searching".',
  },
  {
    name: 'add a person, possible matches',
    why:
      'Adds an advisory panel to the measured "add a person" state. Its only controls are ' +
      '"Open this record" links carrying min-h-11 explicitly; every form control on the page ' +
      'is measured there.',
  },
  {
    name: 'add a person, duplicate candidates',
    why:
      'Two Buttons, which are the measured primitive, and an "Open this record" link carrying ' +
      'min-h-11 explicitly. The form it replaces is measured under "add a person".',
  },
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
  await mockPeople(page);

  for (const entry of TARGET_SWEEP) {
    const { route, settle, minimum } = entry;
    const settleRole = 'settleRole' in entry ? entry.settleRole : 'button';

    await page.goto(route);
    await expect(page.getByRole(settleRole, { name: settle })).toBeVisible();

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

      // **The target is what you can hit, not what you can see.** A checkbox or
      // radio wrapped in a `<label>` is activated by clicking anywhere in that
      // label, so the label is the target 2.5.8 measures. Measuring the input
      // instead reported a failure for a control that is already conformant, and
      // the obvious way to satisfy it — growing the visible dot to 24px — makes
      // the form worse to look at while changing nothing you can actually tap.
      const measured = await target.evaluate((node) => {
        const label = node.closest('label');
        const box = (label ?? node).getBoundingClientRect();
        return { width: box.width, height: box.height };
      });

      const box = measured.width > 0 || measured.height > 0 ? measured : await target.boundingBox();
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
 * Nothing scrolls sideways on any screen these leaders actually use.
 *
 * SKILL.md section 23 makes mobile web a **current** surface rather than
 * preparation for one. A page that scrolls horizontally is the ordinary way that
 * goes wrong, and it is invisible at desktop width — the people search shipped
 * with its search box squeezed to 107px beside two buttons, on the one control
 * the screen exists for, and every desktop check passed.
 *
 * **Five widths, chosen because each is a different state rather than a
 * different device.** Listing twenty phones would run the same layout twenty
 * times; what matters is a breakpoint, a content cap first binding, or an
 * extreme. The device names below say which real screen lands on each — they are
 * not the reason it is in the list.
 *
 * `sm` at 640 is the only breakpoint this application uses. There is no `md:`,
 * `lg:` or `xl:` utility anywhere in `web/`, so above 640 nothing rearranges and
 * the remaining widths differ only in which content cap binds.
 *
 * - **320** — the narrowest in real use, and the only width below `sm` here.
 *   Overflow is hardest at the narrowest width, so every phone from 344 (a
 *   folded Z Fold) through 360, 375, 393, 412 and 430 inherits it.
 * - **690** — the first width *above* `sm`, where stacked layouts become rows. A
 *   row that fits at 1280 can still overflow here, and no narrow test sees it.
 * - **768** — `PAGE_WIDTH.READING` exactly: the width at which a form stops
 *   growing, still filling the viewport edge to edge. An iPad mini portrait.
 * - **820** — the first width at which `READING` is capped *and centred, with
 *   margin on both sides*, which is a layout 768 does not produce. A standard
 *   iPad portrait lands here.
 * - **1024** — `PAGE_WIDTH.INDEX` exactly, so the list screens stop growing too:
 *   the narrowest laptop, an iPad landscape, an iPad Pro 12.9 portrait. **The
 *   last width where anything can break**, because nothing widens past it —
 *   1366, 1440, 1512, 1920 and a 4K panel all render what this renders, with
 *   more margin.
 */
const VIEWPORT_WIDTHS = [
  { name: '320px, the narrowest phone in use', width: 320, height: 568 },
  { name: '690px, a foldable opened out', width: 690, height: 829 },
  { name: '768px, where READING stops growing', width: 768, height: 1024 },
  { name: '820px, where READING first centres', width: 820, height: 1180 },
  // **The narrowest laptop, an iPad landscape, an iPad Pro 12.9 portrait — and
  // the last width where anything can break.** The widest content constraint in
  // the application is `PAGE_WIDTH.INDEX` at 1024px, so above this the layout
  // stops changing: a wider display adds margin rather than rearranging
  // anything, and 1366, 1440, 1512, 1920 and a 4K panel all render what this
  // width renders.
  { name: '1024px, a laptop or an iPad landscape', width: 1024, height: 768 },
];

for (const viewport of VIEWPORT_WIDTHS) {
  test.describe(`at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const scan of SCANS) {
      test(`${scan.name} does not scroll sideways`, async ({ page }) => {
        if ('before' in scan && scan.before) {
          await scan.before(page);
        }

        await page.goto(scan.route);

        if ('arrange' in scan && scan.arrange) {
          await scan.arrange(page);
        }

        const { scrollWidth, clientWidth, widest } = await page.evaluate(() => {
          const root = document.documentElement;
          // Name the widest offender, so a failure says which element to fix
          // rather than only that something overflows.
          let widest = '';
          let max = 0;
          for (const node of Array.from(document.querySelectorAll('body *'))) {
            const right = node.getBoundingClientRect().right;
            if (right > max) {
              max = right;
              widest = `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 40)}`;
            }
          }
          return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, widest };
        });

        expect(
          scrollWidth,
          `${scan.name} overflows ${scrollWidth - clientWidth}px past ${viewport.width}px; widest element is ${widest}`,
        ).toBeLessThanOrEqual(clientWidth);
      });
    }
  });
}

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

  // A scan visits a concrete URL; the walker emits the router's own path, which
  // for a dynamic segment is the literal `[id]`. An entry says which pattern it
  // stands for — otherwise every dynamic route reads as unscanned and the guard
  // cries wolf until somebody silences it.
  //
  // **The pattern is checked against the route rather than believed.** Free text
  // compared against nothing reintroduces the hole this walker exists to close,
  // one indirection out: an entry claiming `pattern: '/people/[id]'` while
  // visiting `/people` would mark the dynamic route covered by a scan that never
  // loads it. A pattern must match its own route segment for segment, with
  // `[…]` matching any single segment.
  const declared = new Set<string>();
  for (const scan of SCANS) {
    const path = scan.route.split('?')[0];
    const pattern = 'pattern' in scan && scan.pattern ? scan.pattern : path;

    const patternSegments = pattern.split('/');
    const pathSegments = path.split('/');

    expect(
      patternSegments.length,
      `"${scan.name}" declares pattern ${pattern}, which has a different number of segments from the route it visits (${path}).`,
    ).toBe(pathSegments.length);

    patternSegments.forEach((segment, index) => {
      if (/^\[.+\]$/.test(segment)) {
        expect(
          pathSegments[index].length,
          `"${scan.name}" declares a dynamic segment ${segment} but visits an empty one.`,
        ).toBeGreaterThan(0);
        return;
      }

      expect(
        pathSegments[index],
        `"${scan.name}" declares pattern ${pattern}, which does not match the route it visits (${path}).`,
      ).toBe(segment);
    });

    declared.add(pattern);
  }

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
