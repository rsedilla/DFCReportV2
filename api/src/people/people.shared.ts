import type { CivilStatus, Sex } from '../database/schema';

/**
 * The `people` module's shapes and pure functions (SKILL.md section 2).
 *
 * What belongs here has **no database handle and no injector**, and is needed
 * outside any one service: the shapes, the profile projections, and the text
 * transformations. A file rather than a base class, deliberately: giving these a
 * `this` is what would invite a database handle onto the one part of this module
 * whose merit is having none.
 *
 * Both halves are required, and the first alone is not a test — it would admit
 * every private helper in the module, including the two removed from here for
 * belonging to one service. `transpositionsOf` and `isCalendarDate` sit on the
 * line: they are used by the matcher alone today, and are here because they encode
 * section 3's rules about dates rather than that service's mechanics.
 *
 * **Not "everything used by more than one service"**, which an earlier version of
 * this header claimed and which was false for six of its exports. That test is
 * also the wrong one: it says nothing about what a thing *is*, so anything awkward
 * satisfies it by being needed twice, and the file becomes a junk drawer by
 * construction. Two helpers were private before the split and had been exported
 * only to survive the move; they are private again, in the one service that uses
 * them.
 *
 * The section 8 redaction went with them, to `PeopleDuplicatesService`. It decides
 * which candidates a viewer may see at all and what each carries, which is a rule
 * rather than a transformation — and section 3 records that rule being got wrong
 * three times, so it belongs whole and beside the matcher rather than split across
 * two files.
 */

export interface CreatePersonInput {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  birthDate: string;
  sex: Sex;
  civilStatus: CivilStatus;
  mobileNumber?: string | null;
  /**
   * Null only for the import path (section 2, Initial data load). Section 5
   * permits a Person "encoded but not yet assigned", and section 9 requires the
   * leader at VIP registration — so the API requires it and the service does not.
   */
  pastoralLeaderId: string | null;
  /** Tier 1 candidates the actor has seen and passed over (section 3). */
  acknowledgedDuplicateIds?: readonly string[];
}

/** The keyset a search page resumes from. Opaque to clients (section 22). */
export interface SearchCursor {
  lastName: string;
  firstName: string;
  id: string;
}

/**
 * The body a Person endpoint returns, composed here rather than in the
 * controller.
 *
 * Section 22 requires a write endpoint to record **the response it returns**, and
 * the recording happens inside the transaction, in this service. If the
 * controller reshaped the record afterwards, the stored body and the sent body
 * would differ and every replay would answer something the original never sent —
 * which is exactly the defect that shape produced on the first edit endpoint
 * written here.
 *
 * So the composition lives beside the recording. A controller that wants a
 * different shape has to change this, where the consequence is visible.
 */
export function fullProfile(person: PersonRecord): Record<string, unknown> {
  return {
    id: person.id,
    member_id: person.member_id,
    first_name: person.first_name,
    middle_name: person.middle_name,
    last_name: person.last_name,
    full_name: composeName(person),
    // Section 3: age is derived, never persisted as authoritative data. It is not
    // returned at all — a client that needs it computes it from the birthday,
    // which is the one value that cannot go stale.
    birth_date: person.birth_date,
    sex: person.sex,
    civil_status: person.civil_status,
    mobile_number: person.mobile_number,
    scope: 'FULL',
  };
}

export function composeName(person: {
  first_name: string;
  middle_name: string | null;
  last_name: string;
}): string {
  return [person.first_name, person.middle_name, person.last_name]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
}

export interface PersonRecord {
  id: string;
  member_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: string;
  sex: Sex;
  civil_status: CivilStatus;
  mobile_number: string | null;
}

/**
 * A dialling form beside the value as entered (section 3).
 *
 * Validation is deliberately loose: family abroad, visitors and landlines all
 * produce numbers that do not match a local mobile pattern, and rejecting them
 * loses real contact detail for no benefit.
 */
export function normalizeMobile(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const digits = value.replace(/[^\d+]/g, '');
  return digits === '' ? null : digits;
}

/**
 * The accented characters that occur in the names this church records, and their
 * plain equivalents.
 *
 * Fed to PostgreSQL's `translate()` so the SQL strips diacritics the same way
 * `normalizeName` does — section 3 requires it for comparison, and a narrowing
 * that does not strip them excludes rows the matcher would have scored.
 *
 * Exported because the search and the duplicate matcher are separate services and
 * both fold names with them. (A second docblock was stacked above this one when
 * the export was added, which is invisible to tooling: an editor shows only the
 * nearest.)
 */
export const ACCENTED = 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ';
export const UNACCENTED = 'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC';

/**
 * `%` and `_` are LIKE wildcards; a search term is data, not a pattern.
 *
 * Unescaped, `q=%%` pages out the whole directory — and section 8 makes that
 * directory church-wide by design, so the wildcard is the difference between a
 * name search and a bulk export.
 *
 * A backslash is escaped too, and first, or escaping the wildcards would turn a
 * literal backslash in a name into an escape for whatever followed it.
 * PostgreSQL's LIKE takes backslash as its escape character by default.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Every birthday one adjacent-digit transposition away from this one.
 *
 * Section 3 lists "birthdays differing by a transposition of digits" as a Tier 2
 * signal. The scoring implements it; without this the narrowing would never fetch
 * such a row unless the surname happened to share an initial, which is not what
 * the rule says.
 */
export function transpositionsOf(date: string): string[] {
  const swaps = new Set<string>();
  const digits = [...date.matchAll(/\d/g)].map((match) => match.index);

  // **Any two digit positions, not only adjacent ones.** The scorer accepts any
  // two-position swap, and the commonest date mis-key of all is month against day
  // -- 1994-03-02 for 1994-02-03, which a US-format habit produces and which is
  // not an adjacent swap. Generating only adjacent pairs meant the narrowing
  // could not fetch the row the rule exists to catch, so the rule fired only when
  // the surname initial happened to match.
  for (let a = 0; a < digits.length; a += 1) {
    for (let b = a + 1; b < digits.length; b += 1) {
      const i = digits[a];
      const j = digits[b];

      if (date[i] === date[j]) {
        continue;
      }

      const chars = [...date];
      chars[i] = date[j];
      chars[j] = date[i];
      const swapped = chars.join('');

      // Most swaps produce something that is not a date: `1994-03-02` swapped in
      // the month is `1994-30-02`, and PostgreSQL refuses to compare against it —
      // the whole statement errors rather than the value simply not matching. A
      // mis-keyed birthday that is not a real date cannot be in the table anyway,
      // so these are dropped rather than escaped.
      if (isCalendarDate(swapped)) {
        swaps.add(swapped);
      }
    }
  }

  // `in ()` is not valid SQL, so an empty set needs a value that matches nothing.
  return swaps.size === 0 ? ['0001-01-01'] : [...swaps];
}

/** Whether a string is a real `YYYY-MM-DD` day, not merely shaped like one. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const asDate = new Date(Date.UTC(year, month - 1, day));

  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}
