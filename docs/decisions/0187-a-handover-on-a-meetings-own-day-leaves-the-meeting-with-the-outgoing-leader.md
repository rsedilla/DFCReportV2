# 2026-09-02 — A handover on a meeting's own day leaves the meeting with the outgoing leader

Section 13 fixes the instant a meeting is resolved at — "the meeting's `actual_date`
where it has one, and its `scheduled_date` otherwise" — and settles week-versus-day at
length: a week "is not an instant, and a handover or a closure may land on any day inside
one". It says nothing about a handover landing on the **same** day as the meeting.

Both `leaderOnDateWithin` and `leaderForMeetingScope` compare Manila **dates**, which
Section 13 requires at the closure boundary so a meeting held the day a Cell closed stays
recordable. The cost of that comparison is exactly here: on a handover day the outgoing
and incoming leadership rows both cover the date, and the query cannot tell which of them
was in the room. It answered with the later-starting row, which is a tie-break inherited
from `leaderForScopeWithin` — where it is correct for a different question — rather than
a rule anybody decided.

Raised by `architecture-guardian` on 2026-09-02, found by
`closed-cell-meeting-scope.e2e.spec.ts` failing on its first run. Owed before Stage 5
reports a month, because by then the wrong attribution is inside closed data that Section
20 forbids moving.

## The ruling

**Where two leadership rows both cover a meeting's date, the meeting resolves through the
earlier-starting one** — the leadership in force when the day began. That fixes both the
meeting's scope and the `responsible_leader_id` its first submission freezes.

`leaderOnDateWithin` orders by `started_at` **ascending**. Its two other keys are
unchanged and keep the meanings `leaderForScopeWithin` gives them. `leaderForScopeWithin`
itself is untouched: it asks who leads the Cell *now*, and the latest-starting row is the
answer to that.

## Why, and why not the other two answers

The open item named three, and said none was derivable.

**Compare at the meeting's scheduled instant rather than its date.** This is the only
answer that determines who was actually in the room, and it is refused on two grounds.
The port would have to read the time from `cell_schedules` to authorize, putting a second
input into a guard decision that Section 7 deliberately derives from the path. And it
contradicts two boundaries this specification has already chosen day-granularity for:
Section 13's closure extension, which is required, and decision 0184's creation-day
opening edge, where a Cell approved at eight in the evening still has that evening's
meeting. An instant comparison refuses that meeting outright.

**Prefer the outgoing row because a handover is usually recorded after the meeting.**
This reaches the right answer for the wrong reason, and the reason is false about as often
as it is true — an approval lands when an administrator gets to it, which is as likely to
be the morning of a meeting as the night after.

**State that a handover takes effect at the start of the following day.** Expressed as a
general rule this breaks decision 0184: a Cell's *first* leadership row would not govern
the Cell's first day, and a Cell created on a Saturday that meets on Saturdays would have
no leader for the meeting it held. Narrowed to a row that succeeds another, it is this
ruling, said in a way that invites the general reading.

## The argument that decides it

**The incoming reading is not a fact about the meeting.**

A meeting filed *before* the handover is approved finds one row — the outgoing leader's,
still open — and answers with the outgoing leader. The same meeting filed an hour later
finds two rows, and under the incoming reading answers with the successor. Two different
permanent attributions for one meeting, chosen by when somebody got round to entering the
record.

Section 3 makes a past period reproducible and Section 13 freezes
`responsible_leader_id` permanently, and Sections 12 and 20 count the meeting under the
leader it names. An answer that moves with the clerk satisfies none of them. Under the
outgoing reading the two orderings agree, which is what makes it a rule rather than a
preference.

It is also Section 13's own reading of the neighbouring boundary. A closure ends a
leadership row *on* the closure date, and Section 13 reads that instant as the end of the
day — the outgoing arrangement governing the whole of its last day. A handover is that
boundary with a successor instead of with nobody.

## What it costs

**A handover approved in the morning, before a meeting held that evening, attributes the
meeting to the leader who had already handed it on.** That is wrong about who was in the
room, and it is accepted: the alternative is wrong about the same thing on the other
days, and is additionally unstable. The remedy for a genuinely misattributed meeting is
the one Section 13 already provides for every other frozen value — none. The value is
frozen deliberately, and a leader who wants the record to say something else records the
facilitator, which is the field for who ran it.

**The roster does not have this problem and cannot supply the answer.** Memberships are
compared by the same dates, and on a boundary day the query returns everyone whose row
covers it — the union of both sides. A roster is a set and can hold both; a responsible
leader is one column and cannot. That is why the leader question needed a rule and the
roster question did not, and it is worth saying because "the leader and the people are
read at one instant" invites the assumption that the roster already implies an answer.

## What this binds

- `leaderOnDateWithin`, which is the only caller path this reaches: the meeting roster,
  the first submission's freeze, and `leaderForMeetingScope` on a closed Cell.
- Every recording route slice 2c adds, all of which resolve through the same method.
- Nothing else. `leaderForScopeWithin` keeps `started_at DESC`, and the closure
  service's own leader lookups are unaffected.

---

Decision 0187, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-02 — The capability decides a meeting's scope resolution, not the HTTP method](0186-the-capability-decides-a-meetings-scope-not-the-http-method.md)
