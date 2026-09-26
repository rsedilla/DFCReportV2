import type { Page } from '@playwright/test';

import { PERSON_IN_SCOPE, SIGNED_IN_PERSON_ID } from './mock-api';

/**
 * The Growth tabs, SUYNL, Training and Conquest (SKILL.md sections 27 and 28; decisions
 * 0278 to 0286).
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
  /** Not a card: how many the opening view leaves out (decision 0287). */
  all_five: 1,
};

export interface GrowthTraffic {
  /** Every list request's query string, in order. */
  lists: URLSearchParams[];
  /** Every submission: the body sent and its `Idempotency-Key`. */
  submitted: { body: { changes: Record<string, unknown>[] }; key: string | undefined }[];
}

/** How far a SUYNL row has got, as `narrowingFor` in `suynl.service.ts` reads it. */
function suynlStep(row: { lessons: unknown[] }): string {
  return row.lessons.length === 0
    ? 'NOT_STARTED'
    : row.lessons.length === 10
      ? 'GRADUATED'
      : 'IN_PROGRESS';
}

/**
 * Whether a row is in the list a `step` asks for, as the two services narrow it: a card
 * names its own people, and `STILL_TO_FINISH`, the opening view, everyone who has not
 * finished (decision 0287). No `step` is everyone.
 */
function inStep(tab: 'suynl' | 'training', row: unknown, step: string | null): boolean {
  if (step === null) {
    return true;
  }

  if (tab === 'suynl') {
    const reached = suynlStep(row as { lessons: unknown[] });
    return step === 'STILL_TO_FINISH' ? reached !== 'GRADUATED' : reached === step;
  }

  const held = (row as { graduations: { program: string }[] }).graduations.map((g) => g.program);
  if (step === 'STILL_TO_FINISH') {
    return held.length < 5;
  }
  return step === 'NOT_STARTED' ? held.length === 0 : held.includes(step);
}

/**
 * One tab's three routes. `outcome` decides what a submission answers: accepted as the
 * API accepts it (201 with its counts), or refused as a lost race is (409
 * `VERSION_CONFLICT`, with the message the SUYNL service writes).
 *
 * The list honours `step`, so the opening view leaves out whoever has finished as the API
 * does, and a screen that sent the wrong step would show the wrong people. `q` and `mine`
 * are recorded and not applied.
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
    const params = new URL(route.request().url()).searchParams;
    traffic.lists.push(params);
    const data = rows.filter((row) => inStep(tab, row, params.get('step')));
    return route.fulfill(json({ data, next_cursor: null }));
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

export async function mockSuynl(
  page: Page,
  outcome: 'accepted' | 'conflict' = 'accepted',
  fixture: { counts?: unknown; rows?: unknown[] } = {},
): Promise<GrowthTraffic> {
  const traffic = await mockTab(
    page,
    'suynl',
    fixture.counts ?? SUYNL_COUNTS,
    fixture.rows ?? [SUYNL_IN_PROGRESS, SUYNL_NOT_STARTED, SUYNL_GRADUATED, SUYNL_NOT_MINE],
    outcome,
  );
  // Reports → SUYNL reads its readiness table too (decision 0297); a case wanting another
  // view installs `mockSuynlReadiness` after this, which Playwright then asks first.
  await mockSuynlReadiness(page);
  return traffic;
}

/**
 * The SUYNL readiness table (decision 0297), in the shape `readiness()` in
 * `api/src/suynl/suynl.service.ts` builds. Every figure below adds up as the API's do: each
 * row's buckets sum to its people, and the rows, the reader's own row and the elsewhere line
 * sum to the total.
 *
 * **The leader's view** (`GET /suynl/readiness`): three direct disciples in surname order.
 * Arturo leads people and carries four, one in each bucket at least; Florante leads nobody
 * and carries himself; Gregoria leads people none of whom is counted. The reader alone is on
 * the own row.
 */
export const READINESS_ARTURO_ID = '7f000000-0000-4000-8000-000000000001';
export const READINESS_FLORANTE_ID = '7f000000-0000-4000-8000-000000000002';
export const READINESS_GREGORIA_ID = '7f000000-0000-4000-8000-000000000003';
export const READINESS_MENS_ROOT_ID = '7f000000-0000-4000-8000-000000000011';
export const READINESS_WOMENS_ROOT_ID = '7f000000-0000-4000-8000-000000000012';

