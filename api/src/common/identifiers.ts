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
 * The same value with every UUID-shaped string in it canonicalized.
 *
 * Strings, arrays and plain objects, recursively; anything else is returned as it
 * came. Nothing is mutated — a fresh value is built, because the caller may be
 * holding the request body.
 *
 * **Only UUID-shaped strings are touched, and that is what makes this safe to run
 * over a whole request.** A name, a reason, a search term or a pagination cursor
 * is not eight-four-four-four-twelve hex, so none of them can be caught by
 * accident. A UUID is case-insensitive by definition, so canonicalizing one loses
 * nothing.
 */
export function canonicalizeIdentifiers(value: unknown): unknown {
  if (typeof value === 'string') {
    return UUID.test(value) ? canonicalId(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeIdentifiers);
  }

  // Plain objects only. A `Date`, a `Buffer` or a class instance is left alone:
  // this runs before validation, where a body is still the parsed JSON.
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        canonicalizeIdentifiers(item),
      ]),
    );
  }

  return value;
}

/**
 * Canonicalizes every identifier a client supplies, on every route, without being
 * asked.
 *
 * Registered globally, which is the whole point. The rule above was previously a
 * pipe wired onto each `@Param('id')`, so the next route written without it was
 * silently outside the rule — verbatim the failure SKILL.md section 2 gives as the
 * reason the capability guard is declarative and fails closed. A convention
 * remembered per parameter is only as reliable as the least familiar developer
 * writing the newest route, and per *field* is no better.
 *
 * **Path parameters, query and body — everything a client sends.** An earlier
 * version took path parameters alone and gave a reason that its own implementation
 * made inapplicable: it claimed the search cursor had to be protected from
 * canonicalization, when a base64url cursor is not UUID-shaped and could never
 * have been touched. What the narrow version actually left out was every
 * identifier arriving as a query filter (section 22 documents one) and every body
 * field, which each needed a decorator somebody had to remember.
 *
 * `custom` arguments are excluded because they are not client input: `@CurrentActor`
 * and `@CurrentIdempotency` are values this application constructed.
 *
 * **It canonicalizes and does not validate.** Whether a value is a UUID at all is
 * decided elsewhere — by the capability guard for the target it resolves scope
 * against, and by the DTOs for everything they declare. A pipe that threw here
 * would be a second answer to a question already asked, and its throwing branch
 * was in fact unreachable for that reason.
 */
@Injectable()
export class CanonicalIdentifierPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') {
      return value;
    }

    return canonicalizeIdentifiers(value);
  }
}
