# 2026-08-28 — The Cell schema, and a test that agreed with itself on one machine only


Migration 0009 creates the six tables `cells` owns. Most of it is Sections 10 and 11
followed rather than decided — the five rulings settled earlier the same day did the
deciding. Four things were not settled by them, and one lesson came out of checking
the work rather than out of writing it.

**`cell_schedules` gains `id` and `actor_id`; `cell_memberships` gains neither.** The
first is an amendment made in the same change, per the 2026-08-21 slot ruling: every
other effective-dated table in this specification has a primary key and that one had
no natural one, and Section 10 says a schedule change "is audited as a category change
is" while giving `cell_categories` an `actor_id` in its own shape.

The second is the more useful half, because the first version of the migration added
`actor_id` to `cell_memberships` too, on symmetry with its neighbours in the same
file. Section 10's shape does not give one, and Section 10 says instead that every
membership change is audit logged **with actor** — which is an `audit_log` entry.
`pastoral_assignments` settles it: the closest analogue in the schema, the most
heavily authorized and audited relationship in the system, and it carries no actor
column. Adding one would have been amending a shape no rule needed amended, which is
the drift that ruling exists to forbid. Both halves are written into Section 10.

**An ACTIVE Cell must carry an open category row and an open schedule row, enforced.**
Section 10 says the two rows open in the approval transaction and that they "are not
optional extras", and `docs/ROADMAP.md` names their omission as the single risk of
this stage. A named risk with a constraint available is a constraint.

**Only the ACTIVE side is constrained, and the silence is deliberate.** Section 11
says what a CLOSED Cell's leadership is — none — so that trigger states both halves.
For these two, Section 10's "What closing does" lists three writes and neither of
these is among them, while a parenthetical about coverage says a Cell closed part-way
through a month has fewer scheduled meetings "because its schedule row ... ends at
closure". Those do not plainly agree. Asserting the closed half in a trigger would
settle a rule a migration has no authority to settle, so it is listed as open below.

**`cells` and `cell_leadership_requests` are never deleted, with a message of their
own.** Neither is effective-dated, so 0001's function does not describe their rule.
Section 10 says a Cell ID is never reused and that a mistaken closure stands in the
record, and gives `CREATED_IN_ERROR` as the reason for a Cell that should not exist —
so a DELETE is the one operation that undoes both. And declined requests "are
retained: they are part of the record of how a leader was developed".

**The at-least-one leadership trigger counts rows, and the 2026-08-21 ruling says a
counting trigger is not a constraint. That ruling is about the other direction**, and
the difference was re-derived rather than assumed. The failure it records is two
concurrent transactions each counting *below* a cap, neither seeing the other's
uncommitted row, both committing, and the cap exceeded. The cap here — at most one
open row per Cell — is a unique index, which is the remedy that ruling reached for.
What the trigger adds is the floor, and the floor cannot be undershot concurrently:
reaching zero means closing the single open row, and the index permits only one such
row, so only one transaction can close it.

**The lesson is in the verification, not the writing.** Section 10 warns at length
that the schedule-start rule has two halves in different frames, and that a trigger
evaluating the month boundary in UTC "would refuse every schedule change there is,
while a Cell created during a working day on the 1st passes by accident". Two cases
were written against exactly that, and both passed. Mutating the trigger to the
defect Section 10 describes left the suite **green**.

The reason is that this development machine's PostgreSQL runs `Asia/Kuala_Lumpur`.
`date_trunc` on a `timestamptz` resolves in the *session's* zone, and Kuala Lumpur is
UTC+8 with no daylight saving — so on this box the defective implementation and the
correct one agree on every date, and the two cases certified a rule they could not
see. CI's PostgreSQL runs UTC, where the same two cases would have caught it. A pair
of cases that reports "correct" on one machine and "correct" on another for opposite
reasons is worse than a weak pair, because nothing about it looks wrong.

What pins it now is a case that sets `SET LOCAL TIME ZONE 'UTC'` inside its own
transaction and asserts both verdicts there, so the two implementations disagree
wherever the suite runs. It was verified red against the mutation and green against
the real trigger, as were the leadership floor, the configuration check, the
membership same-Network trigger and the closure-is-final trigger — each mutated in
turn, each turning exactly its own cases red.

Recorded because the general form is the one this log keeps recording under a
different heading: **a test can agree with the code for a reason belonging to
neither.** "What mutation would this fail against" is the question that finds it, and
it has to be asked against a machine configured like the one that will run it.

