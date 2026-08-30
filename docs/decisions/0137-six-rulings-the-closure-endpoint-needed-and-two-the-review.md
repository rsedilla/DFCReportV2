# 2026-08-29 — Six rulings the closure endpoint needed, and two the review raised


Stage 3 slice 4 is closure, and the open list deferred six questions to it — more than
any other unbuilt endpoint in the project. Settled together, before a line of code, on
the pattern that opened this stage: read Sections 10, 11, 7 and 22 whole rather than
meet them at a keyboard. Three turned out to be readings the specification had already
decided; three were genuine choices. Two of the eight did not survive review and are
withdrawn at the end of this entry.

**A CLOSED Cell keeps no open category row and no open schedule row.** Migration 0009
recorded this as unsettled and constrained only the ACTIVE side, because "What closing
does" lists three writes and neither of these is among them. The specification decides
it twice elsewhere, both times in load-bearing arguments: the coverage paragraph under
Section 10's own *Schedule changes* says a Cell closed part-way through a month has
fewer scheduled meetings "because its schedule row ... ends at closure", and the
Reopening ruling argues against reversal partly on what "un-ending its schedule and
membership rows" would do. *An earlier version of this paragraph, and the commit message
with it, attributed the first to Section 12. Section 12's equivalent sentence does not
contain the clause — and misnaming it weakened the very citation the argument rests on,
which is that two other passages already assumed the write.* The list was
incomplete; it now carries five writes.

The schedule half is forced independently of that reading. A schedule row left open on a
closed Cell derives one scheduled meeting a week for ever, so Section 12 hands a Cell
that no longer meets a coverage denominator that worsens every month. The category half
has no such consequence and is closed for consistency — the two rows open together at
approval and an ACTIVE Cell must hold one of each, so ending one of a pair needs a
reason that does not exist.

**The closure effective date floor was ruled on three times, refuted three times, and
is withdrawn.** What is settled is that a floor is *needed*: a closure ends every open
row at the effective date, `period_ordered` refuses a period ending before it starts, so
some dates are satisfiable by no write and an operator meets a constraint violation
rather than an answer. What the floor **is** is not settled.

The first version named two tables and the same commit made a closure end four. The
second widened it to four and thereby made a Cell with a pending schedule change
**unclosable by anybody** — a schedule change takes effect at the start of the following
month, so its rows carry future timestamps, the floor sat in the future, and a
forward-dated closure is not an operation this system defines. The third excluded rows
that had not started yet and missed that the *outgoing* row has started and ends in the
future too, so the Cell stayed unclosable by the same mechanism.

It also cannot be settled independently: it turns on whether the rule that no row of a
closed Cell may end after the Cell did reaches category and schedule rows, or only the
two the database constrains today — which is itself an open item. Section 10 now records
the gap, names the schedule-change difficulty, and leaves the floor to the closure
endpoint, which settles it against the schema.

**A deadlock is answered as `RESOURCE_BUSY`.** *The second half of this ruling as first
written — that the locks are ordered so a deadlock should not arise — is the ordering
withdrawn below. What survives is the error code, which stands on its own.* The `FOR
SHARE` migration 0009 takes on the `cells` row makes `40P01` reachable
from ordinary practice: two leaders closing Cells and dispersing into each other's take
the two rows in opposite orders, each holding an exclusive lock and waiting on the
other's. `isLockTimeout` matches `55P03` only, so today the loser gets `INTERNAL_ERROR`
— a 500 for two people doing routine work at the same moment, with no indication that
retrying would work.

The classification is needed whatever the ordering turns out to be, which is what lets it
survive the withdrawal: ordering cannot reach the locks a deferred trigger takes at
COMMIT, so `40P01` stays reachable however carefully an operation sorts its own.

The comment this overrules argued that a deadlock is not ordinary contention. That is
right about the cause, and it is a statement about the logs rather than about the
client: the caller's correct action is identical, and 503 releases the idempotency key,
which is correct because nothing was recorded. Section 22's existing rule already
requires an elapsed wait to answer `RESOURCE_BUSY` **wherever it is raised**; this is
the same argument applied to the other way a wait can end. The ordering defect still
surfaces, in the log rather than in a leader's face.

