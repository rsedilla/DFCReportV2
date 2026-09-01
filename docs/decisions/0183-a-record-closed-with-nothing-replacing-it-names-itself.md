# 2026-09-01 — A record closed with nothing replacing it names itself, and that is the idiom rather than a workaround

§13 requires the path: a `RESCHEDULED` meeting that ultimately does not take place "may
be changed to `NOT_HELD`, preserving both records", and a `NOT_HELD` meeting carries no
live attendance — so its attendance rows are closed and **nothing replaces them**.

`cell_attendance_supersession_is_whole` (migration 0011) requires a `superseded_by`
wherever `superseded_at` is set, stated as an equivalence because `superseded_by` "holds
the id of the row that replaced this one" and a close with no replacement looked like an
incomplete write. It is not. It is the one operation §13 names that has no successor.

Three answers were defensible and none was derivable. This settles it, before the Cell
recording slice — the first code that can reach the path at all.

## The ruling

**The row names itself, and §13 documents that as the idiom.** `superseded_at` is set
and `superseded_by` is the row's own id.

The two constraints that meet it carry the exemption by name and only on
`cell_attendance`: migration 0013's contiguity trigger returns early for it, and
`cell_attendance_one_successor` excludes it from the index with `superseded_by <> id`.
`dcc_attendance` refuses the shape outright, because §9 says `NOT_HELD` "has no DCC
equivalent" and no DCC operation produces it.

## Why not a null `superseded_by`

It reads better and costs more than it looks.

Permitting `superseded_at` set with `superseded_by` null means relaxing
`..._supersession_is_whole` from an equivalence to an implication in one direction. That
constraint's equivalence form is what makes "a superseded row has a successor" a fact
about the table rather than about its callers, and three other things now lean on it:
the deferred foreign key's guarantee that the successor exists, the contiguity trigger's
right to assume a row it can look up, and §9's argument that a live row exists for a
person once one ever has.

Relaxing it would replace one refusal that is always correct with a nullable column
whose two null cases — "not superseded" and "superseded by nothing" — are distinguished
only by a second column. That is a shape where a query written without the second column
is quietly wrong, and there is no constraint that can catch such a query.

## Why not a column of its own

A `closed_with_no_replacement` boolean, or a separate meeting-level record, is a
migration, a schema concept and a new invariant for **one** operation on **one** table.
The self-reference needs none of those and is already enforced on both sides: refused
where §9 forbids it, permitted where §13 requires it, with a case pinning each.

It would also make the operation's shape differ between the two attendance tables for a
reason that is not §9's. §9's asymmetry is that the *operation does not exist* there —
not that it takes another form.

## What made this look like a workaround, and what changed

It was recorded as open because the schema had "no way to express" the operation except
a self-reference, which reads as the schema failing to have an opinion. In the course of
Stage 4's seventh, eighth and ninth review passes the shape acquired one:

- The trigger's exemption is on `cell_attendance` alone, and a case goes red when it is
  widened back to both.
- `cell_attendance_one_successor` carries `<> id`, and a case goes red when it is
  dropped — the case that found the index refusing §13's own path for any record already
  corrected once.
- `dcc_attendance` refuses the shape as a rule about the shape rather than as a side
  effect of comparing two instants, and two cases pin it, one at zero length.

So the idiom is now the only shape the schema permits where §13 requires it, and is
refused everywhere else, each by something that fails when removed. What was missing was
never the enforcement; it was a ruling saying the enforcement is the design. This is it.

**`SKILL.md` §13 states it as the idiom** rather than describing it as a workaround, and
§9 states the corresponding refusal, so the next reader meets a rule instead of an
apology and an open question.

## The residual, disclosed rather than closed

Once a Cell row self-closes, nothing is live for that `(cell_meeting_id, person_id)`, so
an unrelated row may afterwards be inserted with a `recorded_at` overlapping the closed
one. Nothing refuses it. This is the exemption's residual and it exists under every
answer above — a null `superseded_by` or a separate column leaves the same gap, because
what is absent is a constraint on *re-opening*, not on the closing shape.

It is unreachable through the application: a `NOT_HELD` meeting refuses attendance
outright (`assert_no_attendance_when_not_held`), so the only route to the overlap is a
`psql` session. Named here so the next reader knows it was seen and is not a consequence
of choosing the self-reference.

---

Decision 0183, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-01 — A closed month is amended on the routes that record it, and §20 already said who invalidates](0182-a-closed-month-is-amended-on-the-routes-that-record-it.md)
