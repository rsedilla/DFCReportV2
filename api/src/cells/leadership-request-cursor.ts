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
 * An unreadable cursor is treated as absent, matching `GET /api/v1/people` and the Cell
 * roster. Section 22 does not settle what a collection endpoint does with a forged,
 * stale or unparseable cursor — `CLAUDE.md` carries that as open — and this route makes
 * the third implementation agreeing rather than a second answer.
 *
 * **This is the third keyset cursor in the repository**, after `people.controller.ts`
 * and `roster-cursor.ts`. They share the bound in `common/cursor.ts` and nothing else;
 * whether the encode/decode pair should be generic there is recorded as open rather than
 * settled by a third copy.
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
 * renders according to the session's `DateStyle` — a setting nothing in this repository
 * pins and the deployment controls. Under `SQL`, `Postgres` or `German` a cast emits
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
    // Falls through to null: an unreadable cursor is absent, per the docblock above.
  }

  return null;
}

export function encodeLeadershipRequestCursor(
  cursor: LeadershipRequestCursor | null,
): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
