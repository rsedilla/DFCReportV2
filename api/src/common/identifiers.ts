import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';

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
 * Whether a key names an identifier, per SKILL.md section 22's field-naming
 * convention: a bare `id` or `ids`, or anything ending `_id` or `_ids`.
 *
 * **The bare forms are the load-bearing half.** A path parameter binds under the
 * name its route declared, so `@Param('id')` hands this the key `id` — and a
 * pattern admitting only the suffixed forms would put every path parameter in the
 * API outside the rule, which is the case the boundary was written for. The plural
 * is admitted alongside it at both positions, so `ids` and
 * `acknowledged_duplicate_ids` are one rule rather than two.
 *
 * **`camelCase` is deliberately not matched.** Section 22 makes the API surface
 * `snake_case`, so a `meetingId` arriving from a client is a naming defect to fix
 * at the route rather than a spelling for this to absorb. An earlier version
 * accepted `Id`/`Ids` as defence in depth, which is a shape kept without its
 * reason holding (section 25, rule 19): no route, DTO or fixture in this
 * repository names an identifier that way.
 *
 * `forbidNonWhitelisted` is a *partial* backstop and was first cited here as a
 * complete one. `ValidationPipe` validates class metatypes only, so a binding
 * typed as a plain object is skipped entirely, and the idempotency fingerprint
 * walks the raw body before any pipe runs. What the narrowing rests on is that
 * absorbing a `meetingId` silently is what would hide the naming defect, not that
 * one could never arrive.
 *
 * Ordinary words ending in those letters — `valid`, `humid`, `candid` — are not
 * matched, because every branch requires either the whole key or a preceding
 * underscore.
 *
 * The field *name* is what decides, not the value's shape, and that is the whole
 * safety argument. A shape-only rule cannot tell an identifier from a password
 * that happens to be UUID-shaped — `uuidgen` output is an ordinary ad-hoc
 * password — and lowercasing one silently locks an account out for good. Names are
 * decided by this codebase; the contents of a credential field are not.
 */
const IDENTIFIER_KEY = /^ids?$|_ids?$/;

/**
 * How deep a client's JSON may nest before the request is refused.
 *
 * A body is JSON that arrived from a client, so its nesting is chosen by whoever
 * sent it. `JSON.parse` is iterative in V8 and accepts any depth — measured past
 * two hundred thousand levels — while every walk over the result in this
 * application is recursive and does not. **A few thousand levels overflows the
 * stack**, and an unhandled `RangeError` renders as `INTERNAL_ERROR`: a 500 logged
 * as a defect, produced by input, on every authenticated write endpoint.
 *
 * No exact threshold is quoted, deliberately. It moves with the payload's shape
 * and with the stack headroom at the call site, and an earlier version of this
 * comment asserted one measured pair as though it were a constant — it was one
 * shape in one context, and both halves were wrong for every other. What is worth
 * recording is the cheapest case, because it decides whether a body limit helps:
 * a nested **array** reaches it in single-digit kilobytes, since a level costs two
 * bytes, one for each bracket.
 *
 * **Exceeding it is refused, not truncated.** An earlier version stopped
 * descending and returned the container unchanged, which is worse than it looks:
 * a request nested past the bound kept its identifiers in whatever case the client
 * sent them, silently, and every comparison below became a comparison on a
 * spelling.
 *
 * It answers `VALIDATION_FAILED` because a body no DTO in this system describes is
 * malformed input, which is what that code means (section 22). The refusal is
 * deterministic, so a retry gets the same answer whether or not anything was
 * stored — and on the path that actually fires nothing is: the interceptor reaches
 * this before it claims the key, so no row exists and section 22's store-a-4xx
 * rule is never consulted. An earlier version of this comment cited that rule as
 * the reason, which described a path this code does not take.
 *
 * Twenty is far beyond any DTO in this system — the deepest is an array of
 * identifiers inside a body, at three — and far short of a stack.
 */
export const MAX_IDENTIFIER_DEPTH = 20;

