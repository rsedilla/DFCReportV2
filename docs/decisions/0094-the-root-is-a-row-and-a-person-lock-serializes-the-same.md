# 2026-08-23 — The root is a row, and a person lock serializes the same-Network rule


Two Stop Conditions escalated by the second `architecture-guardian` pass, both
ruled on rather than guarded around.

**A Network root is an active pastoral assignment whose `leader_id` is null.**
Section 5 asserted both that a root has "no active pastoral assignment" and that
"A root leader has a null `leader_id`", which are different claims about whether a
row exists. The row-based reading is settled, and the contradictory sentence is
gone.

Two things decide it. It is the only reading under which "is this person a root"
is a question the database can answer, and section 4's refusal to move a root
between Networks needs exactly that — a root must be refused where somebody merely
unassigned must not be. And the alternative needs a durable record of who the
roots are, which section 7 declined to create because it would put the church's two
most consequential positions behind a row somebody could edit.

Invariant 3's "zero is legitimate in exactly three situations" becomes two: a
Person not yet assigned, and an archived Person. A root is no longer one of them.

The evidence that this was the reading already in use is a test whose name and body
disagreed. `permits zero open assignments, which is legitimate for a Network root`
asserted a row with a null `leader_id` in its body. The schema, the fixtures and
every existing test already did it this way; only the prose was undecided.

**An advisory lock on the person serializes a Network change against a concurrent
edge write.** The deferred triggers each see only their own transaction's
commit-time state, which leaves a window neither closes: an edge opened under the
person, dated just before the change's effective instant and committing just after
it, is invisible to the change's comparison and legal by its own. The result is a
permanent cross-Network edge, against a rule section 5 calls hard on every write.

Reachable today through `POST /api/v1/people`, which is why this was not deferred to
the reassignment endpoint. The first version of the open item claimed the other path
did not exist yet; it does.

An advisory lock rather than `SELECT ... FOR UPDATE` on `persons`, because the two
paths live in different modules and `persons` belongs to `people` — a row lock would
mean `networks` reading a table it does not own in order to coordinate rather than to
read. Advisory locks are coordination primitives belonging to no table, and being
transaction-scoped they cannot be leaked by a failing path.

**The ordering rule is the part that will be got wrong**, so the helper sorts rather
than trusting its callers: two corrections moving people under each other, each
locking its own person first, deadlock, and PostgreSQL rather than we choose the
victim. Locks are issued one statement per key, because `FOR UPDATE` with `ORDER BY`
does not guarantee rows are locked in sorted order and the same caution applies to
batching.

The test holds the lock and asserts the correction does **not** proceed, then
releases it and asserts it does. Firing two requests concurrently and hoping to
observe the race would pass against no lock at all nearly every run, which is the
test-that-passes-for-the-wrong-reason this log keeps recording.

---

Decision 0094 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — Three rulings the review of the sex correction forced, and one gap it found](0093-three-rulings-the-review-of-the-sex-correction-forced-and.md) | Next: [2026-08-23 — `RESOURCE_BUSY`, and why its status carries the rule](0095-resourcebusy-and-why-its-status-carries-the-rule.md)
