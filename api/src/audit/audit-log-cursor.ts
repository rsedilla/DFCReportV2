import { unresolvableCursor } from '../common/cursor';
import { CURSOR_INSTANT } from '../cells/leadership-request-cursor';
import { isUuid } from '../common/identifiers';
import { isStorableText } from '../common/text/storable-text';

/**
 * The opaque cursor `GET /api/v1/audit-log` pages by (SKILL.md section 22, decision 0428):
 * `occurred_at` newest first, then `id`, both carried, as the leadership request cursor carries
 * its key and for the same reasons. The instant is rendered by PostgreSQL at the column's
 * microsecond precision, in the one format `CURSOR_INSTANT` accepts; a cursor that is not that
 * shape is refused rather than cast, so it can never reach the database as a cast error.
 */
export interface AuditLogCursor {
  occurredAt: string;
  id: string;
}

export function decodeAuditLogCursor(value: string | undefined): AuditLogCursor | null {
  if (value === undefined || value === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const cursor = parsed as AuditLogCursor;

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      isStorableText(cursor.occurredAt) &&
      CURSOR_INSTANT.test(cursor.occurredAt) &&
      typeof cursor.id === 'string' &&
      isUuid(cursor.id)
    ) {
      return { occurredAt: cursor.occurredAt, id: cursor.id };
    }
  } catch {
    // Falls through to the refusal below.
  }

  throw unresolvableCursor();
}

export function encodeAuditLogCursor(cursor: AuditLogCursor | null): string | null {
  return cursor === null ? null : Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
