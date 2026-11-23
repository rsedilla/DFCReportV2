import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { ENCOUNTER_IDS, mockEncounter, mockRegistrar } from './mock-equipping';

/**
 * The Registrar's Encounter (SKILL.md section 29, decision 0501, point 14; decision 0507): one
 * Network's weekend, cleared students enrolled together before it, and who came from its first
 * day. Every name is invented.
 */

async function open(page: Page, phase: 'ENROLLING' | 'RECORDING' = 'ENROLLING') {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  const mocked = await mockEncounter(page, phase);
  await page.goto('/equipping/encounter');
  await expect(page.getByRole('heading', { name: 'Encounter', level: 1 })).toBeVisible();
  return mocked;
}

test('the Registrar has Encounter as a third item', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('link', { name: 'Encounter' }).first()).toBeVisible();
});

test('before the weekend, the cleared are ticked and enrolled together', async ({ page }) => {
  const { sent } = await open(page);
  await expect(
    page.getByRole('heading', { name: /Men’s Encounter · Friday 4 December 2026/ }),
  ).toBeVisible();
  const cleared = page.getByRole('region', { name: /Cleared · 4/ });
  await expect(cleared.getByRole('checkbox')).toHaveCount(4);
  await expect(cleared).toContainText('Missed the August Encounter');
  await expect(cleared).toContainText('23 on 4 December');

  await cleared.getByRole('checkbox', { name: 'Enroll Ramil Soriano' }).uncheck();
  await page.getByRole('button', { name: 'Enroll 3 in the Men’s Encounter' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({
    season_id: ENCOUNTER_IDS.season,
    network: 'MENS',
    enrollment_ids: [ENCOUNTER_IDS.efren, ENCOUNTER_IDS.nestor, ENCOUNTER_IDS.tomas].sort(),
  });
  await expect(
    page.getByRole('status').filter({ hasText: '3 enrolled in the Men’s Encounter.' }),
  ).toBeVisible();
});

test('a student owing a make-up or who can’t go has no tick, and says why', async ({ page }) => {
  await open(page);
  const needs = page.getByRole('region', { name: /Needs make-up · 1/ });
  await expect(needs).toContainText('L2 not made up yet.');
  await expect(needs.getByRole('checkbox')).toHaveCount(0);
  const cant = page.getByRole('region', { name: /Can’t go · 1/ });
  await expect(cant).toContainText('3 absences in lessons 1 to 4. Repeats Life Class.');
  await expect(cant.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('region', { name: /Waiting for lesson 4/ })).toContainText(
    'Life Class B',
  );
  await expect(page.getByRole('region', { name: /Enrolled · 2/ })).toContainText(
    'Jose Bautista, Wilfredo Tan',
  );
});

test('from the weekend’s first day, the Registrar saves who came', async ({ page }) => {
  const { sent } = await open(page, 'RECORDING');
  const form = page.getByRole('region', { name: /Who came to the Men’s Encounter/ });
  await expect(form.getByRole('checkbox')).toHaveCount(2);
  await expect(form.getByRole('checkbox', { name: /Jose Bautista/ })).toBeChecked();
  await expect(form.getByRole('status')).toHaveText('1 came · 1 did not: Wilfredo Tan');
  await expect(page.getByRole('button', { name: /^Enroll/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save who came' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({
    season_id: ENCOUNTER_IDS.season,
    network: 'MENS',
    came: [ENCOUNTER_IDS.jose],
  });
});