const member = (suffix: string, full_name: string, lessons: number) => ({
  person_id: `7f000000-0000-4000-8000-0000000001${suffix}`,
  full_name,
  lessons,
});

const CARMELITA = member('01', 'Carmelita Aquino', 10);
const ARTURO = member('02', 'Arturo Buenaventura', 8);
const DIOSDADO = member('03', 'Diosdado Cruz', 3);
const EPIFANIA = member('04', 'Epifania Reyes', 1);
const FLORANTE = member('05', 'Florante Mendoza', 5);
const READER = { person_id: SIGNED_IN_PERSON_ID, full_name: 'Marilou Santiago', lessons: 9 };
const HERMINIO = member('07', 'Herminio Lacson', 7);
const ISIDRA = member('08', 'Isidra Manalo', 2);
const JOVITA = member('09', 'Jovita Ramos', 4);

type Member = ReturnType<typeof member>;

function figures(members: Member[]) {
  const completed = members.filter((each) => each.lessons >= 10).length;
  const sevenToNine = members.filter((each) => each.lessons >= 7 && each.lessons < 10).length;
  const oneToSix = members.filter((each) => each.lessons < 7).length;
  return {
    completed,
    seven_to_nine: sevenToNine,
    one_to_six: oneToSix,
    people: members.length,
    members,
  };
}

function row(
  id: string,
  memberId: string,
  fullName: string,
  network: 'MENS' | 'WOMENS' | null,
  leadsAnyone: boolean,
  members: Member[],
) {
  return {
    leader: { id, member_id: memberId, full_name: fullName },
    network,
    leads_anyone: leadsAnyone,
    ...figures(members),
  };
}

function total(members: Member[]) {
  const { completed, seven_to_nine, one_to_six, people } = figures(members);
  return { completed, seven_to_nine, one_to_six, people };
}

export const READINESS_LEADER = {
  subject: { id: SIGNED_IN_PERSON_ID, full_name: READER.full_name },
  rows: [
    row(READINESS_ARTURO_ID, 'M-004201', 'Arturo Buenaventura', null, true, [
      CARMELITA,
      ARTURO,
      DIOSDADO,
      EPIFANIA,
    ]),
    row(READINESS_FLORANTE_ID, 'M-004202', 'Florante Mendoza', null, false, [FLORANTE]),
    row(READINESS_GREGORIA_ID, 'M-004203', 'Gregoria Navarro', null, true, []),
  ],
  own: figures([READER]),
  elsewhere: null,
  total: total([CARMELITA, ARTURO, DIOSDADO, EPIFANIA, FLORANTE, READER]),
};

/**
 * **The whole church** (`GET /suynl/readiness` for a Whole Church reader): the two roots,
 * Men's first, no own row, and the elsewhere line, which carries somebody only when `elsewhere`
 * is asked for.
 */
export function readinessChurch(options: { elsewhere: boolean }) {
  const elsewhere = options.elsewhere ? [JOVITA] : [];
  const men = [CARMELITA, ARTURO, HERMINIO];
  const women = [ISIDRA];
  return {
    subject: null,
    rows: [
      row(READINESS_MENS_ROOT_ID, 'M-004211', 'Honorio Villanueva', 'MENS', true, men),
      row(READINESS_WOMENS_ROOT_ID, 'M-004212', 'Imelda Quizon', 'WOMENS', true, women),
    ],
    own: null,
    elsewhere: figures(elsewhere),
    total: total([...men, ...women, ...elsewhere]),
  };
}

/** **Arturo's table** (`GET /suynl/readiness/{Arturo}`): his one disciple, then himself. */
export const READINESS_ARTURO = {
  subject: { id: READINESS_ARTURO_ID, full_name: 'Arturo Buenaventura' },
  rows: [
    row('7f000000-0000-4000-8000-000000000004', 'M-004204', 'Carmelita Aquino', null, true, [
      CARMELITA,
      DIOSDADO,
      EPIFANIA,
    ]),
  ],
  own: figures([ARTURO]),
  elsewhere: null,
  total: total([CARMELITA, DIOSDADO, EPIFANIA, ARTURO]),
};

