import type { Page } from '@playwright/test';

/**
 * The two Growth tabs, SUYNL and Training (SKILL.md section 28; decisions 0278 to 0282).
 *
 * A companion to `mock-api.ts` and `mock-attendance.ts`, and a stand-in for the transport
 * in the same sense: nothing here decides anything. The shapes are the ones
 * `api/src/suynl/suynl.service.ts` and `api/src/training/training.service.ts` build.
 *
 * **Each tab carries the rows its screen has to handle specially**: a person part way
 * through, a person with nothing yet, a person who has done everything (SUYNL folds them
 * to one line), and a row the reader may not file for (`may_file: false`), which shows
 * marks rather than boxes.
 *
 * Names and identifiers are invented (`CLAUDE.md`, Secrets).
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const IN_PROGRESS_ID = '7a000000-0000-4000-8000-000000000001';
const NOT_STARTED_ID = '7a000000-0000-4000-8000-000000000002';
const GRADUATED_ID = '7a000000-0000-4000-8000-000000000003';
const NOT_MINE_ID = '7a000000-0000-4000-8000-000000000004';

/** The lesson row id a saved lesson carries, which is what an untick names as `seen_id`. */
export function suynlLessonId(person: string, lesson: number): string {
  return `7b000000-0000-4000-8${person.slice(-1)}00-${String(lesson).padStart(12, '0')}`;
}

function lessons(person: string, count: number, filedOn: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: suynlLessonId(person, index + 1),
    lesson: index + 1,
    filed_on: filedOn,
  }));
}

export const SUYNL_IN_PROGRESS = {
  person_id: IN_PROGRESS_ID,
  member_id: 'M-004101',
  full_name: 'Dalisay Soriano',
  lessons: lessons(IN_PROGRESS_ID, 2, '2026-09-06'),
  graduated_on: null,
  may_file: true,
};

export const SUYNL_NOT_STARTED = {
  person_id: NOT_STARTED_ID,
  member_id: 'M-004102',
  full_name: 'Ernani Pascual',
  lessons: [],
  graduated_on: null,
  may_file: true,
};

/** All ten, the tenth filed on 14 August, which is the day the row reads as graduated. */
export const SUYNL_GRADUATED = {
  person_id: GRADUATED_ID,
  member_id: 'M-004103',
  full_name: 'Lualhati Dizon',
  lessons: lessons(GRADUATED_ID, 10, '2026-08-14'),
  graduated_on: '2026-08-14',
  may_file: true,
};

/** Not the reader's to record, so this reader sees marks and no boxes. */
export const SUYNL_NOT_MINE = {
  person_id: NOT_MINE_ID,
  member_id: 'M-004104',
  full_name: 'Bayani Castillo',
  lessons: lessons(NOT_MINE_ID, 1, '2026-07-19'),
  graduated_on: null,
  may_file: false,
};

/** The three cards, adding up to the four people listed (decision 0281). */
export const SUYNL_COUNTS = { people: 4, not_started: 1, in_progress: 2, graduated: 1 };

export const TRAINING_TWO = {
  person_id: IN_PROGRESS_ID,
  member_id: 'M-004101',
  full_name: 'Dalisay Soriano',
  graduations: [
    { id: '7c000000-0000-4000-8000-000000000001', program: 'ENCOUNTER', graduated_on: '2026-03-08' },
    { id: '7c000000-0000-4000-8000-000000000002', program: 'LIFE_CLASS', graduated_on: null },
  ],
  may_file: true,
};

export const TRAINING_NONE = {
  person_id: NOT_STARTED_ID,
  member_id: 'M-004102',
  full_name: 'Ernani Pascual',
  graduations: [],
  may_file: true,
};

export const TRAINING_ALL = {
  person_id: GRADUATED_ID,
  member_id: 'M-004103',
  full_name: 'Lualhati Dizon',
  graduations: ['ENCOUNTER', 'LIFE_CLASS', 'SOL_1', 'SOL_2', 'SOL_3'].map((program, index) => ({
    id: `7c000000-0000-4000-8000-00000000001${index}`,
    program,
    graduated_on: `2025-0${index + 1}-15`,
  })),
  may_file: true,
};

export const TRAINING_NOT_MINE = {
  person_id: NOT_MINE_ID,
  member_id: 'M-004104',
  full_name: 'Bayani Castillo',
  graduations: [
    { id: '7c000000-0000-4000-8000-000000000021', program: 'ENCOUNTER', graduated_on: '2026-02-01' },
  ],
  may_file: false,
};

/** A card per school, which overlap, and one for people with none yet. */
export const TRAINING_COUNTS = {
  people: 4,
  not_started: 1,
  encounter: 3,
  life_class: 2,
  sol_1: 1,
  sol_2: 1,
  sol_3: 1,
};

export interface GrowthTraffic {
  /** Every list request's query string, in order. */
  lists: URLSearchParams[];
  /** Every submission: the body sent and its `Idempotency-Key`. */
  submitted: { body: { changes: Record<string, unknown>[] }; key: string | undefined }[];
}

/**
 * One tab's three routes. `outcome` decides what a submission answers: accepted as the
 * API accepts it (201 with its counts), or refused as a lost race is (409
 * `VERSION_CONFLICT`, with the message the SUYNL service writes).
 */
async function mockTab(
  page: Page,
  tab: 'suynl' | 'training',
  counts: unknown,
  rows: unknown[],
  outcome: 'accepted' | 'conflict',
): Promise<GrowthTraffic> {
  const traffic: GrowthTraffic = { lists: [], submitted: [] };

  await page.route(`**/api/v1/${tab}/counts`, (route) => route.fulfill(json(counts)));

  await page.route(`**/api/v1/${tab}/people?*`, (route) => {
    traffic.lists.push(new URL(route.request().url()).searchParams);
    return route.fulfill(json({ data: rows, next_cursor: null }));
  });

  await page.route(`**/api/v1/${tab}/submit`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }

    const body = route.request().postDataJSON() as GrowthTraffic['submitted'][number]['body'];
    const key = (await route.request().headerValue('idempotency-key')) ?? undefined;
    traffic.submitted.push({ body, key });

    if (outcome === 'conflict') {
      return route.fulfill(
        json(
          {
            error: {
              code: 'VERSION_CONFLICT',
              message:
                'Dalisay Soriano · lesson 3 was changed by Rosario Magbanua after this page loaded. Reload to see it, then decide again.',
              details: { submitted_row: null, current_row: '7b000000-0000-4000-8000-000000000999' },
            },
          },
          409,
        ),
      );
    }

    return route.fulfill(json({ created: body.changes.length, corrected: 0, unchanged: 0 }, 201));
  });

  return traffic;
}

export function mockSuynl(
  page: Page,
  outcome: 'accepted' | 'conflict' = 'accepted',
): Promise<GrowthTraffic> {
  return mockTab(
    page,
    'suynl',
    SUYNL_COUNTS,
    [SUYNL_IN_PROGRESS, SUYNL_NOT_STARTED, SUYNL_GRADUATED, SUYNL_NOT_MINE],
    outcome,
  );
}

export function mockTraining(
  page: Page,
  outcome: 'accepted' | 'conflict' = 'accepted',
): Promise<GrowthTraffic> {
  return mockTab(
    page,
    'training',
    TRAINING_COUNTS,
    [TRAINING_TWO, TRAINING_NONE, TRAINING_ALL, TRAINING_NOT_MINE],
    outcome,
  );
}