**A Cell's existence is not a case Section 22's `NOT_FOUND` rule covers, and this
recommendation reversed on writing the scenario down.** Section 8 protects a person's
Cell membership and Cell IDs, so a Cell reads as exactly such a case, and Section 22's
own prescription is `NOT_FOUND`. Slice 3 had closed the oracle the other way, making an
absence look like a denial — the mirror image — which is what raised the question.

What decides it is that **a Cell identifier cannot be enumerated**. Section 22's rule
exists for the probe shape, where an attacker sweeps a space; a Cell is addressed by an
unguessable identifier, so an actor holding one obtained it legitimately, and confirming
that it exists tells them nothing they did not already have. The protection is not the
code but the indistinguishability slice 3 already built: an actor whose scope does not
cover a Cell gets one `SCOPE_DENIED`, one message, one details payload, whether or not
the Cell is there.

`NOT_FOUND` for everyone was rejected on what it costs the ordinary case, which is where
the reversal came from. A leader whose Cell was handed over yesterday would be told
there is no such Cell — false, and it sends them looking for a deleted record instead of
telling them a handover moved it out of their scope. The "two codes for one fact"
objection does not survive either: each actor gets one consistent answer, decided by
their own scope rather than by the record, and `NOT_FOUND` is reached only by an actor
whose scope would have covered the Cell, for whom absence is absence.

Written to Section 22 as a second worked case beside People, so the next Cell-targeted
route inherits it rather than deciding again. The generalisation is stated with it:
where an identifier cannot be enumerated, indistinguishability is what protects the
record, and a denial is the more truthful of the two indistinguishable answers.

**A dispersal destination must be in the actor's scope, on the same rule as an ordinary
move.** A leader closing their Cell places members into Cells they hold scope over and
leaves the rest unassigned.

One rule rather than two, and the asymmetry it passes over is named in Section 10 so the
choice is knowing rather than careless. Slice 3's rule was written about a leader
**taking** somebody out of a peer's Cell; a dispersal is **giving**, which is the milder
act, so a different answer here would have been defensible rather than inconsistent.
What tips it is that giving is not free: Section 10 makes membership the leader's to
manage, and members arriving unrequested move that leader's coverage denominator and
every Section 16 figure derived from it, with nothing recorded about the person who now
carries them.

The restriction is bearable only because Section 10 had already built the escape —
closure is never blocked on placing anyone, members may be left unassigned by explicit
choice, and Section 15's attention list exists so they are surfaced rather than lost. So
nobody is stranded, and the cross-branch handoff becomes a conversation between two
leaders, which is what it is. The cost is written into Section 10 rather than
discovered: a leader whose members mostly belong in other branches does part of the work
and leaves a queue for somebody else, which is the friction Section 5 already imposes on
a cross-branch pastoral move.

**Scope is checked again inside the transaction, after the locks.** The guard decides on
the pool before the transaction opens, so a handover landing in between leaves its
answer describing authority the actor no longer holds — the staleness Section 24 records
for an intermediate ancestor, reached through the Cell rather than through the tree. The
guard keeps the early, cheap refusal; the write rests on the check after the lock. It
reaches an ordinary membership move too, whose destination is decided the same way.

**Migration 0009's own notes are left standing and are superseded here.** It records the
CLOSED-side question as open — in a comment above the check rather than in its header,
which an earlier version of this paragraph got wrong — and deliberately constrains only
the ACTIVE side, which was the right call when it was written. Two further notes in that
file are settled by this entry as well: the `40P01` decision and the unbounded wait, both
of which it describes as open in `CLAUDE.md` and both of which left the list here. It
sits in an approved pull request, and editing it
would dismiss that approval to change a comment — so the constraint arrives in a
migration of its own with the closure endpoint, and this entry is where the two are
reconciled. The same shape as migration 0005's stale header, for the same reason.

**A third review pass found that the floor fix had made a Cell unclosable, and that is
recorded rather than quietly repaired.** Widening the floor to all four tables was right
and was stated without qualification, and a schedule row is written *before it starts*:
a change decided on 12 August carries `started_at` of 1 September, and closes the
outgoing row at the same future instant. A floor reading those sits in September, so
every date below it is refused by `cell_schedules_period_ordered` — and no actor can
clear it, because a closure dated 1 September is forward-dated and Section 10 provides
for no such thing. Neither the leader nor Admin could close a Cell whose leader had
merely rescheduled it.

