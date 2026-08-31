# 2026-08-31 — Four Stop Conditions the Stage 4 rulings raised

The first `architecture-guardian` pass over decisions 0161 to 0164 raised six Stop
Conditions and fourteen findings. Two of the six were answered by correcting the rulings
that opened them; four needed a decision, and are here. The corrections are recorded in
0161 to 0164 themselves.

## A missed Sunday is back-filled, and the horizon is visible

**The calendar command fills a past Sunday it finds missing. Back-filling into a closed
month requires `records.backdate_effective_date`, a reason and an audit entry. And the
Admin dashboard carries the date the calendar reaches.**

0161 wrote "it never creates an event in the past" as one of three protections, and that
bullet was the hole rather than a guard. No route in Section 22 creates a DCC event, so a
Sunday missed while the horizon was short could never be created by anything: that
month's N would be permanently one short and every bucket derived from it wrong, with no
remedy the specification offers.

Section 9's guarantee is that **every Sunday carries an event unless an Admin has
deliberately removed it**, and a removed Sunday keeps its row. So the only way for a past
Sunday to have no row is a lapse, and filling it restores the guarantee rather than
breaking it. Nothing is ambiguous about which Sundays those are.

What the withdrawn bullet was protecting is real and is kept where it belongs: a
back-fill into a **closed** month changes a period already reported, which is exactly what
`records.backdate_effective_date` governs everywhere else it appears. An ordinary run
touches only open months and needs none of it; a run finding a closed month short refuses
that part and says so.

**The horizon on the dashboard is the other half, and 0161 needed it without knowing.**
That ruling argued the obligation sits with the deployment "alongside the backup schedule
… a periodic task the platform runs, whose failure is visible". A backup job's failure is
visible because the job reports it. A command nobody runs reports nothing — the reason did
not carry, which is Section 25 rule 19, committed in a ruling that cited Section 25 rule
19. With the date on the dashboard a lapse is a task somebody sees, which is what makes a
command acceptable at all.

## The responsible leader resolves at the meeting's date

**`cell_meetings.responsible_leader_id` is resolved as of the meeting's `actual_date`
where it has one, and its `scheduled_date` otherwise.**

0163 said "as of the meeting's week", and a week is a period. A handover takes effect at
approval and a closure on its effective date, either of which can land on any day — so
resolving at the week's Monday would attribute a Saturday meeting to a leader who handed
the Cell over on the Wednesday, which is the outcome 0163 exists to prevent, reached
through its own wording.

The date is right for the reason Section 9 gives for DCC, "as of the event date", and for
one more that is specific here: the ruling of 2026-08-20 takes a rescheduled meeting's
**roster** from its actual date, so the leader and the people are read at one instant
rather than two.

For a `RESCHEDULED` meeting the leader may then come from a different calendar week than
the one the meeting reports in. That is already true of its roster and it is the right way
round: which week a meeting belongs to is a fact about the reporting period, and who was
leading when it happened is a fact about the meeting.

## A closed Cell still takes a record for a week it was open

**Until the submission window shuts, a `CLOSED` Cell accepts a meeting record for a week
before its closure, from the leader who led it. Weeks after the closure are refused.**

Section 10 says a Cell closed part-way through a month "simply has fewer recorded
meetings that month" — fewer, not none — and Section 13 gives a leader until the 7th of
the following month whether or not the Cell survived. Under 0162 there is no row until
someone reports, so refusing a closed Cell would mean a Cell that met three times and then
closed reports `0 of 4 meetings recorded` — which Section 7 names as "the evidence that
its leader reported nothing", arguing there about a backdated closure, which erases it.
Refusing here would manufacture that same evidence against a leader who did meet.

Scope allows it without amendment: Section 7 resolves a Cell meeting through the Cell's
leader as of the period being viewed, falling back to its last leader where the Cell is
closed — and says that fallback exists precisely so a closed Cell's history stays with the
person who led it.

Weeks after the closure are a different thing. The Cell did not exist to meet, so there is
nothing to report, and a row would create a scheduled meeting that never was.

*0163 asserted the opposite in passing, saying a meeting for a Cell with no leadership row
was unreachable "because an `ACTIVE` Cell has exactly one leader and a `CLOSED` Cell is
refused". The second half is not a rule Sections 10 or 11 state.*

## A DCC submission that conflicts applies none of it, and names the first person

**Where a DCC submission conflicts on one or more people, nothing is applied and the
response names the first, carrying that person's two values, two actors and two
timestamps.**

A DCC submission is a batch — Section 9's checklist covers a leader's own direct children
and those of every downline leader without an account — and versioning is per person
(0164), so an on-behalf collision conflicts on all of them at once. Section 22 fixes the
`VERSION_CONFLICT` body as one `submitted` and one `current` pair, and Section 14 requires
that a person can see both figures and decide. One person's pair is that shape exactly.

The client resolves that person, resubmits under a new key, and meets the next if there is
one. Tedious for a wide collision, and never wrong.

**All or nothing, rather than applying the people who did not conflict.** A partial result
is a third outcome that no client has, and a leader reading the response could not tell
what had been recorded without fetching the roster again. Section 14's rule is that a
conflict is resolved by a person and never by the system, and applying half a submission
is the system deciding about the half it applied.

**A widened body carrying every conflict was weighed.** It resolves a collision in one
round trip and is additive, so Section 22's versioning rule permits it. Refused for now
because it is a shape three client codebases must learn for a case that needs a person's
attention anyway, and the narrow form can widen later without breaking a client.

## One thing this deliberately leaves as it is

**Two concurrent first submissions of one Cell meeting.** Under 0162 neither holds a
version, so the loser meets the `(cell_id, week_starting)` uniqueness rather than a
version check. It answers `VERSION_CONFLICT` with a null `submitted_version` and the
stored row as `current`, which satisfies Section 14 — the person sees what was recorded,
by whom and when, against their own figures — and needs no new code. It is written down
because a uniqueness violation left to surface on its own would be an `INTERNAL_ERROR` on
an ordinary race.

---

Decision 0165, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — A Cell submission versions the meeting; a DCC submission versions the person](0164-a-cell-submission-versions-the-meeting-a-dcc-submission-versions-the-person.md)
