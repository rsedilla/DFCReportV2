# 2026-09-02 — A meeting's scope resolves through its frozen responsible leader

Section 7's closed-Cell exception resolves a Cell meeting "through whoever led the Cell on
the meeting's date", and fixes that date as the **scheduled** one, on a reason it states:
"A closed Cell's meetings cannot be rescheduled (Section 13), so the authorizing date is
the scheduled one, derived from the Cell's own schedule. Without that, an actor could
declare an actual date inside their own past tenure and recover authority through a
request field."

Section 13 supplied the premise — "on a closed Cell `actual_date` equals `scheduled_date`"
— and the premise is false. It is an inference about rescheduling a Cell that is *already*
closed, and it says nothing about a meeting moved while the Cell was `ACTIVE` and closed
afterwards. Both of that meeting's dates fall before the closure, nothing refuses it, and
it sits on a closed Cell with the two differing.

Raised by `architecture-guardian` on the fifth review pass of decisions 0185 to 0187,
which is the pass that was asked whether those three left slice 2c with an unanswered
question. They did.

## The case

A leads until 9 March, B from 9 March. A meeting scheduled 7 March is held on 10 March and
recorded. Section 13 freezes its `responsible_leader_id` from the meeting's own instant —
its actual date — so the record belongs to **B**. The Cell closes on 20 March. Inside the
still-open window, Section 7 authorizes the correction at the **scheduled** date, 7 March,
which resolves to **A**.

So A may correct a record belonging to B, and B may not correct their own. That is the
exact inverse of the coincidence Section 7's exception is justified by: "they coincide here
because the only person who can sensibly file a meeting is the one who was leading when it
happened."

Unreachable today. `actual_date` is null on every row this system can produce, because the
only write path is a first submission and its DTO admits `HELD | NOT_HELD`. Slice 2c's
reschedule route is what makes it reachable, which is why it is settled before that route
rather than after.

## The ruling

**Within Section 7's closed-Cell exception — and only there — a Cell meeting with a
record resolves through that record's frozen `responsible_leader_id`. Where it has none,
it resolves through whoever led the Cell on the scheduled date, as now.**

*The first version of this sentence omitted "within the closed-Cell exception" and was
disambiguated only by a paragraph at the end of the ruling. Building it is what showed the
gap: read generally it would give an `ACTIVE` Cell's meeting to its frozen leader, which
silently reverses decision 0186 — and the branch order in the implementation is the one
place that mistake would have been made.*

**And a first submission cannot carry `RESCHEDULED`.** Both halves are the ruling; the
second is what keeps the first safe.

## Why

**Section 7 already says it.** "The meeting carries the answer and the Cell no longer
does" is Section 7's own sentence for why a meeting is placed per record rather than per
Cell — and the frozen column *is* the meeting carrying the answer. Resolving through a date
and hoping it lands on the same person is a re-derivation of a value the row already holds.

**It makes the coincidence true by construction.** Section 7 argues that who may act on a
record and who it belongs to are different questions that coincide on this path. Under a
date they coincide only while the dates agree. Under the frozen column they are the same
value, and the argument stops being something a future change can falsify — which this one
did.

**It is actor-independent, and that now rests on a pairing.** `responsible_leader_id` is
frozen at the first submission from the meeting's own instant, and a first submission
cannot carry `RESCHEDULED` — so the instant it freezes is always the scheduled date,
derived from the Cell's own schedule, and a later reschedule moves `actual_date` and never
the frozen column. Remove either half and the resolution becomes actor-chosen: an actor
able to declare an actual date on a *first* submission could freeze themselves as the
responsible leader and keep authority over the record past the Cell's closure. That is the
shape Section 7 refuses, reached one field over.

**A first submission cannot carry `RESCHEDULED` for its own reasons too**, which is what
makes the pairing a rule rather than a convenience. A reschedule is a change to a record
that already exists: it is what `cell_meeting_changes` records, and a change row needs a
`from_date` and a `from_status`, which do not exist until a record does. The DTO already
refuses it, on that reasoning, before this ruling needed it to.

## What it changes today: nothing, and that is checkable

For every row this system can currently produce, `actual_date` is null, so the frozen value
was itself resolved from the scheduled date at the first submission. The two resolutions
therefore agree on every reachable case, including the closed-Cell cases already pinned.

Where they *could* disagree without a reschedule is a §5 correction to `cell_leaderships`
between the first submission and the correction. There the frozen column is the right
answer and the date is the wrong one — Section 13 freezes the value precisely so a later
change does not move a recorded meeting between leaders' totals, and Section 20 forbids
moving a closed period's figures. So the new resolution is not merely equivalent; where it
diverges it diverges toward what Section 13 already requires.

## What this binds, and what it defers

- **The enforcement lands with slice 2c's reschedule route**, and that slice's first commit
  owes it. The resolution needs `cell_meetings`, which `attendance` owns and the guard
  cannot reach: `AttendanceModule` imports `AuthorizationModule`, so the dependency the
  other way is a cycle (Section 2). It therefore needs a second port on the shape decision
  0181 settles — declared in `auth/authorization`, implemented in `attendance`, bound in
  `AppModule`, injected optionally and refusing, with the module-graph test asserting the
  binding resolves.
- **`leaderForMeetingScope`'s date parameter stays**, because the no-record case still uses
  it and that is the case the closed-Cell recording path exercises.
- **The half that is reachable today is pinned today**: a first submission carrying
  `RESCHEDULED` is refused, which is the premise the whole ruling rests on and which had no
  case of its own.
- It says nothing about who may correct a meeting on an **`ACTIVE`** Cell. That resolves
  through the current leader under decision 0186 and is unchanged.

---

Decision 0188, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-02 — A handover on a meeting's own day leaves the meeting with the outgoing leader](0187-a-handover-on-a-meetings-own-day-leaves-the-meeting-with-the-outgoing-leader.md)
