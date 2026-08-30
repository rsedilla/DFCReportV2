# 2026-08-31 — A Cell leadership audit entry names the Cell

Settled before any Stage 4 code, because `audit_log` is append-only and Stage 4 writes
a great many entries. A convention decided after they are written leaves the log
permanently heterogeneous, and every later reader carrying both readings in their head.

**All three Cell leadership actions carry `target_type = 'cell'` and the Cell's UUID as
`target_id`: `cell_leadership.opened`, `cell_leadership.ended`, and
`cell_leadership.changed`.** The outgoing and the incoming leader continue to be
carried in `before` and `after`, which is what Section 21 already asks of them.

## What was actually there

The three did not agree, and nothing had decided that they should not.
`cell_leadership.opened` targeted the **person** at both of its sites —
`cells.service.ts` for direct creation during initial encoding, and
`cells.leadership-request.service.ts` for a `NEW_CELL` approval. `ended` targeted the
**Cell** in the closure service, and `changed` targeted the **Cell** in the approval.

The divergence between `opened` and `ended` predates the approval endpoint. The
approval picked the Cell for `changed` because its neighbour had it, which is Section
25 rule 19 — a shape reused without re-deriving why it had that shape — and the
question was raised rather than settled at the time.

The consequence is not cosmetic. Section 7 resolves an audit entry's scope **through
its target**, so a reader whose scope covers the person but not the Cell saw the
appointment and not the handover that took it away, and a reader searching one person's
leadership history found the opening and not the ending.

## Why the Cell

**Section 7 already says how a leadership resolves, and it says the Cell.** Its target
list is explicit: "a Cell, a Cell meeting, a membership or a leadership resolves through
the Cell's leader **as of the period being viewed**, falling back to its last leader
where the Cell is closed". A Cell-targeted entry therefore resolves by the rule written
for the thing the entry is about. A person-targeted one resolves through that person's
pastoral position, which is a different rule reaching a different answer.

**The fallback clause is what decides it rather than the general shape.** Section 7
gives a closed Cell's history to the leader who led it, and Sections 10 and 15 require
that. A closure writes `cell_leadership.ended`; if that entry resolved through the
person, the outgoing leader's later pastoral reassignment would move who can read the
record of a Cell they closed. Resolving through the Cell is stable in exactly the sense
the period clause means.

**Section 21's own reader-question is Cell-shaped.** It says a reader "asking who led a
Cell before a handover must find it here". The question names a Cell, so the entry a
search starts from is the Cell's.

**The person-shaped search is served, and by the field built for it.** Section 21
requires these entries to carry "the outgoing and the incoming leader where each
exists", and all four sites already do. So naming the Cell as the target costs a
person-shaped search a payload predicate rather than the entry itself, while naming the
person costs a Cell-shaped search the fallback above. Only one of those two losses is
recoverable.

**Section 16 was the argument for the person, and it is about a different table.** New
Cell Leaders counts by when a leadership assignment starts, which it reads from
`cell_leaderships` — the effective-dated table. Section 21 says in terms that the audit
log "is never a source for as-of state", so Section 16 never reads this log and its
shape places no requirement on this target.

## What it costs, stated rather than discovered

Two sites change from `person` to `cell`, both writing `cell_leadership.opened`. No
migration: `target_type` and `target_id` are ordinary columns and the log is
append-only, so entries already written keep what they have.

**Entries written before this ruling stay heterogeneous, permanently.** That is the
property that made this worth settling first rather than the thing the ruling avoids.
It is tolerable only because no deployment exists — `main` has never been applied to a
database anybody depends on, which is the same premise the migration-0001 exception of
2026-08-21 rests on, and the development log is rebuilt with the database.

Nothing else in the system reads `audit_log` by target today. `audit.view` is specified
and no endpoint serves it yet, so this changes no response.

## What was rejected

**Writing both, one entry per target.** Section 21 says one entry per *action*
performed, not per target, and it says so to keep a compound operation legible. Two
entries per leadership action doubles the log and makes any count of leadership actions
wrong unless every reader deduplicates — a correctness burden placed on every future
reader to save one predicate today.

**Leaving it heterogeneous and documenting the split.** Cheapest now, and it makes every
reader of this log carry two readings for one concept. The reason to settle it before
Stage 4 is precisely that Stage 4 multiplies the entries; documenting the divergence
would have multiplied the divergence.

---

Decision 0157, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — `DateStyle` is pinned by the connection, not inherited](0156-datestyle-is-pinned-by-the-connection-not-inherited.md) | Next: [2026-08-31 — A stale premise under a cleanly taken lock is transient](0158-a-stale-premise-under-a-cleanly-taken-lock-is-transient.md)
