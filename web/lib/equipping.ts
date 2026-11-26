import { authenticatedRequest } from './session';

/**
 * Equipping as this client sees it (SKILL.md section 29, decision 0499): Registration and
 * Enrollment for Life Class. Every route needs `equipping.manage` at Whole Church, which the
 * API checks.
 */

export type EquippingLevel = 'LIFE_CLASS' | 'SOL_1';

/** The levels the school runs, in order (decisions 0499 and 0514). */
export const EQUIPPING_LEVELS: readonly EquippingLevel[] = ['LIFE_CLASS', 'SOL_1'];

export const LEVEL_LABELS: Record<EquippingLevel, string> = {
  LIFE_CLASS: 'Life Class',
  SOL_1: 'SOL 1',
};

export type RequirementCode =
  | 'HAS_LEADER'
  | 'CELL_REGULAR'
  | 'DCC_REGULAR'
  | 'SUYNL_LESSONS_1_TO_4'
  | 'LIFE_CLASS_PASSED'
  | 'WIN_3'
  | 'SOL_1_MANUAL';
export type RegistrationStatus =
  | 'REGISTERED'
  | 'REGISTERED_WITH_EXCEPTION'
  | 'ENROLLED'
  | 'CANCELLED';

export interface Term {
  level: EquippingLevel;
  term_year: number;
  term_number: number;
}

/** The four record requirements, in the words the form shows (decision 0499, point 6). */
/**
 * The name a school list shows in its name column, last name first (decision 0515): *Aquino,
 * Tomas R.* A sentence or a dialog's title keeps `full_name`.
 */
export function listName(person: { full_name: string | null; list_name?: string | null }): string | null {
  return person.list_name ?? person.full_name;
}

export const REQUIREMENT_LABELS: Record<RequirementCode, string> = {
  HAS_LEADER: 'Has a leader',
  CELL_REGULAR: 'Regular in a Cell Group',
  DCC_REGULAR: 'Regular in DCC',
  SUYNL_LESSONS_1_TO_4: 'SUYNL: lessons 1 to 4',
  // SOL 1's three (decision 0514).
  LIFE_CLASS_PASSED: 'Life Class passed',
  WIN_3: 'Win 3, or 3 disciples',
  SOL_1_MANUAL: 'Has the SOL 1 Manual',
};

export const STATUS_LABELS: Record<RegistrationStatus, string> = {
  REGISTERED: 'Registered',
  REGISTERED_WITH_EXCEPTION: 'Registered with exception',
  ENROLLED: 'Enrolled',
  CANCELLED: 'Cancelled',
};

export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export interface FoundPerson {
  id: string;
  member_id: string;
  full_name: string;
  direct_leader_name: string | null;
  /** The Guide search's reason they may guide, e.g. "Passed SOL 1" (decision 0501, point 4). */
  qualifies?: string | null;
}

export interface Candidate {
  person: { id: string; member_id: string; full_name: string };
  archived: boolean;
  leader_name: string | null;
  in_a_cell: boolean;
  cell_leader_name: string | null;
  birth_date: string | null;
  requirements: { code: RequirementCode; met: boolean; detail: string }[];
  /** Each earlier Life Class graded *Not passed*, oldest first (decision 0511). */
  earlier_tries?: { term_year: number; term_number: number; class_name: string; reason: string }[];
  /** Joins a later class at Lesson 6, keeping lessons 1 to 4 from there (decision 0512). */
  joins_at_lesson_6?: KeptFrom | null;
}

/** Where a student joining at Lesson 6 kept lessons 1 to 4 and the Encounter (decision 0512). */
export interface KeptFrom {
  class_name: string;
  term_year: number;
  term_number: number;
}

export interface Registration {
  id: string;
  person: { id: string; member_id: string | null; full_name: string | null; list_name?: string | null };
  leader_name: string | null;
  birthday_recorded: boolean;
  status: RegistrationStatus;
  unmet: RequirementCode[];
  exception_reason: string | null;
  note: string | null;
  class: { id: string; name: string } | null;
  enrollment_id: string | null;
  registered_at: string;
  cancel_reason: string | null;
  /** Which try this is: 1 and the tries in earlier terms (decision 0511). */
  try_number?: number;
}

