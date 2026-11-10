import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockDccEvents, mockDccRoster, mockMeetingRoster } from './mock-attendance';

/**
 * A marking row must leave a name room to be read. Beside Present and Absent, the frames
 * nested around a row left a name 28px at 360 wide, broken every two or three letters, and
 * the sideways-scroll check could not see it: nothing was wider than the page.
 */

const LONG_NAME = 'Rosalinda Angelica C. Ocampo';
const ROW = '[role=group][aria-labelledby$="-legend"]';

const SCREENS = [
  {
    screen: 'DCC checklist',
    open: async (page: Page) => {
      await mockDccEvents(page);
      await mockDccRoster(page);
      await page.goto('/dcc/3f1b7c6e-0000-4000-8000-000000000501');
    },
  },
  {
    screen: 'Cell meeting',
    open: async (page: Page) => {
      await mockMeetingRoster(page);
      await page.goto('/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27');
    },
  },
];

async function measure(page: Page) {
  await page.locator(ROW).first().waitFor();
  return page.evaluate(
    ([selector, name]) => {
      const row = document.querySelector<HTMLElement>(selector)!;
      const label = row.querySelector<HTMLElement>('[id$="-legend"]')!;
      label.textContent = name;
      const nameBox = label.getBoundingClientRect();
      const labels = [...row.querySelectorAll('label')];
      const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight);
      return {
        nameWidth: nameBox.width,
        nameBottom: nameBox.bottom,
        nameLines: Math.round(nameBox.height / lineHeight),
        choicesTop: Math.min(...labels.map((l) => l.getBoundingClientRect().top)),
        choicesRight: Math.max(...labels.map((l) => l.getBoundingClientRect().right)),
        rowRight: row.getBoundingClientRect().right,
        clipped: labels.some((l) => l.scrollWidth > l.clientWidth),
      };
    },
    [ROW, LONG_NAME] as const,
  );
}

for (const { screen, open } of SCREENS) {
  for (const width of [320, 344, 360, 375, 393, 412, 430, 639]) {
    test(`${screen}: at ${width} a name has its own line above the choices`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockSignedIn(page);
      await open(page);

      const row = await measure(page);
      expect(row.choicesTop).toBeGreaterThanOrEqual(row.nameBottom);
      expect(row.nameLines).toBeLessThanOrEqual(2);
      expect(row.choicesRight).toBeLessThanOrEqual(row.rowRight + 0.5);
      expect(row.clipped).toBe(false);
    });
  }

  for (const width of [320, 360]) {
    test(`${screen}: at ${width} with larger text a name stays readable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockSignedIn(page);
      await open(page);
      await page.addStyleTag({ content: 'html { font-size: 150%; }' });

      const row = await measure(page);
      expect(row.choicesTop).toBeGreaterThanOrEqual(row.nameBottom);
      expect(row.nameLines).toBeLessThanOrEqual(5);
      expect(row.choicesRight).toBeLessThanOrEqual(row.rowRight + 0.5);
      expect(row.clipped).toBe(false);
    });
  }

  for (const width of [640, 690, 820, 1280]) {
    test(`${screen}: at ${width} the choices stay beside the name`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockSignedIn(page);
      await open(page);

      const row = await measure(page);
      expect(row.choicesTop).toBeLessThan(row.nameBottom);
      expect(row.nameWidth).toBeGreaterThanOrEqual(100);
    });
  }

  test(`${screen}: at 1024, in two columns, a name still has room`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await mockSignedIn(page);
    await open(page);

    const row = await measure(page);
    expect(row.choicesTop).toBeGreaterThanOrEqual(row.nameBottom);
    expect(row.nameWidth).toBeGreaterThanOrEqual(100);
  });
}
