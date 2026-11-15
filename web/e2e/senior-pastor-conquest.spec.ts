import { expect, test, type Page } from '@playwright/test';

import { mockScreens, mockSignedIn } from './mock-api';
import { mockConquest } from './mock-growth';
import {
  SP_MENS_ROOT,
  SP_PRIMARIES,
  SP_WOMENS_ROOT,
  mockChurchCounts,
} from './mock-senior-pastor';

/**
 * The Senior Pastors' Conquest (decision 0494): each tab opens on the reader's own Network's 12,
 * and a name with people beneath them goes a level down. Names are invented (CLAUDE.md, Secrets).
 */

const OCTOBER_8 = new Date('2026-10-08T02:00:00Z');

function json(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

const goal = (reached: string | null, now?: number) => ({
  reached_on: reached,
  ...(now === undefined ? {} : { now }),
});
const goals = (win: number) => ({
  win_3: goal(win >= 3 ? '2026-09-01' : null, win),
  open_a_cell: goal(null),
  completion_of_12: goal(null, 0),
  raise_12_leaders: goal(null, 0),
});
const figures = (people: number, win3: number) => ({
  people,
  win_3: win3,
  open_a_cell: 0,
  completion_of_12: 0,
  raise_12_leaders: 0,
});
const person = (entry: { id: string; full_name: string }) => ({
  id: entry.id,
  full_name: entry.full_name,
  first_name: entry.full_name.split(' ')[0],
  last_name: entry.full_name.split(' ').slice(-1)[0],
});

/** `GET /conquest/branches`, keeping each query string asked for. */
async function mockBranches(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/api/v1/conquest/branches*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push(params.toString());
    const leader = params.get('leader_id');
    if (leader === SP_PRIMARIES.abad.id) {
      return route.fulfill(
        json({
          network: null,
          total: figures(3, 1),
          tables: [
            {
              root: person(SP_PRIMARIES.abad),
              network: null,
              rows: [
                {
                  leader: person(SP_PRIMARIES.ocampo),
                  has_disciples: false,
                  goals: goals(1),
                  ...figures(1, 0),
                },
                {
                  leader: person(SP_PRIMARIES.bautista),
                  has_disciples: false,
                  goals: goals(3),
                  ...figures(1, 1),
                },
              ],
              own: { goals: goals(0), ...figures(1, 0) },
            },
          ],
          others: figures(0, 0),
        }),
      );
    }
    const root = params.get('network') === 'WOMENS' ? SP_WOMENS_ROOT : SP_MENS_ROOT;
    return route.fulfill(
      json({
        network: params.get('network'),
        total: figures(5, 1),
        tables: [
          {
            root: person(root),
            network: params.get('network'),
            rows: [
              {
                leader: person(SP_PRIMARIES.abad),
                has_disciples: true,
                goals: goals(0),
                ...figures(3, 1),
              },
            ],
            own: { goals: goals(0), ...figures(1, 0) },
          },
        ],
        others: figures(1, 0),
      }),
    );
  });
  return asked;
}

async function asBishop(page: Page) {
  await page.clock.setFixedTime(OCTOBER_8);
  await mockSignedIn(page);
  await mockScreens(page, 'SENIOR_PASTOR', { personId: SP_MENS_ROOT.id });
  await mockChurchCounts(page);
  const traffic = await mockConquest(page);
  const asked = await mockBranches(page);
  return { traffic, asked };
}

const which = (page: Page) => page.getByRole('group', { name: 'Which Network' });
const MENS_TABLE = `${SP_MENS_ROOT.full_name}’s leaders`;

test.describe('the Senior Pastors’ Conquest (decision 0494)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('opens on the Bishop’s own Network’s 12, with no list beneath', async ({ page }) => {
    const { traffic, asked } = await asBishop(page);

    await page.goto('/conquest');

    await expect(which(page).getByRole('button')).toHaveText(['Men', 'Women', 'Both']);
    const table = page.getByRole('table', { name: MENS_TABLE });
    await expect(table).toBeVisible();
    await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText([
      SP_PRIMARIES.abad.full_name,
      '0 of 3 so far',
      '1',
      '3',
    ]);
    // The root's own row and a Total of the two close it; Others follows, and the rows, the root's
    // own row and Others are the box's 5: 3 + 1 + 1.
    await expect(table.getByRole('row').last().getByRole('cell')).toHaveText(['Total', '', '1', '4']);
    await expect(page.getByText('Others: 0 reached, of 1 person.')).toBeVisible();
    await expect.poll(() => asked).toContain('network=MENS');
    expect(traffic.lists).toEqual([]);
  });

  test('goes a level down and back, keeping the tab', async ({ page }) => {
    await asBishop(page);
    await page.goto('/conquest');

    await page.getByRole('link', { name: SP_PRIMARIES.abad.full_name }).click();
    await expect(page).toHaveURL(new RegExp(`leader=${SP_PRIMARIES.abad.id}`));
    const twelve = page.getByRole('table', { name: `${SP_PRIMARIES.abad.full_name}’s 12` });
    await expect(twelve).toBeVisible();
    // Nobody beneath them, so their names are plain text.
    await expect(twelve.getByRole('link')).toHaveCount(0);
    const reached = twelve.getByRole('row').nth(2).getByRole('cell').nth(1);
    await expect(reached).toContainText('Reached Sept 2026');
    await expect(reached).toContainText('3 of 3 now');

    await page.getByRole('link', { name: 'Raise 12 Leaders' }).click();
    await expect(page).toHaveURL(new RegExp(`goal=RAISE_12_LEADERS.*leader=${SP_PRIMARIES.abad.id}`));
    await expect(twelve).toBeVisible();

    await page.getByRole('link', { name: 'Back to Conquest' }).click();
    await expect(page.getByRole('table', { name: MENS_TABLE })).toBeVisible();
    await expect(page).toHaveURL(/goal=RAISE_12_LEADERS/);
  });

  test('a search shows the list as before', async ({ page }) => {
    const { traffic } = await asBishop(page);
    await page.goto('/conquest?q=Ber');

    await expect(page.getByRole('table', { name: MENS_TABLE })).toHaveCount(0);
    await expect.poll(() => traffic.lists.length).toBeGreaterThan(0);
  });

  test('on a phone each leader reads in lines beneath the name', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await asBishop(page);
    await page.goto('/conquest');

    const item = page.getByRole('listitem').filter({ hasText: SP_PRIMARIES.abad.full_name });
    await expect(item).toContainText('Their Win 3: 0 of 3 so far');
    await expect(item).toContainText('1 reached, of 3 people');
  });
});
