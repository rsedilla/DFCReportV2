import { unresolvableCursor } from '../common/cursor';
import { isUuid } from '../common/identifiers';
import { isCalendarDate } from '../common/time/manila';

/**
 * The opaque cursor `GET /api/v1/dcc/people/{id}/attendance` pages by (SKILL.md section 22,
 * *Pagination*; decision 0247).
 *
 * **Its own pair, because its key is its own.** The collection is one person's records,
 * newest event first, so the key is the event's date and then the event's id.
 *
 * `event_date` is unique, so the id never breaks a tie today. It travels anyway, because a
 * keyset that is total by construction does not depend on a constraint staying where it is.
 *
 * **Both parts are checked before the query sees them.** Each is cast in SQL, so a value
 * PostgreSQL cannot parse would reach the database as a cast error and answer 500 rather
 * than a refusal. A cursor this cannot read is refused with `VALIDATION_FAILED` naming the
 * field, on the ruling of 2026-08-31.
 */
export interface DccPersonAttendanceCursor {
  eventDate: string;
  eventId: string;
}

export function decodeDccPersonAttendanceCursor(
  value: string | undefined,
): DccPersonAttendanceCursor | null {
  // An absent cursor starts at the first page. The DTO in front of this refuses an empty
  // one; it is treated as absent here so the function is total.
  if (value === undefined || value === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as DccPersonAttendanceCursor).eventDate === 'string' &&
      typeof (parsed as DccPersonAttendanceCursor).eventId === 'string' &&
      isCalendarDate((parsed as DccPersonAttendanceCursor).eventDate) &&
      isUuid((parsed as DccPersonAttendanceCursor).eventId)
    ) {
      return parsed as DccPersonAttendanceCursor;
    }
  } catch {
    // Falls through to the refusal below.
  }

  throw unresolvableCursor();
}

export function encodeDccPersonAttendanceCursor(cursor: DccPersonAttendanceCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