**Two `architecture-guardian` passes followed, and between them they found thirteen
things.** The first pass's seven are above the line in what the migration now
enforces; the second pass reviewed the fixes and found six more, two of them live
defects it reproduced by execution. Both are worth recording, because both are this
project's recurring fault rather than new ones.

**The handover trigger did not implement the rule it cited.** Section 10 refuses a
handover "where the incoming leader and the Cell's current leader do not share a
Network" — leader to leader, unconditional. What was written compared the incoming
leader against the Cell's **members**, so a Cell with no members changed Networks
freely, and a Cell whose members were all closed out in the same transaction did too.
Three statements asserted the opposite of the code, and the third is the one that
matters: **a test was written asserting that a cross-Network handover succeeds once
the members are moved out** — pinning an operation the specification forbids, in a
file that becomes immutable at first deployment. The trigger now compares the two
leaders and keeps the member check as the separate rule Section 10 states about
membership.

**The CLOSED-membership rule was a counting trigger with no index behind it.** The
migration re-derives, correctly and at length, why the *leadership* floor is safe
despite counting: the cap is `cell_leaderships_one_open_per_cell`, so closing a Cell
and opening a replacement contend on one row and serialize. That argument was then
reused for memberships, where `cell_memberships_one_open` is over `person_id` and the
two writes touch no row in common — so closing a Cell and adding a member to it both
committed, leaving a member open in a closed Cell, unable to join any other. That is
the exact outcome the rule was written to prevent, and it was reproduced against the
schema. The read now takes `FOR SHARE` on the `cells` row, which orders it against
the closure's own `UPDATE` without blocking two concurrent joiners.

**That one is section 25 rule 19 failing inside the paragraph that cites section 25
rule 19** — the re-derivation was performed for one rule and the *result* carried to a
second without being redone.

*An earlier version of this paragraph called it "the first instance on this project of
that particular shape". It is not, and this file records at least three others: the
2026-08-25 root-seat migration, whose header says "**Re-derived rather than copied**"
and cites rule 19 while asserting a drift guarantee that did not hold; the 2026-08-26
module-ownership entry, "§25 rule 19, in the batch written to apply §25 rule 19"; and
the 2026-08-23 identifier batch, "merged that morning, and cited three paragraphs
earlier in this entry — failing inside the batch written to apply it". A claim of
primacy asserted without grepping the file it appears in is the cheapest form of the
fault this log exists to record.*

What is true is narrower, and is why the rule is written as "does X hold here?" rather
than "is this the same kind of thing?": here the re-derivation was performed correctly
and its *conclusion* was then carried to a second rule, which is a step further out
than reusing a shape.

**Four smaller findings from the same pass**, each the familiar class: the "two
uncovered paths" comment named two of three, missing the widest — a Network change on
the Cell's *leader*, which strands every member of every Cell they lead; the narrowed
approver constraint had nothing that could fail against reverting it to the terminal
form, and is now pinned by a shape assertion in `schema.spec.ts` rather than by a
behavioural case that would answer an open question; the `cells`-side trigger was
still named for leadership after it began enforcing memberships too, and is now
`cells_relationships_match_state`; and the finality trigger's message claimed "what a
request asked" while freezing four columns that do not include the category, day and
time a `NEW_CELL` request actually asks for.

**The two mutation-testing findings during the fix batch are the useful part.** The
first concurrency case did not assert the wait — it fired the second statement without
awaiting and committed the first, so whether the second blocked depended on how long
the first happened to take. Mutating an *unrelated* trigger turned it red, which is
how it was found: the real trigger had been slowing the winner just enough to hide the
race. And the case written to pin the Network comparison instant dated its Network
change one second in the **future**, so the member had not moved when the trigger ran;
mutating the comparison to `now()` left it green. Both now do what their titles say,
and both were verified red against the defect they describe.

Every rule-bearing trigger function this migration adds has been mutated in turn —
nine of them — and each reddened exactly its own cases.

*An earlier version of this sentence said "every constraint", which the migration
outnumbers about five to one: it carries twenty-two named `CHECK` constraints, six
unique indexes and seventeen triggers, and nine is the count of trigger functions. The
checks and the indexes are covered by cases of their own rather than by mutation.
Recorded because a universal claim over a set five times its stated size is exactly
what a reader would rely on and not re-count.*

