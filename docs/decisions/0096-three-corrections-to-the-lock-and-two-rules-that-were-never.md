# 2026-08-23 — Three corrections to the lock, and two rules that were never written down


Fourth `architecture-guardian` pass. Two behavioural defects, and two rules this
log had recorded as specified while `SKILL.md` did not contain them.

**The lock key is computed from the identity, not from its spelling.**
`hashtextextended` is case-sensitive; a `uuid` column comparison is not, and
`@IsUUID()` accepts either case. So the same leader named in uppercase and in
lowercase compared equal everywhere in the system except in the lock, where they
took two different keys and serialized against nothing — reopening the window the
lock had just been built to close. `UUID().uuidString` on iOS is uppercase by
default and §2 names iOS as a client, so this was not hypothetical. The key is now
taken over `id::uuid::text`.

**`SET LOCAL lock_timeout` bounds the whole transaction, not the acquisition.** The
comment said it reverts for the pooled connection's next occupant, which is true,
and stopped there — so nothing said it also stays in force for the row locks the
caller takes afterwards, including the idempotency key's in `completeWithin`. Those
raise `55P03` at call sites that know nothing about locks, where it was neither
caught nor recognised: an unhandled 500, logged as a defect, for ordinary
contention.

Kept rather than narrowed, because those waits are unbounded otherwise and an
unbounded wait inside a transaction holding a pooled connection is the same hazard
the timeout was added for. What it required was classifying an elapsed wait as
`RESOURCE_BUSY` **wherever it is raised**, which `ApiExceptionFilter` now does. §5
says both halves.

*This is the fifth time on this project that a mechanism was described from the
part of it being looked at.* The others are the backdate floor, the zero-length
row, the Nest status ordering, and the §8 redaction.

**The sort key changed and `SKILL.md` did not.** Ordering by lock key rather than by
person id was right — a collision can otherwise give two callers opposite
acquisition orders, which is a cycle rather than mere over-serialization — but §5
was left stating the old rule in two places, in a commit that edited the paragraph
directly beneath it. Both now say ascending lock key.

**Two rules were cited to §22 and were not in §22.** The 4xx-stored / 5xx-released
split, and the canonicalized fingerprint. The 2026-08-22 ruling says both were
written there; neither was, and the first had by then become the entire
justification for `RESOURCE_BUSY` being a 503. §22 now carries both, and that entry
is annotated.

**§24 gained the pool and the probe**, for the same reason: §5 cited §24 for a
bounded pool and a liveness probe sharing it, and §24 contained neither. Whether the
probe should keep sharing the pool is an operational decision, recorded as open
rather than settled.

**Two tests were named for more than they pinned.** The `POST /people` case claimed
to pin lock-before-check and would have passed under either order; it now names an
**archived** leader, so a request that validated first would refuse without ever
waiting. And nothing pinned §5's ordering rule at all — the property whose absence
is a deadlock with a PostgreSQL-chosen victim. It is pinned now by holding the
*higher* of two keys and asserting the caller is **holding** the lower one while it
waits, which is true only if the helper sorted.

---

Decision 0096, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — `RESOURCE_BUSY`, and why its status carries the rule](0095-resourcebusy-and-why-its-status-carries-the-rule.md) | Next: [2026-08-23 — An identifier is compared canonically, and the class was wider than the instance](0097-an-identifier-is-compared-canonically-and-the-class-was.md)
