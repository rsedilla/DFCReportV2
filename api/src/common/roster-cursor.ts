import { unresolvableCursor } from './cursor';

/**
 * The opaque cursor for a collection ordered by `(last_name, first_name, member_id)`
 * (SKILL.md section 22).
 *
 * **Two routes page by exactly this key**, in two modules, which is why the file is
 * here rather than in either: `GET /api/v1/cells/{id}/members` and
 * `GET /api/v1/dcc/events/{id}/roster`. It was `cells/roster-cursor.ts` until the
 * second arrived (decision 0174) — and what it does *not* know is how the key is
 * compared, deliberately. The Cell roster compares it in SQL as a lexicographic
 * keyset; the DCC checklist compares it against a list its own service assembled by
 * walking the pastoral tree, because there is no single query to key. The wire format
 * is the part a client sees and the part that was going to diverge; the comparison is
 * each route's own.
 *
 * The two other cursors in this API keep their own pairs and are not an oversight.
 * `people.controller.ts` keys on two names and a UUID and `leadership-request-cursor.ts`
 * on an instant and a UUID, needing a format predicate neither of the others does — so
 * one generic pair over all four would be a type parameter plus a per-route validator,
 * which is most of what each file already holds. Sharing happens where the key is
 * identical, and there it is not optional: a fourth file re-deriving these same three
 * fields is exactly how the history below repeats.
 *
 * The history is the Cell roster's, and it is kept because it is why the file exists.
 *
 * **It carries all three ordering keys, and that is the whole reason this file
 * exists.** A first version carried the Member ID alone and looked up the other two
 * with a scalar subquery inside the comparison — which compiled to a row constructor
 * compared against a single-column subquery, so every request that followed a cursor
 * was refused by PostgreSQL as `subquery has too few columns` before a row was read.
 * `42601` is not a code `postgres-errors.ts` classifies, so it rendered
 * `INTERNAL_ERROR`: a 500 on a parameter section 22 documents.
 *
 * The bug was the symptom. `people.read.service.ts` already pages this exact shape and
 * carries its whole key in the cursor, and the reason it does is not incidental — a
 * lexicographic keyset needs every key it orders by, and re-deriving that is what
 * section 25 rule 19 asks for. Carrying one key forces the second lookup, and it also
 * makes the boundary **unstable**: a member renamed between two pages moves the key
 * the lookup would have found, so rows are skipped or repeated. A cursor holding the
 * key is immune, because the key travelled with it.
 *
 * Base64url of JSON, so the shape can change without a client having learned to read
 * it — section 22 requires the cursor be opaque and never constructed by a client, and
 * the Member ID this used to emit is neither: section 3 makes it six digits off a
 * sequence and section 8 publishes it church-wide.
 *
 * **A cursor this cannot resolve is refused** with `VALIDATION_FAILED` naming the
 * field, on the ruling of 2026-08-31 now written into section 22. It was treated as
 * absent until then, matching `people.controller.ts` — which had reached that answer
 * first and not by decision, so the two agreed by accident.
 *
 * What refusing prevents is silent. A client sends a cursor because it already holds a
 * page; handed the first page again under a `200`, it appends rows it already has and
 * cannot tell that from a roster that grew. It also makes one rule of a path that had
 * two: the DTO in front of this refuses an empty `cursor=` and an over-long one, so a
 * value a byte too long was a 422 while a value of the right length carrying nothing
 * readable was a silent restart.
 *
 * Refusing does not strand a client, because the recovery is a request it can already
 * make — drop the cursor, start over — which is exactly what the old behaviour did for
 * it, silently. And a forged cursor that happens to parse still discloses nothing: the
 * worst it does is start the page elsewhere in a roster the reader is authorized to see
 * in full.
 */
export interface RosterCursor {
  lastName: string;
  firstName: string;
  memberId: string;
}

export function decodeRosterCursor(value: string | undefined): RosterCursor | null {
  // An **absent** cursor is absent and starts at the first page. The empty string is
  // already refused by the DTO in front of this; it is treated as absent here so the
  // function is total for a caller that has none.
  if (value === undefined || value === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as RosterCursor).lastName === 'string' &&
      typeof (parsed as RosterCursor).firstName === 'string' &&
      typeof (parsed as RosterCursor).memberId === 'string'
    ) {
      return parsed as RosterCursor;
    }
  } catch {
    // Falls through to the refusal below. Both failures are the same answer: a value
    // that is not base64url JSON and one that is JSON of the wrong shape are equally
    // unresolvable, and section 22 gives them one code.
  }

  throw unresolvableCursor();
}

export function encodeRosterCursor(cursor: RosterCursor | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
