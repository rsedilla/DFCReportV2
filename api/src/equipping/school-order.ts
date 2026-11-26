import type { PersonForDecision } from '../people/people.read.service';

/**
 * **The school's lists are in last-name order** (decision 0515): last name, then first name, then
 * Member ID, a title never compared (decision 0271). It is the one exception to the first-name
 * order every other list of people keeps (decision 0359), and every list `Equipping` shows is
 * sorted by this comparator, so a list added later takes the rule by using it.
 */
export function compareSchoolNames(
  left: PersonForDecision | undefined,
  right: PersonForDecision | undefined,
): number {
  return (
    (left?.lastName ?? '').localeCompare(right?.lastName ?? '') ||
    (left?.firstName ?? '').localeCompare(right?.firstName ?? '') ||
    (left?.memberId ?? '').localeCompare(right?.memberId ?? '')
  );
}

/**
 * Sorts rows naming a person into the school's order, reading each person's name from `people`,
 * as `forDecisions` returns it.
 */
export function bySchoolName<T extends { person: { id: string } }>(
  people: ReadonlyMap<string, PersonForDecision>,
): (a: T, b: T) => number {
  return (a, b) => compareSchoolNames(people.get(a.person.id), people.get(b.person.id));
}

/** A student as a school list shows them: the name, and the name last name first for its column. */
export function schoolPerson(
  id: string,
  people: ReadonlyMap<string, PersonForDecision>,
): { id: string; full_name: string | null; list_name: string | null } {
  const person = people.get(id);
  return { id, full_name: person?.fullName ?? null, list_name: person?.listName ?? null };
}
