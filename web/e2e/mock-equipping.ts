import type { Page } from '@playwright/test';

/**
 * Equipping as the browser tests see it (SKILL.md section 29, decision 0499): a Registrar's
 * account, and one term's registrations and classes. Names are invented (CLAUDE.md, Secrets).
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const CLASS_ID = '3f1b7c6e-0000-4000-8000-00000000e001';

/** A name last name first, as the API's `list_name` (decision 0515): "Tomas Aquino" is "Aquino, Tomas". */
function lastNameFirst(name: string): string {
  const parts = name.split(' ');
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
}

/** A school list's order: by last name (decision 0515). */
function byLastName(a: { person: { list_name: string } }, b: { person: { list_name: string } }): number {
  return a.person.list_name.localeCompare(b.person.list_name);
}

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
export async function mockEquipping(
  page: Page,
  options: { tries?: boolean; joins?: boolean; lesson6Passed?: boolean } = {},
): Promise<void> {
  // Ernesto kept lessons 1 to 4 and the Encounter in Term 2, 2026 (decision 0512).
  const joins = options.joins
    ? { joins_at_lesson_6: { class_name: 'Life Class B', term_year: 2026, term_number: 2 } }
    : {};
  // A student taking Life Class again (decision 0511): Carlito and Ernesto on a 2nd try.
  const second = options.tries ? { try_number: 2 } : {};
  // The counts on the Level picker (decision 0514).
  await page.route('**/api/v1/equipping/registrations/counts?*', (route) =>
    route.fulfill(json({ LIFE_CLASS: 2, SOL_1: 0, SOL_2: 0, SOL_3: 0 })),
  );
  await page.route('**/api/v1/equipping/registrations?*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e101',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e201', member_id: 'M-000951', full_name: 'Carlito Manalo', list_name: 'Manalo, Carlito' },
            leader_name: 'Benito Cruz',
            cell_leader_name: 'Lorna Reyes',
            leads_a_cell: false,
            birthday_recorded: false,
            status: 'REGISTERED_WITH_EXCEPTION',
            unmet: ['DCC_REGULAR'],
            exception_reason: 'His leader confirms he attends every Sunday.',
            note: null,
            class: null,
            enrollment_id: null,
            registered_at: '2026-11-10T02:00:00.000Z',
            cancel_reason: null,
            ...second,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e102',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e202', member_id: 'M-000952', full_name: 'Danica Flores', list_name: 'Flores, Danica' },
            leader_name: 'Mila Tan',
            cell_leader_name: null,
            leads_a_cell: true,
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
          level: 'LIFE_CLASS',
          day_of_week: 2,
          time_of_day: '19:00',
          place: 'Room 2',
          first_lesson_on: '2026-12-01',
          encounter_season_id: '3f1b7c6e-0000-4000-8000-00000000e401',
          run_by: 'CHURCH',
          teacher: { id: '3f1b7c6e-0000-4000-8000-00000000e203', full_name: 'Graciela Uy' },
          encounter_weekends: { mens: '2026-12-04', womens: '2026-12-11' },
          lesson_6: { on: '2027-01-05', open: !options.lesson6Passed },
        },
        enrolled: [
          {
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000e301',
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e102',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e202', full_name: 'Danica Flores', list_name: 'Flores, Danica' },
          },
        ],
        ready: [
          {
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e103',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e204', full_name: 'Ernesto Lim', list_name: 'Lim, Ernesto' },
            leader_name: 'Benito Cruz',
            with_exception: false,
            birthday_recorded: true,
            age_at_encounter: 22,
            blocked: null,
            ...second,
            ...joins,
          },
          {
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e101',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e201', full_name: 'Carlito Manalo', list_name: 'Manalo, Carlito' },
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
export async function mockCoordinatedClasses(
  page: Page,
  options: { lessonSaved?: boolean; cancelled?: boolean } = {},
): Promise<void> {
  const base = {
    place: 'Room 2',
    encounter_season_id: '3f1b7c6e-0000-4000-8000-00000000e301',
    run_by: 'CHURCH',
  };
  // The levels the reader coordinates (decision 0514): Life Class alone, so no picker.
  await page.route('**/api/v1/equipping/coordinate/levels', (route) =>
    route.fulfill(json({ data: ['LIFE_CLASS'] })),
  );
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
            lesson_saved: options.lessonSaved ?? false,
          },
          // Cancelled on 23 Nov 2026 (decision 0510): listed only under *Cancelled*.
          ...(options.cancelled
            ? [
                {
                  ...base,
                  id: '3f1b7c6e-0000-4000-8000-00000000e003',
                  name: 'Life Class D',
                  day_of_week: 4,
                  time_of_day: '18:00',
                  first_lesson_on: '2026-12-03',
                  teacher: null,
                  enrolled: 0,
                  status: 'CANCELLED',
                  lesson_saved: false,
                  cancelled_on: '2026-11-23',
                  cancel_reason: 'The Teacher moved to another Network',
                },
              ]
            : []),
        ],
      }),
    ),
  );
}

