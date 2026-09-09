# 2026-09-09 — A Cell meeting roster carries the marks it asks to be resubmitted

Section 13 and Section 14 provide for correcting a recorded meeting, and
`SubmitCellMeetingDto.attendance` requires **the whole roster** on a `HELD` submission —
"every member of the Cell on the meeting date, present or not" — because a submission is one
leader's account of the whole meeting.

> **Corrected on review the same day.** This gave the reason as "Section 20's
> reconciliation needs an absent row and a row marked absent to be different facts".
> Section 20 says nothing of the kind, and `CellFiguresService` counts attendees, so the
> two contribute identically to every figure the system computes. The whole-roster
> requirement is Section 13's on its own terms, and what makes this field nullable is the
> round trip rather than a reconciliation.

Nothing let a client read the marks it must resubmit.
`GET /api/v1/cells/{id}/meetings/{meeting_id}/roster` returned each member as
`person_id`, `member_id`, `first_name` and `last_name`; its `meeting` object is the
`cell_meetings` row rather than per-person marks; the meetings listing carries the same
row; and **no controller in `api/src` read `cell_attendance` at all**.

**A Cell meeting's roster carries each member's recorded mark**, or null where that member
has none.

## Why, and why it is not a new decision

Decision 0194 settled this for the other domain and gave the reason: **a leader marking a
checklist must see who is already marked.** The DCC roster carries `record` on every line
for exactly that reason. Nothing in that argument is about DCC — it is about a person
being asked to submit a list they cannot see — and the Cell route asks for more than the
DCC one does, because it demands the *whole* roster rather than the lines being changed.

Section 7's accepted disclosure reaches it: a leader authorized to record a meeting is
authorized to know what was recorded for it. The route is already guarded by
`cell.take_attendance` resolved against the meeting (decisions 0186, 0188, 0192), so this
adds no reader.

> **Two corrections, from the review of the implementation on the same day.** This
> paragraph said "resolved against the meeting's **frozen** responsible leader", which is
> the closed-Cell case alone — Section 7 resolves an `ACTIVE` Cell's meeting through its
> **current** leader, whatever any record says. And "adds no reader" is true of the route
> and was read as more: an actor holding `cell.take_attendance` without
> `cell.correct_subtree` may now **read** a mark they may not change, which Section 7 had
> already made and withdrawn as a claim for DCC. Under which capability those marks may be
> read is recorded as open in `CLAUDE.md`; this ruling settles that the roster carries them
> and does not settle that.

## What it prevents

A correction screen rendering every member unmarked, and a submission then overwriting
every other member's recorded mark with a blank one. That is silent data loss on the path
Section 13 exists to provide, and it is reachable by a leader correcting one person.

## The shape is the Cell's, not a copy of DCC's

**The line carries the mark and no per-person version**, and that is the part a copy would
have got wrong. Decision 0164 has a Cell submission carry **the meeting's** version and
the server compare that, while a DCC submission compares per `(dcc_event_id, person_id)`;
decision 0190 states that `cell_attendance.version` "orders one person's chain and is not
compared". A per-person version on a Cell roster line would therefore be a number the
client must not send back, offered beside the fields it must — which is decision 0100's
rule about re-deriving why a shape has the shape it has, in the one place a reader would
be most tempted to skip it. The meeting's version is already on the roster's `meeting`
object, which is the version a correction carries.

## What was rejected

**A separate read route for a meeting's recorded attendance.** It adds a route, a ledger
entry and a capability question to deliver what the roster is already the natural home
for — the roster exists to answer "who is there to record", and "what is recorded for
them" is the same question at correction time.

**Stating in Section 13 that a correction resubmits from the leader's own knowledge.** It
requires no API change and is the only option that keeps the data-loss path, so choosing
it would have been choosing that risk deliberately. It also asks a leader to reconstruct a
roster the system is holding.

## What this does not settle

**Whether the mark carries `recorded_at`.** The DCC line does. It is omitted here because
nothing on the Cell path needs it — a Cell correction compares the meeting's version, not
a per-person timestamp — and adding a field a client cannot act on is the shape this
ruling's own reasoning refuses.

**Nothing about DCC changes.** Its roster already carries what this gives the Cell one.

---

*Recorded as an open Stop Condition earlier the same day and settled before that record
was reviewed. Both are kept in this branch's history rather than the first being amended
away: the question was real when it was written, and a reader tracing why the roster gained
a field should find the gap stated before the answer.*

Decision 0223, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-08 — A yearly report returns the months that have begun](0222-a-yearly-report-returns-the-months-that-have-begun.md)