export interface EquippingClass {
  id: string;
  name: string;
  day_of_week: number;
  time_of_day: string;
  place: string | null;
  first_lesson_on: string;
  /** Null for a SOL 1 class, which has no Encounter (decision 0514). */
  encounter_season_id: string | null;
  run_by: 'CHURCH';
  /** Null until the Coordinator names one (decision 0501). */
  teacher: { id: string; full_name: string | null } | null;
  enrolled: number;
}

/** A class as the Coordinator's *Classes* lists it (decision 0501, point 22). */
export interface CoordinatedClass extends EquippingClass {
  /** A cancelled class is listed only under *Cancelled* (decision 0510). */
  status: 'NOT_STARTED' | 'RUNNING' | 'CANCELLED';
  /** Whether a lesson is saved: *When and where* and *Cancel class* stop then (decision 0510). */
  lesson_saved?: boolean;
  /** The day it was cancelled, in Manila, and why (decision 0510). */
  cancelled_on?: string;
  cancel_reason?: string | null;
  /** How many Guides are named, and how many more the students of each sex need (decision 0501). */
  guides?: { named: number; short_men: number; short_women: number };
  /**
   * Lessons late, and lessons whose week closed with nothing recorded, said in words: *L1 not
   * recorded · L3 late* (decision 0501, point 22).
   */
  lessons?: { late: number[]; not_recorded: number[] };
}

/** One enrolled student as the Coordinator's *Students* shows them (decision 0501). */
export interface ClassStudent {
  enrollment_id: string;
  person: { id: string; full_name: string | null; list_name?: string | null };
  sex: 'MALE' | 'FEMALE' | null;
  cell_leader: { id: string; full_name: string | null } | null;
  guide: { id: string; full_name: string | null } | null;
}

export interface ClassGuide {
  id: string;
  person: { id: string; full_name: string | null; list_name?: string | null };
  sex: 'MALE' | 'FEMALE' | null;
  /** Archived since being named: keeps their students and takes no new ones (decision 0502). */
  archived?: boolean;
}

/** A clash with a Cell the person leads, under the two-hour rule (decision 0392). */
export interface CellClash {
  day_of_week: number;
  time_of_day: string;
}

export interface ClassDetail {
  class: Omit<EquippingClass, 'enrolled'> & {
    level: EquippingLevel;
    encounter_weekends: { mens: string | null; womens: string | null };
    /**
     * Its Lesson 6's day, and whether it still takes a student at Lesson 6 (decision 0512); null
     * for a SOL 1 class (decision 0514).
     */
    lesson_6?: { on: string; open: boolean } | null;
  };
  enrolled: {
    enrollment_id: string;
    registration_id: string;
    person: { id: string; full_name: string | null; list_name?: string | null };
  }[];
  ready: {
    registration_id: string;
    person: { id: string; full_name: string | null; list_name?: string | null };
    leader_name: string | null;
    with_exception: boolean;
    birthday_recorded: boolean;
    age_at_encounter: number | null;
    blocked: string | null;
    try_number?: number;
    joins_at_lesson_6?: KeptFrom | null;
  }[];
}

const termQuery = (term: Term) =>
  new URLSearchParams({
    level: term.level,
    term_year: String(term.term_year),
    term_number: String(term.term_number),
  }).toString();

/** The Registrar's person picker. A Teacher is found with `searchTeachers` (decision 0501). */
export async function searchPeople(q: string, signal?: AbortSignal): Promise<{ data: FoundPerson[] }> {
  const params = new URLSearchParams({ q });
  return authenticatedRequest(`/api/v1/equipping/people?${params.toString()}`, {
    signal,
  });
}

export async function getCandidate(
  personId: string,
  level: EquippingLevel,
  signal?: AbortSignal,
): Promise<Candidate> {
  return authenticatedRequest(
    `/api/v1/equipping/people/${encodeURIComponent(personId)}?level=${level}`,
    { signal },
  );
}

/** How many are registered for each level in a term (decision 0514), for the Level picker. */
export async function getRegistrationCounts(
  term: Pick<Term, 'term_year' | 'term_number'>,
  signal?: AbortSignal,
): Promise<Record<EquippingLevel, number>> {
  return authenticatedRequest(
    `/api/v1/equipping/registrations/counts?term_year=${term.term_year}&term_number=${term.term_number}`,
    { signal },
  );
}

