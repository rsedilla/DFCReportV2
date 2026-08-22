import { Injectable, type PipeTransform } from '@nestjs/common';

import { ValidationFailedError } from './errors/api-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The canonical form of an identifier, for comparison in application code.
 *
 * **PostgreSQL compares a `uuid` column case-insensitively and JavaScript does
 * not.** Every identifier that reaches a `uuid` column is therefore normalized for
 * free, and every identifier compared with `===`, `.includes` or `Set.has` is not
 * — so the same person named in two cases is one person to the database and two to
 * the application, and only the comparisons written in TypeScript can tell the
 * difference.
 *
 * That is not hypothetical input. `@IsUUID()` and the guard's own pattern both
 * accept either case, and `UUID().uuidString` on iOS is uppercase by default,
 * which SKILL.md section 2 names as a client surface.
 *
 * It has already produced two defects of very different severity: a lock key that
 * failed to serialize two writes naming one person, and — the one that matters —
 * section 5 invariant 4 answering "this is not you" to somebody correcting their
 * own record with their id in uppercase, which is the escalation that check exists
 * to stop.
 *
 * The remedy is applied in two places on purpose. `CanonicalUuidPipe` normalizes
 * at the boundary so that nothing downstream has to remember, and the security
 * check in `hierarchy` normalizes again, because a check that fails open must not
 * depend on a caller having wired a pipe.
 */
export function canonicalId(value: string): string {
  return value.toLowerCase();
}

/**
 * The canonical form of a value that is a UUID, and the value unchanged where it
 * is not.
 *
 * For the one place an identifier is **stored** as free text rather than compared:
 * `audit_log.target_id`, which SKILL.md section 21 makes `text` precisely because
 * not every target is keyed by a UUID — a setting is keyed by its `key`. Blanket
 * lowercasing would canonicalize the UUIDs and quietly corrupt anything else, so
 * this narrows to the shape it understands.
 */
export function canonicalIfUuid(value: string): string {
  return UUID.test(value) ? canonicalId(value) : value;
}

/** Whether two identifiers name the same record, however each was spelled. */
export function sameId(left: string, right: string): boolean {
  return canonicalId(left) === canonicalId(right);
}

/**
 * Validates a path parameter as a UUID and hands on its canonical form.
 *
 * Nest's own `ParseUUIDPipe` validates and returns the value unchanged, which
 * leaves exactly the problem above. This one lowercases, so a handler and every
 * service below it compare identifiers that came from a client against
 * identifiers that came from the database and get the right answer.
 *
 * Guards run before pipes, so the capability guard still sees the raw value — that
 * is safe, because everything it does with it ends in a `uuid` comparison in SQL.
 */
@Injectable()
export class CanonicalUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw new ValidationFailedError('That identifier is not a UUID.', { value });
    }

    return canonicalId(value);
  }
}
