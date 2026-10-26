/**
 * Writes a Philippine mobile number with hyphens (owner, 2026-10-27): `09171234567`
 * becomes `0917-123-4567`, and `+639171234567` or `639171234567` becomes
 * `+63-917-123-4567`. Spaces, hyphens, dots and brackets typed between the digits are
 * read through, so `0917 123 4567` is written the same way.
 *
 * **Any other number is left exactly as typed**: SKILL.md section 3 validates loosely,
 * because family abroad, visitors and landlines all give numbers that match no local
 * pattern, and a guess at their grouping would be wrong more often than right.
 *
 * The form applies it as the box is left, and the person's page shows a saved number
 * through it, so one written before this rule reads the same. The server is untouched:
 * it keeps the number as given beside a digits-only form for comparing (section 3), and
 * hyphens change neither.
 */
export function formatMobile(value: string): string {
  const compact = value.trim().replace(/[\s.()-]/g, '');

  const local = /^09(\d{2})(\d{3})(\d{4})$/.exec(compact);
  if (local) {
    return `09${local[1]}-${local[2]}-${local[3]}`;
  }

  const international = /^\+?639(\d{2})(\d{3})(\d{4})$/.exec(compact);
  if (international) {
    return `+63-9${international[1]}-${international[2]}-${international[3]}`;
  }

  return value;
}
