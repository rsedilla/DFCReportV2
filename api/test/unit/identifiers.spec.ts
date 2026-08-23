import { ApiErrorCode } from '../../src/common/errors/api-error';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import {
  MAX_IDENTIFIER_DEPTH,
  canonicalId,
  canonicalIfUuid,
  canonicalizeIdentifiers,
  sameId,
} from '../../src/common/identifiers';

import type { Db } from '../../src/database/database.module';

/**
 * The identifier boundary (SKILL.md section 7).
 *
 * These are pure functions, and they are unit-tested because the walk runs over
 * **every request body in the system** while three of its safety properties are
 * things no end-to-end case can see. A prototype check that silently skips
 * `req.query`, a credential quietly lowercased, and a stack overflow on a legal
 * payload all look identical to a passing suite.
 *
 * They do still run under the shared harness, which requires `DATABASE_URL` to be
 * set before any suite loads (`test/setup/env.ts`). An earlier version of this
 * comment claimed they needed no database at all, which was the justification for
 * the file and was not true of the harness — they need no database *server*, and a
 * dummy URL is enough.
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
    });

    it('reaches identifiers inside an array under such a key', () => {
      // `acknowledged_duplicate_ids` is the real one: a client echoes candidate
      // ids back, and compared raw the section 3 gate can never be satisfied.
      expect(canonicalizeIdentifiers({ acknowledged_duplicate_ids: [UPPER, LOWER] })).toEqual({
        acknowledged_duplicate_ids: [LOWER, LOWER],
      });
    });

    it('accepts the singular and the plural, bare and suffixed', () => {
      // **The bare forms are the load-bearing half.** A path parameter binds under
      // the name its route declared, so `@Param('id')` arrives here as the key
      // `id` — a pattern admitting only `_id`/`_ids` would put every path
      // parameter in the API outside the rule, which is the case the boundary was
      // written for. `^id$` without `^ids$` separately left a body field named
      // plainly `ids` outside it, found by CI because the probe's body used it.
      for (const key of ['id', 'ids', 'leader_id', 'duplicate_ids']) {
        expect(canonicalizeIdentifiers({ [key]: UPPER })).toEqual({ [key]: LOWER });
      }

      // And ordinary words ending in those letters are not identifiers.
      for (const key of ['valid', 'humid', 'candid']) {
        expect(canonicalizeIdentifiers({ [key]: UPPER })).toEqual({ [key]: UPPER });
      }
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

    it('leaves a camelCase key alone, because section 22 makes the surface snake_case', () => {
      // **This is a narrowing, and it is deliberate.** An earlier version matched
      // `Id`/`Ids` as defence in depth. Nothing in this API can produce such a key
      // — section 22 fixes the surface as snake_case and `forbidNonWhitelisted`
      // rejects an undeclared one — so it was a shape kept without its reason
      // holding, which section 25 rule 19 exists to stop. A `meetingId` arriving
      // from a client is a naming defect to fix at the route, and the boundary
      // silently absorbing it is what would hide that.
      expect(canonicalizeIdentifiers({ meetingId: UPPER })).toEqual({ meetingId: UPPER });
      expect(canonicalizeIdentifiers({ memberIds: [UPPER] })).toEqual({ memberIds: [UPPER] });
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
  });

  describe('a body nested past the bound is refused, not truncated', () => {
    /**
     * Exactly `containers` nested objects around `leaf`, and no more.
     *
     * **The count has to be exact, and this helper has now been wrong twice.** The
     * boundary sits between two adjacent counts, so a helper off by one cannot
     * express either of them. The first version wrapped `levels + 1` times, and
     * the second defaulted `leaf` to `{ id: UPPER }` \u2014 itself a container \u2014 so
     * `nest(20)` built 21. Both were written to pin an off-by-one.
     *
     * `leaf` therefore defaults to a **string**, which no walk descends into, and
     * the key is `id` at every level so that the innermost value is an identifier
     * the walk must reach.
     */
    function nest(containers: number, leaf: unknown = UPPER): unknown {
      let deep: unknown = leaf;
      for (let level = 0; level < containers; level += 1) {
        deep = { id: deep };
      }
      return deep;
    }

    function refusal(run: () => unknown): { code?: string } | undefined {
      try {
        run();
        return undefined;
      } catch (error) {
        return error as { code?: string };
      }
    }

    it('answers VALIDATION_FAILED rather than overflowing the stack', () => {
      // **A body is JSON chosen by whoever sent it.** `JSON.parse` is iterative in
      // V8 and accepts any depth \u2014 measured past two hundred thousand levels \u2014 while
      // both walks over the result are recursive and do not. A few thousand levels
      // overflows, and an unhandled RangeError renders as INTERNAL_ERROR: a 500
      // logged as a defect, produced by input.
      //
      // No exact threshold is asserted, because it moves with the payload's shape
      // and the stack headroom at the call site. The cheapest case is a nested
      // array, which reaches it in single-digit kilobytes.
      const thrown = refusal(() => canonicalizeIdentifiers(nest(5_000)));

      expect(thrown).toBeDefined();
      expect(thrown?.code).toBe(ApiErrorCode.VALIDATION_FAILED);
      expect(thrown).not.toBeInstanceOf(RangeError);
    });

    it('refuses exactly one container past the bound, and accepts the bound itself', () => {
      // **The boundary, not a number either side of it.** `>=` relaxed to `>`, or
      // the constant moved by one in either direction, has to fail here \u2014 the
      // earlier pair (18 and 22 containers) left every one of those green.
      expect(refusal(() => canonicalizeIdentifiers(nest(MAX_IDENTIFIER_DEPTH)))).toBeUndefined();
      expect(refusal(() => canonicalizeIdentifiers(nest(MAX_IDENTIFIER_DEPTH + 1)))?.code).toBe(
        ApiErrorCode.VALIDATION_FAILED,
      );
    });

    it('refuses rather than returning the container unwalked', () => {
      // **The mutation this fails against is the version that shipped**, which
      // stopped descending and returned the container unchanged. That is worse
      // than it looks: a request nested past the bound kept its identifiers in
      // whatever case the client sent, silently, and every comparison below became
      // a comparison on a spelling. It has to refuse, not truncate.
      //
      // **A truncating implementation returns a value where this expects a
      // refusal**, which is the whole difference and is what this line asserts. An
      // earlier revision moved that assertion out into the boundary case above and
      // left this name and this comment behind, so the case named for the mutation
      // was green against it \u2014 the leaf is a string, and a string is handled before
      // the truncation check is ever reached.
      expect(refusal(() => canonicalizeIdentifiers(nest(MAX_IDENTIFIER_DEPTH + 1)))?.code).toBe(
        ApiErrorCode.VALIDATION_FAILED,
      );

      // And a body inside the bound is walked all the way down, so the refusal is
      // not simply "deep bodies fail".
      const shallow = canonicalizeIdentifiers(nest(MAX_IDENTIFIER_DEPTH));
      expect(JSON.stringify(shallow)).toContain(LOWER);
      expect(JSON.stringify(shallow)).not.toContain(UPPER);
    });

    it('bounds the fingerprint walk too, at the same depth', () => {
      // **The second recursive walk over the same body, and the one that was
      // unbounded.** The interceptor calls `canonicalizeIdentifiers` first, so in
      // practice that refuses before this is entered \u2014 but `fingerprint` is a
      // public method and the ordering of its callers is not a property it can
      // rely on, which is how the unbounded version was reached at all.
      const idempotency = new IdempotencyService(null as unknown as Db);
      const fingerprint = (body: unknown): unknown =>
        idempotency.fingerprint('POST', '/api/v1/people', body);

      expect(refusal(() => fingerprint(nest(5_000)))?.code).toBe(ApiErrorCode.VALIDATION_FAILED);
      expect(refusal(() => fingerprint(nest(MAX_IDENTIFIER_DEPTH)))).toBeUndefined();
      expect(refusal(() => fingerprint(nest(MAX_IDENTIFIER_DEPTH + 1)))?.code).toBe(
        ApiErrorCode.VALIDATION_FAILED,
      );
    });

    it('gives both walks one answer for one body, whatever the leaf is', () => {
      // **Sharing the constant is not sufficient, and the first version proved it.**
      // The identifier walk asserted before dispatching on type, so a leaf occupied
      // a level; the fingerprint walk returned for a primitive before asserting, so
      // it did not. One body twenty deep was then refused or accepted according to
      // whether its innermost value happened to be a string:
      //
      //     leaf "x" -> both accepted        leaf 5 -> identifier walk refused only
      //
      // Client-visible arbitrariness, and it was introduced by the commit whose own
      // comment said sharing the constant meant one answer for one body. Both must
      // assert at the same point -- immediately before descending, never on a leaf.
      const idempotency = new IdempotencyService(null as unknown as Db);

      // **A container leaf brings its own level**, so the wrap count has to drop by
      // one for it to land on the boundary. Without that, `{ id: UPPER }` and `[]`
      // ran at 21 and 22 and both walks refused every time \u2014 duplicating the
      // refusal side and never touching the accept side, which is precisely where
      // the disagreement this case exists for lived.
      for (const leaf of ['x', 5, null, true, { id: UPPER }, []]) {
        const own = typeof leaf === 'object' && leaf !== null ? 1 : 0;

        for (const containers of [MAX_IDENTIFIER_DEPTH - own, MAX_IDENTIFIER_DEPTH + 1 - own]) {
          const body = nest(containers, leaf);
          const walk = refusal(() => canonicalizeIdentifiers(body)) !== undefined;
          const print =
            refusal(() => idempotency.fingerprint('POST', '/api/v1/people', body)) !== undefined;

          expect({ leaf, containers, walk, print }).toEqual({
            leaf,
            containers,
            walk,
            print: walk,
          });
        }
      }
    });
  });

  describe('the primitives', () => {
    it('compares two spellings of one identifier as equal', () => {
      expect(sameId(UPPER, LOWER)).toBe(true);
      expect(sameId(UPPER, UPPER.replace('3F', '4F'))).toBe(false);
    });

    it('canonicalIfUuid narrows to the shape, for the one place with no key', () => {
      // The idempotency fingerprint's path segments, which have no key to read.
      // What makes shape safe *there* is reachability rather than any property of
      // paths: the credentials that travel in a URL-shaped position are the
      // activation and reset tokens, and those routes are unauthenticated, so the
      // interceptor returns before a path is ever canonicalized for them.
      expect(canonicalIfUuid(UPPER)).toBe(LOWER);
      expect(canonicalIfUuid('cell_attention_months')).toBe('cell_attention_months');
      expect(canonicalId(UPPER)).toBe(LOWER);
    });
  });
});
