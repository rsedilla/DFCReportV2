import { expect, test, type Page } from '@playwright/test';

import {
  mockAccountsAdministrator,
  mockAdminArea,
  mockAdministrator,
  mockAuditLog,
  mockScreens,
  mockRecordVerse,
  mockSettings,
  mockSignedIn,
  RECORD_VERSE,
} from './mock-api';
import { mockEncounterSeasons } from './mock-growth';

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
    await expect(row('Herminia Lazaro')).toContainText('Given 28 Oct');
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
    // The count is shown and kept out of the chip's name, which never changes.
    await expect(chips.getByRole('button', { name: 'Waiting for activation', exact: true })).toContainText('6');
    await expect(chips).toHaveAccessibleDescription(/Waiting for activation 6/);
    await expect(chips.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
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

test.describe('the Audit Log tab (decision 0428)', () => {
  test('lists each entry in words: when, who, what with its detail, and what it was about', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAuditLog(page);
    await openAdmin(page, '/admin?tab=audit');

    await expect(page.getByRole('button', { name: 'Audit Log' })).toHaveAttribute('aria-pressed', 'true');
    const table = page.getByRole('table', { name: 'Audit Log' });
    await expect(table.getByRole('columnheader')).toHaveText(['When', 'Who did it', 'What', 'About']);
    const row = (text: string) => table.getByRole('row').filter({ hasText: text });

    // Manila time, eight hours ahead of the instant stored.
    await expect(row('Moved to another leader')).toContainText('2 Nov 2026, 9:33 pm');
    await expect(row('Moved to another leader')).toContainText('Rosario Dimaculangan');
    await expect(row('Moved to another leader')).toContainText('From Celestina Abad to Teodoro Vergara');
    await expect(row('Moved to another leader').getByRole('link', { name: 'Lorenzo Pascual' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000952',
    );
    await expect(row('Cell category changed')).toContainText('Youth to Young Pro');
    await expect(row('Cell category changed').getByRole('link', { name: 'CELL-000004' })).toHaveAttribute(
      'href',
      '/cells/3f1b7c6e-0000-4000-8000-000000000955/meetings',
    );
    await expect(row('DCC changed after its week closed')).toContainText(
      'Sunday 20 September 2026, present · Reason: The paper attendance arrived late.',
    );
    await expect(row('Setting changed')).toContainText('4 to 3');
    await expect(row('Setting changed')).toContainText('No meeting in (months)');
    // Nobody made the pause: the system did.
    await expect(row('Sign-in paused')).toContainText('System');
    await expect(row('Sign-in paused')).toContainText('Teodoro Vergara');
  });

  test('narrows by one chip at a time, and pressing the one on returns to Everything', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const asked = await mockAuditLog(page);
    await openAdmin(page, '/admin?tab=audit');

    const chips = page.getByRole('group', { name: 'Show' });
    await expect(chips.getByRole('button')).toHaveText([
      'Everything',
      'People',
      'Moves',
      'Cells',
      'Attendance',
      'Growth',
      'Accounts',
      'Settings',
    ]);
    await chips.getByRole('button', { name: 'Moves' }).click();
    await expect(page).toHaveURL(/kind=MOVES/);
    await expect.poll(() => asked.at(-1)).toContain('kind=MOVES');
    await chips.getByRole('button', { name: 'Moves' }).click();
    await expect(page).not.toHaveURL(/kind=/);
  });

  test('searches by a person, a Member ID or a Cell ID', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const asked = await mockAuditLog(page);
    await openAdmin(page, '/admin?tab=audit');

    await page.getByLabel('Search by person, Member ID or Cell ID').fill('CELL-000004');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=CELL-000004/);
    await expect.poll(() => asked.at(-1)).toContain('q=CELL-000004');
  });

  test('shows each entry as a card on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockAuditLog(page);
    await openAdmin(page, '/admin?tab=audit');

    await expect(page.getByRole('table', { name: 'Audit Log' })).toBeHidden();
    const card = page.getByRole('listitem').filter({ hasText: 'Moved to another leader' });
    await expect(card).toContainText('From Celestina Abad to Teodoro Vergara');
    await expect(card).toContainText('by Rosario Dimaculangan');
    await expect(card.getByRole('link', { name: 'Lorenzo Pascual' })).toBeVisible();
  });
});

