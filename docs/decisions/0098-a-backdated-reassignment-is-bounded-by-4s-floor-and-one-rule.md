# 2026-08-23 — A backdated reassignment is bounded by §4's floor and one rule of its own


Stage 2 step 6's only Stop Condition. §5 permits Admin to backdate a reassignment
and states no bound at all, and two failures follow from that silence.

At an effective date equal to the current assignment's `started_at`, the close is
zero-length, which §5 makes **inert** — so the leader the person actually had for
that whole period vanishes from every as-of query, with nothing raised. Below it the
row cannot be closed at all. And because the same-Network trigger compares
`network_as_of` on both ends at the assignment's `started_at`, a reassignment
backdated into a period when either person belonged to a different Network is
rejected at commit as a raw `check_violation` — a 500 rather than a date the
administrator can act on.

**The bounds are §4's floor, plus one rule of its own**: strictly later than the
floor `hierarchy.backdateFloorFor` already computes, and the edge validated as of
the effective date rather than as of now. The refusal names the earliest legal date,
or names none where the bound falls on the current day.

*The first version of this entry said "the same two bounds" and "same code" — in
its heading as well as its body — and both were false.* The heading outlived the
first correction by two commits, which is its own small lesson: a heading is what
gets skimmed and quoted, so a stale one travels further than a stale paragraph. §4's second bound is on the Network row, which a reassignment does
not write, so the pair is not the same pair; and the first implementation compared
against the current assignment's `started_at` inline rather than calling the floor,
so the code was parallel rather than shared. Found by `architecture-guardian`, and it
is the sixth instance on this project of a rule written by describing part of a
mechanism — committed, this time, in the entry created to settle that mechanism.

Both are now true: the floor is the shared call, which also settles the Stop
Condition below.

**A person with no open assignment is bounded by a term (b) of its own.** Nothing else
bounds them — the one-active index is partial over `ended_at IS NULL`, so an
effective date inside an already-closed period is permitted by the schema and leaves
two rows valid at one instant, with "who led this person on date D" having two
answers. Not reachable in Stage 2, because nothing yet closes an assignment without
opening one; ruled now because the rule reads as complete without it and the term
already exists.

**It reaches only the subordinate side, and the first attempt reached both.** I
recommended "the same term §4's floor already carries, for the same reason", and
the reason does not carry: §4 needs both directions because
`assert_network_change_keeps_edges` selects edges either way, while a reassignment
fires `assert_assignment_same_network`, which reads only the row being written. Both
directions therefore refused a legitimate Admin correction for every leader who had
ever had a disciple moved — which §4 makes the *ordinary* precondition of a Network
correction. The shared method now takes which disjuncts apply, and §5 states its own
reason instead of borrowing one.

Recorded because the fault is a specific one and this is the second time in two
batches it has appeared here: a rule adopted from a neighbouring section by its
*shape* rather than by re-deriving why it has that shape.

**A reassignment to the leader the person already has is refused**, matching what §4
does for a sex correction that changes nothing, on the same reasoning: the operation
is audited, and a transfer whose before and after name the same leader misleads
whoever reads the log — and it puts a boundary in the assignment history where
nothing happened, so "how long under this leader" answers wrongly ever after.

The two alternatives were rejected for the reasons this project has already
recorded once. Refusing anything before the person's current Network period is
simpler and refuses legitimate corrections inside periods where nothing changed,
which is most of them. Permitting anything and letting the constraint reject it is
honest about where enforcement lives and hands the administrator the constraint
message, which is precisely the failure §4's floor exists to prevent.

Also settled without needing a ruling, because §5 states it: the reason is required
whenever an effective date is given and not otherwise. An ordinary reassignment is
audited without one — it records a decision taken today, and the entry already
carries who took it.

---

Decision 0098 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — An identifier is compared canonically, and the class was wider than the instance](0097-an-identifier-is-compared-canonically-and-the-class-was.md) | Next: [2026-08-23 — The application runs at READ COMMITTED, and that is now load-bearing](0099-the-application-runs-at-read-committed-and-that-is-now-load.md)
