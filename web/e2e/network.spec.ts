import { expect, test } from '@playwright/test';

import { mockAdministrator, mockScreens, mockSignedIn } from './mock-api';

/**
 * The Branch screen, `/network` (decisions 0252 and 0318), was replaced by # of People and
 * Family Tree (decision 0364) and is offered to no account (decision 0379): its address shows
 * the note naming the account's screens and the way to its start screen. The page's own tests
 * went with it; whether the page itself is removed is a separate decision.
 */
for (const [who, arrange, screens, start] of [
  ['a Full view leader', async () => undefined, 'Record, Reports, People, Cells and SUYNL', '/dashboard'],
  ['an Admin', mockAdministrator, 'Record, Reports, People, Cells and Growth', '/dashboard'],
  [
    'a Senior Pastor',
    async (page: import('@playwright/test').Page) => mockScreens(page, 'SENIOR_PASTOR'),
    'Record and Reports',
    '/reports/dcc',
  ],
  [
    'a Recording-only account',
    async (page: import('@playwright/test').Page) => mockScreens(page, 'RECORDING'),
    'Record, People, Cells and SUYNL',
    '/dashboard',
  ],
] as const) {
  test(`the Branch screen is not offered to ${who}`, async ({ page }) => {
    await mockSignedIn(page);
    await arrange(page);

    await page.goto('/network?focus=3f1b7c6e-0000-4000-8000-000000000701');

    await expect(page.getByRole('heading', { name: 'This page isn’t part of your screens' })).toBeVisible();
    await expect(page.getByText(`Your screens are ${screens}.`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to your start screen' })).toHaveAttribute('href', start);
    await expect(page.getByRole('navigation', { name: 'Where this person sits' })).toHaveCount(0);
  });
}
