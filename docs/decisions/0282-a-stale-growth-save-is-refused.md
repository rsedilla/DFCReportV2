# 2026-09-24 — A stale Growth save is refused and names the line

A Growth row carries no version, and Section 14 detects a write made against a stale view by
comparing versions. So nothing stopped a leader
withdrawing a correction they had never seen: load a graduation, somebody changes its date,
untick it with a reason written about the old one, and the untick withdraws the new row.

The owner chose this answer from a drawing of that sequence.

## The ruling

**Each change in a Growth save names the row it was made against, or none where the client
saw none.** A row is never changed once it stands, only superseded, so its identifier is what
the client saw.

**Where that row is no longer the current one, nothing is saved** and the refusal names the
first such line, in the order the client sent. It is a `VERSION_CONFLICT` carrying both sides,
as Section 22 requires, with `submitted_row` and `current_row` in the places of the two
versions; either may be null.

**A change that already agrees with what is stored writes nothing and conflicts with
nothing**, as Section 22 settles for a lost race: ticking a lesson somebody else has just
ticked succeeds.

## Why

It is the rule a DCC submission already follows, applied to a record that has row identity in
place of a version. The cost is one field per change.

---

Decision 0282, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-24 — The Growth count cards](0281-the-growth-count-cards.md)
