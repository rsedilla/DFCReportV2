# 2026-08-31 — Three more the second review of the Stage 4 rulings raised

The second `architecture-guardian` pass over 0161 to 0165 found thirteen more, and three
of them were consequences of the settlements rather than defects in how they were
written. Two undermined the settlement that produced them.

## A write against a closed Cell resolves through its last leader, bounded by the window

0165 let a closed Cell take an attendance record for a week it was open, and said "Scope
allows it without amendment: Section 7 resolves a Cell meeting through the Cell's leader
as of the period being viewed, falling back to its last leader where the Cell is closed."

**It does not.** That fallback hangs off "as of the period being viewed", and Section 7
fixes what that means one subsection later: it is the period *a read* is asking about,
while a write "is acted on now" and resolves through the current leader. A closed Cell has
none, so under Section 7 as it stood, a submission against one resolved through nobody.

It is the mistake the first review caught, inverted. That draft gave Section 7's answer
for a write where a read was meant; this one gave its answer for a read where a write was
meant. Both are Section 25 rule 19 — a shape reused without checking that its reason
carries — and the reason is exactly what does not carry: the fallback's own justification
is that a closed Cell's history stays **visible** to whoever led it.

**Section 7 is amended rather than the settlement reversed.** For recording or correcting
a Cell meeting whose month's submission window is still open, a write resolves through the
Cell rather than through nobody. Nothing else does.

*Through the Cell's **last** leader, this ruling said, and
[decision 0167](0167-four-more-from-the-third-review-including-a-key-that-was-wrong.md)
narrows it to the meeting's own frozen responsible leader: a Cell handed from A to B before
it closed has weeks belonging to each, and the last-leader rule would deny A the write
while Section 19 showed A the task.*

**Both halves of that are load-bearing.**

The **attendance-only** half, because the fallback's sentence names "a Cell, a Cell
meeting, a membership or a leadership". Read into writes wholesale it would hand a closed
Cell's last leader permanent authority over its memberships and leaderships, which nobody
decided and which Section 10's closure rules exist to end.

The **window** half, because Section 7's rule against resolving authority as of a past
effective date has a stated reason: an actor could reach back far enough to recover it.
That reason does not carry here, and the difference is who chooses the date. Section 7's
case is an actor picking one; this is one fixed, short, forward-moving window per month,
set by the calendar, closing on the 7th whatever anybody does. A leader finishing the
record of the Cell they led last week is not recovering authority.

## A back-filled Sunday in a closed month is excluded from coverage

0165's back-fill created an event no leader could ever have submitted against — the window
had already shut — and DCC coverage counts how many responsible leaders have a record for
an event. So every leader in the church would read as zero for it.

That is the harm Section 7 names when it argues about a backdated closure: a coverage line
that reads as "the evidence that its leader reported nothing". 0165 reasoned about N and
about buckets and never about coverage, and so introduced through the remedy the thing the
closed-Cell settlement three paragraphs earlier was chosen to avoid.

**Such an event carries `backfilled_at` and is excluded from every coverage denominator.**
*This ruling kept it in N, "because those are facts about who attended rather than
judgements about anybody's reporting" — and for a closed-month back-fill that reason is
false, since nobody was permitted to record anything about it. Superseded by
[decision 0167](0167-four-more-from-the-third-review-including-a-key-that-was-wrong.md):
while it holds no attendance it counts toward nothing, and it re-enters every view the
moment Admin records against it.*

The mechanism is not new: Section 9 already excludes a Network root from coverage
denominators, and for the same reason — the denominator counts the leaders who had the
opportunity.

**Only a back-fill into a closed month is marked.** A Sunday filled while its month is
still open is an ordinary event: the window is open, leaders can still submit, and it
counts like any other.

## A meeting dated the day the Cell closed belongs to the outgoing leader

0165 resolved a meeting's responsible leader as of its date. A leadership row is in force
over `[started_at, ended_at)` and Section 10 ends it *on* the closure date — so a meeting
dated that day falls outside every row and 0163's own rule refuses it.

**For a meeting's own lookups, the closure instant is read as the end of that day.** The
half-open interval is untouched everywhere else; what changes is which leader a meeting on
the boundary resolves to, and it resolves to the one who was leading when the Cell met.

*Two corrections from the third review.* This said "for this **lookup** alone", meaning the
leader — and Section 10 ends a **membership** on the closure date too, so extending one and
not the other would give that meeting a responsible leader and an empty roster, which is
worse than refusing it and falsifies 0165's own claim that the leader and the people are
read at one instant. Both halves or neither.

And it justified itself with "a Cell closing after its last meeting is the ordinary case,
not a corner" — which is the one case that never reaches the boundary, since such a meeting
sits comfortably inside the leadership row. An undated closure takes the current instant,
so a leader closing the Cell the evening it met has no problem either. What reaches it is a
closure carrying an effective date equal to a day the Cell met, which under Section 10 is
Admin backdating. The rule is right and the case for it was not.

Resolving at the closure *instant* instead was weighed and refused. A meeting carries a
`scheduled_time`, so it is expressible — and it would make the answer depend on whether
the Cell met before or after somebody pressed the button, which is not a distinction
anybody reporting a meeting would think about, and not one the record should turn on.

Requiring the closure to be dated after the last meeting was also refused: it turns the
ordinary case into a refusal the leader has to diagnose, and Section 10 does not tell them
to date it later.

---

Decision 0166, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Four Stop Conditions the Stage 4 rulings raised](0165-four-stop-conditions-the-stage-four-rulings-raised.md) | Next: [2026-08-31 — Four more from the third review, including a key that was wrong](0167-four-more-from-the-third-review-including-a-key-that-was-wrong.md)
