# 2026-08-22 — A claim and a response are bounded separately


`expires_at` was doing two jobs of different lengths: retaining the response for
§22's "at least 24 hours", and bounding how long a claim may sit unfinished. A
request whose process died left its row `IN_FLIGHT` for the full day, and every
retry was answered `REQUEST_IN_FLIGHT` — which §22 defines as "retry after a
short delay". A day is not a short delay, and the caller never learned the
outcome.

`claimed_at` bounds the attempt; `expires_at` keeps the answer. A claim older
than a one-minute lease may be taken over. Migration 0003 adds the column and
§22's shape is amended in the same change, per the rule that a shape is amended
when a rule needs a column.

Two smaller items settled with it, both client-visible and neither derivable:
a request **missing** the header is `VALIDATION_FAILED` — a required header that
is absent is malformed input; and a replay reproduces **the status and the body
and nothing else**, which is written into §22 as a constraint on endpoints rather
than a limitation of the store: no state-changing endpoint may put meaning in a
response header, because a `Location` or an `ETag` would not survive a retry.

**What the lease does not close, and is recorded as open below.** It bounds an
abandoned attempt, and it cannot distinguish one abandoned *before* the write
committed from one abandoned *after*. For the second, taking the claim over
means executing a committed write again — sooner than before, not never. That
window is narrow and real, and closing it needs the completion to share the
write's transaction rather than follow it.

---

Decision 0085, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — Idempotency covers the authenticated write surface, and applies by default](0084-idempotency-covers-the-authenticated-write-surface-and.md) | Next: [2026-08-22 — A write endpoint records its idempotency completion in its own transaction](0086-a-write-endpoint-records-its-idempotency-completion-in-its.md)
