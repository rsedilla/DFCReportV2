import { expect, test, type Page } from '@playwright/test';

import {
  PERSON_IN_SCOPE,
  mockAdministrator,
  mockGrants,
  mockPeople,
  mockScreens,
  mockSignedIn,
} from './mock-api';
import { CELL_WITH_MEETINGS, mockCellMeetings, mockCellMembers } from './mock-attendance';
import { mockPersonGrowth } from './mock-growth';

/**
 * A page not on an account's screens does not open, and no page that does open links to one
 * that does not (decision 0379). The guard keys on the screens the server names and on
 * capabilities; the API still decides every request.
 */
const NOTE = 'This page isn’t part of your screens';
const PERSON = `/people/${PERSON_IN_SCOPE.id}`;
const MEETINGS = `/cells/${CELL_WITH_MEETINGS.id}/meetings`;
const MEMBERS = `/cells/${CELL_WITH_MEETINGS.id}/members`;

type Account = 'FULL' | 'ADMIN' | 'SENIOR_PASTOR' | 'RECORDING';

async function as(page: Page, account: Account) {
  await mockSignedIn(page);
  await mockPeople(page);
  await mockCellMeetings(page);
  await mockCellMembers(page);
  if (account === 'ADMIN') await mockAdministrator(page);
  if (account === 'SENIOR_PASTOR' || account === 'RECORDING') await mockScreens(page, account);
}

async function expectNote(page: Page, shown: boolean) {
  // The page's own heading arrives either way; the note's is checked once the shell has decided.
  await expect(page.locator('main')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: NOTE })).toHaveCount(shown ? 1 : 0);
}

// Which pages open for which screens: the routing table, one address at a time.
const TABLE: readonly [Account, string, boolean][] = [
  ['SENIOR_PASTOR', PERSON, true],
  ['SENIOR_PASTOR', `${PERSON}/network`, true],
  ['SENIOR_PASTOR', MEETINGS, true],
  ['SENIOR_PASTOR', MEMBERS, true],
  ['SENIOR_PASTOR', '/people', false],
  ['SENIOR_PASTOR', '/cells', false],
  ['SENIOR_PASTOR', '/cells/new', false],
  ['SENIOR_PASTOR', '/growth/suynl', false],
  ['SENIOR_PASTOR', '/reports/suynl', false],
  ['RECORDING', PERSON, true],
  ['RECORDING', MEETINGS, true],
  ['RECORDING', '/my-cell', true],
  ['RECORDING', '/cells', false],
  ['RECORDING', '/cells/new', false],
  ['RECORDING', '/growth/training/encounters', true],
  ['RECORDING', '/reports/dcc', false],
  ['FULL', '/cells', true],
  ['FULL', '/cells/new', false],
  ['FULL', '/my-cell', false],
  ['FULL', '/growth/training/encounters', true],
  ['FULL', '/growth/training', false],
  ['FULL', '/reports/suynl', false],
  ['FULL', '/trends', true],
  ['ADMIN', '/growth/training/encounters', true],
  ['ADMIN', '/reports/suynl', true],
  ['ADMIN', '/trends', false],
  ['ADMIN', '/network', false],
];

for (const [account, address, opens] of TABLE) {
  test(`${address} ${opens ? 'opens' : 'shows the note'} for ${account}`, async ({ page }) => {
    await as(page, account);
    await page.goto(address);
    await expectNote(page, !opens);
  });
}

test('a Senior Pastor’s person page links to no page they do not have', async ({ page }) => {
  await as(page, 'SENIOR_PASTOR');
  // The Senior Pastor role reads SUYNL and Training at Whole Church, so the person page's
  // Growth frame is drawn for them, without its links (decision 0379).
  await mockScreens(page, 'SENIOR_PASTOR', {
    wholeChurch: ['suynl.view_subtree', 'training.view_subtree'],
  });
  await mockPersonGrowth(page);
  await page.goto(PERSON);
  await expect(page.getByRole('heading', { name: PERSON_IN_SCOPE.full_name })).toBeVisible();
  await expect(page.getByText(/of 10 lessons/)).toBeVisible();

  await expect(page.getByRole('link', { name: 'Back to people' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'People' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit details' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open SUYNL' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Training' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Where they sit' })).toBeVisible();
});

test('a Full view leader’s person page keeps its People tabs and Back to people', async ({ page }) => {
  await as(page, 'FULL');
  await page.goto(PERSON);
  await expect(page.getByRole('heading', { name: PERSON_IN_SCOPE.full_name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to people' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'People' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit details' })).toBeVisible();
});

test('a Senior Pastor’s Cell pages offer no Cells tab, no change buttons, and Back to Update Records', async ({
  page,
}) => {
  await as(page, 'SENIOR_PASTOR');
  await page.goto(MEETINGS);
  await expect(page.getByRole('link', { name: 'Back to Update Records' })).toHaveAttribute(
    'href',
    '/dashboard?list=awaiting',
  );
  await expect(page.getByRole('button', { name: 'Change when it meets' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change category' })).toHaveCount(0);

  await page.goto(MEMBERS);
  await expect(page.getByRole('link', { name: 'Active Cells' })).toHaveCount(0);
});

test('the change buttons are offered only with cell.manage_configuration', async ({ page }) => {
  await as(page, 'FULL');
  await page.goto(MEETINGS);
  await expect(page.getByRole('link', { name: 'Back to Cells' })).toHaveAttribute('href', '/cells');
  await expect(page.getByRole('button', { name: 'Change when it meets' })).toHaveCount(0);

  await mockGrants(page, ['cell.manage_configuration']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Change when it meets' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change category' })).toBeVisible();
});

test('on the recording screens a Cell’s page goes back to My Cell', async ({ page }) => {
  await as(page, 'RECORDING');
  await page.goto(MEETINGS);
  await expect(page.getByRole('link', { name: 'Back to Cells' })).toHaveAttribute('href', '/my-cell');
});

test('the note names the account’s screens, marks no item current, and leads to its start', async ({
  page,
}) => {
  await as(page, 'RECORDING');
  await page.goto('/cells');
  await expect(page.getByRole('heading', { name: NOTE })).toBeVisible();
  await expect(page.getByText('Your screens are Record, People, Cells and SUYNL.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Go to your start screen' })).toHaveAttribute(
    'href',
    '/dashboard',
  );
});
