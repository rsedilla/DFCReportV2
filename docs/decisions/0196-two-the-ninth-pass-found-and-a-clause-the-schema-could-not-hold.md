# 2026-09-04 — Two the ninth pass found, and a Section 13 clause the schema could not hold

The ninth `architecture-guardian` pass on the transitions slice was narrowed to two defect
*classes* rather than run as a general sweep, on the evidence that this is what works here:
passes 1 to 7 were general and each found defects, and pass 8 audited two classes and found
in one round what the general passes had missed.

It found two behavioural defects on this branch. Both are one rule enforced on one path and
not on its neighbour, which is the shape this project keeps recording, and each is settled
below. A third, on the sibling DCC route, is pre-existing on `main` and is recorded as open
rather than fixed here.

## Section 13's `NOT_HELD` refusal binds every path that reaches the status

Section 13 says of `NOT_HELD` that "No attendance is recorded", and
`assertAttendanceMatchesRoster` refuses a submission carrying any. The route called it on
the reschedule branch alone:

```ts
const attendance =
  operation.kind === 'reschedule'
    ? assertAttendanceMatchesRoster(body, roster, { cellId, meetingId })
    : [];
```

so a transition to `NOT_HELD` took the `[]` beside it and the refusal never ran. Reproduced
against `dfc_ci`: a moved meeting declared `NOT_HELD` while carrying a full roster answered
`201` with `recorded: 0`, and so did one carrying a `person_id` naming nobody in the
database — the duplicate-name and non-member checks live behind the same assertion. The
identical body on a first submission answers `409`, and a green case had pinned it there
since the route was written, blind to the path this branch added.

**The ruling: the refusal is a property of the status and not of the path that reached it.**
Section 13 is amended to say so, and the assertion is called unconditionally rather than on
a second branch, because a branch is what was wrong. `declare_not_held` is reachable only
from a stored `RESCHEDULED` with a submitted `NOT_HELD` — `LEGAL_TRANSITIONS` admits nothing
else into it — so the call takes the function's own `NOT_HELD` branch and returns `[]`.

Nothing was corrupted: the attendance rows are closed either way. What was wrong is that an
actor was told `201` for a body whose contents were discarded, which is the shape Section 22
says can never be given meaning later — and which this branch's own earlier commit named,
in those words, when it fixed the same shape for `actual_time`. One rule, two paths, two
answers, twice.

## A reschedule's note had nowhere to go, and the constraint was stricter than the section

Section 13 asks that a rescheduled meeting preserve "original scheduled date/time, new
scheduled date/time, **optional note/context**, who rescheduled it, timestamp". The route
wrote four of the five and forced the note to null on a move. The submission's
`correction_reason` was accepted and stored in no row anywhere: it reaches only the
successor `cell_attendance` rows, and the ordinary reschedule leaves the roster unchanged
and produces none.

It was unimplementable rather than merely unimplemented. `cell_meeting_changes.reason` is
typed `cell_meeting_not_held_reason` — the closed enum of Section 13's `NOT_HELD` reasons —
and migration 0011 added

```sql
CONSTRAINT cell_meeting_changes_note_only_with_reason
  CHECK (note IS NULL OR reason IS NOT NULL)
```

so a note required one of those reasons beside it. A move has no such reason and never can:
the meeting was moved, not abandoned.

This was escalated as a Stop Condition rather than fixed, because it is a domain rule with a
migration attached and three answers were defensible — that `correction_reason` is the field
the clause means, that the change row should carry a free-text note independent of `reason`,
or that the audit entry discharges the clause.

**The ruling: the note lives in `cell_meeting_changes.note`, and stands there without a
`reason`.** Migration 0014 drops the coupling. The ground is that Section 13's own schema
block lists `reason` and `note` as independent nullable columns and couples them nowhere —
the constraint was an implementation choice made when the only change this table recorded
was a `NOT_HELD` declaration, where it happened to hold. A reschedule is the case it was
never written against, and it arrived with this slice.

A blank note is a note nobody wrote and is stored as absent. That is normalised in the
service rather than refused at the edge: `correction_reason` carries only `@IsString()` and
`@MaxLength(500)`, and tightening it would change what the *correction* path accepts, which
is a different change from this one.

### The migration relaxes and adds nothing, and the first draft did not

The first draft replaced the constraint with a non-blank-and-at-most-500 check. That would
have shipped **the sixth constraint-driven 500 on this route**: `not_held_note` writes the
same column and its DTO bounds it at 1000, so a legal note between 501 and 1000 characters
would have met a `CHECK` with no service guard in front of it. Two fields with different
bounds share the column, and one arbitrary bound over both is a rule neither of them states.

It is recorded because the draft was written *while* auditing that exact class, by the
reviewer of it, in the commit fixing its findings — which is the fix-batch failure this
repository has now measured across ten passes on two branches, reached from the one position
that should have been immune to it.

## What is not settled here

The DCC route carries the same null class this branch closed on the Cell route:
`correction_reason: null` is refused where omitting the key succeeds, because
`record.correction_reason !== undefined` is true of an explicit null and
`DccAttendanceService` has no `withoutNulls`. Two bodies that mean the same thing get two
answers. It is pre-existing on `main`, this branch does not touch that file, and CLAUDE.md
asks a pull request to be one coherent change — so it is recorded as open rather than fixed
here.

It is also why the Class A answer was "no". The class was closed at one door and the sibling
door was never checked, which is the shape of every fix batch this project records.

---

Decision 0196, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — A reschedule carries the roster of the day it moved to, in one operation](0195-a-reschedule-carries-the-roster-of-the-day-it-moved-to.md)
