/**
 * A high surrogate with no low one after it, or a low surrogate with no high one before it.
 *
 * `String.prototype.isWellFormed` says this in one call and needs `lib: es2024`; this file is
 * not the place to move the whole project's target, so the pair is matched directly. The two
 * agree on every input: checked against `isWellFormed` over every code unit and over every
 * two-unit combination across the surrogate range, with no divergence.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Whether PostgreSQL can store this value as written (SKILL.md section 22).
 *
 * Two characters a JSON string may legally contain that a `text` column will not keep, and
 * they fail differently — which is why both are refused rather than only the loud one:
 *
 * - **U+0000** is refused by the database outright, so it surfaces as `INTERNAL_ERROR` on a
 *   well-formed request.
 * - **An unpaired surrogate** is accepted and silently rewritten to U+FFFD, so the request
 *   succeeds and the record says a person wrote something they did not.
 *
 * **A predicate rather than only a decorator**, because text reaches the database through
 * two kinds of edge and only one of them is a DTO. A pagination cursor arrives base64url
 * encoded and is decoded into strings that go straight into a keyset comparison, so a forged
 * cursor carried a null byte past every validator in the application and answered 500 —
 * which is the same rule failing at an edge the decorator cannot see.
 *
 * A valid surrogate **pair** is unaffected: an emoji is two well-formed code units, and a
 * note typed on a phone is the ordinary case rather than the exotic one.
 */
export function isStorableText(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}
