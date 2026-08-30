# 2026-08-23 — The application runs at READ COMMITTED, and that is now load-bearing


Escalated by the third `architecture-guardian` pass on the reassignment endpoint.

Section 5 has a write take an advisory lock on the person and *then* decide — scope,
invariant 4, invariant 1's two endpoints, the backdate floor. That design is correct
only under `READ COMMITTED`, where each statement after the lock takes a fresh
snapshot and therefore sees whichever transaction held the lock first.

Under `REPEATABLE READ` the snapshot is taken by the transaction's **first**
statement, which is the key-hashing `SELECT` inside `lockPersonsWithin` and runs
before the lock is held. Every check after it would then be decided on the state the
request arrived with — precisely the staleness the lock exists to remove.

*An earlier version of this entry said "nothing would raise, because the reads all
succeed", and that is true of the reads and not of the request.* Where the loser's
own assignment row moved, its own update would meet a version committed after its
snapshot and raise a serialization failure. The silent case is narrower and is the
one that matters: a concurrent move of an **intermediate ancestor** changes the
actor's scope while leaving every row this request writes untouched, so it commits a
write the actor was no longer authorized to make. A deployment changing
`default_transaction_isolation` would remove an authorization guarantee, and that
case would remove it quietly.

It is PostgreSQL's default and nothing in this repository sets it, so this records a
dependency rather than changing behaviour. Written to `SKILL.md` §24 beside the pool
and the probe, and asserted by reading `SHOW transaction_isolation` **inside a
transaction** — from the server rather than from configuration this repository
controls, because the thing that can change it is not a file here.

Recorded rather than left implicit because the failure is invisible: no test goes
red, no constraint fires, and the endpoint keeps answering 200. `SET LOCAL` is a
utility command and takes no snapshot, which is why the lock helper's first
*snapshot-taking* statement is the one that matters — a detail worth writing down,
since it is the kind of mechanism this log has recorded getting wrong seven times.

---

Decision 0099 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — A backdated reassignment is bounded by §4's floor and one rule of its own](0098-a-backdated-reassignment-is-bounded-by-4s-floor-and-one-rule.md) | Next: [2026-08-23 — Reusing a shape requires re-deriving why it has that shape](0100-reusing-a-shape-requires-re-deriving-why-it-has-that-shape.md)
