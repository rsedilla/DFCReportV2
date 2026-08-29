import { CURSOR_MAX_LENGTH, NAME_FIELD_MAX_LENGTH } from '../../src/common/cursor';
import { decodeRosterCursor, encodeRosterCursor } from '../../src/cells/roster-cursor';

/**
 * The roster cursor (SKILL.md section 22, *Pagination*).
 *
 * These are pure functions and need no database *server* — but the shared harness
 * throws without `DATABASE_URL` before any suite loads, so a dummy URL is enough.
 *
 * They exist because the e2e cases reach only the two shapes a client produces: a
 * cursor this code emitted, and a string that is not base64url at all. The branch a
 * *forged but decodable* cursor takes — well-formed JSON missing a key — is reachable
 * only here, and it is the branch that decides whether a partial cursor silently pages
 * from `undefined`.
 */
describe('the roster cursor', () => {
  const key = { lastName: 'Zamora', firstName: 'Zosimo', memberId: 'M-000123' };

  it('round-trips the whole ordering key', () => {
    // All three, which is the property the first version lacked: it carried the Member
    // ID and looked the other two up, and a lexicographic keyset needs every key it
    // orders by.
    expect(decodeRosterCursor(encodeRosterCursor(key) as string)).toEqual(key);
  });

  it('is opaque rather than a Member ID', () => {
    // Section 22: clients pass it back unmodified and never construct one. A bare
    // Member ID is six digits off a sequence (section 3), published church-wide
    // (section 8), and therefore constructible.
    const encoded = encodeRosterCursor(key) as string;

    expect(encoded).not.toBe(key.memberId);
    expect(encoded).not.toContain('M-000123');
  });

  it('fits the bound its DTOs enforce, at the worst payload a name can produce', () => {
    // **The bound moved underneath the payload once and nothing said so.** It was 200,
    // sized for a cursor carrying a bare Member ID, and the payload became two names —
    // so the server could emit a value its own DTO refuses, which on this route means a
    // Cell over the page size that nobody can close.
    //
    // Derived rather than assumed: `class-validator` counts UTF-16 units, so the
    // costliest 100 units is 100 three-byte characters. A four-byte character costs two
    // units and therefore buys 200 bytes rather than 300, which is why this uses CJK
    // rather than an emoji — the intuitive worst case is not the worst case.
    const costliest = '中'.repeat(NAME_FIELD_MAX_LENGTH);
    expect(costliest).toHaveLength(NAME_FIELD_MAX_LENGTH);

    const encoded = encodeRosterCursor({
      lastName: costliest,
      firstName: costliest,
      // The longest third key either cursor carries is a UUID, not a Member ID, so the
      // bound is derived against that and covers both.
      memberId: '00000000-0000-4000-8000-000000000000',
    }) as string;

    expect(encoded.length).toBeLessThanOrEqual(CURSOR_MAX_LENGTH);
    // And it round-trips at that size, so the bound is not merely a number that fits.
    expect(decodeRosterCursor(encoded)?.lastName).toBe(costliest);
  });

  it('encodes null as null', () => {
    expect(encodeRosterCursor(null)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not base64url at all', 'not-a-real-cursor'],
    ['base64url of something that is not JSON', Buffer.from('nope').toString('base64url')],
    ['JSON that is not an object', Buffer.from('"nope"').toString('base64url')],
    ['null', Buffer.from('null').toString('base64url')],
    [
      'an object missing memberId',
      Buffer.from(JSON.stringify({ lastName: 'Z', firstName: 'Z' })).toString('base64url'),
    ],
    [
      'an object whose key is the wrong type',
      Buffer.from(JSON.stringify({ ...key, memberId: 7 })).toString('base64url'),
    ],
  ])('treats %s as absent', (_label, value) => {
    // Absent rather than refused, matching `GET /api/v1/people` — the only other
    // paginated collection and the only behaviour this repository has chosen. Section
    // 22 does not settle it; `CLAUDE.md` carries that as open.
    //
    // The first two cases never reach this decoder through the API: `@IsOptional()`
    // skips an absent parameter, and `@Length(1, …)` refuses `?cursor=` with 422, as
    // `/people` does. They are here because this function is called with whatever a
    // caller has, and its own contract should not depend on a decorator upstream.
    expect(decodeRosterCursor(value)).toBeNull();
  });
});