export async function listRegistrations(
  term: Term,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<{ data: Registration[]; next_cursor: string | null }> {
  const query = termQuery(term) + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
  return authenticatedRequest(`/api/v1/equipping/registrations?${query}`, { signal });
}

/** The key is the caller's, so a retry after a lost answer is the same request. */
export async function register(
  input: Term & {
    person_id: string;
    /** Life Class only (decision 0514). */
    bible_confirmed?: boolean;
    manual_confirmed: boolean;
    exception_reason?: string;
    note?: string;
  },
  idempotencyKey: string,
): Promise<{ id: string; status: RegistrationStatus }> {
  return authenticatedRequest('/api/v1/equipping/registrations', {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

export async function cancelRegistration(
  registrationId: string,
  reason: string,
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(
    `/api/v1/equipping/registrations/${encodeURIComponent(registrationId)}/cancel`,
    { method: 'POST', body: { reason }, idempotencyKey },
  );
}

export async function listClasses(term: Term, signal?: AbortSignal): Promise<{ data: EquippingClass[] }> {
  return authenticatedRequest(`/api/v1/equipping/classes?${termQuery(term)}`, { signal });
}

export async function getClass(classId: string, signal?: AbortSignal): Promise<ClassDetail> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}`, { signal });
}

export async function openClass(
  input: Term & {
    name: string;
    day_of_week: number;
    time_of_day: string;
    place?: string;
    first_lesson_on: string;
    teacher_person_id?: string;
    /** Life Class only; a SOL 1 class names no Encounter weekend (decision 0514). */
    encounter_season_id?: string;
  },
  idempotencyKey: string,
): Promise<
  EquippingClass & {
    clash?: CellClash | null;
    /** Whether the Teacher named can record the class (decision 0503). */
    account?: 'ACTIVE' | 'PENDING_ACTIVATION' | 'DISABLED' | 'NONE' | null;
  }
> {
  return authenticatedRequest('/api/v1/equipping/classes', {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

/** The Coordinator's *Classes* (decision 0501). */
/** The levels the reader coordinates, every level for the Admin (decision 0514). */
export async function listCoordinatorLevels(signal?: AbortSignal): Promise<{ data: EquippingLevel[] }> {
  return authenticatedRequest('/api/v1/equipping/coordinate/levels', { signal });
}

export async function listCoordinatedClasses(
  term: Term,
  signal?: AbortSignal,
): Promise<{ data: CoordinatedClass[]; other_coordinators?: string[] }> {
  return authenticatedRequest(`/api/v1/equipping/coordinate/classes?${termQuery(term)}`, { signal });
}

export async function listCoordinatorSeasons(
  signal?: AbortSignal,
): Promise<{ data: EncounterSeasonChoice[] }> {
  return authenticatedRequest('/api/v1/equipping/coordinate/encounter-seasons', { signal });
}

export async function listClassStudents(
  classId: string,
  signal?: AbortSignal,
): Promise<{ class: { id: string; name: string }; guides: ClassGuide[]; data: ClassStudent[] }> {
  return authenticatedRequest(
    `/api/v1/equipping/coordinate/classes/${encodeURIComponent(classId)}/students`,
    { signal },
  );
}

/** The Coordinator's Guide search: who may guide Life Class, SOL 1 passed and in the tree. */
export async function searchGuides(
  term: string,
  signal?: AbortSignal,
  level: EquippingLevel = 'LIFE_CLASS',
): Promise<{ data: FoundPerson[] }> {
  return authenticatedRequest(
    `/api/v1/equipping/guides?q=${encodeURIComponent(term)}&level=${level}`,
    { signal },
  );
}

export async function nameGuide(classId: string, personId: string, idempotencyKey: string): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/guides`, {
    method: 'POST',
    body: { person_id: personId },
    idempotencyKey,
  });
}

export async function removeGuide(classId: string, guideId: string, idempotencyKey: string): Promise<unknown> {
  return authenticatedRequest(
    `/api/v1/equipping/classes/${encodeURIComponent(classId)}/guides/${encodeURIComponent(guideId)}/remove`,
    { method: 'POST', body: {}, idempotencyKey },
  );
}

export async function swapGuide(enrollmentId: string, guideId: string, idempotencyKey: string): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/enrollments/${encodeURIComponent(enrollmentId)}/guide`, {
    method: 'POST',
    body: { guide_id: guideId },
    idempotencyKey,
  });
}

/** The Coordinator's Teacher search: current Cell Leaders in the tree only. */
export async function searchTeachers(term: string, signal?: AbortSignal): Promise<{ data: FoundPerson[] }> {
  return authenticatedRequest(`/api/v1/equipping/teachers?q=${encodeURIComponent(term)}`, { signal });
}

export async function teacherClash(
  classId: string,
  personId: string,
  signal?: AbortSignal,
): Promise<{
  clash: CellClash | null;
  /** Whether they can record the class (decision 0503): their account's state, or NONE. */
  account?: 'ACTIVE' | 'PENDING_ACTIVATION' | 'DISABLED' | 'NONE' | null;
}> {
  return authenticatedRequest(
    `/api/v1/equipping/coordinate/classes/${encodeURIComponent(classId)}/clash?person_id=${encodeURIComponent(personId)}`,
    { signal },
  );
}

export async function setTeacher(
  classId: string,
  teacherPersonId: string,
  idempotencyKey: string,
): Promise<{ id: string; teacher: { id: string; full_name: string }; clash: CellClash | null }> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/teacher`, {
    method: 'POST',
    body: { teacher_person_id: teacherPersonId },
    idempotencyKey,
  });
}

