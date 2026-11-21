import type { Page } from '@playwright/test';

/**
 * Equipping as the browser tests see it (SKILL.md section 29, decision 0499): a Registrar's
 * account, and one term's registrations and classes. Names are invented (CLAUDE.md, Secrets).
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const CLASS_ID = '3f1b7c6e-0000-4000-8000-00000000e001';

/** The signed-in account as a Registrar: `EQUIPPING` screens and `equipping.manage` alone. */
export async function mockRegistrar(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
        person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
        email: 'registrar@example.invalid',
        first_name: 'Teresita',
        roles: ['REGISTRAR'],
        screens: 'EQUIPPING',
        people_i_oversee: false,
        privacy_notice: { version: '2026-11-16', acknowledged_at: '2026-11-16T01:00:00.000Z' },
        capabilities: [
          {
            capability: 'equipping.manage',
            scope_type: 'WHOLE_CHURCH',
            scope_network: null,
            read_only: false,
            source: 'ROLE',
          },
        ],
      }),
    ),
  );
}

/** One term: two registrations, one class with one person ready and one enrolled. */
export async function mockEquipping(page: Page): Promise<void> {
  await page.route('**/api/v1/equipping/registrations?*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e101',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e201', member_id: 'M-000951', full_name: 'Carlito Manalo' },
            leader_name: 'Benito Cruz',
            birthday_recorded: false,
            status: 'REGISTERED_WITH_EXCEPTION',
            unmet: ['DCC_REGULAR'],
            exception_reason: 'His leader confirms he attends every Sunday.',
            note: null,
            class: null,
            enrollment_id: null,
            registered_at: '2026-11-10T02:00:00.000Z',
            cancel_reason: null,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e102',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e202', member_id: 'M-000952', full_name: 'Danica Flores' },
            leader_name: 'Mila Tan',
            birthday_recorded: true,
            status: 'ENROLLED',
            unmet: [],
            exception_reason: null,
            note: null,
            class: { id: CLASS_ID, name: 'Life Class A' },
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000e301',
            registered_at: '2026-11-09T02:00:00.000Z',
            cancel_reason: null,
          },
        ],
        next_cursor: null,
      }),
    ),
  );
  await page.route('**/api/v1/equipping/classes?*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: CLASS_ID,
            name: 'Life Class A',
            day_of_week: 2,
            time_of_day: '19:00',
            place: 'Room 2',
            first_lesson_on: '2026-12-01',
            encounter_season_id: '3f1b7c6e-0000-4000-8000-00000000e401',
            run_by: 'CHURCH',
            teacher: { id: '3f1b7c6e-0000-4000-8000-00000000e203', full_name: 'Graciela Uy' },
            enrolled: 1,
          },
        ],
      }),
    ),
  );
  await page.route(`**/api/v1/equipping/classes/${CLASS_ID}`, (route) =>
    route.fulfill(
      json({
        class: {
          id: CLASS_ID,
          name: 'Life Class A',
          day_of_week: 2,
          time_of_day: '19:00',
          place: 'Room 2',
          first_lesson_on: '2026-12-01',
          encounter_season_id: '3f1b7c6e-0000-4000-8000-00000000e401',
          run_by: 'CHURCH',
          teacher: { id: '3f1b7c6e-0000-4000-8000-00000000e203', full_name: 'Graciela Uy' },
          encounter_weekends: { mens: '2026-12-04', womens: '2026-12-11' },
        },
        enrolled: [
          {
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000e301',
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e102',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e202', full_name: 'Danica Flores' },
          },
        ],
        ready: [
          {
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e103',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e204', full_name: 'Ernesto Lim' },
            leader_name: 'Benito Cruz',
            with_exception: false,
            birthday_recorded: true,
            age_at_encounter: 22,
            blocked: null,
          },
          {
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e101',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e201', full_name: 'Carlito Manalo' },
            leader_name: 'Benito Cruz',
            with_exception: true,
            birthday_recorded: false,
            age_at_encounter: null,
            blocked: 'no birthday recorded',
          },
        ],
      }),
    ),
  );
}