/**
 * Both readiness routes. `/readiness` answers the leader's view or, with `view: 'church'`,
 * the whole church's; `/readiness/{id}` answers Arturo's table for Arturo and a
 * `SCOPE_DENIED` for anybody else. Returns every path asked, with its query string.
 */
export async function mockSuynlReadiness(
  page: Page,
  options: { view?: 'leader' | 'church'; elsewhere?: boolean } = {},
): Promise<{ asked: string[] }> {
  const traffic = { asked: [] as string[] };

  await page.route('**/api/v1/suynl/readiness**', (route) => {
    const url = new URL(route.request().url());
    traffic.asked.push(`${url.pathname}${url.search}`);
    const id = url.pathname.split('/readiness/')[1];

    if (id === undefined) {
      return route.fulfill(
        json(
          options.view === 'church'
            ? readinessChurch({ elsewhere: options.elsewhere ?? true })
            : READINESS_LEADER,
        ),
      );
    }
    if (id === READINESS_ARTURO_ID) {
      return route.fulfill(json(READINESS_ARTURO));
    }
    return route.fulfill(
      json(
        {
          error: {
            code: 'SCOPE_DENIED',
            message: 'That person is outside your scope.',
            details: {},
          },
        },
        403,
      ),
    );
  });

  return traffic;
}

export function mockTraining(
  page: Page,
  outcome: 'accepted' | 'conflict' = 'accepted',
  fixture: { counts?: unknown; rows?: unknown[] } = {},
): Promise<GrowthTraffic> {
  return mockTab(
    page,
    'training',
    fixture.counts ?? TRAINING_COUNTS,
    fixture.rows ?? [TRAINING_TWO, TRAINING_NONE, TRAINING_ALL, TRAINING_NOT_MINE],
    outcome,
  );
}

/**
 * The Conquest tab (SKILL.md section 27), read-only: its two routes, in the shapes
 * `api/src/conquest/conquest.service.ts` builds.
 *
 * **Each row carries goal states the screen words differently**: reached with today's count
 * below the target, at it, and past it; not reached with a count; and Open a cell, which
 * carries no count, both reached and not.
 */
export const CONQUEST_PARTWAY = {
  person_id: IN_PROGRESS_ID,
  member_id: 'M-004101',
  full_name: 'Dalisay Soriano',
  goals: {
    // Reached, and fewer than three today: "Reached Mar 2026" over "2 of 3 now".
    win_3: { reached_on: '2026-03-08', now: 2 },
    open_a_cell: { reached_on: '2025-11-02' },
    // Reached, and past the target today: "13 now".
    completion_of_12: { reached_on: '2026-01-20', now: 13 },
    // Not reached: "7 of 12 so far".
    raise_12_leaders: { reached_on: null, now: 7 },
  },
};

export const CONQUEST_NONE = {
  person_id: NOT_STARTED_ID,
  member_id: 'M-004102',
  full_name: 'Ernani Pascual',
  goals: {
    win_3: { reached_on: null, now: 0 },
    open_a_cell: { reached_on: null },
    completion_of_12: { reached_on: null, now: 4 },
    raise_12_leaders: { reached_on: null, now: 0 },
  },
};

export const CONQUEST_ALL = {
  person_id: GRADUATED_ID,
  member_id: 'M-004103',
  full_name: 'Lualhati Dizon',
  goals: {
    win_3: { reached_on: '2025-01-12', now: 3 },
    open_a_cell: { reached_on: '2025-03-01' },
    // Reached and exactly at the target today: "12 of 12 now".
    completion_of_12: { reached_on: '2025-11-30', now: 12 },
    raise_12_leaders: { reached_on: '2026-03-15', now: 11 },
  },
};

/** A card per goal, which overlap, and everyone listed (section 27). */
export const CONQUEST_COUNTS = {
  people: 3,
  win_3: 2,
  open_a_cell: 2,
  completion_of_12: 2,
  raise_12_leaders: 1,
};