/**
 * Life Class C's empty roster, and the correction and cancellation routes (decision 0510), each
 * request recorded; a correction answers with a clash when `clash` is set.
 */
export async function mockClassChanges(
  page: Page,
  options: { clash?: boolean } = {},
): Promise<{ sent: { url: string; body: unknown }[] }> {
  const sent: { url: string; body: unknown }[] = [];
  const classC = '3f1b7c6e-0000-4000-8000-00000000e002';
  await page.route(`**/api/v1/equipping/coordinate/classes/${classC}/students`, (route) =>
    route.fulfill(json({ class: { id: classC, name: 'Life Class C' }, guides: [], data: [] })),
  );
  await page.route('**/api/v1/equipping/classes/*/correction', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push({ url: route.request().url(), body });
    return route.fulfill(
      json({
        id: classC,
        ...body,
        corrected: true,
        clash: options.clash ? { day_of_week: 2, time_of_day: '19:30' } : null,
      }),
    );
  });
  await page.route('**/api/v1/equipping/classes/*/cancel', (route) => {
    const body = route.request().postDataJSON() as { reason: string };
    sent.push({ url: route.request().url(), body });
    return route.fulfill(
      json({ id: classC, status: 'CANCELLED', cancelled_on: '2026-11-23', cancel_reason: body.reason }),
    );
  });
  return { sent };
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
    { id: GUIDE_BENJIE, person: { id: '3f1b7c6e-0000-4000-8000-00000000a201', full_name: 'Benjie Lacson', list_name: 'Lacson, Benjie' }, sex: 'MALE' },
    { id: GUIDE_DANILO, person: { id: '3f1b7c6e-0000-4000-8000-00000000a202', full_name: 'Danilo Pineda', list_name: 'Pineda, Danilo' }, sex: 'MALE' },
    // Archived since being named: keeps any students, takes no new ones (decision 0502).
    {
      id: '3f1b7c6e-0000-4000-8000-00000000a103',
      person: { id: '3f1b7c6e-0000-4000-8000-00000000a203', full_name: 'Rogelio Santos', list_name: 'Santos, Rogelio' },
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
            person: { id: '3f1b7c6e-0000-4000-8000-00000000a401', full_name: 'Efren Quiambao', list_name: 'Quiambao, Efren' },
            sex: 'MALE',
            cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000a501', full_name: 'Gilbert Manalo' },
            guide: { id: GUIDE_BENJIE, full_name: 'Benjie Lacson' },
          },
          {
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000a302',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000a402', full_name: 'Hernan Ocampo', list_name: 'Ocampo, Hernan' },
            sex: 'MALE',
            cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000a501', full_name: 'Gilbert Manalo' },
            guide: { id: GUIDE_BENJIE, full_name: 'Benjie Lacson' },
          },
          {
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000a303',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000a403', full_name: 'Imelda Tolentino', list_name: 'Tolentino, Imelda' },
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
 * lesson 2, and Gilbert's Rosa, who came to both, in Life Class A, and the same two in SOL 1 A,
 * each with SOL's card (decision 0514, point 14).
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
              {
                ...person('003', 'Lorna Bautista', true, null, [
                  { lesson: 1, came: true, made_up_on: null },
                  { lesson: 2, came: false, made_up_on: null },
                ]),
                level: 'SOL_1',
                class: { id: CLASS_ID, name: 'SOL 1 A' },
                encounter: null,
                sol: { verses: 1, devotionals: 1, quiz: 'NOT_TAKEN', book: false, still_missing: ['L2 make-up'] },
              },
              {
                ...person('004', 'Rosa Villanueva', false, { id: '3f1b7c6e-0000-4000-8000-00000000b501', full_name: 'Gilbert Manalo' }, [
                  { lesson: 1, came: true, made_up_on: null },
                  { lesson: 2, came: true, made_up_on: null },
                ]),
                level: 'SOL_1',
                class: { id: CLASS_ID, name: 'SOL 1 A' },
                encounter: null,
                sol: { verses: 2, devotionals: 2, quiz: 'PASSED', book: false, still_missing: [] },
              },
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
            level: 'LIFE_CLASS',
            day_of_week: 2,
            time_of_day: '19:00',
            first_lesson_on: '2026-11-03',
            role: 'TEACHER',
          },
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e002',
            name: 'Life Class C',
            level: 'LIFE_CLASS',
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
    carried = false,
  }: {
    role?: AttendanceRole;
    closedThree?: boolean;
    joiners?: boolean;
    missedTwice?: boolean;
    carried?: boolean;
  } = {},
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
    person: { id: '3f1b7c6e-0000-4000-8000-00000000b405', full_name: 'Paz Ocampo', list_name: 'Ocampo, Paz' },
    cell_leader: null,
    guide: null,
    joined_on: '2026-11-15',
    marks: [mark(3, false, null, { from_class: classB })],
  };
  const rosa = {
    enrollment_id: '3f1b7c6e-0000-4000-8000-00000000b303',
    person: { id: '3f1b7c6e-0000-4000-8000-00000000b403', full_name: 'Rosa Villanueva', list_name: 'Villanueva, Rosa' },
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
    person: { id: '3f1b7c6e-0000-4000-8000-00000000b404', full_name: 'Tomas Aquino', list_name: 'Aquino, Tomas' },
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
      level: 'LIFE_CLASS',
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
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b401', full_name: 'Efren Quiambao', list_name: 'Quiambao, Efren' },
        cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000b501', full_name: 'Gilbert Manalo' },
        guide: { id: '3f1b7c6e-0000-4000-8000-00000000b601', full_name: 'Benjie Lacson' },
        joined_on: '2026-11-01',
        // With missedTwice, absent at lesson 3 too: the last two lessons missed, neither made up.
        marks: [mark(1, true, null), mark(2, false, null), ...(missedTwice ? [mark(3, false, null)] : [])],
      },
      {
        enrollment_id: STUDENT_IMELDA,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b402', full_name: 'Imelda Tolentino', list_name: 'Tolentino, Imelda' },
        cell_leader: null,
        guide: null,
        joined_on: '2026-11-01',
        // With missedTwice, absent at lesson 3 too, but lesson 2 is made up (decision 0505).
        marks: [mark(1, true, null), mark(2, false, '2026-11-12'), ...(missedTwice ? [mark(3, false, null)] : [])],
      },
      ...(joiners ? [rosa, tomas, paz] : []),
      // Joined at Lesson 6, keeping lessons 1 to 4 and the Encounter from Life Class B (0512).
      ...(carried
        ? [
            {
              enrollment_id: '3f1b7c6e-0000-4000-8000-00000000b306',
              person: { id: '3f1b7c6e-0000-4000-8000-00000000b406', full_name: 'Ramil Cruz', list_name: 'Cruz, Ramil' },
              cell_leader: null,
              guide: null,
              joined_on: '2026-11-01',
              carried: { class_name: 'Life Class B', term_year: 2026, term_number: 2 },
              encounter: 'CAME',
              marks: [
                mark(1, true, null, { from_class: classB }),
                mark(2, true, null, { from_class: classB }),
                mark(3, false, '2026-11-20', { from_class: classB }),
                mark(4, true, null, { from_class: classB }),
              ],
            },
          ]
        : []),
    ],
    owed: [
      {
        enrollment_id: STUDENT_EFREN,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b401', full_name: 'Efren Quiambao', list_name: 'Quiambao, Efren' },
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
        person: { id: id(8101), full_name: 'Jose Bautista', list_name: 'Bautista, Jose' },
        class: classC,
        came: phase === 'RECORDING' ? true : null,
      },
      {
        encounter_enrollment_id: id(5002),
        person: { id: id(8102), full_name: 'Wilfredo Tan', list_name: 'Tan, Wilfredo' },
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
    person: { id: id(8100 + n), full_name: name, list_name: lastNameFirst(name) },
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
      // In last-name order, as the API sends a school list (decision 0515).
    ].sort(byLastName),
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

/**
 * SOL 1's final grades (decision 0514, point 11, as approved): SOL 1 A ready to post, its five
 * students graded by the checklist. Called after `mockFinalGrades`, whose list it answers for
 * SOL 1. Every name is invented.
 */
export async function mockSolFinalGrades(
  page: Page,
  options: { posted?: boolean; twoTries?: boolean; level?: 'SOL_1' | 'SOL_2' } = {},
): Promise<{ sent: { url: string; body: unknown }[] }> {
  const solName = options.level === 'SOL_2' ? 'SOL 2' : 'SOL 1';
  const sent: { url: string; body: unknown }[] = [];
  const id = (n: number) => `3f1b7c6e-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const SOL_CLASS = id(9301);
  const status = (p: string) => ({
    phase: p,
    missing_lessons: [],
    counts: { passed: 2, not_passed: 3, not_yet: 0 },
    coordinator_check: p === 'READY' || p === 'POSTED' ? { by: 'Lito Ramos', at: '2027-03-20T02:00:00.000Z' } : null,
    admin_check: p === 'READY' || p === 'POSTED' ? { by: 'Ada Reyes', at: '2027-03-21T02:00:00.000Z' } : null,
    disciples_for_admin: 0,
    posted: p === 'POSTED' ? { at: '2027-03-22T02:00:00.000Z' } : null,
  });
  const checklist = (over: object = {}) => ({
    absences: 0,
    made_up: 0,
    verses: 10,
    devotionals: 10,
    quiz: { items: 20, scores: [15], passed: true },
    book: true,
    ...over,
  });
  const student = (n: number, name: string, grade: string, reason: string, kept: number, list: object) => ({
    enrollment_id: id(7300 + n),
    person: { id: id(8300 + n), full_name: name, list_name: lastNameFirst(name) },
    grade,
    reason,
    lessons_kept: kept,
    lessons_made_up: (list as { made_up?: number }).made_up ?? 0,
    lessons: Array(10).fill('CAME'),
    checklist: checklist(list),
    your_disciple: false,
  });
  const phase = options.posted ? 'POSTED' : 'READY';
  // Posted, as the Admin reads it: each grade changeable lesson by lesson (decision 0514, point 12).
  const posted = (n: number, devotional7 = true) =>
    options.posted
      ? {
          final_grade_id: id(7400 + n),
          changes_seen: 0,
          history: [],
          changeable: {
            lessons: Array.from({ length: 10 }, (_, i) => ({
              lesson: i + 1,
              sign: 'CAME',
              made_up_on: null,
              held_on: `2027-01-${String(5 + i * 7 > 31 ? 31 : 5 + i).padStart(2, '0')}`,
              verse: true,
              devotional: i + 1 === 7 ? devotional7 : true,
            })),
            why: null,
          },
        }
      : {};
  const grades = {
    class: {
      id: SOL_CLASS,
      name: `${solName} A`,
      level: options.level ?? 'SOL_1',
      day_of_week: 2,
      time_of_day: '19:00',
      place: 'Room 2',
    },
    status: status(phase),
    may_check: !options.posted,
    checks_as: 'COORDINATOR',
    may_change: options.posted === true,
    fingerprint: 'b'.repeat(64),
    students: [
      student(1, 'Imelda Tolentino', 'NOT_PASSED', 'Quiz not passed after two retakes: 60%, 55%, 65%.', 10, {
        quiz: { items: 20, scores: options.twoTries ? [12, 11] : [12, 11, 13], passed: false },
      }),
      student(2, 'Nestor Villamor', 'NOT_PASSED', 'L7 devotional and the book missing.', 10, {
        made_up: 1,
        devotionals: 9,
        book: false,
      }),
      // Every check not met is named, the absences first (owner, 2026-11-26).
      student(3, 'Ramil Soriano', 'NOT_PASSED', '4 absences, over the 3 allowed. L2, L5, L6 and L8 not made up.', 6, {
        absences: 4,
        quiz: { items: 20, scores: [16], passed: true },
      }),
      student(4, 'Efren Quiambao', 'PASSED', 'Everything done.', 10, { made_up: 1 }),
      student(5, 'Tomas Aquino', 'PASSED', 'Everything done.', 10, { quiz: { items: 20, scores: [18], passed: true } }),
    ]
      .map((st, i) => ({ ...st, ...posted(i + 1, st.person.full_name !== 'Nestor Villamor') }))
      .sort(byLastName),
  };
  await page.route('**/api/v1/equipping/final-grades/grades/*/change-preview?*', (route) => {
    const url = new URL(route.request().url());
    const book = url.searchParams.get('item') === 'BOOK' && url.searchParams.get('read') === 'true';
    return route.fulfill(
      json({
        item: url.searchParams.get('item'),
        lesson: url.searchParams.get('lesson') === null ? null : Number(url.searchParams.get('lesson')),
        grade_before: 'NOT_PASSED',
        reason_before: 'L7 devotional and the book missing.',
        grade_after: book && options.level === 'SOL_2' ? 'PASSED' : 'NOT_PASSED',
        reason_after: book && options.level === 'SOL_2' ? 'Every check met.' : book ? 'L7 devotional missing.' : 'The book missing.',
        not_counted: [],
        // Reading the book makes the grade a pass in a SOL 2 class, so Training files it.
        training: book && options.level === 'SOL_2' ? 'FILES' : null,
        encounter_change: null,
        enrollment: null,
      }),
    );
  });
  await page.route('**/api/v1/equipping/final-grades/grades/*/changes', (route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill(json({ ok: true }, 201));
  });
  await page.route('**/api/v1/equipping/final-grades?*', (route) => {
    if (!route.request().url().includes(`level=${options.level ?? 'SOL_1'}`)) return route.fallback();
    return route.fulfill(
      json({
        data: [
          { id: SOL_CLASS, name: `${solName} A`, day_of_week: 2, time_of_day: '19:00', status: status(phase) },
          { id: id(9302), name: `${solName} B`, day_of_week: 4, time_of_day: '19:00', status: status('WAITING_COORDINATOR') },
        ],
      }),
    );
  });
  await page.route(`**/api/v1/equipping/final-grades/classes/${SOL_CLASS}`, (route) => route.fulfill(json(grades)));
  await page.route(`**/api/v1/equipping/final-grades/classes/${SOL_CLASS}/post`, (route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill(json({ ok: true }));
  });
  return { sent };
}

/**
 * A grade changed after posting (decision 0513): Life Class A posted, read as the Admin reads it,
 * Imelda's lessons changeable and Efren's grade changed once already. Called after
 * `mockFinalGrades(page, 'POSTED')`, whose class read it replaces. Every name is invented.
 */
export async function mockGradeChange(page: Page): Promise<{ sent: { url: string; body: unknown }[] }> {
  const sent: { url: string; body: unknown }[] = [];
  const id = (n: number) => `3f1b7c6e-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const C = 'CAME';
  const lessonsOf = (signs: string[]) =>
    [1, 2, 3, 4, 6, 7, 8, 9].map((lesson, i) => ({
      lesson,
      sign: signs[i],
      made_up_on: signs[i] === 'MADE_UP' ? '2027-02-20' : null,
      held_on: `2027-0${lesson < 6 ? 1 : 2}-${String(10 + lesson).padStart(2, '0')}`,
    }));
  const student = (n: number, name: string, grade: string, reason: string, signs: string[], extra = {}) => ({
    enrollment_id: id(7100 + n),
    person: { id: id(8100 + n), full_name: name, list_name: lastNameFirst(name) },
    grade,
    reason,
    lessons_kept: signs.filter((s) => s !== 'ABSENT').length + 1,
    lessons_made_up: signs.filter((s) => s === 'MADE_UP').length,
    lessons: [...signs.slice(0, 4), 'CAME', ...signs.slice(4)],
    your_disciple: false,
    final_grade_id: id(7200 + n),
    changes_seen: 0,
    changeable: { lessons: lessonsOf(signs), why: null },
    history: [],
    ...extra,
  });
  const grades = {
    class: { id: CLASS_ID, name: 'Life Class A', day_of_week: 2, time_of_day: '19:00', place: 'Room 2' },
    status: {
      phase: 'POSTED',
      missing_lessons: [],
      counts: { passed: 2, not_passed: 1, not_yet: 0 },
      coordinator_check: { by: 'Lito Ramos', at: '2027-03-20T02:00:00.000Z' },
      admin_check: null,
      disciples_for_admin: 0,
      posted: { at: '2027-03-22T02:00:00.000Z' },
    },
    may_check: false,
    checks_as: 'ADMIN',
    may_change: true,
    fingerprint: 'a'.repeat(64),
    students: [
      student(1, 'Efren Quiambao', 'PASSED', 'Every lesson done.', [C, C, 'MADE_UP', C, C, C, C, C], {
        changes_seen: 1,
        // Joined at Lesson 6: lessons 1 to 4 kept from last term's class (decision 0513, point 12).
        changeable: {
          lessons: lessonsOf([C, C, 'MADE_UP', C, C, C, C, C]).map((l) =>
            l.lesson <= 4 ? { ...l, kept: true, recorded_in: 'Life Class B' } : l,
          ),
          why: null,
        },
        history: [
          {
            at: '2027-03-25T02:00:00.000Z',
            by: 'Ada Reyes',
            lesson: 3,
            sign_before: 'ABSENT',
            made_up_on_before: null,
            sign_after: 'MADE_UP',
            made_up_on_after: '2027-03-24',
            why: 'MADE_UP_AFTER_POSTING',
            details: 'Watched the L3 teaching with the Teacher.',
            grade_before: 'NOT_PASSED',
            reason_before: 'L3 not made up.',
            grade_after: 'PASSED',
            reason_after: 'Every lesson done.',
          },
        ],
      }),
      student(2, 'Imelda Tolentino', 'NOT_PASSED', 'L7 not made up.', [C, C, C, C, C, 'ABSENT', C, C]),
      student(5, 'Tomas Aquino', 'PASSED', 'Every lesson done.', [C, C, C, C, C, C, C, C]),
      // In last-name order, as the API sends a school list (decision 0515).
    ].sort(byLastName),
  };
  await page.route(`**/api/v1/equipping/final-grades/classes/${CLASS_ID}`, (route) => route.fulfill(json(grades)));
  await page.route('**/api/v1/equipping/final-grades/grades/*/change-preview?*', (route) => {
    const url = new URL(route.request().url());
    const passes = url.searchParams.get('lesson') === '7' && url.searchParams.get('to') !== 'ABSENT';
    return route.fulfill(
      json({
        lesson: Number(url.searchParams.get('lesson')),
        sign_before: 'ABSENT',
        made_up_on_before: null,
        grade_before: 'NOT_PASSED',
        reason_before: 'L7 not made up.',
        grade_after: passes ? 'PASSED' : 'NOT_PASSED',
        reason_after: passes ? 'Every lesson done.' : 'L7 not made up.',
        joins_at_lesson_6_after: false,
        training: passes ? 'FILES' : null,
      }),
    );
  });
  await page.route('**/api/v1/equipping/final-grades/grades/*/changes', (route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill(json({ grade: 'PASSED' }, 201));
  });
  return { sent };
}

/** The Register form's person read for Wilfredo, with two earlier tries or none (decision 0511). */
export async function mockCandidate(page: Page, tries: boolean, joins = false): Promise<void> {
  // With its level asked for (decision 0514), so any query string.
  await page.route('**/api/v1/equipping/people/3f1b7c6e-0000-4000-8000-00000000f002*', (route) =>
    route.fulfill(
      json({
        person: { id: '3f1b7c6e-0000-4000-8000-00000000f002', member_id: 'M-000519', full_name: 'Wilfredo Sanchez' },
        archived: false,
        leader_name: 'Marites D. Ramos',
        in_a_cell: true,
        cell_leader_name: 'Marites D. Ramos',
        birth_date: '1994-03-02',
        requirements: [
          { code: 'HAS_LEADER', met: true, detail: 'Marites D. Ramos' },
          { code: 'CELL_REGULAR', met: true, detail: 'Came 3 of the last 4 Cell meetings' },
          { code: 'DCC_REGULAR', met: true, detail: 'Came 4 of the last 4 Sundays' },
          { code: 'SUYNL_LESSONS_1_TO_4', met: true, detail: 'Lessons 1 to 4 done' },
        ],
        earlier_tries: tries
          ? [
              { term_year: 2026, term_number: 1, class_name: 'Life Class B', reason: 'More than three absences' },
              { term_year: 2026, term_number: 2, class_name: 'Life Class A', reason: 'Missed three of lessons 1 to 4' },
            ]
          : [],
        joins_at_lesson_6: joins ? { class_name: 'Life Class A', term_year: 2026, term_number: 2 } : null,
      }),
    ),
  );
}

/**
 * SOL 1 A's register (decision 0514, points 8 to 10): ten lessons, 1 and 2 saved and 3 late.
 * Efren came to L1 with both ticks, missed L2 and owes its make-up, and passed the quiz on his
 * first try and read the book. Imelda came to L1 without her devotional, a week now closed, and
 * made L2 up with the verse and without the devotional; she took the quiz once at 60%. Records
 * what each write sent.
 */
export async function mockSolAttendance(
  page: Page,
  options: { notCounted?: boolean; level?: 'SOL_1' | 'SOL_2' } = {},
): Promise<{ sent: { url: string; body: unknown }[] }> {
  const sent: { url: string; body: unknown }[] = [];
  const lesson = (n: number, expected: string, extra: object) => ({
    lesson: n,
    expected_on: expected,
    held_on: null,
    version: null,
    state: 'NOT_YET',
    open: true,
    closes_at: '2026-12-31T16:00:00.000Z',
    ...extra,
  });
  const mark = (n: number, held: string, extra: object) => ({
    lesson: n,
    held_on: held,
    came: true,
    made_up_on: null,
    before_joining: false,
    from_class: null,
    verse: null,
    devotional: null,
    verse_brought_on: null,
    devotional_brought_on: null,
    ...extra,
  });
  const days = ['03', '10', '17', '24'];
  const body = {
    class: {
      id: CLASS_ID,
      name: options.level === 'SOL_2' ? 'SOL 2 A' : 'SOL 1 A',
      level: options.level ?? 'SOL_1',
      day_of_week: 2,
      time_of_day: '19:00',
      place: 'Room 2',
      first_lesson_on: '2026-11-03',
    },
    role: 'TEACHER',
    may_record: true,
    may_correct_closed: false,
    lessons: [
      lesson(1, '2026-11-03', { held_on: '2026-11-03', version: 1, state: 'SAVED', open: false }),
      lesson(2, '2026-11-10', { held_on: '2026-11-10', version: 1, state: 'SAVED' }),
      lesson(3, '2026-11-17', { state: 'LATE' }),
      ...[4, 5, 6, 7, 8, 9, 10].map((n) =>
        lesson(n, `2026-${n < 5 ? '11' : '12'}-${n < 5 ? days[n - 1] : String(n * 7 - 34).padStart(2, '0')}`, {}),
      ),
    ],
    students: [
      {
        enrollment_id: STUDENT_EFREN,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b401', full_name: 'Efren Quiambao', list_name: 'Quiambao, Efren' },
        cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000b501', full_name: 'Gilbert Manalo' },
        guide: { id: '3f1b7c6e-0000-4000-8000-00000000b601', full_name: 'Benjie Lacson' },
        joined_on: '2026-11-02',
        carried: null,
        encounter: null,
        marks: [
          mark(1, '2026-11-03', { verse: true, devotional: false, devotional_brought_on: '2026-11-24' }),
          mark(2, '2026-11-10', { came: false }),
        ],
        // Try 1 corrected from 12, by the Admin (owner, 2026-11-26).
        quiz: {
          tries: [
            {
              try: 1,
              score: 15,
              corrected_from: 12,
              corrected_by: { account_id: '3f1b7c6e-0000-4000-8000-00000000b701', full_name: 'Ada Ramos' },
              corrected_on: '2026-11-20',
            },
          ],
          not_counted: options.notCounted ? [{ try: 2, score: 13 }] : [],
          passed: true,
          retakes_left: 0,
          may_add_try: false,
        },
        brought_late: [
          {
            lesson: 1,
            item: 'DEVOTIONAL',
            brought_on: '2026-11-24',
            ticked_by: { account_id: '3f1b7c6e-0000-4000-8000-00000000b701', full_name: 'Ada Ramos' },
          },
        ],
        book_read: true,
        verses: 1,
        devotionals: 1,
        still_missing: { make_ups: [2], verses: [], devotionals: [], quiz: false, book: false },
      },
      {
        enrollment_id: STUDENT_IMELDA,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b402', full_name: 'Imelda Tolentino', list_name: 'Tolentino, Imelda' },
        cell_leader: null,
        guide: null,
        joined_on: '2026-11-02',
        carried: null,
        encounter: null,
        marks: [
          mark(1, '2026-11-03', { verse: true, devotional: false }),
          mark(2, '2026-11-10', { came: false, made_up_on: '2026-11-20', verse: true, devotional: false }),
        ],
        quiz: { tries: [{ try: 1, score: 12 }], passed: false, retakes_left: 2, may_add_try: true },
        book_read: false,
        verses: 2,
        devotionals: 0,
        still_missing: { make_ups: [], verses: [], devotionals: [1, 2], quiz: true, book: true },
      },
    ],
    owed: [
      {
        enrollment_id: STUDENT_EFREN,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b401', full_name: 'Efren Quiambao', list_name: 'Quiambao, Efren' },
        cell_leader: { id: '3f1b7c6e-0000-4000-8000-00000000b501', full_name: 'Gilbert Manalo' },
        lesson: 2,
        held_on: '2026-11-10',
        before_joining: false,
      },
    ],
    quiz: { items: 20 },
    owed_items: [
      {
        enrollment_id: STUDENT_IMELDA,
        person: { id: '3f1b7c6e-0000-4000-8000-00000000b402', full_name: 'Imelda Tolentino', list_name: 'Tolentino, Imelda' },
        cell_leader: null,
        lessons: [
          { lesson: 1, items: ['DEVOTIONAL'], owed_since: '2026-11-03', made_up: false },
          { lesson: 2, items: ['DEVOTIONAL'], owed_since: '2026-11-20', made_up: true },
        ],
      },
    ],
  };
  await page.route(`**/api/v1/equipping/classes/${CLASS_ID}/attendance`, (route) => route.fulfill(json(body)));
  for (const path of ['lessons/*', 'make-ups', 'items-brought', 'items-brought/untick', 'quiz', 'quiz-tries', 'books']) {
    await page.route(`**/api/v1/equipping/classes/${CLASS_ID}/${path}`, (route) => {
      sent.push({ url: route.request().url(), body: route.request().postDataJSON() as unknown });
      return route.fulfill(json({}, 201));
    });
  }
  return { sent };
}
