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
/**
 * The shortest search the API accepts.
 *
 * `SearchPeopleDto.q` is `@Length(2, 100)`, so a single character is refused
 * with `VALIDATION_FAILED`. Stated here rather than left to the screens, which
 * were enabling the Search button at one character and then rendering the pipe's
 * raw refusal as a form-level error.
 */
export const MINIMUM_SEARCH_LENGTH = 2;

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

/**
 * **The key is supplied by the caller, not minted here.**
 *
 * Section 23 requires a client-generated idempotency key on every write so that
 * "a retry must never create a second record". Minting one inside this function
 * defeats that exactly: no two attempts at the same logical write ever share a
 * key, so a retry after a lost response presents a body the store has never seen
 * and creates a second Person.
 *
 * The lost response is the case that matters, and it is indistinguishable from a
 * request that never arrived — which is why the caller holds one key for the
 * whole attempt, including across a duplicate-acknowledgement round trip.
 */
export async function createPerson(
  input: PersonInput,
  idempotencyKey: string,
): Promise<PersonFull> {
  return authenticatedRequest<PersonFull>('/api/v1/people', {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

export type PersonEdit = Partial<
  Pick<PersonInput, 'first_name' | 'middle_name' | 'last_name' | 'birth_date' | 'mobile_number'>
> & { civil_status?: CivilStatus };

/** The key is the caller's, for the reason given on `createPerson`. */
export async function editPerson(
  id: string,
  changes: PersonEdit,
  idempotencyKey: string,
): Promise<PersonFull> {
  return authenticatedRequest<PersonFull>(`/api/v1/people/${id}`, {
    method: 'PATCH',
    body: changes,
    idempotencyKey,
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
  sex: Sex;
  /**
   * The API's own flag for a withheld candidate. **Read this rather than
   * inferring the same fact from a missing `tier` or empty `reasons`.**
   *
   * The inference happens to hold today, because every matching rule pushes at
   * least one reason — so the first rule that matches without one would render
   * "their details are visible to their own leaders" for somebody the viewer
   * actually pastors. A client deciding a redaction question by reading the
   * shape of a payload is guessing at a rule the API already states.
   */
  possible_match?: boolean;
  tier?: 1 | 2;
  reasons?: string[];
}

/** True where section 8 withheld this candidate's tier and reasons. */
export function isWithheld(candidate: DuplicateCandidate): boolean {
  return candidate.possible_match === true || candidate.tier === undefined;
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

  // A future birthday is a mis-keyed year rather than an absent one, and the two
  // must not render the same. Returning null here put "Needs a birthday" beside
  // a birthday the screen was displaying, which is a statement the record
  // contradicts one line above.
  return age >= 0 ? age : NEGATIVE_AGE;
}

/**
 * What `ageFrom` returns for a birthday in the future: a recorded date that
 * cannot yield an age, which is different from no date at all.
 */
export const NEGATIVE_AGE = -1;

export function networkLabel(network: Network | null): string {
  if (network === 'MENS') {
    return "Men's Network";
  }
  if (network === 'WOMENS') {
    return "Women's Network";
  }
  return 'No Network recorded';
}

/**
 * The two closed enumerations these forms offer, written once.
 *
 * Section 4 makes the sexes a total mapping onto the Networks and section 3
 * fixes the three civil statuses. Both are closed lists in the specification, so
 * they live here rather than inline on each screen, where a fourth could be
 * added without anybody noticing it was an amendment.
 */
export const SEX_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
] as const satisfies readonly { value: Sex; label: string }[];

export const CIVIL_STATUS_OPTIONS = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED', label: 'Married' },
  { value: 'WIDOWED', label: 'Widowed' },
] as const satisfies readonly { value: CivilStatus; label: string }[];

export function civilStatusLabel(status: CivilStatus): string {
  return { SINGLE: 'Single', MARRIED: 'Married', WIDOWED: 'Widowed' }[status];
}

export function sexLabel(sex: Sex): string {
  return sex === 'MALE' ? 'Male' : 'Female';
}
