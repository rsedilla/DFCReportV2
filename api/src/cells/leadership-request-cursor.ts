import { unresolvableCursor } from '../common/cursor';

import type { CellRequestKind } from '../database/schema';

/**
 * The opaque cursor `GET /api/v1/cells/leadership-requests` pages by
 * (SKILL.md section 22, *Pagination*).
 *
 * **Its whole key travels in it, and that reason is re-derived rather than borrowed
 * from the roster cursor** (section 25 rule 19). The reason there was that a
 * lexicographic keyset needs every key it orders by, and that a key looked up by one
 * column moves when a member is renamed. The first half carries here unchanged. The
 * second does not: this route orders by `requested_at`, which nothing edits, and the
 * finality trigger freezes `requested_at` from the moment a row is written — so a
 * looked-up key would in fact be stable. It travels anyway, because the lookup form is
 * what compiled to a row constructor against a single-column subquery and could not be
 * planned at all, and because one shape for both routes is one shape to get right.
 *
 * **The ordering is oldest first**, which is the one thing here that is not the roster's
 * shape. A queue is worked from the front: section 19 puts pending requests on the Admin
 * dashboard because "a request nobody can see is a request nobody acts on", and a new
 * Cell additionally holds up a real leader's account (section 6). Newest-first would put
 * the request that has been waiting longest on the last page.
 *
 * `id` is the tie-break. Two requests can share a `requested_at`: the column defaults to
 * `now()`, which is transaction start, so two submitted inside one transaction — nothing
 * does that today — or on a clock with coarse resolution would collide. A tie-break that
 * is total makes the order deterministic whether or not that happens, which is what
 * section 22 requires of two identical requests.
 *
 * **A cursor this cannot resolve is refused** with `VALIDATION_FAILED` naming the field,
 * on the ruling of 2026-08-31 now written into section 22, through the shared refusal in
 * `common/cursor.ts`. It was treated as absent until then — this route having matched
 * the two that came before it, both of which say the same about themselves, so one
 * decision had been copied twice and looked like three.
 *
 * This route has a third way to be unresolvable that the others do not: `requestedAt` is
 * cast to `timestamptz` in the query, so a value PostgreSQL cannot parse is a 500 rather
 * than an empty page. It is refused by the same code as the other two, because to a
 * client they are one condition — the server could not read the cursor.
 *
 * **This is the third keyset cursor in the repository**, after `people.controller.ts`
 * and `roster-cursor.ts`. They share the bound in `common/cursor.ts` and now the
 * refusal; whether the encode/decode pair should be generic there is on `CLAUDE.md`'s
 * open list, which is where an earlier version of this sentence said it was before it
 * was — the claim was made and never carried out, and a reader grepping for it found
 * nothing.
 */
export interface LeadershipRequestCursor {
  requestedAt: string;
  id: string;
}

/**
 * The `to_char` format the ordering key is rendered with, shared so the query and the
 * test that pins its rendering cannot drift apart — a test carrying its own copy of the
 * format would keep passing after the query's changed.
 */
export const CURSOR_INSTANT_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/**
 * The one rendering `requested_at` is ever carried in: ISO 8601, UTC, microseconds,
 * `2026-08-30T05:08:54.622914Z`.
 *
 * Exported so `test/database/cursor-rendering.spec.ts` can assert the query's own
 * `to_char` output against it under every `DateStyle`. That property cannot be pinned
 * end to end: the test harness opens its own pool, and a `SET` on one connection does
 * not reach the pool the application serves requests from — so an end-to-end case that
 * sets `DateStyle` is testing nothing about the session the query actually runs in.
 *
 * **Fixed by `to_char` with an explicit format rather than by a cast to `text`**, which
 * renders according to the session's `DateStyle`. That setting is now pinned by the pool
 * (`database/date-style.ts`), which this sentence used to say it was not — but the
 * `to_char` is still what makes the key safe, because an ISO cast emits
 * `2026-08-30 05:08:54.622914+00`, which `CURSOR_INSTANT` rejects on the space and the
 * offset. The pin removed the reason this was written; it did not remove the need for
 * it. Under `SQL`, `Postgres` or `German` a cast emits
 * `30/08/2026 …`, `Sun 30 Aug …` or `30.08.2026 …`, every one of which this pattern
 * rejects; the server would then refuse every cursor it had just emitted and serve page
 * one for ever, silently. Measured against all four styles rather than assumed.
 *
 * *An earlier version matched the cast's rendering and called it "the only shape this
 * cursor ever carries", which was true of this machine and of nothing else.*
 */
export const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export interface LeadershipRequestRow {
  id: string;
  kind: CellRequestKind;
  prospective_leader_id: string;
  requested_by: string;
  requested_at: Date;
  /**
   * The same instant at the column's own precision, rendered by PostgreSQL.
   *
   * `timestamptz` holds microseconds and the driver parses it into a JS `Date`, which
   * holds milliseconds — so a cursor built from `requested_at.toISOString()` is
   * *earlier* than the row it came from, `requested_at > cursor` matches that row
   * again, and the page repeats its last row instead of advancing. The response still
   * carries the `Date`, because that is what a client reads; only the key needs the
   * precision.
   */
  requested_at_key: string;
  cell_id: string | null;
}

export function decodeLeadershipRequestCursor(
  value: string | undefined,
): LeadershipRequestCursor | null {
  // An **absent** cursor is absent. The empty string is already refused by the DTO in
  // front of this; it is treated as absent here so the function is total for a caller
  // that has none.
  if (value === undefined || value === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as LeadershipRequestCursor).requestedAt === 'string' &&
      typeof (parsed as LeadershipRequestCursor).id === 'string' &&
      // The timestamp is cast to `timestamptz` in the query, so a value PostgreSQL
      // cannot parse reaches it as a cast error rather than as an empty page — the
      // 500-instead-of-an-answer failure this repository keeps recording. Checked here
      // because a cursor is client-supplied.
      //
      // **Matched against the format this code emits, not against `Date.parse`.** An
      // earlier version used `Date.parse`, which is a different and much wider
      // predicate: `new Date().toString()` passes it — V8's own output — and reaches
      // PostgreSQL as `time zone "gmt+0800" not recognized`, a reproduced 500.
      CURSOR_INSTANT.test((parsed as LeadershipRequestCursor).requestedAt)
    ) {
      return parsed as LeadershipRequestCursor;
    }
  } catch {
    // Falls through to the refusal below.
  }

  throw unresolvableCursor();
}

export function encodeLeadershipRequestCursor(
  cursor: LeadershipRequestCursor | null,
): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