/** The Coordinator's *Classes* (decision 0501): one class with a Teacher, one not named yet. */
export async function mockCoordinatedClasses(page: Page): Promise<void> {
  const base = {
    place: 'Room 2',
    encounter_season_id: '3f1b7c6e-0000-4000-8000-00000000e301',
    run_by: 'CHURCH',
  };
  await page.route('**/api/v1/equipping/coordinate/classes?*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            ...base,
            id: CLASS_ID,
            name: 'Life Class A',
            day_of_week: 2,
            time_of_day: '19:00',
            first_lesson_on: '2026-12-01',
            teacher: { id: '3f1b7c6e-0000-4000-8000-00000000e401', full_name: 'Aurora Reyes' },
            enrolled: 3,
            status: 'NOT_STARTED',
            guides: { named: 1, short_men: 0, short_women: 1 },
          },
          {
            ...base,
            id: '3f1b7c6e-0000-4000-8000-00000000e002',
            name: 'Life Class C',
            day_of_week: 6,
            time_of_day: '15:00',
            first_lesson_on: '2026-12-05',
            teacher: null,
            enrolled: 0,
            status: 'NOT_STARTED',
            guides: { named: 0, short_men: 0, short_women: 0 },
          },
        ],
      }),
    ),
  );
}

/** The Register dialog's person search (decision 0499): two invented people, each with a leader. */
export async function mockRegistrationSearch(page: Page): Promise<void> {
  await page.route('**/api/v1/equipping/people?*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-00000000f001',
            full_name: 'Wilma Santos',
            member_id: 'M-000412',
            direct_leader_name: 'Teodoro L. Cruz',
          },
          {
            id: '3f1b7c6e-0000-4000-8000-00000000f002',
            full_name: 'Wilfredo Sanchez',
            member_id: 'M-000519',
            direct_leader_name: 'Marites D. Ramos',
          },
        ],
      }),
    ),
  );
}

const GUIDE_BENJIE = '3f1b7c6e-0000-4000-8000-00000000a101';
const GUIDE_DANILO = '3f1b7c6e-0000-4000-8000-00000000a102';

/**
 * Life Class A's Guides and students (decision 0501, point 8): two men and a woman enrolled,
 * one man Guide named and one woman with no Guide yet. Records what each write sent.
 */
export async function mockClassGuides(page: Page): Promise<{ sent: { url: string; body: unknown }[] }> {
  const sent: { url: string; body: unknown }[] = [];
  const guides = [
    { id: GUIDE_BENJIE, person: { id: '3f1b7c6e-0000-4000-8000-00000000a201', full_name: 'Benjie Lacson' }, sex: 'MALE' },
    { id: GUIDE_DANILO, person: { id: '3f1b7c6e-0000-4000-8000-00000000a202', full_name: 'Danilo Pineda' }, sex: 'MALE' },
    // Archived since being named: keeps any students, takes no new ones (decision 0502).
    {
      id: '3f1b7c6e-0000-4000-8000-00000000a103',
      person: { id: '3f1b7c6e-0000-4000-8000-00000000a203', full_name: 'Rogelio Santos' },
      sex: 'MALE',
      archived: true,
    },
  ];
  await page.route(`**/api/v1/equipping/coordinate/classes/${CLASS_ID}/students`, (route) =>
    route.fulfill(
      json({
        class: { id: CLASS_ID, name: 'Life Class A' },
        guides,
        data: [
          {
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000a301',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000a401', full_name: 'Efren Quiambao' },
            sex: 'MALE',
            cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000a501', full_name: 'Gilbert Manalo' },
            guide: { id: GUIDE_BENJIE, full_name: 'Benjie Lacson' },
          },
          {
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000a302',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000a402', full_name: 'Hernan Ocampo' },
            sex: 'MALE',
            cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000a501', full_name: 'Gilbert Manalo' },
            guide: { id: GUIDE_BENJIE, full_name: 'Benjie Lacson' },
          },
          {
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000a303',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000a403', full_name: 'Imelda Tolentino' },
            sex: 'FEMALE',
            cell_leader: null,
            guide: null,
          },
        ],
      }),
    ),
  );
  await page.route('**/api/v1/equipping/guides?*', (route) =>
    route.fulfill(
      json({
        data: [{
            id: '3f1b7c6e-0000-4000-8000-00000000a601',
            full_name: 'Josefina Uy',
            member_id: 'M-000733',
            direct_leader_name: null,
            qualifies: 'Passed SOL 1',
          },],
      }),
    ),
  );
  const record = (status: number) => (route: import('@playwright/test').Route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill(json({ ok: true }, status));
  };
  await page.route(`**/api/v1/equipping/classes/${CLASS_ID}/guides`, record(201));
  await page.route(`**/api/v1/equipping/classes/${CLASS_ID}/guides/*/remove`, record(201));
  await page.route('**/api/v1/equipping/enrollments/*/guide', record(201));
  return { sent };
}

