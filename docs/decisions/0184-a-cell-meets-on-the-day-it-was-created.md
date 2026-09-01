# 2026-09-01 — A Cell meets on the day it was created, and the bound is a date at both ends

Section 10 opens a Cell's schedule row at `created_at` and says what a schedule change
does at a month boundary. It says nothing about a meeting **on the creation date
itself** — a Cell approved on a Saturday morning whose schedule is Saturday.

The listing built in the same stage derives that meeting. Until now that was code taking
a position nothing had asked it to take, and it was recorded as open the day it was
found. It is settled here because the recording slice is where it stops being a display
choice: a meeting the listing derives is one a leader can file, and a meeting it does not
derive is one nothing can record.

## The ruling

**The meeting counts.** A Cell's schedule governs a date when the schedule row is in
force on that date, and both ends of that comparison are Manila **dates** rather than
instants. A Cell created on 8 August has a scheduled meeting on 8 August if it meets on
Saturdays.

## Why, and what it costs

**Section 13 already takes this direction at the other edge, for a stated reason.** A
closure ends the schedule row *on* the closure date, and section 13 says a meeting dated
that day "reads the Cell as it stood that day" — because otherwise the meeting falls
outside every row, finds an empty roster, and a meeting the Cell actually held becomes
unrecordable. That is the same failure this rule prevents at the opening edge, reached
from the other side.

**The opposite reading refuses a record for a meeting that happened.** A Cell approved on
a Saturday morning that meets that evening is not unusual — section 10's creation
workflow is a request and an approval, and an approval lands when an administrator gets
to it, which is as likely to be the morning of a meeting as any other time. Under the
strict reading the leader's first meeting is one the system will not derive, will not
show as awaiting a record, and will not accept a submission for. Section 13 works harder
than anywhere else in this specification to avoid exactly that outcome, and it does so
because the alternative is a leader learning that honest reporting is not always
available to them.

**The cost is real and is accepted: nothing checks the time.** A Cell approved at four in
the afternoon did not exist for a meeting at ten that morning, and this rule counts that
meeting anyway. What it produces is one derivable meeting the Cell could not have held,
which a leader answers by declaring `NOT_HELD` with `LEADER_UNAVAILABLE` — an honest
record of a meeting that did not take place, which is the mechanism section 13 provides
for exactly this and which costs the leader one action.

The reverse error has no such remedy. A meeting the schedule does not derive cannot be
recorded at all, by anybody, and section 13 gives no route to add one.

## Why the bound is a date at both ends rather than an instant at one

The closing edge **must** be day-granular: section 13 requires it in terms, and the
requirement is not optional. So the only question is whether the opening edge should
differ.

It should not, and the argument is not symmetry — decision 0100 is the standing warning
against that. It is that a bound granular one way at one end and the other way at the
other is **two rules wearing one name**. Every reader of `cell_schedules` would have to
know which end they were near, and the derivation query would carry a comparison whose
form changed halfway through its own `WHERE` clause. The specification has one sentence
for when a schedule governs a date; the code should have one comparison.

*An earlier version of this argument said the two edges are symmetric and left it there.
They are not: the closing edge is required by section 13 and the opening edge is chosen
here. What makes them the same rule is the cost of their being different, not a symmetry
that was asserted.*

## What this binds

- `GET /api/v1/cells/{id}/meetings` derives a meeting on the creation date. It already
  did; this is what makes that correct rather than incidental, and a case pins it.
- The recording routes accept a submission for that meeting, on the same terms as any
  other. The Cell existed, it had a leader from `created_at`, and its roster is whoever
  held a membership that day.
- The closure edge is unchanged. Section 13 governs it and this ruling restates nothing
  about it beyond the comparison's form.

It says nothing about a schedule **change**, and does not need to: section 10 pins a
change to the first of a month, where no meeting can predate the row by hours.

---

Decision 0184, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-01 — A record closed with nothing replacing it names itself](0183-a-record-closed-with-nothing-replacing-it-names-itself.md)
