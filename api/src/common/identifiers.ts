import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';

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
 * The remedy is applied in two places on purpose. `CanonicalIdentifierPipe`
 * normalizes at the boundary — globally, so that no route has to opt in and
 * nothing downstream has to remember — and the security check in `hierarchy`
 * normalizes again, because a check that fails open must not depend on the
 * boundary having done its job.
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
 * Canonicalizes every UUID-shaped **path parameter**, on every route, without
 * being asked.
 *
 * Registered globally, which is the whole point. The rule above was previously a
 * pipe wired onto each `@Param('id')`, so the next route written without it was
 * silently outside the rule — verbatim the failure SKILL.md section 2 gives as the
 * reason the capability guard is declarative and fails closed. A convention
 * remembered per parameter is only as reliable as the least familiar developer
 * writing the newest route.
 *
 * **Path parameters only, and that is deliberate rather than cautious.** A query
 * parameter can be case-sensitive by construction: the search cursor is base64url,
 * where `A` and `a` are different bytes, so canonicalizing queries would corrupt
 * pagination. A body is a DTO, whose identifier fields carry their own transform
 * and whose other fields are names and reasons that must survive untouched.
 *
 * **It canonicalizes and does not validate.** Whether a path parameter is a UUID
 * at all is already decided before this runs: guards execute before pipes, and the
 * capability guard refuses a target that is not one (section 7). A pipe that threw
 * here would be a second answer to a question already answered — and its throwing
 * branch was, in fact, unreachable for exactly that reason.
 *
 * Anything that is not a UUID-shaped string is passed through untouched, so a
 * route with a non-UUID path parameter is unaffected by this existing.
 */
@Injectable()
export class CanonicalIdentifierPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'param' || typeof value !== 'string' || !UUID.test(value)) {
      return value;
    }

    return canonicalId(value);
  }
}
