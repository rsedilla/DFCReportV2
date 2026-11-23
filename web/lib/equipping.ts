import { authenticatedRequest } from './session';

/**
 * Equipping as this client sees it (SKILL.md section 29, decision 0499): Registration and
 * Enrollment for Life Class. Every route needs `equipping.manage` at Whole Church, which the
 * API checks.
 */

export type EquippingLevel = 'LIFE_CLASS';
export type RequirementCode = 'HAS_LEADER' | 'CELL_REGULAR' | 'DCC_REGULAR' | 'SUYNL_LESSONS_1_TO_4';
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
export const REQUIREMENT_LABELS: Record<RequirementCode, string> = {
  HAS_LEADER: 'Has a leader',
  CELL_REGULAR: 'Regular in a Cell Group',
  DCC_REGULAR: 'Regular in DCC',
  SUYNL_LESSONS_1_TO_4: 'SUYNL: lessons 1 to 4',
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
}

export interface Registration {
  id: string;
  person: { id: string; member_id: string | null; full_name: string | null };
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
}

export interface EquippingClass {
  id: string;
  name: string;
  day_of_week: number;
  time_of_day: string;
  place: string | null;
  first_lesson_on: string;
  encounter_season_id: string;
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
  person: { id: string; full_name: string | null };
  sex: 'MALE' | 'FEMALE' | null;
  cell_leader: { id: string; full_name: string | null } | null;
  guide: { id: string; full_name: string | null } | null;
}

export interface ClassGuide {
  id: string;
  person: { id: string; full_name: string | null };
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
    encounter_weekends: { mens: string | null; womens: string | null };
  };
  enrolled: {
    enrollment_id: string;
    registration_id: string;
    person: { id: string; full_name: string | null };
  }[];
  ready: {
    registration_id: string;
    person: { id: string; full_name: string | null };
    leader_name: string | null;
    with_exception: boolean;
    birthday_recorded: boolean;
    age_at_encounter: number | null;
    blocked: string | null;
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

export async function getCandidate(personId: string, signal?: AbortSignal): Promise<Candidate> {
  return authenticatedRequest(`/api/v1/equipping/people/${encodeURIComponent(personId)}`, { signal });
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
    bible_confirmed: boolean;
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
    encounter_season_id: string;
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
export async function listCoordinatedClasses(
  term: Term,
  signal?: AbortSignal,
): Promise<{ data: CoordinatedClass[] }> {
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
export async function searchGuides(term: string, signal?: AbortSignal): Promise<{ data: FoundPerson[] }> {
  return authenticatedRequest(`/api/v1/equipping/guides?q=${encodeURIComponent(term)}`, { signal });
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
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/enrollments`, {
    method: 'POST',
    body: { registration_ids: registrationIds },
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

/** A class the reader teaches or guides (decision 0501, point 21). */
export interface MyClass {
  id: string;
  name: string;
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
  person: { id: string; full_name: string | null };
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
  person: { id: string; full_name: string | null };
  cell_leader: { id: string; full_name: string | null } | null;
  guide: { id: string; full_name: string | null } | null;
  /** The day they joined this class (decision 0503). */
  joined_on: string;
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
  }[];
}

export interface ClassAttendance {
  class: {
    id: string;
    name: string;
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
    person: { id: string; full_name: string | null };
    cell_leader: { id: string; full_name: string | null } | null;
    lesson: number;
    held_on: string | null;
    before_joining: boolean;
  }[];
}

export async function getClassAttendance(classId: string, signal?: AbortSignal): Promise<ClassAttendance> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/attendance`, { signal });
}

export async function saveLesson(
  classId: string,
  lesson: number,
  body: { held_on: string; came: string[]; version?: number; correction_reason?: string },
  idempotencyKey: string,
): Promise<{ lesson: number; version: number; came: number; absent: number }> {
  return authenticatedRequest(
    `/api/v1/equipping/classes/${encodeURIComponent(classId)}/lessons/${lesson}`,
    { method: 'POST', body, idempotencyKey },
  );
}

export async function recordMakeUp(
  classId: string,
  body: { enrollment_id: string; lesson: number; made_up_on: string },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest(`/api/v1/equipping/classes/${encodeURIComponent(classId)}/make-ups`, {
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
    person: { id: string; full_name: string | null };
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
    person: { id: string; full_name: string | null };
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

export interface ClassGrades {
  class: { id: string; name: string; day_of_week: number; time_of_day: string; place: string | null };
  status: GradesStatus;
  may_check: boolean;
  checks_as: 'ADMIN' | 'COORDINATOR';
  fingerprint: string;
  students: {
    enrollment_id: string;
    person: { id: string; full_name: string | null };
    grade: FinalGrade;
    reason: string;
    lessons_kept: number;
    lessons_made_up: number;
    lessons: EncounterSign[];
    your_disciple: boolean;
  }[];
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
