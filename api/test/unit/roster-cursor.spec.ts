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
    expect(decodeRosterCursor(value)).toBeNull();
  });
});
