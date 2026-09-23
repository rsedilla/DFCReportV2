/**
 * Raises the first letter of each word in a name, and leaves every other letter as
 * typed: `juan dela cruz` becomes `Juan Dela Cruz`, while `McDonald` and `Santos III`
 * are untouched. A word starts at the beginning, after a space, or after a hyphen.
 *
 * **The form applies it as a box is left, never the server**, so what is saved is what
 * the person saw and could change back: SKILL.md section 3 forbids altering a stored
 * name, and a leader may want `dela` kept small. `NameFields` leaves a letter lowered
 * by hand in the name it just raised, and raises a name typed afresh.
 */
export function capitalizeNameWords(name: string): string {
  return name.replace(
    /(^|[\s-])(\p{Ll})/gu,
    (_match, before: string, letter: string) => before + letter.toUpperCase(),
  );
}
