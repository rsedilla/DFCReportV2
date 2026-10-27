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
