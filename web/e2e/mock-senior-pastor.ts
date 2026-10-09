import type { Page } from '@playwright/test';

/**
 * The two Senior Pastors' Reports and Trends (decisions 0326 and 0327), answered as the API
 * answers them. Every name is invented (CLAUDE.md, Secrets).
 *
 * **The order is the server's and is built to tell a client that re-sorts it apart**, as the
 * Recording status fixture is: the Men's root comes first although his name sorts after the
 * Women's root's, and a table's rows are in surname order while their figures are not.
 */
function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

export const SP_MENS_ROOT = {
  id: '3f1b7c6e-0000-4000-8000-000000000c01',
  member_id: 'M-000911',
  full_name: 'Bishop Teodulo Villareal',
};
export const SP_WOMENS_ROOT = {
  id: '3f1b7c6e-0000-4000-8000-000000000c02',
  member_id: 'M-000912',
  full_name: 'Pastora Amparo Lacson',
};
export const SP_PRIMARIES = {
  abad: { id: '3f1b7c6e-0000-4000-8000-000000000d01', member_id: 'M-000921', full_name: 'Bernardo Abad' },
  ocampo: { id: '3f1b7c6e-0000-4000-8000-000000000d02', member_id: 'M-000922', full_name: 'Celestino Ocampo' },
  bautista: { id: '3f1b7c6e-0000-4000-8000-000000000d03', member_id: 'M-000923', full_name: 'Felicidad Bautista' },
};

function figures(cells: [number, number, number], leaders: number, people: number) {
  const [youth, youngPro, couple] = cells;
  return {
    cell_groups: youth + youngPro + couple,
    youth,
    young_pro: youngPro,
    couple,
    cell_leaders: leaders,
    people,
  };
}

/**
 * `GET /reports/church-counts`, the same counts for any month (decision 0326), adding up as
 * the API's must: the rows and *Others* are the whole church, field by field.
 */
export function churchCounts(period: string, current: boolean) {
  return {
    period,
    current,
    at: current ? '2026-10-08T02:00:00.000Z' : '2026-09-30T15:59:59.999Z',
    whole_church: figures([1, 3, 1], 5, 36),
    tables: [
      {
        root: SP_MENS_ROOT,
        network: 'MENS',
        rows: [
          { leader: SP_PRIMARIES.abad, ...figures([0, 2, 0], 2, 6) },
          { leader: SP_PRIMARIES.ocampo, ...figures([0, 0, 0], 0, 11) },
        ],
      },
      {
        root: SP_WOMENS_ROOT,
        network: 'WOMENS',
        rows: [{ leader: SP_PRIMARIES.bautista, ...figures([1, 1, 0], 2, 16) }],
      },
    ],
    others: figures([0, 0, 1], 1, 3),
  };
}

/** Answers every month as {@link churchCounts}, October 2026 being current; returns the periods asked. */
export async function mockChurchCounts(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/api/v1/reports/church-counts?*', (route) => {
    const period = new URL(route.request().url()).searchParams.get('period') ?? '2026-10-01';
    asked.push(period);
    return route.fulfill(json(churchCounts(period, period === '2026-10-01')));
  });
  return asked;
}

const MONTHS = [
  '2025-11-01',
  '2025-12-01',
  '2026-01-01',
  '2026-02-01',
  '2026-03-01',
  '2026-04-01',
  '2026-05-01',
  '2026-06-01',
  '2026-07-01',
  '2026-08-01',
  '2026-09-01',
  '2026-10-01',
];

/**
 * `GET /reports/trends` (decisions 0326 and 0327): twelve months ending with October 2026, the
 * church then the Men's and Women's branches, or one leader's branch where one is named.
 * March could not be read, so every line has a gap there. Returns the queries asked.
 */
export async function mockTrends(page: Page): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  await page.route('**/api/v1/reports/trends?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push(params);
    const series = (scale: number) =>
      MONTHS.map((_, index) => (index === 4 ? null : Math.round((index + 1) * scale)));
    const leaderId = params.get('leader_id');
    const leader = Object.values(SP_PRIMARIES).find((person) => person.id === leaderId);

    return route.fulfill(
      json({
        figure: params.get('figure') ?? 'CG',
        months: MONTHS,
        current: '2026-10-01',
        lines:
          leader === undefined
            ? [
                { leader: null, values: series(3) },
                { leader: SP_MENS_ROOT, values: series(1.5) },
                { leader: SP_WOMENS_ROOT, values: series(1.2) },
              ]
            : [{ leader, values: series(0.5) }],
      }),
    );
  });
  return asked;
}

function stages(vip: number, second: number, third: number, fourth: number, regular: number) {
  return {
    unique_people: vip + second + third + fourth + regular,
    classification: {
      vip,
      second_timer: second,
      third_timer: third,
      fourth_timer: fourth,
      regular,
    },
  };
}

/**
 * `GET /reports/{cells,dcc}/twelve?rows=ROOT_LEADERS` (decision 0326): the whole church's
 * figures with each root's direct disciples as the rows. Registered after any other twelve
 * mock, so it answers only the Senior Pastors' request and lets the rest fall through.
 */
export async function mockRootLeadersTwelve(page: Page): Promise<void> {
  for (const report of ['cells', 'dcc']) {
    await page.route(`**/api/v1/reports/${report}/twelve*`, (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('rows') !== 'ROOT_LEADERS') {
        return route.fallback();
      }
      return route.fulfill(
        json({
          kind: params.get('kind') ?? 'MONTH',
          start: params.get('start') ?? '2026-10-01',
          end: '2026-10-31',
          open: true,
          coverage:
            report === 'cells'
              ? { recorded: 6, scheduled: 8, through: '2026-10-31' }
              : { met: 3, owed: 4 },
          n: 4,
          removed_events: [],
          buckets: null,
          calendar_start: '2025-01-05',
          roots: [
            { ...SP_MENS_ROOT, network: 'MENS' },
            { ...SP_WOMENS_ROOT, network: 'WOMENS' },
          ],
          rows: [
            { leader: SP_PRIMARIES.abad, root_id: SP_MENS_ROOT.id, ...stages(1, 1, 0, 0, 2) },
            { leader: SP_PRIMARIES.ocampo, root_id: SP_MENS_ROOT.id, ...stages(0, 0, 1, 0, 0) },
            { leader: SP_PRIMARIES.bautista, root_id: SP_WOMENS_ROOT.id, ...stages(2, 0, 0, 1, 1) },
          ],
          own: null,
          overlap: 0,
          elsewhere: 1,
          total: stages(3, 1, 1, 1, 4),
        }),
      );
    });
  }
}
