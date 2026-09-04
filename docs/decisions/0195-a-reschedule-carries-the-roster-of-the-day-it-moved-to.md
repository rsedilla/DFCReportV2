# 2026-09-04 — A reschedule carries the roster of the day it moved to, in one operation

Section 13 and Section 12 each state a rule that is clear alone, and together they leave a
meeting in a state Section 13 says cannot exist.

- **A first submission cannot carry `RESCHEDULED`** (Section 13). A reschedule is a change
  to a record that already exists, so a meeting that had already moved when it was first
  reported "is recorded and then rescheduled, in that order".
- **A rescheduled meeting's roster comes from the actual date** (Section 12), not the
  scheduled one: "Membership can change between the two, and the roster should be the
  people who could actually have been there."
- **A submission must name every member of the meeting exactly once** (Section 13), which
  is what Section 20's reconciliation depends on.

So the ordinary flow records attendance against the scheduled-date roster and then moves
the roster out from under it. A person who joined between the two dates has no record and
should have one; a person who left has a record for a meeting they were not a member of.
Neither is refused by anything, and the meeting is left failing the "exactly once" rule
silently — invisible until a month is reported.

Raised while building slice 2c's transitions, and escalated rather than settled in code:
this decides what a leader sees and what is counted, which is a pastoral question wearing a
technical shape.

## The ruling

**A reschedule carries the roster of the day it moved to, and moving the meeting and
recording that roster are one operation.**

`POST /api/v1/cells/{id}/meetings/{meeting_id}/submit` takes `status: 'RESCHEDULED'` with
`actual_date` (and optionally `actual_time`), a `version`, and the **complete attendance
for the new actual date**. The meeting moves, `cell_meeting_changes` records the move, and
the roster is written in the same transaction.

### Why not the alternatives

**Re-derive the roster and leave the meeting incomplete until corrected.** This is the
state Section 13 says cannot exist, held deliberately and for an unbounded time. Nothing
would surface it: coverage counts recorded meetings, not complete ones, so a month would
reconcile wrongly with every figure looking ordinary.

**Refuse a reschedule that would change the roster.** A leader whose member joined on
Tuesday could not record that Saturday's move at all, for a reason they cannot fix and did
not cause. It also makes a legitimate operation fail on the history of an unrelated
membership.

**Close the dropped rows and leave the added ones missing.** Half the defect, and the
half that is left is the one that breaks reconciliation.

The operation is not a larger request than the alternatives: a submission already carries
the whole roster, so this asks for exactly what the route already takes.

### A member of the old roster and not the new one

Their `cell_attendance` row is **closed with nothing replacing it**, which is decision
0183's idiom — `superseded_at` set, `superseded_by` the row's own id.

**This widens the case 0183 names**, and that is said rather than assumed. 0183 states the
shape "is where that case arises" of a `RESCHEDULED` meeting later declared `NOT_HELD`.
This is a second occasion for the same shape, in the same section, and the two constraints
that meet it already carry the exemption by name — the contiguity trigger returns early for
a self-reference, and `cell_attendance_one_successor` excludes it with `superseded_by <>
id`. Nothing about them is specific to the `NOT_HELD` path.

The row is closed rather than deleted because Section 12 makes the person a non-member of
that meeting rather than someone whose attendance was wrong: they could not have been
there. The history stays legible, which is Principle 12.

## Which capability

**`cell.correct_subtree`**, in addition to `cell.take_attendance` resolved against the
meeting, and `cell.submit_on_behalf` where the meeting is not the actor's.

Section 7's capability list is closed, so no new name was available, and this is the right
existing one rather than the only one: a reschedule changes a record that already exists,
which is what Section 7 owes the amendment capability for. It differs from what is stored
by definition — the status moves and the actual date appears — so the rule that exempts an
unchanged submission never reaches it.

## Which transitions are legal

Exactly those Section 13 names, and no others:

- A **first submission** is `HELD` or `NOT_HELD` (Section 13, stated).
- **`HELD` → `RESCHEDULED`** — "recorded and then rescheduled, in that order" (Section 13).
- **`RESCHEDULED` → `RESCHEDULED`** — Section 13 "permits a meeting to be rescheduled
  twice", which is why the changes live in their own rows rather than in columns.
- **`RESCHEDULED` → `NOT_HELD`** — stated, "preserving both records".

Everything else is refused with `INVARIANT_VIOLATION`:

- **`NOT_HELD` → anything.** `NOT_HELD` means the meeting "did not take place and is not
  being made up" (Section 13). Rescheduling it contradicts the fact just recorded, and
  Section 13 gives no route back.
- **`RESCHEDULED` → `HELD`** is not a transition at all and needs none: `RESCHEDULED`
  already means "the meeting took place, or is planned, on a date other than its scheduled
  one" (Section 13), and Section 12 counts `HELD` and `RESCHEDULED` alike in N. A meeting
  that moved and then happened is `RESCHEDULED` and is counted.
- **`HELD` → `NOT_HELD`.** Not a move but a claim that the first record was wrong, which is
  a different operation from the one this route performs.

## What this does not settle

**Correcting a status recorded in error.** A leader who files `NOT_HELD` and then finds the
meeting did happen has no route, and neither does one who files `HELD` for a meeting that
did not. Section 13 defines no such operation, and inventing one here would put an
unaudited "the record was wrong" beside the transitions it does define. Recorded as open in
`CLAUDE.md`. It is not urgent: both are rare, and the wrong answer would be a route that
quietly rewrites history.

**Whether a reschedule may move a meeting into a month whose window has shut.** Section 13
fixes the reporting month at creation and a reschedule never moves it, so the *record*
stays in its own month — but the actual date may fall outside it, and the closed-month
amendment of decision 0182 governs when a record may be written rather than which dates it
may name.

*This said it was "refused for now by the window check that already guards the route,
which is the conservative answer". It was not refused at all: that check reads the
meeting's own `reporting_month`, which a reschedule never changes, so `actual_date` reached
no window function anywhere and a meeting could be moved into a month shut for weeks.
Reproduced by `architecture-guardian` at 201.* The refusal is now written rather than the
claim withdrawn, because a record naming a day inside a closed month is what section 13
shuts the window to prevent — but it is a refusal this ruling chose after the fact, not one
the specification stated, so what remains open is whether it is the **right** bound rather
than whether one exists.

---

Decision 0195, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-03 — The accepted disclosure is a Cell argument, and the DCC roster publishes per-person figures by design](0194-the-accepted-disclosure-is-a-cell-argument.md)
