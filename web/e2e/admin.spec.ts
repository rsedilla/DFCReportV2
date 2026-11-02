import { expect, test, type Page } from '@playwright/test';

import {
  mockAccountsAdministrator,
  mockAdminArea,
  mockAdministrator,
  mockScreens,
  mockSignedIn,
} from './mock-api';

/**
 * The Admin area (SKILL.md section 19, ruling of 2026-11-02, decision 0419): who sees it, where it
 * sits, and its Home and Accounts tabs. Every figure here is invented.
 */

async function openAdmin(page: Page, path = '/admin'): Promise<string[]> {
  await mockSignedIn(page);
  await mockAccountsAdministrator(page);
  const asked = await mockAdminArea(page);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
  return asked;
}

test.describe('the Admin item', () => {
  test('is set apart at the foot of the sidebar on a laptop, not in Main', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAdmin(page);

    const administration = page.getByRole('navigation', {
      name: 'Administration',
    });
    await expect(administration.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText('For the administrator')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }),
    ).toHaveCount(0);
  });

  test('is a button in the top bar on a phone, not in the bar along the bottom', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openAdmin(page);

    const top = page.getByRole('banner');
    const admin = top.getByRole('link', { name: 'Admin' });
    await expect(admin).toBeVisible();
    await expect(admin).toHaveAttribute('aria-current', 'page');
    await expect(top.getByRole('link', { name: 'Account and session' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }),
    ).toHaveCount(0);
    // Nothing in the top bar runs past the screen's edge at 320px.
    const box = await top.boundingBox();
    const overflow = await top.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(box?.width).toBeLessThanOrEqual(320);
    expect(overflow).toBe(false);
  });

  test('is drawn for nobody without accounts.manage at Whole Church', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSignedIn(page);
    // The administrator of every case written before the ruling, holding no `accounts.manage`.
    await mockAdministrator(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  });

  test('is not drawn for a Senior Pastor, and its address opens nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSignedIn(page);
    await mockScreens(page, 'SENIOR_PASTOR');
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toHaveCount(0);
  });

  test('is where the account lands', async ({ page }) => {
    await mockSignedIn(page);
    await mockAccountsAdministrator(page);
    await mockAdminArea(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe('the Admin area’s Home', () => {
  test('counts what needs the administrator, each opening its list', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAdmin(page);

    const tile = (name: string) =>
      page
        .locator('div')
        .filter({ has: page.getByRole('heading', { name, exact: true }) })
        .last();

    await expect(tile('Cells to approve')).toContainText('2');
    await expect(tile('Cells to approve').getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/cells?view=APPROVE',
    );
    await expect(tile('No Leader Yet')).toContainText('3');
    await expect(tile('Accounts not activated')).toContainText('6');
    await expect(
      tile('Accounts not activated').getByRole('link', {
        name: 'Resend or correct',
      }),
    ).toHaveAttribute('href', '/admin?tab=accounts&filter=PENDING_ACTIVATION');
    await expect(tile('Sign-ins paused')).toContainText('1');
    // A first page with more behind it reads with a plus, as Record's tabs do.
    await expect(tile('Pending CG Records')).toContainText('3+');
    await expect(tile('Pending DCC Records')).toContainText('2');

    const people = page.getByRole('region', { name: 'People and accounts' });
    await expect(people).toContainText('1,284');
    await expect(people).toContainText('221');
    await expect(page.getByRole('region', { name: 'Cells' })).toContainText('186');
  });
});

test.describe('the Admin area’s Accounts', () => {
  test('lists every account with its role, state and what is set', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAdmin(page, '/admin?tab=accounts');

    const table = page.getByRole('table', { name: 'Accounts' });
    const row = (name: string) => table.getByRole('row').filter({ hasText: name });
    await expect(row('Teofilo Ramos')).toContainText('Leader');
    await expect(row('Teofilo Ramos')).toContainText('Full view, Moves people');
    await expect(row('Herminia Lazaro')).toContainText('Waiting for activation');
    await expect(row('Herminia Lazaro')).toContainText('Email sent 28 Oct');
    await expect(row('Marilou Santos')).toContainText('Active, sign-in paused');
    await expect(row('Marilou Santos')).toContainText('Second step set up');
    await expect(row('Teofilo Ramos').getByRole('link', { name: 'Teofilo Ramos' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000911',
    );
  });

  test('filters by one chip at a time, each with its count', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const asked = await openAdmin(page, '/admin?tab=accounts');

    const chips = page.getByRole('group', { name: 'Show' });
    await expect(chips.getByRole('button', { name: /Waiting for activation\s*6/ })).toBeVisible();
    await expect(chips.getByRole('button', { name: /^All\s*221/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await chips.getByRole('button', { name: /Sign-ins paused/ }).click();
    await expect(page).toHaveURL(/filter=PAUSED/);
    await expect.poll(() => asked.at(-1)).toContain('filter=PAUSED');
    await expect(chips.getByRole('button', { name: /^All/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Pressing the chip that is on returns to every account.
    await chips.getByRole('button', { name: /Sign-ins paused/ }).click();
    await expect(page).not.toHaveURL(/filter=/);
  });

  test('searches by name, username or email', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const asked = await openAdmin(page, '/admin?tab=accounts');

    await page.getByLabel('Search accounts by name, username or email').fill('teo');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=teo/);
    await expect.poll(() => asked.at(-1)).toContain('q=teo');
  });

  test('shows each account as a card on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openAdmin(page, '/admin?tab=accounts');

    await expect(page.getByRole('table', { name: 'Accounts' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Herminia Lazaro' })).toBeVisible();
    await expect(page.getByText('Leader · Waiting for activation')).toBeVisible();
  });
});
