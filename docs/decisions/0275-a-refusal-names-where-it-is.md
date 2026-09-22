# 2026-09-22 — A refusal names where it is, and the screen names the line

Section 22 asks a refusal to name the field, "which is what a client needs in order to fix
it", and for a field inside a nested object it did not: a checklist whose second line had a
reason too long answered `{ "field": "records", "problems": [] }`, the container with no
message. The owner's Claude Design shows no refusal of this kind. The owner chose this answer
from a drawing of it beside today's.

## The ruling

**Each entry of `details.fields` carries a `path`** reaching inside the top-level property,
`records[1].correction_reason` or `amendment.reason`, and **`problems` carries that member's
messages**. `field` stays the top-level property, as it was.

**A screen that sent a roster names the person on the refused line**: the DCC checklist maps
`records[i]` and the Cell meeting screen maps `attendance[i]` to the person it sent there.

## Why

Both are additions, so a client reading `field` alone is unaffected, which is what Section
22's additive rule asks while native clients are to read this envelope too. The screens cap
lengths already, so this is rare, and when it happens the leader is told whose line to fix.

---

Decision 0275, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-22 — Any current Person may have run a Cell meeting, and the screen asks](0274-any-current-person-may-have-run-a-cell-meeting.md)
