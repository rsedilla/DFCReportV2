# 2026-09-09 — DCC events are listed by month, under the viewing capability

`GET /api/v1/dcc/events/{id}/roster` and its submit both take an event identifier, and
nothing handed a leader one. Section 22's route table named no index.

**`GET /api/v1/dcc/events?month=YYYY-MM-01` lists the events of one month, under
`dcc.view_subtree`.**

## Why a month rather than a window

A month is the unit Section 9 already uses for everything else: the submission window closes
on the 7th of the following month, coverage is a monthly figure, and the reporting routes take
the same parameter. A rolling window would need a width, and a width is a rule nothing else in
this system needs — invented for one route and then owed forever.

**The deciding case is a removed Sunday.** Section 9 is emphatic that a removed Sunday "always
means a row that records a decision", while a missing row "is never a decision", and that a
report covering a month with a gap is **wrong until the gap is filled**. A month view shows the
removal in its place, as a decision somebody took. A rolling window slides past a gap without
naming it, and a full listing across the thirteen-month horizon buries it among four hundred
rows.

## Why the viewing capability rather than the recording one

The roster is guarded by `dcc.take_attendance`, a **recording** capability, on Section 7's
argument that requiring a management capability to reach an attendance surface is what must
not happen. Copying that here was the first instinct and it is wrong.

**The index carries a scoped figure, and a recording capability has no scope to compute one
over.** Each row states how many responsible leaders have a record for that event, which is
decision 0224's coverage measured over the actor's subtree: a Cell leader's figure covers their
own people, an upline leader's covers their branch. `dcc.view_subtree` is the capability that
names that subtree, it is a Read capability, and it is grantable `read_only` — which a figure
somebody may read without recording anything should be.

`dcc.take_attendance` still guards the roster and the submission the index leads to. The index
is a read; what it leads to is a write; the capabilities differ because the acts differ.

## What a row carries

The event's date and identifier, whether it is recordable, and its coverage as **two figures**
— leaders with a record out of leaders who owe one, never divided (decision 0224, Section 13).
A removed event carries the removal and no coverage: nobody owes a record for a service that
was not held.

**A row is never colour-graded and the list is never ordered by coverage** (Sections 13, 17,
19). It is ordered by date, which is what a calendar is.

## What this does not settle

**What a report does when a month holds a calendar gap**, which Section 9 calls wrong until
filled and which is recorded as open in `CLAUDE.md`. This route will *display* such a month;
it does not decide whether the month is reportable.

**Whether the index may name the leaders who owe a record**, which is a different question
about a different disclosure and is settled separately.

---

Decision 0227, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-09 — A leader lists the Cells of their scope, with a filter for their own](0226-a-leader-lists-the-cells-of-their-scope-with-a-filter-for-their-own.md)