/** The Conquest tab's two routes. Returns every list request's query string, in order. */
export async function mockConquest(page: Page): Promise<{ lists: URLSearchParams[] }> {
  const traffic = { lists: [] as URLSearchParams[] };

  await page.route('**/api/v1/conquest/counts', (route) => route.fulfill(json(CONQUEST_COUNTS)));

  await page.route('**/api/v1/conquest/people?*', (route) => {
    traffic.lists.push(new URL(route.request().url()).searchParams);
    return route.fulfill(
      json({ data: [CONQUEST_PARTWAY, CONQUEST_NONE, CONQUEST_ALL], next_cursor: null }),
    );
  });

  return traffic;
}

/**
 * `PERSON_IN_SCOPE`'s own SUYNL row for the person page's Growth frame: three lessons
 * with a gap, so a box left empty between two ticked ones is reachable, filed on three
 * different days, so "latest" has to pick one.
 */
export const PERSON_SUYNL = {
  person_id: PERSON_IN_SCOPE.id,
  member_id: PERSON_IN_SCOPE.member_id,
  full_name: PERSON_IN_SCOPE.full_name,
  lessons: [
    { id: '7d000000-0000-4000-8000-000000000001', lesson: 1, filed_on: '2026-08-02' },
    { id: '7d000000-0000-4000-8000-000000000004', lesson: 4, filed_on: '2026-09-06' },
    { id: '7d000000-0000-4000-8000-000000000002', lesson: 2, filed_on: '2026-08-16' },
  ],
  graduated_on: null,
  may_file: true,
};

/**
 * Two schools, listed Life Class first so the frame's Encounter-first order is its own
 * rather than the fixture's, and one of them with no date.
 */
export const PERSON_TRAINING = {
  person_id: PERSON_IN_SCOPE.id,
  member_id: PERSON_IN_SCOPE.member_id,
  full_name: PERSON_IN_SCOPE.full_name,
  graduations: [
    { id: '7e000000-0000-4000-8000-000000000002', program: 'LIFE_CLASS', graduated_on: null },
    { id: '7e000000-0000-4000-8000-000000000001', program: 'ENCOUNTER', graduated_on: '2026-03-08' },
  ],
  may_file: true,
};

/**
 * What one Growth list answers the person page: the rows to return, or a refusal, or a
 * failure that is not a refusal.
 */
export type PersonGrowthAnswer =
  | { rows: unknown[] }
  | { refused: 'CAPABILITY_DENIED' | 'SCOPE_DENIED' }
  | { failed: true };

/**
 * The two Growth lists as the person page asks them: searched by `PERSON_IN_SCOPE`'s
 * Member ID. A request for anything else falls through to whatever was registered
 * before, so this composes with `mockSuynl` and `mockTraining`.
 *
 * Returns every query string each list received for that Member ID.
 */
export async function mockPersonGrowth(
  page: Page,
  answers: { suynl?: PersonGrowthAnswer; training?: PersonGrowthAnswer } = {},
): Promise<{ suynl: URLSearchParams[]; training: URLSearchParams[] }> {
  const traffic = { suynl: [] as URLSearchParams[], training: [] as URLSearchParams[] };
  const defaults = { suynl: { rows: [PERSON_SUYNL] }, training: { rows: [PERSON_TRAINING] } };

  for (const tab of ['suynl', 'training'] as const) {
    const answer = answers[tab] ?? defaults[tab];

    await page.route(`**/api/v1/${tab}/people?*`, (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('q') !== PERSON_IN_SCOPE.member_id) {
        return route.fallback();
      }
      traffic[tab].push(params);

      if ('refused' in answer) {
        return route.fulfill(
          json(
            {
              error: {
                code: answer.refused,
                message: `You hold no ${tab}.view_subtree over this person.`,
                details: {},
              },
            },
            403,
          ),
        );
      }
      if ('failed' in answer) {
        return route.fulfill(
          json(
            { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: {} } },
            500,
          ),
        );
      }
      return route.fulfill(json({ data: answer.rows, next_cursor: null }));
    });
  }

  return traffic;
}