/** Corrects a class's day, time, place and first lesson (decision 0510). */
export async function correctClass(
  classId: string,
  body: { day_of_week: number; time_of_day: string; place: string | null; first_lesson_on: string },
  idempotencyKey: string,
): Promise<{ id: string; corrected: boolean; clash: CellClash | null }> {
  return authenticatedRequest(
    `/api/v1/equipping/classes/${encodeURIComponent(classId)}/correction`,
    { method: 'POST', body, idempotencyKey },
  );
}

/** Cancels a class with no students and no lesson saved; never a delete (decision 0510). */
export async function cancelClass(
  classId: string,
  reason: string,
  idempotencyKey: string,
): Promise<{ id: string; status: 'CANCELLED'; cancelled_on: string; cancel_reason: string }> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/cancel`, {
    method: 'POST',
    body: { reason },
    idempotencyKey,
  });
}

export async function enroll(
  classId: string,
  registrationIds: string[],
  idempotencyKey: string,
  startFromLesson1: string[] = [],
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/enrollments`, {
    method: 'POST',
    body: {
      registration_ids: registrationIds,
      // Those who could join at Lesson 6 and are started from Lesson 1 instead (decision 0512).
      ...(startFromLesson1.length > 0 ? { start_from_lesson_1: startFromLesson1 } : {}),
    },
    idempotencyKey,
  });
}