/** Refuses a payload nested past {@link MAX_IDENTIFIER_DEPTH}. */
export function assertWithinDepth(depth: number): void {
  if (depth >= MAX_IDENTIFIER_DEPTH) {
    throw new ValidationFailedError('That request body is nested too deeply.', {
      max_depth: MAX_IDENTIFIER_DEPTH,
    });
  }
}

/**
 * The same value with identifier fields canonicalized.
 *
 * A string is canonicalized only when **both** hold: the key that carries it names
 * an identifier, and the value is UUID-shaped. The intersection is deliberate and
 * each half stops a different mistake.
 *
 * - **Name alone would corrupt a non-UUID identifier.** `member_id` is `M-` plus
 *   six digits (section 3), and lowercasing it changes the value.
 * - **Shape alone would corrupt a credential.** A password is arbitrary bytes and
 *   case-sensitive, and nothing about its content marks it as one.
 *
 * Arrays inherit the key that holds them, so `acknowledged_duplicate_ids` reaches
 * its elements. Nothing is mutated — a fresh value is built, because the caller
 * may be holding the request body, and the capability guard reads that body before
 * this runs.
 *
 * Plain objects only, and `null`-prototype counts as plain: Express 5 builds
 * `req.query` and `req.params` with `Object.create(null)`, so a prototype test
 * against `Object.prototype` alone silently skips every object-bound query and
 * path parameter — which is exactly the "silently outside the rule" failure this
 * exists to remove. A `Date`, a `Buffer` or a class instance is still excluded.
 *
 * *A revision of this docblock claimed the result **aliases** the input wherever
 * nothing changed. It does not, for any array or plain object — every container is
 * rebuilt unconditionally — and the reason offered for it described non-mutation
 * rather than aliasing. The original sentence above is the true one and stands.*
 */
export function canonicalizeIdentifiers(value: unknown, key?: string, depth = 0): unknown {
  if (typeof value === 'string') {
    return key !== undefined && IDENTIFIER_KEY.test(key) ? canonicalIfUuid(value) : value;
  }

  // **Asserted immediately before descending, never on a leaf**, which is what
  // makes this agree with the fingerprint's walk rather than merely share its
  // constant. Asserted first, a leaf occupied a level here and not there, so one
  // body twenty deep was refused or accepted according to whether its innermost
  // value happened to be a string — the disagreement the shared constant is
  // supposed to prevent, introduced by the commit claiming it had been.
  if (Array.isArray(value)) {
    assertWithinDepth(depth);
    return value.map((item) => canonicalizeIdentifiers(item, key, depth + 1));
  }

  if (isPlainObject(value)) {
    assertWithinDepth(depth);
    return Object.fromEntries(
      Object.entries(value).map(([itemKey, item]) => [
        itemKey,
        canonicalizeIdentifiers(item, itemKey, depth + 1),
      ]),
    );
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
 * version took path parameters alone and gave a reason its own implementation made
 * inapplicable: it claimed the search cursor had to be protected, when a base64url
 * cursor is not UUID-shaped and could never have been touched. What the narrow
 * version actually left out was every identifier arriving as a query filter
 * (section 22 documents one) and every body field.
 *
 * For a named binding — `@Param('id')`, `@Query('filter_id')` — the key is the name
 * the route asked for. For an object binding it is each property's own key.
 *
 * **`custom` arguments are skipped, and that is by Nest's bucket rather than by
 * intent.** Everything that is not a body, a param or a query resolves to `custom`,
 * which today means `@CurrentActor` and `@CurrentIdempotency` — values this
 * application constructed — but also covers uploaded files and raw bodies, which
 * are client input. Nothing in this system binds those yet; a route that does, or a
 * future identifier decorator built with `createParamDecorator`, lands in this
 * branch and would need naming here.
 *
 * **It canonicalizes and does not validate.** Whether a value is a UUID at all is
 * decided elsewhere — by the capability guard for the target it resolves scope
 * against, and by the DTOs for everything they declare. A pipe that threw here
 * would be a second answer to a question already asked.
 */
@Injectable()
export class CanonicalIdentifierPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') {
      return value;
    }

    return canonicalizeIdentifiers(value, metadata.data);
  }
}