test.describe('the Settings tab (decision 0425)', () => {
  test('shows each church-wide setting, the calendar start without a control, and the Encounter seasons', async ({
    page,
  }) => {
    await mockSettings(page);
    await mockEncounterSeasons(page);
    await openAdmin(page, '/admin?tab=settings');

    const tabs = page.getByRole('group', { name: 'Admin' });
    // Decision 0419's four tabs, the fourth since decision 0428.
    await expect(tabs.getByRole('button')).toHaveText(['Home', 'Accounts', 'Settings', 'Audit Log']);
    await expect(tabs.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true');

    const months = page.getByRole('region', { name: 'No meeting in' });
    await expect(months).toContainText('3 months');
    await expect(months.getByRole('button', { name: 'Change' })).toBeVisible();

    const calendar = page.getByRole('region', { name: 'DCC calendar' });
    await expect(calendar).toContainText('Ready to 31 Oct 2027');
    await expect(calendar).toContainText('Starts Sunday 5 Jan 2025.');
    await expect(calendar.getByRole('button')).toHaveCount(0);

    const encoding = page.getByRole('region', { name: 'Initial encoding' });
    await expect(encoding).toContainText('Open');
    await expect(encoding.getByRole('button', { name: 'Close Encoding' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Add an Encounter season' })).toBeVisible();
  });

  test('changes the months with a key and shows the new value', async ({ page }) => {
    const traffic = await mockSettings(page);
    await mockEncounterSeasons(page);
    await openAdmin(page, '/admin?tab=settings');

    const months = page.getByRole('region', { name: 'No meeting in' });
    await months.getByRole('button', { name: 'Change' }).click();
    await months.getByLabel('Months').selectOption('4');
    await months.getByRole('button', { name: 'Save' }).click();

    await expect(months).toContainText('4 months');
    expect(traffic.writes).toHaveLength(1);
    expect(traffic.writes[0].path).toBe('/api/v1/settings/cell-attention-months');
    expect(traffic.writes[0].body).toEqual({ months: 4 });
    expect(traffic.writes[0].key).toBeTruthy();
  });

  test('closes encoding only after the dialog is confirmed, and offers no way back', async ({
    page,
  }) => {
    const traffic = await mockSettings(page);
    await mockEncounterSeasons(page);
    await openAdmin(page, '/admin?tab=settings');

    const encoding = page.getByRole('region', { name: 'Initial encoding' });
    await encoding.getByRole('button', { name: 'Close Encoding' }).click();
    const dialog = page.getByRole('dialog', { name: 'Close initial encoding?' });
    await expect(dialog).toContainText('It cannot be opened again.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(traffic.writes).toHaveLength(0);

    await encoding.getByRole('button', { name: 'Close Encoding' }).click();
    await dialog.getByRole('button', { name: 'Close Encoding' }).click();

    await expect(encoding).toContainText('Closed');
    await expect(encoding.getByRole('button')).toHaveCount(0);
    expect(traffic.writes.map((write) => write.path)).toEqual([
      '/api/v1/settings/initial-encoding/close',
    ]);
  });

  test('Home carries how far the DCC calendar reaches, linking to Settings', async ({ page }) => {
    await mockSettings(page);
    await openAdmin(page);

    const line = page.getByText('Ready to 31 Oct 2027');
    await expect(line).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
      'href',
      '/admin?tab=settings',
    );
  });
  test('sends a new key for each change, so changing back is saved and not replayed', async ({
    page,
  }) => {
    // Found on the live site, 2026-11-02: a key built from the value alone made 4, 3, 4 send
    // the first save's key again, and the server answered it from its store, saving nothing.
    const traffic = await mockSettings(page);
    await mockEncounterSeasons(page);
    await openAdmin(page, '/admin?tab=settings');

    const months = page.getByRole('region', { name: 'No meeting in' });
    for (const value of ['4', '3', '4']) {
      await months.getByRole('button', { name: 'Change' }).click();
      await months.getByLabel('Months').selectOption(value);
      await months.getByRole('button', { name: 'Save' }).click();
      await expect(months).toContainText(`${value} months`);
    }
    const verse = page.getByRole('region', { name: 'Verse on Record' });
    for (const reference of ['Test A 1:1 (KJV)', 'Test B 2:2 (KJV)', 'Test A 1:1 (KJV)']) {
      await verse.getByRole('button', { name: 'Change' }).click();
      await verse.getByLabel('Verse').fill(`Words for ${reference}.`);
      await verse.getByLabel('Reference').fill(reference);
      await verse.getByRole('button', { name: 'Save' }).click();
      await expect(verse).toContainText(reference);
    }

    const keys = traffic.writes.map((write) => write.key);
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
  });

  test('changes the verse with a key, and empty boxes clear it', async ({ page }) => {
    const traffic = await mockSettings(page);
    await mockEncounterSeasons(page);
    await openAdmin(page, '/admin?tab=settings');

    const verse = page.getByRole('region', { name: 'Verse on Record' });
    await expect(verse).toContainText('1 Peter 5:2 (NIV)');
    await verse.getByRole('button', { name: 'Change' }).click();
    await expect(verse.getByLabel('Verse')).toHaveValue(RECORD_VERSE.text);
    await verse.getByLabel('Verse').fill('For God so loved the world.');
    await verse.getByLabel('Reference').fill('John 3:16 (NIV)');
    await verse.getByRole('button', { name: 'Save' }).click();
    await expect(verse).toContainText('John 3:16 (NIV)');

    await verse.getByRole('button', { name: 'Change' }).click();
    await verse.getByLabel('Verse').fill('');
    await verse.getByLabel('Reference').fill('');
    await verse.getByRole('button', { name: 'Save' }).click();
    await expect(verse).toContainText('No verse');

    expect(traffic.writes.map((write) => [write.path, write.body])).toEqual([
      [
        '/api/v1/settings/record-verse',
        { text: 'For God so loved the world.', reference: 'John 3:16 (NIV)' },
      ],
      ['/api/v1/settings/record-verse', { text: null, reference: null }],
    ]);
    expect(traffic.writes.every((write) => write.key)).toBe(true);
  });
});

test.describe('the verse on Record (decision 0425)', () => {
  test('sits under the welcome, with its reference', async ({ page }) => {
    await mockSignedIn(page);
    await mockRecordVerse(page);
    await page.goto('/dashboard');

    const verse = page.locator('main figure');
    await expect(verse.locator('blockquote')).toHaveText(`“${RECORD_VERSE.text}”`);
    await expect(verse.locator('figcaption')).toHaveText('1 Peter 5:2 (NIV)');
  });

  test('draws nothing when no verse is set', async ({ page }) => {
    await mockSignedIn(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Welcome, Marilou' })).toBeVisible();
    await expect(page.locator('main figure')).toHaveCount(0);
  });

});

test.describe('Inactive N+ Months carries the setting (decision 0425)', () => {
  test('on Home and on Cells, before the list is opened', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAdmin(page);
    // Installed after the Admin area's own counts, so this answer wins.
    await page.route('**/api/v1/cells/counts', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ in_scope: 186, led_by_me: 0, attention_months: 4 }),
      }),
    );
    await page.reload();

    await expect(page.getByRole('link', { name: 'Inactive 4+ Months' })).toHaveAttribute(
      'href',
      '/cells?view=QUIET',
    );
    await expect(page.getByRole('link', { name: 'Inactive 3+ Months' })).toHaveCount(0);
  });

  test('offers two to six months, three the usual', async ({ page }) => {
    await mockSettings(page);
    await mockEncounterSeasons(page);
    await openAdmin(page, '/admin?tab=settings');

    const months = page.getByRole('region', { name: 'No meeting in' });
    await months.getByRole('button', { name: 'Change' }).click();
    await expect(months.getByLabel('Months').locator('option')).toHaveText([
      '2 months',
      '3 months (usual)',
      '4 months',
      '5 months',
      '6 months',
    ]);
  });
});
