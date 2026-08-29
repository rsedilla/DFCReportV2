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
/**
 * PostgreSQL's `timestamptz` text rendering, which is what `cast(requested_at as text)`
 * produces and therefore the only shape this cursor ever carries:
 * `2026-08-30 11:22:33.456789+08`. Fractional seconds are absent when zero, and the
 * offset carries minutes only where the zone has them.
 */
const TIMESTAMPTZ_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

export interface LeadershipRequestCursor {
  requestedAt: string;
  id: string;
}

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
      // PostgreSQL as `time zone "gmt+0800" not recognized`, a reproduced 500. What is
      // emitted is `cast(requested_at as text)`, whose rendering is fixed.
      TIMESTAMPTZ_TEXT.test((parsed as LeadershipRequestCursor).requestedAt)
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
