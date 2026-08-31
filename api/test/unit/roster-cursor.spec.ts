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

  it('fits the bound comfortably at the worst payload a validated path can produce', () => {
    // **The bound moved underneath the payload once and nothing said so.** It was 200,
    // sized for a cursor carrying a bare Member ID, and the payload became two names —
    // so the server could emit a value its own DTO refuses, which on this route means a
    // Cell over the page size that nobody can close.
    //
    // Measured rather than assumed: `class-validator` counts UTF-16 units, so the
    // costliest 100 units is 100 three-byte characters. A four-byte character costs two
    // units and therefore buys 200 bytes rather than 300, which is why this uses CJK
    // rather than an emoji — the intuitive worst case is not the worst case.
    const costliest = '中'.repeat(NAME_FIELD_MAX_LENGTH);
    expect(costliest).toHaveLength(NAME_FIELD_MAX_LENGTH);

    const encoded = encodeRosterCursor({
      lastName: costliest,
      firstName: costliest,
      // The longest third key either cursor carries is a UUID, not a Member ID, so the
      // bound is measured against that and covers both.
      memberId: '00000000-0000-4000-8000-000000000000',
    }) as string;

    expect(encoded.length).toBeLessThanOrEqual(CURSOR_MAX_LENGTH);

    // **Comfortably, not merely.** The bound is a request-size guard rather than a
    // proof: `persons.first_name` is bare `text` and the tree import bounds nothing, so
    // a longer name is representable and no finite constant is provably sufficient
    // while no rule states a maximum. Asserting real headroom is what makes this a
    // check on the margin rather than on a coincidence.
    expect(encoded.length * 2).toBeLessThan(CURSOR_MAX_LENGTH);
    // And it round-trips at that size, so the bound is not merely a number that fits.
    expect(decodeRosterCursor(encoded)?.lastName).toBe(costliest);
  });

  it('encodes null as null', () => {
    expect(encodeRosterCursor(null)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
  ])('treats %s as absent', (_label, value) => {
    // **Absent is still absent**, and only these two are. Neither reaches this decoder
    // through the API: `@IsOptional()` skips an absent parameter and `@Length(1, …)`
    // refuses `?cursor=` with 422. They are here because this function is called with
    // whatever a caller has, and its own contract should not depend on a decorator
    // upstream.
    expect(decodeRosterCursor(value)).toBeNull();
  });

  it.each([
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
  ])('refuses %s', (_label, value) => {
    // **Refused rather than treated as absent**, on the ruling of 2026-08-31 now written
    // into section 22. These cases asserted the opposite and justified it as matching
    // "the only other paginated collection" — which was already two others by the time
    // it was written, both of which had copied the same answer from `/people`, which
    // never pinned it.
    //
    // **This file is where five of the six are reachable at all**, which is why they are
    // enumerated here rather than end to end: a client only ever produces a cursor this
    // code emitted or a string that is not base64url, which is the first case alone.
    // The other five are well-formed base64url: the second throws out of `JSON.parse`
    // and the last four are parsed and rejected on shape, which `decodeRosterCursor`
    // distinguishes and answers identically. The shape branch is the one that decides
    // whether a partial cursor silently pages from `undefined`, and now the one that
    // decides whether it is refused.
    expect(() => decodeRosterCursor(value)).toThrow(/pagination cursor could not be read/);
  });

  it('names the field, so a client can bind the message', () => {
    // Section 22's envelope carries `details.field`. Asserted once rather than on every
    // case above: what varies there is which shape is unresolvable, and the answer is
    // deliberately one answer.
    expect(() => decodeRosterCursor('not-a-real-cursor')).toThrow(
      expect.objectContaining({ details: { field: 'cursor' } }) as Error,
    );
  });
});
