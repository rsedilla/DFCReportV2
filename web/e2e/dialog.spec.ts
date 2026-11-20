import { expect, test, type Page } from '@playwright/test';

import { mockCoordinator, mockSignedIn } from './mock-api';
import { mockCoordinatedClasses, mockEquipping, mockRegistrar } from './mock-equipping';

/**
 * Every dialog has a close button and keeps its buttons in view (decision 0500), shown on the
 * Withdraw dialog of Enrollment and the Coordinator's *Open a class*, which every dialog shares
 * through `Dialog`.
 */
async function openTheOpenClassDialog(page: Page) {
  await mockCoordinator(page);
  await mockCoordinatedClasses(page);
  await page.goto('/equipping/classes');
  await page.getByRole('button', { name: 'Open a class' }).click();
}

test.describe('a dialog (decision 0500)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedIn(page);
    await mockRegistrar(page);
    await mockEquipping(page);
  });

  test('closes from its × button, which never takes the first focus', async ({ page }) => {
    await page.goto('/equipping/enrollment');
    await page.getByRole('button', { name: /^Withdraw/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The safe answer the dialog marks takes the first focus, not the ×.
    await expect(dialog.getByRole('button', { name: 'Keep them' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('on a 320px phone its buttons and its × are on screen without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/equipping/enrollment');
    await page.getByRole('button', { name: /^Withdraw/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (const name of [/^Withdraw/, 'Keep them', 'Close']) {
      const box = await dialog.getByRole('button', { name }).first().boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(568);
      // 2.5.8: a target at least 24 by 24; the × is 44.
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('without a marked control, the first field takes the first focus, not the ×', async ({ page }) => {
    await openTheOpenClassDialog(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Class name')).toBeFocused();
  });

  // 2.4.11: Tab through a dialog taller than a 320px phone, and no focused control is ever
  // entirely hidden under the title bar or the button bar.
  test('keeps every focused control clear of both bars on a 320px phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openTheOpenClassDialog(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Class name')).toBeFocused();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const place = await page.evaluate(() => {
        const focused = document.activeElement as HTMLElement | null;
        const dlg = document.querySelector('dialog[open]');
        if (!focused || !dlg || !dlg.contains(focused)) return null;
        const bar = dlg.firstElementChild as HTMLElement;
        const actions = dlg.querySelector<HTMLElement>('[data-dialog-actions]');
        const r = focused.getBoundingClientRect();
        const inBars = bar.contains(focused) || (actions?.contains(focused) ?? false);
        return {
          inBars,
          top: r.top,
          bottom: r.bottom,
          barBottom: bar.getBoundingClientRect().bottom,
          actionsTop: actions ? actions.getBoundingClientRect().top : window.innerHeight,
        };
      });
      if (!place || place.inBars) continue;
      expect(place.bottom).toBeGreaterThan(place.barBottom);
      expect(place.top).toBeLessThan(place.actionsTop);
    }
  });
});
