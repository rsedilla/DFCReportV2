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

The consequence is that Section 7 reads the three by two different rules — it resolves
an audit entry **through its target**, and it gives a leadership one resolution and a
Person another. A reader searching one person's leadership history also finds the opening
and not the ending, which is a search rather than a permission.

**Exactly where the two rules give different answers is not stated here, because one
question behind it is still open.** Section 7 resolves a Cell through "the Cell's leader
as of the period being viewed" and does define that phrase, under *An effective date does
not move the scope decision*: the period a request under a **viewing** capability is
asking about, everything else being acted on now. *That definition read "the period a read
is asking about" when this ruling was written, and this paragraph quoted those words until
2026-09-02, when decision 0186 moved the split from the HTTP method to the capability.
`audit.view` is one of the three capabilities Section 7 now names, so the phrase reaches
this log by capability — which changes nothing about the question below.* What it does not say
is what period a read of this log asks about: a single entry is an instant, a filtered
range is a range, and the answers put the divergence in different places. Recorded as open
in `CLAUDE.md`.

*Three drafts of this ruling got this wrong in three ways, which is why it is written down
rather than attempted a fourth time. The first said a reader whose scope covered the person
and not the Cell saw an appointment with no ending. The second said the targets part
company after a later handover. The third called the phrase's meaning for an audit
entry undecided and did not engage the passage where Section 7 defines it; the open
question is one layer in from there.*

## Why the Cell

**Section 7 already says how a leadership resolves, and it says the Cell.** Its target
list is explicit: "a Cell, a Cell meeting, a membership or a leadership resolves through
the Cell's leader **as of the period being viewed**, falling back to its last leader
where the Cell is closed". A Cell-targeted entry therefore resolves by the rule written
for the thing the entry is about. A person-targeted one resolves through that person's
pastoral position, which is a different rule reaching a different answer.

**What Section 7 says about a leadership is the whole of the argument, and it is enough.**
It lists "a Cell, a Cell meeting, a membership or a leadership" together and gives them
one resolution. A leadership audit entry is an entry about a leadership; resolving it by
the rule Section 7 wrote for one needs no further justification, and is what makes the
three entries answerable by a single reader.

*The closed-Cell fallback was offered here as the deciding reason and is withdrawn. For
the `cell_leadership.ended` entry a closure writes, the Cell's last leader is the same
person a person target would have named, so the fallback resolves both the same way and
decides nothing between them. It matters for reading a closed Cell's history, which is
Sections 10 and 15's requirement and is true whatever this entry's target is.*

**Section 21's own reader-question is Cell-shaped.** It says a reader "asking who led a
Cell before a handover must find it here". The question names a Cell, so the entry a
search starts from is the Cell's.

**The person-shaped search is served, and by the field built for it.** Section 21
requires these entries to carry "the outgoing and the incoming leader where each
exists", and all four sites already do. So a person-shaped *search* becomes a predicate
over `before` and `after` rather than over `target_id`.

**That argument is about searching and not about scope**, and the first version of this
ruling ran the two together. Scope is not recoverable by a predicate: Section 7 resolves
the entry through its target, so a reader whose scope does not reach the Cell loses the
entry outright. The point is that the same holds in the other direction — a
person-targeted entry is lost to a reader whose scope reaches the Cell and not the
person — and the tie is broken by which target Section 7 already names for a leadership,
and by three entries about one thing being read by one rule. *This clause named the
closed-Cell fallback as well, which the withdrawal above refutes.*

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

**Moving the fourth action with them.** `cell_leadership.account_pending` carries the
same noun and is not part of this: Section 21 lists it separately, as "Cell leadership
assignment left with account provisioning pending", and what is pending is a
provisioning step on a Person (Section 6). It keeps a `person` target, and Section 21
now says so — because "all three" stated over a noun with four actions reads as an
omission rather than as a boundary.

**Leaving it heterogeneous and documenting the split.** Cheapest now, and it makes every
reader of this log carry two readings for one concept. The reason to settle it before
Stage 4 is precisely that Stage 4 multiplies the entries; documenting the divergence
would have multiplied the divergence.

---

Decision 0157, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — `DateStyle` is pinned by the connection, not inherited](0156-datestyle-is-pinned-by-the-connection-not-inherited.md) | Next: [2026-08-31 — A stale premise under a cleanly taken lock is transient](0158-a-stale-premise-under-a-cleanly-taken-lock-is-transient.md)
