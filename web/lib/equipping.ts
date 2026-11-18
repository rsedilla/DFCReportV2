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
  teacher: { id: string; full_name: string | null };
  enrolled: number;
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

export async function searchPeople(q: string, signal?: AbortSignal): Promise<{ data: FoundPerson[] }> {
  return authenticatedRequest(`/api/v1/equipping/people?${new URLSearchParams({ q }).toString()}`, {
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
    teacher_person_id: string;
    encounter_season_id: string;
  },
  idempotencyKey: string,
): Promise<EquippingClass> {
  return authenticatedRequest('/api/v1/equipping/classes', {
    method: 'POST',
    body: input,
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

export async function listSeasons(signal?: AbortSignal): Promise<{ data: EncounterSeasonChoice[] }> {
  return authenticatedRequest('/api/v1/equipping/encounter-seasons', { signal });
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