const TEACHER_PERSON = '3f1b7c6e-0000-4000-8000-00000000b001';
const STUDENT_EFREN = '3f1b7c6e-0000-4000-8000-00000000b301';
const STUDENT_IMELDA = '3f1b7c6e-0000-4000-8000-00000000b302';

/**
 * The signed-in account as a Leader who teaches (decision 0503): `equipping.class` over their
 * own subtree, as every Leader holds it. `RECORDING` screens, or a Full view leader's.
 */
export async function mockTeacher(page: Page, screens: 'RECORDING' | 'FULL'): Promise<void> {
  const grant = (capability: string, scope_type = 'OWN_SUBTREE') => ({
    capability,
    scope_type,
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  });
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0e',
        person_id: TEACHER_PERSON,
        email: 'teacher@example.invalid',
        first_name: 'Aurora',
        roles: ['LEADER'],
        screens,
        people_i_oversee: false,
        privacy_notice: { version: '2026-11-16', acknowledged_at: '2026-11-16T01:00:00.000Z' },
        capabilities: [
          grant('people.view_subtree'),
          grant('suynl.view_subtree'),
          grant('suynl.confirm'),
          grant('equipping.class'),
          ...(screens === 'FULL' ? [grant('reports.view_subtree')] : []),
        ],
      }),
    ),
  );
}

/** The classes the reader teaches or guides: one of each (decision 0503, point 3). */
export async function mockMyClasses(page: Page): Promise<void> {
  await page.route('**/api/v1/equipping/my-classes', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: CLASS_ID,
            name: 'Life Class A',
            day_of_week: 2,
            time_of_day: '19:00',
            first_lesson_on: '2026-11-03',
            role: 'TEACHER',
          },
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e002',
            name: 'Life Class C',
            day_of_week: 6,
            time_of_day: '15:00',
            first_lesson_on: '2026-11-07',
            role: 'GUIDE',
          },
        ],
      }),
    ),
  );
}

type AttendanceRole = 'TEACHER' | 'GUIDE' | 'ADMIN';

/**
 * Life Class A's attendance (decisions 0501 and 0503): lessons 1 and 2 saved, lesson 3 late and
 * still open, the rest not yet. Two students: Efren missed lesson 2 and owes its make-up, Imelda
 * missed it and made it up. `closedThree` closes lesson 3's week, which only the Admin corrects.
 * `joiners` adds Rosa, who joined on 15 November after lessons 1 and 2, and Tomas, moved from
 * Life Class B where he came to both (decision 0503, points 5). Records what each write sent.
 */
