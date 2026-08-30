# 2026-08-28 — Three rulings before Stage 3, and a fourth withdrawn


Stage 3 builds `cells`: five effective-dated tables, a workflow with a second party,
and the first migration nobody may edit afterwards. Reading Sections 10, 11, 7 and 26
whole, before writing any of it, found four things an implementer cannot avoid
answering and the specification does not settle. Three are settled here. The fourth is
withdrawn and escalated, and why is the most useful part of this entry.

**An `ACTIVE` Cell has exactly one leader, and a `CLOSED` Cell has none.** Section 5's
constraint list gives `cell_leaderships` one open row per Cell, which is a partial
unique index and permits *zero*; nothing anywhere forbade it, and Section 13 casually
contemplates a genuine handover as "a separate, deliberate change to
`cell_leaderships`" without saying what happens in between.

Three rules lose their subject at once if zero is legal. `cell.manage_membership` is
held first of all by the Cell's current leader. A Cell takes its Network from its
leader, which is what the same-Network rule on membership compares against and what
approval revalidates. And Cell attendance is recorded by a leader against their own
Cell. None of the three has a fallback written for it, which is itself the evidence
that the specification never imagined a leaderless Cell.

A **deferred** constraint trigger on both tables, which is what lets a Cell change
hands at all: the outgoing row closes and the incoming one opens inside one
transaction, and a check firing at COMMIT sees only the state it ends in. The index
keeps *at most one*; the trigger adds *at least one*.

A trigger is the weaker mechanism and is chosen knowing it. This system has twice
replaced one with a denormalized column under a partial unique index — the Senior
Pastor slot, the Network root seat — because `pg_restore --disable-triggers` skips a
trigger and never skips an index. Both of those enforce *at most one*, which is what a
unique index expresses; "at least one" constrains a row that is **absent**, and no
index constrains an absence. The restore weakness is accepted in writing rather than
denied, and what makes it tolerable is that a leaderless Cell is visible on every
screen that names a Cell.

*The first version of this said the trigger was needed because the rule spans two
tables and no index can express it. Spanning two tables is not the reason* — *the
root seat spans two and was solved with an index and a denormalized column. The reason
is the direction of the constraint, and it had to be re-derived rather than asserted.*

**`cell.manage_configuration`, the twenty-seventh capability.** Section 10 makes a
Cell's category and schedule editable, effective-dated and audited, and named no
capability for either; Section 7 declares its list closed and separately rules that an
endpoint declaring no capability is denied. Both endpoints were therefore unbuildable.
That is the gap `people.correct_sex` was found in, and it is closed the same way, in
one change across the specification, the role catalog, the enum, `capabilities.ts` and
the role defaults.

One capability rather than two, because both are effective-dated edits to how a Cell
is configured, both audited identically, and an administrator granting one while
withholding the other would be drawing a distinction no rule makes.

**The enum value went into `0001` rather than into a new migration**, under the
2026-08-21 exception, which is what `people.correct_sex` did and which still stands
because nothing is deployed. The first attempt wrote migration `0009` and marked it
irreversible, since PostgreSQL cannot remove a value from an enum type — and that
would have **broken CI on the branch that added it**: the workflow runs
`migrate:down --all` after applying, `revertLast` throws unconditionally on an
irreversible migration, and it would have been the newest one forever, so nothing
could be reverted again. The migration's own header cited `people.correct_sex` as its
precedent while taking the opposite route from it, which is Section 25 rule 19 in its
plainest form.

The cost is the one the exception names, and it is larger here than that ruling
assumed: `assertUnchanged` runs before anything is applied, so a development database
that has already applied `0001` can accept no further migration until it is dropped
and rebuilt. `dfc_dev` holds the imported spine, so that is a re-import rather than a
minute.

**The schedule trigger is strict, and needs no exception for backdating.** Section 10
required a schedule row to start on the first day of a month, by "a trigger, not a
check constraint, because the rule admits an exception a row-level check cannot see",
and then named `records.backdate_effective_date` as that exception. A trigger cannot
see who is writing or what they hold, so the rule as written was not enforceable as
specified.

*My first recommendation was to weaken the trigger to advisory, and it was wrong.*
Every legitimate row starts on a first of month, a correction included, and the one
exception is a Cell created part-way through a month.
`records.backdate_effective_date` governs how far back a date may be set, which is
about the actor and belongs in the domain layer; it does not govern what kind of date
is legal.

Two things the review then corrected in that rule, both of which would have shipped.
The test is the Cell's **`created_at`**, not whether the row is the Cell's first,
because a Section 5 correction to the first row produces a *second* row at the same
instant and a first-row test refuses it. And the calendar half is **Asia/Manila**: a
legitimate row starts at Manila midnight on the 1st, stored as 16:00 UTC on the last
day of the previous month, so a trigger evaluating in UTC refuses every schedule
change there is, while a Cell created during a working day on the 1st passes by
accident — the defect hiding in exactly the rows the rule is not about.

**The fourth ruling is withdrawn.** It routed handing a Cell to a new leader through
request-and-approve, on Section 10's own argument: the two-step workflow exists so
that no leader decides alone that one of their own disciples should lead, and that is
as true of a handover as of a creation.

The reasoning still looks right. What made it unlandable is that settling it requires
three further rulings, and the first draft answered none of them while writing the
workflow into the source of truth: which capability guards a handover request and its
approval, which of the two leaders the guard resolves against, and whether one pending
request per prospective leader is still the right constraint once two kinds share a
table. The draft also widened that index on a reason that does not carry to a
handover, and left absent the constraint the reason does support — two pending
handovers of the same Cell to different people, both approvable, the second silently
closing what the first opened.

**Writing an under-specified workflow into `SKILL.md` while `CLAUDE.md` records its
questions as open is the one failure this file's preamble names.** The two documents
then disagree, Source of Truth says the specification wins, and an implementer builds
what the log says is wrong. Better to leave the gap recorded than to fill it with
something that has to be re-argued in three places.

So Section 11 states the rule a change of leader must satisfy — one transaction,
because of the trigger — and says no section defines the workflow; and Section 7 says
plainly that `cell.manage_leadership` sits in the closed list with nothing defining
what it may do. That is the honest state, and it is strictly better than before this
pass, when neither was written down anywhere.

***Superseded the following day** by the ruling below, which lands the withdrawn
workflow with its three questions answered. Both clauses of that last paragraph are
now false: Section 10 defines the workflow, and Section 7 defines what
`cell.manage_leadership` governs. The reasoning stands — what it records is why an
under-specified ruling was held back for a day rather than written into the source of
truth, which is the part worth keeping.*

---

Decision 0132, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-28 — A pastoral path says which end is a root](0131-a-pastoral-path-says-which-end-is-a-root.md) | Next: [2026-08-28 — A Cell changes hands by request and approval, and a closure is never reversed](0133-a-cell-changes-hands-by-request-and-approval-and-a-closure.md)
