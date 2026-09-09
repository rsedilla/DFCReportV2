import { unresolvableCursor } from '../common/cursor';
import { isStorableText } from '../common/text/storable-text';

/**
 * The opaque cursor for `GET /api/v1/cells`, which is ordered by `cell_id` alone
 * (SKILL.md section 22; decision 0226).
 *
 * **One key, and its own file rather than a fourth use of `roster-cursor.ts`.** That
 * file states the rule it lives by: "Sharing happens where the key is identical, and
 * there it is not optional." This key is not identical — it is a single column, not the
 * `(last_name, first_name, member_id)` triple — so a shared implementation would need a
 * type parameter and a per-route validator, which is most of what each file already
 * holds.
 *
 * **Opaque even though the value inside it is public.** Section 10 publishes `CELL-000000`
 * as the handle a person recognises, so nothing is concealed by the encoding; what
 * section 22 is protecting is the *format*, so that the key this collection orders by can
 * change without a client having learned to construct one. A client that built
 * `?cursor=CELL-000042` by hand would be broken by any future ordering, and would look
 * like a server defect when it was.
 *
 * **The key is immutable, which is the property `roster-cursor.ts` had to work for.**
 * There the key is a name, so a rename between two pages moves the boundary and rows are
 * skipped or repeated. `cells.cell_id` is generated once and never rewritten — section 10
 * keeps it across a category change for exactly that reason — so this cursor cannot go
 * stale in that way. Carrying the whole key is still what makes it a keyset rather than
 * an offset, which section 22 requires because a Cell created mid-paging would otherwise
 * shift every subsequent page by one.
 *
 * **An unreadable cursor is refused** rather than treated as absent (section 22, ruling
 * of 2026-08-31): a client sends one because it already holds a page, and handing it the
 * first page again under a `200` makes a restart indistinguishable from a collection that
 * grew.
 */
export interface CellIndexCursor {
  cellId: string;
}

export function decodeCellIndexCursor(value: string | undefined): CellIndexCursor | null {
  // Absent starts at the first page. The empty string is refused by the DTO in front of
  // this; it is read as absent here so the function is total for a caller with none.
  if (value === undefined || value === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      isStorableText((parsed as CellIndexCursor).cellId)
    ) {
      return parsed as CellIndexCursor;
    }
  } catch {
    // Falls through to the refusal below: a value that is not base64url JSON and one
    // that is JSON of the wrong shape are equally unresolvable, and section 22 gives
    // them one code.
  }

  throw unresolvableCursor();
}

export function encodeCellIndexCursor(cursor: CellIndexCursor | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