export async function moveEnrollment(
  enrollmentId: string,
  classId: string,
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/enrollments/${encodeURIComponent(enrollmentId)}/move`, {
    method: 'POST',
    body: { class_id: classId },
    idempotencyKey,
  });
}

export async function withdrawEnrollment(
  enrollmentId: string,
  reason: string,
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(
    `/api/v1/equipping/enrollments/${encodeURIComponent(enrollmentId)}/withdraw`,
    { method: 'POST', body: { reason }, idempotencyKey },
  );
}

/** An Encounter season a class may name, both weekends (decision 0499, point 10). */
export interface EncounterSeasonChoice {
  id: string;
  mens_encounter_on: string;
  womens_encounter_on: string;
}

/** The term a screen opens on: the year now, Term 1 to 3 by the month (Jan to Apr, May to Aug, Sep to Dec). */
export function currentTerm(today: Date = new Date()): Term {
  const month = today.getMonth();
  return {
    level: 'LIFE_CLASS',
    term_year: today.getFullYear(),
    term_number: month < 4 ? 1 : month < 8 ? 2 : 3,
  };
}

export function termLabel(term: Pick<Term, 'term_year' | 'term_number'>): string {
  return `Term ${term.term_number}, ${term.term_year}`;
}

/** *2nd*, *3rd*, *11th*, *22nd*. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** *2nd try* and on, or nothing for a first try (decision 0511). */
export function tryLabel(tryNumber: number | undefined): string | null {
  return tryNumber !== undefined && tryNumber > 1 ? `${ordinal(tryNumber)} try` : null;
}

/** A class the reader teaches or guides (decision 0501, point 21). */
export interface MyClass {
  id: string;
  name: string;
  level: EquippingLevel;
  day_of_week: number;
  time_of_day: string;
  first_lesson_on: string;
  role: 'TEACHER' | 'GUIDE';
}

export async function listMyClasses(signal?: AbortSignal): Promise<{ data: MyClass[] }> {
  return authenticatedRequest('/api/v1/equipping/my-classes', { signal });
}

/** One of the reader's people in the school, read only (decisions 0501 and 0504). */
export interface MyPerson {
  enrollment_id: string;
  person: { id: string; full_name: string | null; list_name?: string | null };
  level: string;
  /** One of the reader's twelve. */
  twelve: boolean;
  /** The one of the reader's twelve they are reached through; null for one of the twelve. */
  through: { id: string; full_name: string | null } | null;
  class: { id: string; name: string };
  teacher: { id: string; full_name: string | null } | null;
  guide: { id: string; full_name: string | null } | null;
  joined_on: string;
  /** The ENC column (decision 0507): attended, enrolled and not yet recorded, or missed. */
  encounter?: 'CAME' | 'ENROLLED' | 'MISSED' | null;
  /**
   * SOL's card (decision 0514, point 14): what is still missing so far, the verses and
   * devotionals out of ten, the quiz as passed or not and never its score, and the book.
   */
  sol?: {
    verses: number;
    devotionals: number;
    quiz: 'PASSED' | 'NOT_PASSED' | 'NOT_TAKEN';
    book: boolean;
    still_missing: string[];
  };
  marks: AttendanceStudent['marks'];
}

export async function listMyPeople(signal?: AbortSignal): Promise<{ data: MyPerson[] }> {
  return authenticatedRequest('/api/v1/equipping/my-people', { signal });
}

/** Where a lesson stands (decision 0503). */
export type LessonState = 'SAVED' | 'NOT_YET' | 'TODAY' | 'TO_RECORD' | 'LATE' | 'NOT_RECORDED';

export interface ClassLesson {
  lesson: number;
  expected_on: string;
  held_on: string | null;
  version: number | null;
  state: LessonState;
  open: boolean;
  closes_at: string;
}

export interface AttendanceStudent {
  enrollment_id: string;
  person: { id: string; full_name: string | null; list_name?: string | null };
  cell_leader: { id: string; full_name: string | null } | null;
  guide: { id: string; full_name: string | null } | null;
  /** The day they joined this class (decision 0503). */
  joined_on: string;
  /** Joined at Lesson 6, keeping lessons 1 to 4 and the Encounter from there (decision 0512). */
  carried?: KeptFrom | null;
  /** The ENC column (decision 0507): attended, enrolled and not yet recorded, or missed. */
  encounter?: 'CAME' | 'ENROLLED' | 'MISSED' | null;
  marks: {
    lesson: number;
    came: boolean;
    made_up_on: string | null;
    held_on: string;
    /** Held here before they joined: owed as a make-up, not an absence (decision 0503). */
    before_joining: boolean;
    /** The class it was marked in, for a student moved since; null for this class. */
    from_class: { id: string; name: string } | null;
    /** SOL: the memory verse and devotional, from the lesson or its make-up (decision 0514). */
    verse?: boolean | null;
    devotional?: boolean | null;
    /** SOL: the day each was brought, if it came after the lesson (decision 0514, point 10). */
    verse_brought_on?: string | null;
    devotional_brought_on?: string | null;
  }[];
  /**
   * SOL's quiz, book and counts (decision 0514, point 8); absent on Life Class. A corrected try
   * names the score it replaced, and a try left behind by an earlier one corrected to a pass is
   * kept and not counted (owner, 2026-11-26).
   */
  quiz?: {
    tries: {
      try: number;
      score: number;
      corrected_from?: number;
      corrected_by?: { account_id: string; full_name: string | null } | null;
      corrected_on?: string;
    }[];
    not_counted?: { try: number; score: number }[];
    passed: boolean;
    retakes_left: number;
    may_add_try: boolean;
  };
  /** SOL: each verse or devotional ticked late, which the Teacher may untick (owner, 2026-11-26). */
  brought_late?: {
    lesson: number;
    item: SolItem;
    brought_on: string;
    ticked_by: { account_id: string; full_name: string | null } | null;
  }[];
  book_read?: boolean;
  verses?: number;
  devotionals?: number;
  still_missing?: {
    make_ups: number[];
    verses: number[];
    devotionals: number[];
    quiz: boolean;
    book: boolean;
  };
}

/** One row of SOL's *Verses and devotionals still owed* (decision 0514, point 10). */
export interface OwedItems {
  enrollment_id: string;
  person: { id: string; full_name: string | null; list_name?: string | null };
  cell_leader: { id: string; full_name: string | null } | null;
  lessons: { lesson: number; items: SolItem[]; owed_since: string; made_up: boolean }[];
}

export type SolItem = 'VERSE' | 'DEVOTIONAL';

export interface ClassAttendance {
  class: {
    id: string;
    name: string;
    level: EquippingLevel;
    day_of_week: number;
    time_of_day: string;
    place: string | null;
    first_lesson_on: string;
  };
  role: 'TEACHER' | 'GUIDE' | 'COORDINATOR' | 'ADMIN';
  may_record: boolean;
  may_correct_closed: boolean;
  lessons: ClassLesson[];
  students: AttendanceStudent[];
  owed: {
    enrollment_id: string;
    person: { id: string; full_name: string | null; list_name?: string | null };
    cell_leader: { id: string; full_name: string | null } | null;
    lesson: number;
    held_on: string | null;
    before_joining: boolean;
  }[];
  /** SOL: the quiz's number of items, null until the Teacher enters it. */
  quiz?: { items: number | null };
  owed_items?: OwedItems[];
}

export async function getClassAttendance(classId: string, signal?: AbortSignal): Promise<ClassAttendance> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/attendance`, { signal });
}

