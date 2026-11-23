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

/**
 * The reader's people in the school (decision 0504): by default nobody, so a page that does not
 * ask about them stays as it was. `withPeople` gives one of the reader's 12, Lorna, who missed
 * lesson 2, and Gilbert's Rosa, who came to both, in Life Class A.
 */
export async function mockSchoolPeople(page: Page, withPeople = false): Promise<void> {
  const person = (
    id: string,
    name: string,
    twelve: boolean,
    through: { id: string; full_name: string } | null,
    marks: { lesson: number; came: boolean; made_up_on: string | null }[],
  ) => ({
    enrollment_id: `3f1b7c6e-0000-4000-8000-00000000c${id}`,
    person: { id: `3f1b7c6e-0000-4000-8000-00000000d${id}`, full_name: name },
    level: 'LIFE_CLASS',
    twelve,
    through,
    class: { id: CLASS_ID, name: 'Life Class A' },
    teacher: { id: TEACHER_PERSON, full_name: 'Aurora Dizon' },
    guide: null,
    joined_on: '2026-11-01',
    marks: marks.map((m) => ({ ...m, held_on: m.lesson === 1 ? '2026-11-03' : '2026-11-10', before_joining: false, from_class: null })),
  });
  await page.route('**/api/v1/equipping/my-people', (route) =>
    route.fulfill(
      json({
        data: withPeople
          ? [
              person('001', 'Lorna Bautista', true, null, [
                { lesson: 1, came: true, made_up_on: null },
                { lesson: 2, came: false, made_up_on: null },
              ]),
              person('002', 'Rosa Villanueva', false, { id: '3f1b7c6e-0000-4000-8000-00000000b501', full_name: 'Gilbert Manalo' }, [
                { lesson: 1, came: true, made_up_on: null },
                { lesson: 2, came: true, made_up_on: null },
              ]),
            ]
          : [],
      }),
    ),
  );
}

/** The classes the reader teaches or guides: one of each (decision 0503, point 3). */
export async function mockMyClasses(page: Page): Promise<void> {
  await mockSchoolPeople(page);
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
    missedTwice = false,
  }: { role?: AttendanceRole; closedThree?: boolean; joiners?: boolean; missedTwice?: boolean } = {},
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
    held_on: lesson === 1 ? '2026-11-03' : lesson === 2 ? '2026-11-10' : '2026-11-17',
    before_joining: false,
    from_class: null,
    ...extra,
  });
  const classB = { id: '3f1b7c6e-0000-4000-8000-00000000e003', name: 'Life Class B' };
  // Moved from Life Class B too, where he missed lesson 3: ticked here only if he came here.
  const paz = {
    enrollment_id: '3f1b7c6e-0000-4000-8000-00000000b305',
    person: { id: '3f1b7c6e-0000-4000-8000-00000000b405', full_name: 'Paz Ocampo' },
    cell_leader: null,
    guide: null,
    joined_on: '2026-11-15',
    marks: [mark(3, false, null, { from_class: classB })],
  };
  const rosa = {
    enrollment_id: '3f1b7c6e-0000-4000-8000-00000000b303',
    person: { id: '3f1b7c6e-0000-4000-8000-00000000b403', full_name: 'Rosa Villanueva' },
    cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000b502', full_name: 'Lorna Bautista' },
    guide: null,
    joined_on: '2026-11-15',
    // With missedTwice, absent at lesson 3 as well: one absence since she joined, not two.
    marks: [
      mark(1, false, null, { before_joining: true }),
      mark(2, false, null, { before_joining: true }),
      ...(missedTwice ? [mark(3, false, null)] : []),
    ],
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
      lesson(
        3,
        '2026-11-17',
        missedTwice
          ? { held_on: '2026-11-17', version: 1, state: 'SAVED' }
          : closedThree
            ? { state: 'NOT_RECORDED', open: false }
            : { state: 'LATE' },
      ),
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
        // With missedTwice, absent at lesson 3 too: the last two lessons missed, neither made up.
        marks: [mark(1, true, null), mark(2, false, null), ...(missedTwice ? [mark(3, false, null)] : [])],
      },
      {
        enrollment_id: STUDENT_IMELDA,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b402', full_name: 'Imelda Tolentino' },
        cell_leader: null,
        guide: null,
        joined_on: '2026-11-01',
        // With missedTwice, absent at lesson 3 too, but lesson 2 is made up (decision 0505).
        marks: [mark(1, true, null), mark(2, false, '2026-11-12'), ...(missedTwice ? [mark(3, false, null)] : [])],
      },
      ...(joiners ? [rosa, tomas, paz] : []),
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

