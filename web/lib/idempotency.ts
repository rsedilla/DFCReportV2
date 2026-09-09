/**
 * An idempotency key derived from the request it belongs to (SKILL.md sections 22
 * and 23; decision 0127).
 *
 * **A key belongs to a body, not to an attempt.** Decision 0127 settles that, and
 * it is what makes the guarantee useful on the connection a leader actually has:
 * pressing Save twice writes once, a retry after a dropped response replays the
 * stored answer rather than recording a second time, and changing something and
 * saving again is a different request that gets a different key. A
 * `crypto.randomUUID()` per press satisfies none of that — it makes every attempt
 * a new request, which is the opposite of what the header is for.
 *
 * **It returns a v4 UUID because the boundary validates the format.** Section 22
 * fixes the shape at the edge, so a client inventing its own digest format would
 * simply be refused. The randomness a v4 normally carries is deliberately replaced
 * by the body's own content, which is the whole point: two attempts at one
 * submission must agree.
 *
 * **This is one rule and therefore one function.** The submission *shapes* across
 * this application differ, and differ for reasons section 14 is explicit about — a
 * Cell submission carries one version for the meeting, a DCC submission one per
 * person. That is a fact about the bodies and not about how a key is derived from
 * one. *An earlier version of this reasoning kept a copy of the hash in each
 * recording screen on the ground that the two bodies were not the same shape,
 * which conflated the two; five copies of a hash is the duplication this
 * repository condemns everywhere else.*
 *
 * The hash is not cryptographic and does not need to be. What it must do is agree
 * with itself for equal inputs and differ for unequal ones, which is what the
 * retry guarantee rests on; a collision would replay somebody's own earlier
 * request to themselves, not anybody else's.
 */
export function idempotencyKeyFor(...parts: unknown[]): string {
  const canonical = JSON.stringify(parts);

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }

  const hex = (value: number) => value.toString(16).padStart(8, '0');
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(Math.imul(h1 ^ h2, 0xc2b2ae35) >>> 0);
  const d = hex(Math.imul(h1 + h2, 0x27d4eb2f) >>> 0);

  // Version 4 and the RFC variant, so the value satisfies the boundary's own
  // `@IsUUID()` rather than merely looking like a UUID.
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
}