export async function saveLesson(
  classId: string,
  lesson: number,
  body: {
    held_on: string;
    came: string[];
    verse?: string[];
    devotional?: string[];
    version?: number;
    correction_reason?: string;
  },
  idempotencyKey: string,
): Promise<{ lesson: number; version: number; came: number; absent: number }> {
  return authenticatedRequest(
    `/api/v1/equipping/classes/${encodeURIComponent(classId)}/lessons/${lesson}`,
    { method: 'POST', body, idempotencyKey },
  );
}

export async function recordMakeUp(
  classId: string,
  body: { enrollment_id: string; lesson: number; made_up_on: string; verse?: boolean; devotional?: boolean },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/make-ups`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

/** A SOL verse or devotional brought after its lesson (decision 0514, point 10). */
export async function recordItemsBrought(
  classId: string,
  body: { enrollment_id: string; lesson: number; items: SolItem[]; brought_on: string },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/items-brought`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

/** A late verse or devotional ticked by mistake, unticked (owner, 2026-11-26). */
export async function untickItemBrought(
  classId: string,
  body: { enrollment_id: string; lesson: number; item: SolItem },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/items-brought/untick`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

/** A SOL class's quiz: its number of items (decision 0501, point 18). */
export async function setQuiz(classId: string, body: { items: number }, idempotencyKey: string): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/quiz`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

/** One SOL quiz try's score (decision 0501, point 18; owner, 2026-11-26). */
export async function recordQuizTry(
  classId: string,
  body: { enrollment_id: string; try: number; score: number },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/quiz-tries`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

/** Whether a SOL student read the book (decision 0501, point 18; owner, 2026-11-26). */
export async function recordBook(
  classId: string,
  body: { enrollment_id: string; read: boolean },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/books`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// The Encounter (decision 0501, point 14; decision 0507)
// ---------------------------------------------------------------------------

export type EncounterNetwork = 'MENS' | 'WOMENS';
export type EncounterStatus = 'CLEARED' | 'NEEDS_MAKE_UP' | 'CANT_GO';
export type EncounterSign = 'CAME' | 'MADE_UP' | 'ABSENT' | 'BEFORE_JOINING' | 'NONE';

/** One Network's weekend: who is cleared, who waits for a make-up, who can't go, and who is in. */
export interface EncounterList {
  network: EncounterNetwork;
  seasons: { id: string; weekend_on: string }[];
  season: { id: string; weekend_on: string } | null;
  phase?: 'ENROLLING' | 'RECORDING';
  students?: {
    enrollment_id: string;
    person: { id: string; full_name: string | null; list_name?: string | null };
    class: { id: string; name: string };
    cell_leader: { id: string; full_name: string | null } | null;
    status: EncounterStatus;
    reasons: string[];
    age_on_weekend: number | null;
    lessons: EncounterSign[];
    missed_weekend_on: string | null;
    from_weekend_on: string | null;
  }[];
  waiting?: { class: { id: string; name: string }; lesson_4_on: string }[];
  enrolled?: {
    encounter_enrollment_id: string;
    person: { id: string; full_name: string | null; list_name?: string | null };
    class: { id: string; name: string };
    came: boolean | null;
  }[];
}

export async function getEncounter(
  network: EncounterNetwork,
  seasonId: string | null,
  signal?: AbortSignal,
): Promise<EncounterList> {
  const params = new URLSearchParams({ network });
  if (seasonId !== null) {
    params.set('season_id', seasonId);
  }
  return authenticatedRequest(`/api/v1/equipping/encounter?${params.toString()}`, { signal });
}

export async function enrollEncounter(
  body: { season_id: string; network: EncounterNetwork; enrollment_ids: string[] },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest('/api/v1/equipping/encounter/enrollments', {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

export async function saveEncounterAttendance(
  body: { season_id: string; network: EncounterNetwork; came: string[] },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest('/api/v1/equipping/encounter/attendance', {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// Final grades (decision 0501, points 15 and 16; decision 0508)
// ---------------------------------------------------------------------------

export type FinalGrade = 'PASSED' | 'NOT_PASSED' | 'NOT_YET';
export type GradesPhase = 'NOT_READY' | 'WAITING_COORDINATOR' | 'WAITING_ADMIN' | 'READY' | 'POSTED';

/** Where a class stands: lessons recorded, checked, posted. */
export interface GradesStatus {
  phase: GradesPhase;
  missing_lessons: number[];
  counts: { passed: number; not_passed: number; not_yet: number };
  coordinator_check: { by: string | null; at: string } | null;
  admin_check: { by: string | null; at: string } | null;
  disciples_for_admin: number;
  posted: { at: string } | null;
}

/** What a change after posting sets a lesson to, and why (decision 0513). */
export type GradeChangeTo = 'CAME' | 'ABSENT' | 'MADE_UP';
export type GradeChangeWhy = 'MADE_UP_AFTER_POSTING' | 'RECORDED_WRONGLY';
export type GradeChangeSign = GradeChangeTo | 'BEFORE_JOINING';

/**
 * The Encounter the grade as it stood read, and what it reads now, where they differ (decision
 * 0513, point 14). The grade reads it as attended or not, so `before` is that alone.
 */
export interface EncounterChange {
  before: 'CAME' | 'NOT_CAME';
  now: 'CAME' | 'MISSED' | 'ENROLLED' | 'NONE';
}

/** What a change does to the graded enrollment (decision 0513, point 10). */
export type EnrollmentEffect = 'ENDS' | 'REOPENS';

/** One change of a posted grade, as its history lists it (decision 0513). */
/** What a SOL change reaches (decision 0514, point 12); a Life Class change is attendance. */
export type GradeChangeItem = 'ATTENDANCE' | 'VERSE' | 'DEVOTIONAL' | 'QUIZ' | 'BOOK';

/** One change, as the change dialog sends it. */
export interface GradeChangeInput {
  item?: GradeChangeItem;
  lesson?: number;
  to?: GradeChangeTo;
  made_up_on?: string;
  handed_in?: boolean;
  brought_on?: string;
  try?: number;
  score?: number;
  read?: boolean;
}

export interface GradeChange {
  at: string;
  by: string | null;
  item?: GradeChangeItem;
  lesson: number | null;
  sign_before: GradeChangeSign | null;
  made_up_on_before: string | null;
  sign_after: GradeChangeTo | null;
  made_up_on_after: string | null;
  /** SOL: a verse or devotional HANDED_IN or NOT_HANDED_IN, the book READ or NOT_READ. */
  value_before?: string | null;
  value_after?: string | null;
  brought_on?: string | null;
  quiz_try?: number | null;
  score_before?: number | null;
  score_after?: number | null;
  why: GradeChangeWhy;
  details: string;
  grade_before: FinalGrade;
  reason_before: string;
  grade_after: FinalGrade;
  reason_after: string;
  encounter_change?: EncounterChange | null;
  enrollment?: EnrollmentEffect | null;
}

/** A SOL student's five checks beside the grade (decision 0514, point 11). */
export interface SolChecklist {
  absences: number;
  made_up: number;
  verses: number;
  devotionals: number;
  quiz: { items: number | null; scores: number[]; passed: boolean };
  book: boolean;
}

export interface ClassGrades {
  class: {
    id: string;
    name: string;
    level?: EquippingLevel;
    day_of_week: number;
    time_of_day: string;
    place: string | null;
  };
  status: GradesStatus;
  may_check: boolean;
  checks_as: 'ADMIN' | 'COORDINATOR';
  /** The Admin, on a posted class (decision 0513). */
  may_change?: boolean;
  fingerprint: string;
  students: {
    enrollment_id: string;
    person: { id: string; full_name: string | null; list_name?: string | null };
    grade: FinalGrade;
    reason: string;
    lessons_kept: number;
    lessons_made_up: number;
    lessons: EncounterSign[];
    /** SOL's checklist (decision 0514, point 11); absent on Life Class. */
    checklist?: SolChecklist;
    your_disciple: boolean;
    /** Once posted (decision 0513). */
    final_grade_id?: string;
    changes_seen?: number;
    changeable?: {
      lessons: {
        lesson: number;
        sign: GradeChangeSign;
        made_up_on: string | null;
        held_on: string;
        /** Recorded in another class: one left this term, or the term it was kept from. */
        recorded_in?: string | null;
        /** Kept from an earlier term, where a change keeps the join at Lesson 6 (point 12). */
        kept?: boolean;
        /** SOL: whether the lesson's verse and devotional count; null for a lesson not done. */
        verse?: boolean | null;
        devotional?: boolean | null;
      }[];
      why: string | null;
    };
    encounter_change?: EncounterChange | null;
    history?: GradeChange[];
  }[];
}

/** What a change would make the grade (decision 0513). */
export interface GradeChangePreview {
  item?: GradeChangeItem;
  lesson: number | null;
  sign_before?: GradeChangeSign;
  made_up_on_before?: string | null;
  /** SOL: later tries a correction to a pass leaves kept and no longer counted. */
  not_counted?: number[];
  grade_before: FinalGrade;
  reason_before: string;
  grade_after: FinalGrade;
  reason_after: string;
  joins_at_lesson_6_after?: boolean;
  training: 'FILES' | 'WITHDRAWS' | null;
  encounter_change?: EncounterChange | null;
  enrollment?: EnrollmentEffect | null;
}

export async function previewGradeChange(
  finalGradeId: string,
  input: GradeChangeInput,
  signal?: AbortSignal,
): Promise<GradeChangePreview> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  return authenticatedRequest(
    `/api/v1/equipping/final-grades/grades/${encodeURIComponent(finalGradeId)}/change-preview?${query.toString()}`,
    { signal },
  );
}

export async function changeGrade(
  finalGradeId: string,
  body: GradeChangeInput & {
    why: GradeChangeWhy;
    details: string;
    changes_seen: number;
  },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/final-grades/grades/${encodeURIComponent(finalGradeId)}/changes`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

export async function listFinalGradeClasses(
  term: Term,
  signal?: AbortSignal,
): Promise<{ data: { id: string; name: string; day_of_week: number; time_of_day: string; status: GradesStatus }[] }> {
  return authenticatedRequest(`/api/v1/equipping/final-grades?${termQuery(term)}`, { signal });
}

export async function getFinalGrades(classId: string, signal?: AbortSignal): Promise<ClassGrades> {
  return authenticatedRequest(`/api/v1/equipping/final-grades/classes/${encodeURIComponent(classId)}`, {
    signal,
  });
}

export async function getCoordinatorGrades(classId: string, signal?: AbortSignal): Promise<ClassGrades> {
  return authenticatedRequest(`/api/v1/equipping/coordinate/classes/${encodeURIComponent(classId)}/grades`, {
    signal,
  });
}

export async function checkClassGrades(
  classId: string,
  fingerprint: string,
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/coordinate/classes/${encodeURIComponent(classId)}/check`, {
    method: 'POST',
    body: { fingerprint },
    idempotencyKey,
  });
}

export async function postClassGrades(classId: string, idempotencyKey: string): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/final-grades/classes/${encodeURIComponent(classId)}/post`, {
    method: 'POST',
    body: {},
    idempotencyKey,
  });
}
