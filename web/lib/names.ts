/** Generational suffixes written in capitals: `Santos III`, not `Santos Iii`. */
const ROMAN_SUFFIX = /^(ii|iii|iv)$/i;

/**
 * Writes a name with a capital first letter on each word and the rest small (owner,
 * 2026-10-27): `JUAN dELA cruz` becomes `Juan Dela Cruz`. A word starts at the
 * beginning or after a space, and each part after a hyphen or an apostrophe starts with
 * a capital too (`Santos-Reyes`, `O'Brien`). `II`, `III` and `IV` stay in capitals, and the
 * letter after a leading `Mc` stays capital (`McDonald`). Spacing is left as typed.
 *
 * **The form applies it as a box is left, never the server**, so what is saved is what
 * the person saw and could change back: SKILL.md section 3 forbids altering a stored
 * name, and a leader may want `dela` kept small or `DeVera` kept as the family writes
 * it. `NameFields` keeps a name the person changes by hand after it was written this way.
 */
export function capitalizeNameWords(name: string): string {
  return name.replace(/\S+/gu, (word) => {
    if (ROMAN_SUFFIX.test(word)) {
      return word.toUpperCase();
    }

    return word
      .toLowerCase()
      .replace(
        /(^|[-'’])(\p{L})/gu,
        (_match, before: string, letter: string) => before + letter.toUpperCase(),
      )
      .replace(/^Mc(\p{L})/u, (_match, letter: string) => `Mc${letter.toUpperCase()}`);
  });
}

/** A person as a report names them: the whole name, and its parts where the API sends them. */
export interface NameParts {
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
}

/** A pastor's title, which a phone's short name writes `Ps` (owner, 2026-11-07, decision 0451). */
const PASTOR_TITLE = /^pastora?$/i;

/**
 * The names a phone table shows where it has several figures (decision 0451): the whole
 * first-name field, the middle name left out, and the surname's first letter, so `John Andrew
 * Peter E. Santos` is `John Andrew Peter S.`. Where two in one table would read the same, each
 * takes more of the surname until they differ (`John Andrew Sa.`, `John Andrew So.`), and two
 * whose first names and surnames match in full keep their full names. A Pastor or Pastora is
 * written `Ps` before the name (`Ps Lina O.`); any other title is left out.
 *
 * **The parts are the stored fields, never a split of the full name**: a surname may be two
 * words (`Dela Cruz`) and a middle name a whole word, so a split would guess. A person sent
 * without them keeps the full name, and so does one with no name at all (null).
 */
export function shortNames(people: readonly NameParts[]): (string | null)[] {
  const parts = people.map((person) => {
    const first = person.first_name?.trim() ?? '';
    const last = person.last_name?.trim() ?? '';
    return first === '' || last === '' ? null : { first, last };
  });
  // How many letters of the surname each takes; it grows only for those that clash.
  const letters = parts.map(() => 1);
  const shown = (index: number): string | null => {
    const part = parts[index];
    if (part === null) {
      return people[index].full_name;
    }
    const taken = letters[index];
    return taken >= part.last.length
      ? `${part.first} ${part.last}`
      : `${part.first} ${part.last.slice(0, taken)}.`;
  };

  for (let round = 0; round < 100; round += 1) {
    const seen = new Map<string, number[]>();
    parts.forEach((part, index) => {
      if (part === null) {
        return;
      }
      // Alike if they differ by the full stop alone, which a reader would not tell apart.
      const key = (shown(index) ?? '').replace(/\.$/, '').toLocaleLowerCase();
      seen.set(key, [...(seen.get(key) ?? []), index]);
    });
    let grew = false;
    for (const indices of seen.values()) {
      if (indices.length < 2) {
        continue;
      }
      // One that has reached its whole surname would differ from another by a full stop alone
      // (`Santo`, `Santo.`), so the whole group takes its whole surnames.
      const whole = indices.some((index) => letters[index] >= parts[index]!.last.length);
      for (const index of indices) {
        const part = parts[index]!;
        const before = letters[index];
        letters[index] = whole ? part.last.length : before + 1;
        // Never stop on the space inside a two-word surname (`De Leon`).
        while (letters[index] < part.last.length && part.last[letters[index] - 1] === ' ') {
          letters[index] += 1;
        }
        grew ||= letters[index] !== before;
      }
    }
    if (!grew) {
      break;
    }
  }

  // Still alike with the whole surname: the full names, which may differ by a middle name.
  const final = parts.map((_, index) => shown(index));
  return final.map((name, index) => {
    if (parts[index] === null || name === null) {
      return name;
    }
    const twins = final.filter((other) => other?.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (twins.length > 1) {
      return people[index].full_name;
    }
    return PASTOR_TITLE.test(people[index].title?.trim() ?? '') ? `Ps ${name}` : name;
  });
}