export async function mockClassAttendance(
  page: Page,
  {
    role = 'TEACHER',
    closedThree = false,
    joiners = false,
  }: { role?: AttendanceRole; closedThree?: boolean; joiners?: boolean } = {},
): Promise<{ sent: { url: string; body: unknown }[] }> {
  const sent: { url: string; body: unknown }[] = [];
  const mark = (
    lesson: number,
    came: boolean,
    madeUpOn: string | null,
    extra: { before_joining?: boolean; from_class?: { id: string; name: string } | null } = {},
  ) => ({
    lesson,
    came,
    made_up_on: madeUpOn,
    held_on: lesson === 1 ? '2026-11-03' : '2026-11-10',
    before_joining: false,
    from_class: null,
    ...extra,
  });
  const classB = { id: '3f1b7c6e-0000-4000-8000-00000000e003', name: 'Life Class B' };
  const rosa = {
    enrollment_id: '3f1b7c6e-0000-4000-8000-00000000b303',
    person: { id: '3f1b7c6e-0000-4000-8000-00000000b403', full_name: 'Rosa Villanueva' },
    cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000b502', full_name: 'Lorna Bautista' },
    guide: null,
    joined_on: '2026-11-15',
    marks: [mark(1, false, null, { before_joining: true }), mark(2, false, null, { before_joining: true })],
  };
  const tomas = {
    enrollment_id: '3f1b7c6e-0000-4000-8000-00000000b304',
    person: { id: '3f1b7c6e-0000-4000-8000-00000000b404', full_name: 'Tomas Aquino' },
    cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000b501', full_name: 'Gilbert Manalo' },
    guide: null,
    joined_on: '2026-11-15',
    // Lesson 3 too: Life Class B held it on the Monday before he moved, so A does not mark him.
    marks: [
      mark(1, true, null, { from_class: classB }),
      mark(2, true, null, { from_class: classB }),
      mark(3, true, null, { from_class: classB }),
    ],
  };
  const lesson = (n: number, expected: string, extra: Record<string, unknown>) => ({
    lesson: n,
    expected_on: expected,
    held_on: null,
    version: null,
    state: 'NOT_YET',
    open: true,
    closes_at: '2026-12-31T16:00:00.000Z',
    ...extra,
  });
  const body = {
    class: {
      id: CLASS_ID,
      name: 'Life Class A',
      day_of_week: 2,
      time_of_day: '19:00',
      place: 'Room 2',
      first_lesson_on: '2026-11-03',
    },
    role,
    may_record: role !== 'GUIDE',
    may_correct_closed: role === 'ADMIN',
    lessons: [
      lesson(1, '2026-11-03', { held_on: '2026-11-03', version: 1, state: 'SAVED', open: false }),
      lesson(2, '2026-11-10', { held_on: '2026-11-10', version: 1, state: 'SAVED' }),
      lesson(3, '2026-11-17', closedThree ? { state: 'NOT_RECORDED', open: false } : { state: 'LATE' }),
      lesson(4, '2026-11-24', {}),
      lesson(6, '2026-12-08', {}),
      lesson(7, '2026-12-15', {}),
      lesson(8, '2026-12-22', {}),
      lesson(9, '2026-12-29', {}),
    ],
    students: [
      {
        enrollment_id: STUDENT_EFREN,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b401', full_name: 'Efren Quiambao' },
        cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000b501', full_name: 'Gilbert Manalo' },
        guide: { id: '3f1b7c6e-0000-4000-8000-00000000b601', full_name: 'Benjie Lacson' },
        joined_on: '2026-11-01',
        marks: [mark(1, true, null), mark(2, false, null)],
      },
      {
        enrollment_id: STUDENT_IMELDA,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b402', full_name: 'Imelda Tolentino' },
        cell_leader: null,
        guide: null,
        joined_on: '2026-11-01',
        marks: [mark(1, true, null), mark(2, false, '2026-11-12')],
      },
      ...(joiners ? [rosa, tomas] : []),
    ],
    owed: [
      {
        enrollment_id: STUDENT_EFREN,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b401', full_name: 'Efren Quiambao' },
        cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000b501', full_name: 'Gilbert Manalo' },
        lesson: 2,
        held_on: '2026-11-10',
        before_joining: false,
      },
      ...(joiners
        ? [1, 2].map((n) => ({
            enrollment_id: rosa.enrollment_id,
            person: rosa.person,
            cell_leader: rosa.cell_leader,
            lesson: n,
            held_on: n === 1 ? '2026-11-03' : '2026-11-10',
            before_joining: true,
          }))
        : []),
    ],
  };
  await page.route(`**/api/v1/equipping/classes/${CLASS_ID}/attendance`, (route) =>
    route.fulfill(json(body)),
  );
  const record = (status: number) => (route: import('@playwright/test').Route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill(json({ ok: true }, status));
  };
  await page.route(`**/api/v1/equipping/classes/${CLASS_ID}/lessons/*`, record(200));
  await page.route(`**/api/v1/equipping/classes/${CLASS_ID}/make-ups`, record(201));
  return { sent };
}

/** Life Class A's id and its students' enrollments, for cases that assert what was sent. */
export const ATTENDANCE_IDS = {
  classId: CLASS_ID,
  efren: STUDENT_EFREN,
  imelda: STUDENT_IMELDA,
  rosa: '3f1b7c6e-0000-4000-8000-00000000b303',
  tomas: '3f1b7c6e-0000-4000-8000-00000000b304',
};

/**
 * The Teacher search and the week check for Edit (decisions 0501 and 0503): Marcelino leads a
 * Cell that does not clash and holds `account`, `NONE` by default.
 */
export async function mockTeacherCheck(
  page: Page,
  account: 'ACTIVE' | 'PENDING_ACTIVATION' | 'DISABLED' | 'NONE' = 'NONE',
): Promise<void> {
  await page.route('**/api/v1/equipping/teachers?*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-00000000c001',
            full_name: 'Marcelino Dizon',
            member_id: 'M-000881',
            direct_leader_name: 'Aurelio Castro',
          },
        ],
      }),
    ),
  );
  await page.route('**/api/v1/equipping/coordinate/classes/*/clash?*', (route) =>
    route.fulfill(json({ clash: null, account })),
  );
}
