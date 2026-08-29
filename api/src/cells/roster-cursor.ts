/**
 * The opaque cursor `GET /api/v1/cells/{id}/members` pages by (SKILL.md section 22).
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
 * **An unreadable cursor is treated as absent rather than refused**, which matches
 * `people.controller.ts` and is the only behaviour in the repository. Section 22 does
 * not settle what a collection endpoint does with a forged, stale or unparseable
 * cursor — that is recorded as open in `CLAUDE.md` rather than decided here. What can
 * be said is that it discloses nothing: the worst a tampered value does is start the
 * page elsewhere in a roster the reader is already authorized to see in full, and
 * refusing it would strand a client with no way back.
 */
export interface RosterCursor {
  lastName: string;
  firstName: string;
  memberId: string;
}

export function decodeRosterCursor(value: string | undefined): RosterCursor | null {
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
    // Falls through to null: an unreadable cursor is absent, per the docblock above.
  }

  return null;
}

export function encodeRosterCursor(cursor: RosterCursor | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
