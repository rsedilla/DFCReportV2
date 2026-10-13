import { expect, test } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockCellsWithClosed, mockDccRoster } from './mock-attendance';

/**
 * A day reads as the same day on a device set west of UTC (checklist row
 * audit-date-timezone). A `YYYY-MM-DD` day is formatted from a UTC midnight, so a label
 * formatted in the device's own zone read one day early in the Americas. Names are
 * invented (`CLAUDE.md`, Secrets).
 */
test.use({ timezoneId: 'America/Los_Angeles' });

test('a Sunday reads as that Sunday', async ({ page }) => {
  await mockSignedIn(page);
  await mockDccRoster(page);

  await page.goto('/dcc/3f1b7c6e-0000-4000-8000-000000000501');

  await expect(page.getByRole('heading', { name: 'Sunday 7 June' })).toBeVisible();
});

test('a closed Cell reads the day it closed', async ({ page }) => {
  await mockSignedIn(page);
  await mockCellsWithClosed(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/cells');
  await page.getByRole('button', { name: 'Closed Cells' }).click();

  const row = page
    .getByRole('table', { name: 'Closed Cells you oversee' })
    .getByRole('row', { name: /Members dispersed/ });
  await expect(row).toContainText('12 Jun 2026');
});
