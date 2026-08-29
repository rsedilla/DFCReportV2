/**
 * The longest opaque pagination cursor any collection endpoint may emit (SKILL.md
 * section 22, *Pagination*).
 *
 * **A bound on a cursor is a bound on its payload, and one changed underneath its bound
 * already.** `GET /api/v1/cells/{id}/members` bounded its cursor at 200 while it carried
 * a bare Member ID of eight characters, then began carrying two names past it — so the
 * server could emit a value its own DTO refuses, answering `VALIDATION_FAILED` on
 * something the client had been handed. On that route it is worse than a paging failure:
 * the closure endpoint requires a member list that is exactly the current membership and
 * that route is the only way to build one, so a Cell over the page size becomes closable
 * by nobody. `GET /api/v1/people` had the same defect latent at 500.
 *
 * **The derivation, rather than a round number.** Both cursors carry `last_name` and
 * `first_name`, which the create and edit DTOs bound at 100 each. `class-validator`
 * counts UTF-16 units and section 3 lets a name hold any character, so the costliest 100
 * units is 100 three-byte characters — a four-byte character costs two units, so it buys
 * 200 bytes rather than 300. Two names is 600 bytes; the longest third key is a UUID at
 * 36; JSON punctuation adds under 60. Base64url is four characters per three bytes, so
 * the worst case is under 940 and the measured one is 899.
 *
 * **1024**, which leaves room for a key to be added without this quietly becoming too
 * small a third time. It lives here rather than in either module because both use it,
 * and a bound copied into two DTOs is one that drifts.
 *
 * `test/unit/roster-cursor.spec.ts` computes the worst case from the name-field maximum
 * and asserts it fits, so lowering this or widening a payload reddens rather than waiting
 * for a name long enough to find it.
 */
export const CURSOR_MAX_LENGTH = 1024;

/** The maximum a name field may hold, which is what the bound above is derived from. */
export const NAME_FIELD_MAX_LENGTH = 100;