*The fix this paragraph describes is the second of the three formulations, and it did not
hold either — the account of how the third failed is in the withdrawal below. What is kept
here is the record of the second.*

**The two Stop Conditions the review raised are answered here as well, and both were
right to be raised: each belongs to a section other than the one I had written it in.**
One is settled below and the other is withdrawn with the floor.

**Backdating a closure requires `records.backdate_effective_date`, and Section 7's list
gains a Cell closure by name.** The floor said how far back a closure may be dated and
nothing said who may date it back at all — while Section 7 declares its list closed and
forbids deriving the next item from it, so answering by implication inside Section 10
was the shape this project keeps correcting.

The reason is not consistency with Sections 4 and 5, and that matters because the
obvious alternative is attractive on exactly those grounds. **Backdating a closure
erases the scheduled-meeting count a coverage line is read against**: Section 12 gives a
Cell closed part-way through a month fewer scheduled meetings, so a leader who has
submitted nothing all month and then closes effective the first of it turns `0 of 4
meetings recorded` into `0 of 0`, and the record of their silence goes with it. *Not the
denominator, which Section 12 defines as the meetings actually recorded — that is
already zero for this leader, which is exactly why the coverage line is the only
artifact left. Two earlier versions of this paragraph said "denominator", a term the
2026-08-19 ruling fixes, in the sentence carrying the whole justification for a new
authorization rule.* That is Section 13's own failure mode reached
through a date field rather than a status. A Section 13-style window, letting the closer
reach back inside the open reporting month, was considered for its consistency with how
attendance already works and rejected for handing that vector to every leader in the
period where it does most damage. The closer may always date a closure today, so nothing
is blocked; what they give up is a few days of scheduled-meeting accuracy in the coverage line.

**The lock ordering was rewritten three times and is withdrawn.** A closure needs both
lock classes — advisory locks on people, row locks on Cells — and nothing orders them
against each other. Three orderings were written. The first prescribed Cell locks alone
and removed only the closure-versus-closure cycle. The second put people first and
claimed only closure changed, which was false: a move writes two membership rows in two
Cells, so its deferred trigger takes two Cell locks in write order. The third permitted
a closure to re-read its member list under its row locks and take person locks for what
appeared — and `architecture-guardian` **reproduced a deadlock against PostgreSQL 16**
for it, in the exact shape the rule four lines above forbids.

The lesson is about the instrument rather than the answer. Each version read as sound;
one of them deadlocked. Two properties defeat reasoning on paper — a deferred trigger
takes row locks at commit in write order, which no rule reaches after the fact, and an
operation cannot know which people to lock until it has read a list that another
transaction can invalidate. Section 5 now records the gap and requires an operation
needing both classes to demonstrate its ordering against concurrent writers rather than
assert it.

The six rulings that stand are written to `SKILL.md` Sections 5, 7, 10 and 22, and were
verified by grep rather than asserted. The two withdrawn above are written nowhere as
rules: Sections 5 and 10 record them as gaps, and both are back on the open list.

**Five review passes, and the two withdrawals are the honest outcome rather than a
retreat.** They returned 8, 7, 5, 5 and 11 findings, and from the second onward the
majority were defects the previous batch's *fixes* had introduced — a floor broken by
its own neighbouring ruling, then a Cell nobody could close, then a reproducible
deadlock, and finally a withdrawal that reinstated a claim an earlier pass had already
corrected. Nearly every one came from the same two rulings.

Six rulings are kept and two are withdrawn, and the split does not fall where the
heading's two halves do: of the six questions deferred to this endpoint, **five are
settled and the floor is withdrawn**; of the two Stop Conditions the review raised,
**backdating is settled and the lock ordering is withdrawn**. The two withdrawn are
recorded as gaps for the endpoint that can test them. `CLAUDE.md`'s preamble names
writing an under-specified rule into the source of truth as the failure it exists to
prevent, and the 2026-08-28 handover ruling is the precedent: drafted, withdrawn, and
landed once its questions were answerable.

---

Decision 0137, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — A Cell is placed in the tree by its leader, and a move is two changes](0136-a-cell-is-placed-in-the-tree-by-its-leader-and-a-move-is-two.md) | Next: [2026-08-29 — A second schedule change corrects the pending one](0138-a-second-schedule-change-corrects-the-pending-one.md)
