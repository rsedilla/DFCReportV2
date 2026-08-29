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
 * **What this bound is, and what it is not.** It is a guard on request size, set well
 * clear of anything the validated write paths can produce. It is *not* a proof that a
 * cursor fits, and an earlier version of this comment claimed it was.
 *
 * The arithmetic for the validated paths is worth keeping, because it is not the
 * intuitive one: both cursors carry `last_name` and `first_name`, which the create and
 * edit DTOs bound at 100 each; `class-validator` counts UTF-16 units, so the costliest
 * 100 units is 100 three-byte characters — a four-byte character costs two units and
 * therefore buys 200 bytes rather than 300. That puts the worst case at 870 for the Cell
 * roster and 899 for `/people`, whose third key is a UUID rather than a Member ID.
 *
 * **The derivation stops there, and that is a gap rather than a rounding.** `persons`
 * stores names as bare `text` with no length constraint, and the tree import writes
 * through the services rather than through a DTO and bounds nothing — so a Person with a
 * 300-character name is representable today, and two of those produce a 2,470-character
 * cursor. No finite constant is provably sufficient while no rule states a maximum name
 * length, and SKILL.md section 3 states none: it says a name may hold any character and
 * is silent on how many. `CLAUDE.md` carries that as open rather than this file settling
 * it, because a maximum name length is a domain rule and not a pagination detail.
 *
 * 4096 is therefore chosen as a guard: it is about four times the worst case any
 * validated path can reach, it covers names far longer than the import will ever carry,
 * and it still refuses a query string built to be enormous. Past it a client is refused
 * rather than served, which is the failure this whole file exists to avoid — so if the
 * open item is ever settled with a bound on names, this becomes derivable and should be
 * derived.
 */
export const CURSOR_MAX_LENGTH = 4096;

/**
 * The maximum a name field may hold **on the paths that validate one** — the create and
 * edit DTOs, which import this rather than repeating the number.
 *
 * Deliberately not called the maximum a name may hold: the column is bare `text` and the
 * tree import enforces nothing, which is the open item above.
 *
 * **It is imported rather than documented, because the drift this file argues against
 * was live one field over.** The bound above is stated to be safe *because* a name is
 * capped at this, and while the DTOs carried the literal `100`, widening
 * `first_name` to 300 left `roster-cursor.spec.ts` green at 100 characters while the
 * emitted cursor doubled — the premise falsified with nothing to say so. Now the case
 * and the validators read one number, so widening a name field moves the test.
 */
export const NAME_FIELD_MAX_LENGTH = 100;