**A third pass followed and found six more, two of them live defects it reproduced.**
The worst was in the mechanism the second batch had just added to close the previous
one: the leader-to-leader comparison selected the outgoing assignment with
`ended_at IS NULL OR ended_at >= started_at`, so one microsecond of gap between the two
rows selected nothing and **the whole rule was skipped** — failing open, and silently.
Section 10 records that exact trap two subsections away, about the Cell and its
schedule row: an application-computed timestamp beside a `DEFAULT now()` differs by
microseconds. The predicate no longer reads `ended_at` at all, and its ordering gained
a tie-break, because two rows can share a `started_at` after a Section 5 correction.

That gap existed to be walked through because **nothing enforced contiguity**. Section
10 says a handover ends the outgoing assignment and opens the incoming one "at the same
instant" and Section 11 says a Cell with no leader "must be impossible rather than
merely unusual", and the schema carried neither: the leadership trigger counts open
rows at COMMIT, so a Cell that was leaderless for a microsecond passed while
`assert_membership_same_network` was already treating a leaderless instant as an error
from the other side. The two halves of one schema disagreed. Contiguity is now a
constraint, and it is the structural fix — the predicate above was the symptom.

The pass also found that the `FOR SHARE` added in the second batch **deadlocks on
Section 10's own closure operation**, since closure disperses members in bulk and two
leaders doing that into each other's Cells take the two `cells` rows in opposite
orders; that it is an unbounded intra-transaction wait Section 5 requires bounding; and
four statements this log or the migration made that the code did not support, two of
which are corrected above.

**A fourth pass, scoped to the contiguity mechanism, found four things and no live
defect.** That is the convergence the three before it did not show, and the scoping is
part of why: each earlier batch had *expanded* the migration, and each expansion
produced the next pass's findings.

**The contiguity check reaches only a row written open, and two writes go round it.**
It runs on the row as it finally stands and returns early where that row is closed —
right for the writes Section 10 defines, and silent on an INSERT of an already-closed
row, or an UPDATE moving a closed row's `ended_at`. Both were reproduced: a closed row
overlapping the open one committed, and `assert_membership_same_network` then read it
as the Cell's leader and **refused a legitimate member of the Cell's own Network**.

**The remedy was to refuse the undefined write, not to validate it**, and the
distinction is the whole of the decision. No operation Sections 10 or 11 define writes
a leadership row already closed, and a row already closed is what Section 5 says is
never overwritten in place. Widening the contiguity check to cover these would have
meant deciding what a correction to a closed historical stint looks like — which
Section 10 does not define, and which would be a rule invented in a migration.
`cell_leadership_is_opened_open` refuses both shapes in nine lines; whether such a
correction should exist at all is escalated below.

**One legitimate-looking operation is refused and is left refused**: correcting a
Cell's *first* leadership row to a person of the other Network. The zero-length row is
selected as the predecessor and compared, which follows the 2026-08-22 ruling that a
zero-length row is inert as an answer and not excluded from being examined. It is
arguably the right refusal — a Cell created under a wrong-Network leader had the wrong
Network throughout, and Section 10 gives `CREATED_IN_ERROR` for a Cell that should not
exist — but Section 10 states that rule about a *handover*, and distinguishing a
correction from a handover is a mechanism this migration does not have. Escalated
rather than built. The message was reworded for succession rather than for a handover,
because an administrator meeting it on a correction would otherwise go looking for a
conflict between two leaders that is not there.

**The tie-break was load-bearing and unpinned**, which is the finding worth keeping.
`ORDER BY started_at DESC, ended_at DESC NULLS FIRST, id DESC` exists because a Section
5 correction leaves two rows sharing a `started_at`; dropping `ended_at DESC` left all
eighty-one cases green, and run against that shape it refused a legitimate handover on
some runs and not others, decided by which UUID sorted higher. The case that pins it
now fixes the corrected row's id to the lowest possible value, so the fallback loses
deterministically — without which the case itself caught the mutant about two runs in
three, which is not a pin. `NULLS FIRST` decides nothing, since a null there is a
second open row the unique index already refuses; the comment claiming otherwise is
withdrawn.

Across four passes: nineteen findings, then four. Every rule-bearing trigger function
has been mutated in turn, and the two mutations that were nondeterministic were made
deterministic rather than accepted.

---

Decision 0134, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-28 — A Cell changes hands by request and approval, and a closure is never reversed](0133-a-cell-changes-hands-by-request-and-approval-and-a-closure.md) | Next: [2026-08-29 — Direct creation, and a subtree check where Section 2 asks for Whole Church](0135-direct-creation-and-a-subtree-check-where-section-2-asks-for.md)
