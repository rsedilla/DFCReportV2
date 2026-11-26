import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { ATTENDANCE_IDS, mockMyClasses, mockSolAttendance, mockTeacher } from './mock-equipping';

/**
 * SOL 1's register (SKILL.md section 29, decision 0514, points 8 to 10, and the owner's rulings of
 * 2026-11-26): ten lessons and *Quiz and book*, the memory verse and devotional ticked with each
 * lesson and at the make-up, *Verses and devotionals still owed*, and *Record so far*. Every name
 * is invented.
 */

async function openClass(page: Page, width = 1280, options: { notCounted?: boolean } = {}) {
  await page.setViewportSize({ width, height: 1000 });
  await mockSignedIn(page);
  await mockTeacher(page, 'RECORDING');
  await mockMyClasses(page);
  const mocked = await mockSolAttendance(page, options);
  await page.goto(`/equipping/teach/${ATTENDANCE_IDS.classId}`);
  await expect(page.getByRole('heading', { name: 'SOL 1 A', level: 1 })).toBeVisible();
  return mocked;
}

test('reads ten lessons and Quiz and book, and ticks the verse and devotional of whoever came', async ({ page }) => {
  const { sent } = await openClass(page);
  const tabs = page.getByRole('group', { name: 'Choose a lesson' }).getByRole('button');
  await expect(tabs).toHaveCount(11);
  await expect(tabs.last()).toContainText('Quiz and book');
  await expect(page.getByText('ENC', { exact: true })).toHaveCount(0);

  await expect(
    page.getByText('Tick who came, who recited the memory verse, and who handed in the devotional.', { exact: false }),
  ).toBeVisible();
  const table = page.getByRole('table', { name: 'Who came to lesson 3' });
  await expect(table.getByRole('columnheader')).toContainText(['Came', 'Name', 'Memory verse', 'Devotional']);
  await table.getByRole('checkbox', { name: 'Efren Quiambao came' }).check();
  await table.getByRole('checkbox', { name: 'Efren Quiambao recited the memory verse' }).check();
  // Not ticked as came: their two are ticked when they make the lesson up.
  await expect(table.getByRole('row', { name: /Tolentino, Imelda/ })).toContainText('At make-up');
  await expect(page.getByRole('status').filter({ hasText: 'came' })).toContainText(
    '1 came · 1 absent: Imelda Tolentino (Cell leader none) · Memory verse 1 · Devotional 0',
  );
  await page.getByRole('button', { name: 'Save lesson 3' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/lessons\/3$/);
  expect(sent[0].body).toMatchObject({ came: [ATTENDANCE_IDS.efren], verse: [ATTENDANCE_IDS.efren], devotional: [] });
});

test('a make-up ticks the verse and devotional of the lesson made up', async ({ page }) => {
  const { sent } = await openClass(page);
  await page.getByRole('region', { name: /Make-ups still owed/ }).getByRole('button', { name: 'Record make-up' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make-up for Efren Quiambao · L2' });
  await dialog.getByRole('checkbox', { name: 'Recited the L2 memory verse' }).check();
  await expect(dialog.getByRole('checkbox', { name: 'Handed in the L2 devotional' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Record make-up' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toMatchObject({ enrollment_id: ATTENDANCE_IDS.efren, lesson: 2, verse: true, devotional: false });
});

test('Verses and devotionals still owed lists what is owed, and ticks what is brought', async ({ page }) => {
  const { sent } = await openClass(page);
  const card = page.getByRole('region', { name: /Verses and devotionals still owed/ });
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Verses and devotionals still owed · 1');
  const row = card.getByRole('listitem').filter({ hasText: 'Tolentino, Imelda' });
  await expect(row).toContainText('Tolentino, Imelda · L1 devotional, L2 devotional');
  await expect(row).toContainText('Cell leader none · owed since 3 November 2026 · owed since the L2 make-up, 20 November 2026');
  await row.getByRole('button', { name: /Tick what is brought/ }).click();
  const dialog = page.getByRole('dialog', { name: 'What Imelda Tolentino brought' });
  await dialog.getByRole('checkbox', { name: 'Handed in the L1 devotional' }).check();
  await dialog.getByRole('button', { name: 'Tick what is brought' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/items-brought$/);
  expect(sent[0].body).toMatchObject({ enrollment_id: ATTENDANCE_IDS.imelda, lesson: 1, items: ['DEVOTIONAL'] });
});

test('Quiz and book keeps every score, offers a retake after a failed try, and ticks the book', async ({ page }) => {
  const { sent } = await openClass(page);
  await page.getByRole('button', { name: /Quiz and book/ }).click();
  // Fixed once a score is recorded.
  await expect(page.getByLabel('Quiz items')).toBeDisabled();
  const table = page.getByRole('table', { name: 'Quiz tries and book, student by student' });
  const efren = table.getByRole('row', { name: /Quiambao, Efren/ });
  await expect(efren).toContainText('Try 1: 15 of 20 · 75%');
  await expect(efren).toContainText('✓ Passed');
  await expect(efren.getByRole('button', { name: /Add a retake/ })).toHaveCount(0);
  const imelda = table.getByRole('row', { name: /Tolentino, Imelda/ });
  await expect(imelda).toContainText('Not yet passed · 2 retakes left');

  await imelda.getByRole('button', { name: /Add a retake/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Score for try 2 · Imelda Tolentino' });
  await dialog.getByLabel('Score out of 20').fill('15');
  await expect(dialog.getByRole('status')).toHaveText('75% · passes');
  await dialog.getByRole('button', { name: 'Save score' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({ enrollment_id: ATTENDANCE_IDS.imelda, try: 2, score: 15 });

  await imelda.getByRole('checkbox', { name: 'Imelda Tolentino read the book' }).check();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].body).toEqual({ enrollment_id: ATTENDANCE_IDS.imelda, read: true });
});

test('every try carries its own Correct, and a corrected try says what it replaced', async ({ page }) => {
  const { sent } = await openClass(page);
  await page.getByRole('button', { name: /Quiz and book/ }).click();
  const table = page.getByRole('table', { name: 'Quiz tries and book, student by student' });
  const efren = table.getByRole('row', { name: /Quiambao, Efren/ });
  await expect(efren).toContainText('Corrected from 12 by Ada Ramos, 20 November 2026');
  // No single Correct try N button any more: the try carries it.
  await expect(table.getByRole('button', { name: /^Correct try \d$/ })).toHaveCount(0);
  await efren.getByRole('button', { name: 'Correct try 1 for Efren Quiambao' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct try 1 · Efren Quiambao' });
  await expect(dialog).toContainText('Recorded as 15 of 20. The score it replaces is kept.');
  await dialog.getByLabel('Score out of 20').fill('16');
  await dialog.getByRole('button', { name: 'Save correction' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({ enrollment_id: ATTENDANCE_IDS.efren, try: 1, score: 16 });
});

test('a try left behind by a pass is struck through, kept and not counted', async ({ page }) => {
  await openClass(page, 1280, { notCounted: true });
  await page.getByRole('button', { name: /Quiz and book/ }).click();
  const efren = page
    .getByRole('table', { name: 'Quiz tries and book, student by student' })
    .getByRole('row', { name: /Quiambao, Efren/ });
  await expect(efren.locator('s')).toHaveText('Try 2: 13 of 20 · 65%');
  await expect(efren).toContainText('Not counted: try 1 passed. Kept in history.');
  await expect(efren.getByRole('button', { name: /Correct try 2/ })).toHaveCount(0);
});

test('a tick brought late is listed with who ticked it, and Untick sends it back', async ({ page }) => {
  const { sent } = await openClass(page);
  const card = page.getByRole('region', { name: /Verses and devotionals still owed/ });
  await expect(card.getByRole('heading', { name: 'Brought late · 1' })).toBeVisible();
  const row = card.getByRole('listitem').filter({ hasText: 'L1 devotional' }).filter({ hasText: 'Quiambao, Efren' });
  await expect(row).toContainText('Brought 24 November 2026 · ticked by Ada Ramos');
  await row.getByRole('button', { name: 'Untick L1 devotional for Efren Quiambao' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/items-brought\/untick$/);
  expect(sent[0].body).toEqual({ enrollment_id: ATTENDANCE_IDS.efren, lesson: 1, item: 'DEVOTIONAL' });
});

test('Record so far counts verses and devotionals out of ten and says what is still missing', async ({ page }) => {
  await openClass(page);
  const record = page.getByRole('table', { name: 'Record so far, lesson by lesson' });
  await expect(record.getByRole('columnheader')).toContainText(['Student', 'L1', 'L10', 'Verses', 'Devotionals', 'Quiz', 'Book', 'Still missing']);
  const imelda = record.getByRole('row', { name: /Tolentino, Imelda/ });
  await expect(imelda).toContainText('2 of 10');
  await expect(imelda).toContainText('L1 devotional, L2 devotional, quiz, book');
  await expect(record.getByRole('row', { name: /Quiambao, Efren/ })).toContainText('L2 make-up');
});

test('on a phone each card carries the two ticks under the name', async ({ page }) => {
  await openClass(page, 390);
  await page.getByRole('checkbox', { name: 'Everyone came' }).check();
  await expect(page.getByRole('checkbox', { name: 'All recited the verse' }).first()).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Imelda Tolentino handed in the devotional' }).first().check();
  await expect(page.getByRole('checkbox', { name: 'Imelda Tolentino handed in the devotional' }).first()).toBeChecked();
});
