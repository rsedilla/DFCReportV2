import {
  canonicalId,
  canonicalIfUuid,
  canonicalizeIdentifiers,
  sameId,
} from '../../src/common/identifiers';

/**
 * The identifier boundary (SKILL.md section 7).
 *
 * These are pure functions and need no database, which matters twice over: the
 * walk runs over **every request body in the system**, and two of its three
 * safety properties are things no end-to-end case can see. A prototype check that
 * silently skips `req.query`, a credential quietly lowercased, and a stack
 * overflow on a legal payload all look identical to a passing suite.
 *
 * The e2e probe pins that the boundary is global. This pins what it does once it
 * gets there.
 */
describe('canonicalizing identifiers (section 7)', () => {
  const UPPER = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';
  const LOWER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  describe('what it touches', () => {
    it('canonicalizes a UUID under an identifier-named key', () => {
      expect(canonicalizeIdentifiers({ pastoral_leader_id: UPPER })).toEqual({
        pastoral_leader_id: LOWER,
      });
      expect(canonicalizeIdentifiers({ id: UPPER })).toEqual({ id: LOWER });
      expect(canonicalizeIdentifiers({ meetingId: UPPER })).toEqual({ meetingId: LOWER });
    });

    it('reaches identifiers inside an array under such a key', () => {
      // `acknowledged_duplicate_ids` is the real one: a client echoes candidate
      // ids back, and compared raw the section 3 gate can never be satisfied.
      expect(canonicalizeIdentifiers({ acknowledged_duplicate_ids: [UPPER, LOWER] })).toEqual({
        acknowledged_duplicate_ids: [LOWER, LOWER],
      });
    });

    it('takes the key from a named binding when handed a bare string', () => {
      // `@Param('id')` and `@Query('filter_id')` hand the pipe a string, and the
      // name the route asked for is the only key there is.
      expect(canonicalizeIdentifiers(UPPER, 'id')).toBe(LOWER);
      expect(canonicalizeIdentifiers(UPPER, 'filter_id')).toBe(LOWER);
    });
  });

  describe('what it must never touch', () => {
    it('leaves a credential alone, whatever shape it happens to have', () => {
      // **The reason the rule is name-based.** `uuidgen` output is an ordinary
      // ad-hoc password; lowercasing one locks the account out permanently, with
      // nothing to diagnose it. A shape-only rule cannot tell the two apart.
      expect(canonicalizeIdentifiers({ email: 'a@b.test', password: UPPER })).toEqual({
        email: 'a@b.test',
        password: UPPER,
      });
      expect(canonicalizeIdentifiers(UPPER, 'password')).toBe(UPPER);
    });

    it('leaves a non-UUID identifier alone, because the name alone is not enough', () => {
      // A Member ID is `M-` plus six digits (section 3). Lowercasing by name alone
      // would change the value.
      expect(canonicalizeIdentifiers({ member_id: 'M-000123' })).toEqual({
        member_id: 'M-000123',
      });
    });

    it('leaves ordinary fields alone', () => {
      const body = {
        first_name: 'Dela Cruz',
        reason: 'Corrected AFTER review',
        cursor: 'eyJsYXN0TmFtZSI6IkRlbGEgQ3J1eiJ9',
        birth_date: '2026-08-23',
      };

      expect(canonicalizeIdentifiers(body)).toEqual(body);
    });

    it('leaves a class instance alone rather than flattening it', () => {
      const when = new Date('2026-08-23T00:00:00Z');
      const result = canonicalizeIdentifiers({ when }) as { when: Date };

      expect(result.when).toBeInstanceOf(Date);
      expect(result.when.getTime()).toBe(when.getTime());
    });
  });

  describe('the shapes a request actually arrives in', () => {
    it('walks a null-prototype object, which is what Express hands over', () => {
      // **Express 5 builds `req.query` and `req.params` with `Object.create(null)`.**
      // A prototype test against `Object.prototype` alone skips every object-bound
      // query and path parameter — silently, and with no e2e case able to see it,
      // because the named bindings work either way. That defect shipped in the
      // first version of this file and is the reason this case exists.
      const query = Object.assign(Object.create(null) as Record<string, unknown>, {
        leader_id: UPPER,
      });

      expect(canonicalizeIdentifiers(query)).toEqual({ leader_id: LOWER });
    });

    it('does not mutate what it was given', () => {
      // The capability guard reads `body.pastoral_leader_id` off the request before
      // this runs, so the original has to survive intact.
      const body = { pastoral_leader_id: UPPER, ids: [UPPER] };
      const result = canonicalizeIdentifiers(body);

      expect(body.pastoral_leader_id).toBe(UPPER);
      expect(body.ids[0]).toBe(UPPER);
      expect(result).not.toBe(body);
    });

    it('stops descending rather than overflowing the stack', () => {
      // A body is JSON chosen by whoever sent it. Unbounded, a payload well inside
      // the 100 KB limit throws a RangeError, which renders as INTERNAL_ERROR — a
      // 500 logged as a defect, for input, on a route reachable before sign-in.
      let deep: unknown = { id: UPPER };
      for (let level = 0; level < 5_000; level += 1) {
        deep = { nested: deep };
      }

      expect(() => canonicalizeIdentifiers(deep)).not.toThrow();
    });
  });

  describe('the primitives', () => {
    it('compares two spellings of one identifier as equal', () => {
      expect(sameId(UPPER, LOWER)).toBe(true);
      expect(sameId(UPPER, UPPER.replace('3F', '4F'))).toBe(false);
    });

    it('canonicalIfUuid narrows to the shape, for the one place with no key', () => {
      // The idempotency fingerprint's path segments: a URL path carries
      // identifiers and nothing else, so shape is the whole test there.
      expect(canonicalIfUuid(UPPER)).toBe(LOWER);
      expect(canonicalIfUuid('cell_attention_months')).toBe('cell_attention_months');
      expect(canonicalId(UPPER)).toBe(LOWER);
    });
  });
});