/**
 * The Encounter seasons (SKILL.md section 28, decision 0296): the shape
 * `api/src/training/encounter-seasons.service.ts` builds. Three seasons in the order the API
 * lists them, by the earlier weekend, each LC Party the default five weeks before its own
 * weekend. **The August season's Women's weekend is later than its Men's by a week**, so a
 * day between the two ends tells the halves apart.
 */
export const ENCOUNTER_APRIL = {
  id: '7e000000-0000-4000-8000-000000000001',
  mens_lc_party_on: '2026-02-27',
  mens_encounter_on: '2026-04-03',
  womens_lc_party_on: '2026-03-06',
  womens_encounter_on: '2026-04-10',
};

export const ENCOUNTER_AUGUST = {
  id: '7e000000-0000-4000-8000-000000000002',
  mens_lc_party_on: '2026-07-03',
  mens_encounter_on: '2026-08-07',
  womens_lc_party_on: '2026-07-10',
  womens_encounter_on: '2026-08-14',
};

export const ENCOUNTER_DECEMBER = {
  id: '7e000000-0000-4000-8000-000000000003',
  mens_lc_party_on: '2026-10-30',
  mens_encounter_on: '2026-12-04',
  womens_lc_party_on: '2026-11-06',
  womens_encounter_on: '2026-12-11',
};

export const ENCOUNTER_SEASONS = [ENCOUNTER_APRIL, ENCOUNTER_AUGUST, ENCOUNTER_DECEMBER];

export type SeasonsShown = 'BOTH' | 'MENS' | 'WOMENS' | 'NEITHER';

type Season = (typeof ENCOUNTER_SEASONS)[number];

/** A season as the list answers a reader shown `shows`: the other half's dates null. */
export function seasonAsShown(season: Season, shows: SeasonsShown) {
  const men = shows === 'BOTH' || shows === 'MENS';
  const women = shows === 'BOTH' || shows === 'WOMENS';
  return {
    id: season.id,
    mens_lc_party_on: men ? season.mens_lc_party_on : null,
    mens_encounter_on: men ? season.mens_encounter_on : null,
    womens_lc_party_on: women ? season.womens_lc_party_on : null,
    womens_encounter_on: women ? season.womens_encounter_on : null,
  };
}

export interface EncounterTraffic {
  /** Every write: its method, path, body and `Idempotency-Key`. */
  writes: { method: string; path: string; body: Record<string, unknown>; key: string | undefined }[];
  /** How many times the list was read. */
  reads: number;
}

/** The message the service writes when a Men's LC Party is later than five weeks before. */
export const PARTY_TOO_LATE =
  "The Men's LC Party must be on or before 2027-02-26, five weeks before the Men's Encounter.";

/**
 * `GET`, `POST` and `PATCH /encounter-seasons`. The list answers `shows` and the seasons as
 * that reader is shown them. A write is `accepted` (201 or 200, the whole season, as the API
 * answers an administrator) or `refused` as the service refuses an LC Party too close to its
 * weekend (422 `VALIDATION_FAILED`, naming the field).
 */
export async function mockEncounterSeasons(
  page: Page,
  options: { shows?: SeasonsShown; seasons?: Season[]; outcome?: 'accepted' | 'refused' } = {},
): Promise<EncounterTraffic> {
  const shows = options.shows ?? 'BOTH';
  const seasons = options.seasons ?? ENCOUNTER_SEASONS;
  const traffic: EncounterTraffic = { writes: [], reads: 0 };

  await page.route('**/api/v1/encounter-seasons**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === 'GET') {
      traffic.reads += 1;
      return route.fulfill(
        json({ shows, data: seasons.map((season) => seasonAsShown(season, shows)) }),
      );
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    const key = (await request.headerValue('idempotency-key')) ?? undefined;
    traffic.writes.push({ method: request.method(), path, body, key });

    if (options.outcome === 'refused') {
      return route.fulfill(
        json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: PARTY_TOO_LATE,
              details: { field: 'mens_lc_party_on', value: '2027-03-01', latest: '2027-02-26' },
            },
          },
          422,
        ),
      );
    }

    const id =
      request.method() === 'PATCH' ? path.split('/').pop()! : '7e000000-0000-4000-8000-000000000009';
    return route.fulfill(json({ id, ...body }, request.method() === 'POST' ? 201 : 200));
  });

  return traffic;
}
