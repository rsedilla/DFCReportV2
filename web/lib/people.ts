import { authenticatedRequest } from './session';

/**
 * The `people` API as this client sees it (SKILL.md sections 3 and 8).
 *
 * **A person comes back in one of two shapes, and the difference is a domain
 * rule rather than a loading state.** Section 8 makes the directory church-wide
 * by name — deliberately, so that duplicate prevention works across branches —
 * and withholds the *details* of anyone outside the viewer's pastoral scope. The
 * API says which it gave you in `scope`, and it says so explicitly rather than
 * leaving fields absent, "so a client can tell a withheld profile from an empty
 * one and say so, rather than rendering a person who looks like they have no
 * details".
 *
 * Every screen here honours that. A withheld row is a real person whose details
 * this viewer may not see; it is never an error, never a lesser record, and
 * never marked as one.
 */

export type Sex = 'MALE' | 'FEMALE';
export type Network = 'MENS' | 'WOMENS';
export type CivilStatus = 'SINGLE' | 'MARRIED' | 'WIDOWED';

/** What section 8 permits for somebody outside the viewer's pastoral scope. */
export interface PersonIdentity {
  scope: 'IDENTITY_ONLY';
  id: string;
  member_id: string;
  full_name: string;
  sex: Sex;
  network: Network | null;
  direct_leader_name: string | null;
}

/** The whole record, for somebody inside it. */
export interface PersonFull {
  scope: 'FULL';
  id: string;
  member_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  full_name: string;
  birth_date: string | null;
  sex: Sex;
  civil_status: CivilStatus;
  mobile_number: string | null;
}

export type Person = PersonIdentity | PersonFull;

export interface PersonPage {
  data: Person[];
  next_cursor: string | null;
}

/**
 * Church-wide search by name, cursor-paginated.
 *
 * Section 22 uses cursors and returns no total count, so no screen here offers
 * "page 3 of 12" or a result count, both of which it would have to invent.
 */
export async function searchPeople(
  q: string,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<PersonPage> {
  const params = new URLSearchParams({ q });
  if (cursor) {
    params.set('cursor', cursor);
  }

  return authenticatedRequest<PersonPage>(`/api/v1/people?${params.toString()}`, { signal });
}

export async function getPerson(id: string, signal?: AbortSignal): Promise<PersonFull> {
  return authenticatedRequest<PersonFull>(`/api/v1/people/${id}`, { signal });
}

export interface PersonInput {
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  sex: Sex;
  civil_status: CivilStatus;
  birth_date?: string | null;
  mobile_number?: string | null;
  pastoral_leader_id: string;
  acknowledged_duplicate_ids?: string[];
}

export async function createPerson(input: PersonInput): Promise<PersonFull> {
  return authenticatedRequest<PersonFull>('/api/v1/people', {
    method: 'POST',
    body: input,
    idempotencyKey: crypto.randomUUID(),
  });
}

export type PersonEdit = Partial<
  Pick<PersonInput, 'first_name' | 'middle_name' | 'last_name' | 'birth_date' | 'mobile_number'>
> & { civil_status?: CivilStatus };

export async function editPerson(id: string, changes: PersonEdit): Promise<PersonFull> {
  return authenticatedRequest<PersonFull>(`/api/v1/people/${id}`, {
    method: 'PATCH',
    body: changes,
    idempotencyKey: crypto.randomUUID(),
  });
}

/**
 * A duplicate candidate, as the API hands one back.
 *
 * **`tier` and `reasons` are absent for a candidate outside the viewer's scope,
 * and that is a security rule rather than an omission.** The 2026-08-22 and
 * 2026-08-23 rulings record three attempts at this: withholding the reasons left
 * the tier, which is derived from which rule fired and so leaks the same fact;
 * withholding the tier left membership of the list, which leaks it again. What a
 * client may say about such a candidate is that they are a possible match — which
 * is all section 3 needs the encoder to know, because the answer is to stop and
 * ask the leader who holds them.
 */
export interface DuplicateCandidate {
  id: string;
  member_id: string;
  full_name: string;
  tier?: 1 | 2;
  reasons?: string[];
}

/**
 * The pre-flight list (section 3, and section 9's first step for registering a
 * VIP). Creation refuses on a Tier 1 candidate; this is how an encoder sees the
 * weaker ones before they type a whole record.
 */
export async function duplicateCandidates(
  params: { first_name: string; last_name: string; birth_date?: string; mobile_number?: string },
  signal?: AbortSignal,
): Promise<{ data: DuplicateCandidate[] }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  return authenticatedRequest<{ data: DuplicateCandidate[] }>(
    `/api/v1/people/duplicate-candidates?${query.toString()}`,
    { signal },
  );
}

/**
 * A person's age, derived and never stored.
 *
 * Section 3 keeps the birthday as the authoritative value precisely because it
 * cannot go stale, and derives age from it. Null where no birthday is recorded,
 * which section 3 permits and the 2026-08-24 ruling made ordinary rather than
 * exceptional.
 *
 * Computed against the viewer's own clock rather than Asia/Manila. Section 20
 * fixes the reporting time zone for periods and totals; an age on a profile is
 * neither, and being a day out on somebody's birthday is not a reporting figure.
 * Anything that *counts* uses the section 20 boundaries instead.
 */
export function ageFrom(birthDate: string | null): number | null {
  if (!birthDate) {
    return null;
  }

  const [year, month, day] = birthDate.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  const hadBirthday =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!hadBirthday) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

export function networkLabel(network: Network | null): string {
  if (network === 'MENS') {
    return "Men's Network";
  }
  if (network === 'WOMENS') {
    return "Women's Network";
  }
  return 'No Network recorded';
}

export function civilStatusLabel(status: CivilStatus): string {
  return { SINGLE: 'Single', MARRIED: 'Married', WIDOWED: 'Widowed' }[status];
}

export function sexLabel(sex: Sex): string {
  return sex === 'MALE' ? 'Male' : 'Female';
}
