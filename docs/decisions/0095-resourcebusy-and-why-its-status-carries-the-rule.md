# 2026-08-23 — `RESOURCE_BUSY`, and why its status carries the rule


The person lock introduced the first unbounded intra-request wait in the system.
`pg_advisory_xact_lock` waits forever, §24 bounds the pool at ten with no
acquisition timeout, and nothing sets a statement or lock timeout anywhere. One
client left idle in a transaction blocks every request touching that person, each
blocked request holds a connection, and at ten of them the liveness probe cannot
obtain one either — it runs `SELECT 1` on the same pool, so a healthy process is
read as dead and restarted, losing the transactions that were making progress.

**A three-second `lock_timeout`, and a new §22 code answered on the way out.**
`RESOURCE_BUSY`. Three seconds is longer than any transaction that legitimately
takes this lock — each is a handful of statements — and short enough that the
queue drains rather than accumulating.

**The status is 503, and choosing it was the whole of the decision.** §22 stores a
4xx against the idempotency key and releases the key on a 5xx, and the reason is
that the first is a decision the rules reached and the second carries none.
Contention reaches no decision. A 409 — which is where every other conflict-shaped
code in §22 sits, and the obvious choice — would have been *stored*, so every later
retry of that key would replay the transient failure for the full retention. That
is precisely the dead end §22's release rule exists to prevent, and it would have
been introduced by the change that was fixing a different unbounded-wait problem.

Recorded because the alternative was worse in an instructive way: keeping 409 and
teaching the interceptor to release this one code. That works and is one more thing
somebody must remember for every code added afterwards. Putting the code on the
correct side of a split that already exists makes the behaviour structural, which is
the same argument §2 makes for the capability guard and §22 for `completeWithin`'s
transaction parameter.

The test asserts the retry, not the refusal. A case checking only that a blocked
write answers 503 would pass equally against the stored-forever version.

---

Decision 0095, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — The root is a row, and a person lock serializes the same-Network rule](0094-the-root-is-a-row-and-a-person-lock-serializes-the-same.md) | Next: [2026-08-23 — Three corrections to the lock, and two rules that were never written down](0096-three-corrections-to-the-lock-and-two-rules-that-were-never.md)