/**
 * One Men's Encounter weekend (decision 0507): before it, four cleared, two needing a make-up,
 * two who can't go, a class waiting for lesson 4 and two enrolled; from its first day, who came.
 * Every name is invented.
 */
export async function mockEncounter(
  page: Page,
  phase: 'ENROLLING' | 'RECORDING' = 'ENROLLING',
): Promise<{ sent: { url: string; body: unknown }[] }> {
  const sent: { url: string; body: unknown }[] = [];
  const id = (n: number) => `3f1b7c6e-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const classA = { id: id(9001), name: 'Life Class A' };
  const classC = { id: id(9003), name: 'Life Class C' };
  const student = (
    n: number,
    name: string,
    cls: { id: string; name: string },
    status: string,
    lessons: string[],
    reasons: string[] = [],
    extra: Record<string, unknown> = {},
  ) => ({
    enrollment_id: id(7000 + n),
    person: { id: id(8000 + n), full_name: name },
    class: cls,
    cell_leader: { id: id(8500 + n), full_name: 'Gilbert Manalo' },
    status,
    reasons,
    age_on_weekend: 23,
    lessons,
    missed_weekend_on: null,
    from_weekend_on: null,
    ...extra,
  });
  const body = {
    network: 'MENS',
    seasons: [
      { id: id(6001), weekend_on: '2026-12-04' },
      { id: id(6002), weekend_on: '2027-04-02' },
    ],
    season: { id: id(6001), weekend_on: '2026-12-04' },
    phase,
    students: [
      student(1, 'Efren Quiambao', classA, 'CLEARED', ['CAME', 'CAME', 'MADE_UP', 'CAME']),
      student(2, 'Nestor Villamor', classA, 'CLEARED', ['MADE_UP', 'CAME', 'CAME', 'MADE_UP']),
      student(3, 'Ramil Soriano', classC, 'CLEARED', ['CAME', 'CAME', 'CAME', 'CAME']),
      student(4, 'Tomas Aquino', classA, 'CLEARED', ['CAME', 'CAME', 'CAME', 'CAME'], [], {
        missed_weekend_on: '2026-08-07',
      }),
      student(5, 'Carlito Manalo', classA, 'NEEDS_MAKE_UP', ['CAME', 'ABSENT', 'CAME', 'CAME'], [
        'L2 not made up yet.',
      ]),
      student(6, 'Arnel Santos', classA, 'CANT_GO', ['ABSENT', 'ABSENT', 'CAME', 'ABSENT'], [
        '3 absences in lessons 1 to 4. Repeats Life Class.',
      ]),
    ],
    waiting: [{ class: { id: id(9002), name: 'Life Class B' }, lesson_4_on: '2026-11-24' }],
    enrolled: [
      {
        encounter_enrollment_id: id(5001),
        person: { id: id(8101), full_name: 'Jose Bautista' },
        class: classC,
        came: phase === 'RECORDING' ? true : null,
      },
      {
        encounter_enrollment_id: id(5002),
        person: { id: id(8102), full_name: 'Wilfredo Tan' },
        class: classA,
        came: null,
      },
    ],
  };
  await page.route('**/api/v1/equipping/encounter?*', (route) => route.fulfill(json(body)));
  const record = (status: number) => (route: import('@playwright/test').Route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill(json({ ok: true }, status));
  };
  await page.route('**/api/v1/equipping/encounter/enrollments', record(201));
  await page.route('**/api/v1/equipping/encounter/attendance', record(200));
  return { sent };
}

/** The ids `mockEncounter` uses, for cases that assert what was sent. */
export const ENCOUNTER_IDS = {
  season: '3f1b7c6e-0000-4000-8000-000000006001',
  efren: '3f1b7c6e-0000-4000-8000-000000007001',
  nestor: '3f1b7c6e-0000-4000-8000-000000007002',
  ramil: '3f1b7c6e-0000-4000-8000-000000007003',
  tomas: '3f1b7c6e-0000-4000-8000-000000007004',
  jose: '3f1b7c6e-0000-4000-8000-000000005001',
};

/**
 * Final grades (decision 0508): three classes of the term, and Life Class A's grades in `phase`,
 * Ramil being the Coordinator's own disciple. Every name is invented.
 */
export async function mockFinalGrades(
  page: Page,
  phase: 'WAITING_COORDINATOR' | 'WAITING_ADMIN' | 'READY' | 'POSTED' = 'READY',
): Promise<{ sent: { url: string; body: unknown }[] }> {
  const sent: { url: string; body: unknown }[] = [];
  const id = (n: number) => `3f1b7c6e-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const status = (p: string) => ({
    phase: p,
    missing_lessons: p === 'NOT_READY' ? [8, 9] : [],
    counts: { passed: 2, not_passed: 2, not_yet: 1 },
    coordinator_check:
      p === 'READY' || p === 'POSTED' || p === 'WAITING_ADMIN'
        ? { by: 'Lito Ramos', at: '2027-03-20T02:00:00.000Z' }
        : null,
    admin_check: p === 'READY' || p === 'POSTED' ? { by: 'Ada Reyes', at: '2027-03-21T02:00:00.000Z' } : null,
    disciples_for_admin: 1,
    posted: p === 'POSTED' ? { at: '2027-03-22T02:00:00.000Z' } : null,
  });
  const student = (
    n: number,
    name: string,
    grade: string,
    reason: string,
    lessons: string[],
    kept: number,
    madeUp: number,
    disciple = false,
  ) => ({
    enrollment_id: id(7100 + n),
    person: { id: id(8100 + n), full_name: name },
    grade,
    reason,
    lessons_kept: kept,
    lessons_made_up: madeUp,
    lessons,
    your_disciple: disciple,
  });
  const C = 'CAME';
  const grades = {
    class: { id: CLASS_ID, name: 'Life Class A', day_of_week: 2, time_of_day: '19:00', place: 'Room 2' },
    status: status(phase),
    may_check: phase !== 'POSTED',
    checks_as: 'COORDINATOR',
    fingerprint: 'a'.repeat(64),
    students: [
      student(1, 'Efren Quiambao', 'PASSED', 'Every lesson done.', [C, C, 'MADE_UP', C, C, C, C, C, C], 9, 1),
      student(2, 'Imelda Tolentino', 'NOT_PASSED', 'L7 not made up.', [C, C, C, C, C, C, 'ABSENT', C, C], 8, 0),
      student(3, 'Nestor Villamor', 'NOT_YET', 'Encounter not attended. Passes after a later one.', [C, C, C, C, 'ABSENT', C, C, C, C], 8, 0),
      student(
        4,
        'Ramil Soriano',
        'NOT_PASSED',
        '4 absences, over the 3 allowed. Joins a later class at lesson 6.',
        [C, 'MADE_UP', C, C, C, 'MADE_UP', 'MADE_UP', 'MADE_UP', C],
        9,
        4,
        true,
      ),
      student(5, 'Tomas Aquino', 'PASSED', 'Every lesson done.', [C, C, C, C, C, C, C, C, C], 9, 0),
    ],
  };
  await page.route('**/api/v1/equipping/final-grades?*', (route) =>
    route.fulfill(
      json({
        data: [
          { id: CLASS_ID, name: 'Life Class A', day_of_week: 2, time_of_day: '19:00', status: status(phase) },
          { id: id(9202), name: 'Life Class B', day_of_week: 4, time_of_day: '19:00', status: status('WAITING_COORDINATOR') },
          { id: id(9203), name: 'Life Class C', day_of_week: 6, time_of_day: '15:00', status: status('POSTED') },
        ],
      }),
    ),
  );
  await page.route(`**/api/v1/equipping/final-grades/classes/${CLASS_ID}`, (route) => route.fulfill(json(grades)));
  await page.route(`**/api/v1/equipping/coordinate/classes/${CLASS_ID}/grades`, (route) =>
    route.fulfill(json(grades)),
  );
  const record = (route: import('@playwright/test').Route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill(json({ ok: true }));
  };
  await page.route(`**/api/v1/equipping/final-grades/classes/${CLASS_ID}/post`, record);
  await page.route(`**/api/v1/equipping/coordinate/classes/${CLASS_ID}/check`, record);
  return { sent };
}
