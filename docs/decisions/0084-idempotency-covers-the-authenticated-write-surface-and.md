# 2026-08-22 — Idempotency covers the authenticated write surface, and applies by default


§22 says "every state-changing request" carries an `Idempotency-Key`, and the
`idempotency_keys` shape §22 itself gives is keyed by account. Those two cannot
both be unconditional: an unauthenticated request has no account, so the store
cannot hold a row for it.

**The rule reaches every authenticated state-changing request.** The exempt set
is exactly §7's closed unauthenticated list — sign-in, token refresh, password
reset, activation, the probe — so the exemption is closed rather than a
judgement anyone extends. Derived from §22's own shape rather than invented, but
recorded because it is client-visible.

**It applies by default, not per endpoint**, for the reason §2 gives for the
capability guard: a convention remembered inside each handler is only as
reliable as the least familiar developer writing the newest route. A new write
endpoint is covered the moment it exists.

That reaches `logout` and `logout-all`, which are authenticated and
state-changing. Exempting them was considered and refused: §7 carves out
session endpoints from the *capability* guard, and borrowing that carve-out for
idempotency would be applying a rule to something it was not written about —
the mistake two review passes have already caught on this project. §22's
sentence is unconditional, and a retried sign-out returning the first answer is
better behaviour than a second revocation attempt.

**Nest applies a handler's status *before* the interceptor chain runs**, so
`res.statusCode` inside the interceptor is already the handler's — 201 for a
POST, whatever `@HttpCode` declares where one is present. That is what the
stored status is read from, and it is also what makes the replay path work: the
interceptor's own `.status()` call comes later and therefore wins.

*The first version of this entry said the opposite, and was wrong.* It claimed
the status was applied after the chain and had to be re-derived from
`@HttpCode` or the method. That reading came from `responseController.apply(result,
res, httpStatusCode)` late in `router-execution-context.js` — but `setStatus`
runs earlier: after the guards and before the interceptor chain. `apply`'s third
argument is `undefined` there, because `createHandleResponseFn` is invoked with
three arguments and declared with four. The re-derivation computed the same
numbers, so nothing broke; the recorded *reason* was false, and it asserted the
framework behaved in the way that would break the replay path in the same file.

*The first correction got the mechanism wrong too*, saying `setStatus` runs
"before the guards' own call site" when it runs after them. Both errors are the
same one: describing an ordering from a partial read. It is only worth recording
because the entry it appears in exists to warn against exactly that.

The replay path depends on `apply`'s third argument being `undefined`, which is
an arity accident rather than a documented guarantee. It is pinned by the case
asserting a replayed 409 on a route whose declared status is 201, which fails if
Nest ever starts passing it.

Worth keeping as a pattern rather than a footnote: this is the third time on
this project that a rule was written by reading part of a mechanism and
reasoning about the rest. The other two were the backdate floor and the
zero-length row.

**A 4xx is stored and a 5xx releases the key.** A domain refusal is this
request's outcome, decided by the rules, and a repeat of the same body is
entitled to the same answer. An unexpected failure carries no decision and rolls
back, so nothing was recorded and a retry cannot double-apply; storing it would
pin a transient failure to the key for a day with no way past it.

**The fingerprint is taken over a canonicalized body.** Nothing forbids a client
reordering object keys on a retry and several JSON libraries do, and treating
that as a different body answers `IDEMPOTENCY_KEY_REUSED` — which §22 makes
permanent and says must never be retried, turning an ordinary retry into a dead
end. Arrays keep their order, because order is meaning in an array.

Written to `SKILL.md` §22 — **except that these last two were not, and reached §22
only on 2026-08-23**: the 4xx/5xx split and the canonicalized fingerprint were
implemented, recorded here, and claimed as specified. The gap surfaced when a later
ruling cited §22 for the store/release rule four times over and
`architecture-guardian` went looking for it. "A decision that lives only in a chat
session does not exist" applies equally to one that lives only in this log and in
the code, and nothing checks a "Written to §22" claim.

---

Decision 0084 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — `people.correct_sex`, the twenty-fifth capability, Admin-only](0083-people-correctsex-the-twenty-fifth-capability-admin-only.md) | Next: [2026-08-22 — A claim and a response are bounded separately](0085-a-claim-and-a-response-are-bounded-separately.md)
