# 2026-10-14 — A request records the name of the Cell it names

Record's *Your requests* named a handover's Cell and the Cell a restart resumes by its Cell ID,
because the request held nothing else of it. Decision 0306 names a Cell in a list by its
category and day, and reading the Cell's own would show the sender a Cell's details after it
had left their branch, while that list needs no capability because it returns only what the
sender's account created (Section 7, decision 0269). The owner chose this answer on 14 Oct from
real screenshots, as option 2.

## The ruling

**A handover or a restart records the category and meeting day of the Cell it names, as they
stand when it is sent**, in `named_cell_category` and `named_cell_day_of_week` (migration
0026). They come from the last category and schedule rows the Cell held that were ever in
force. A plain new-Cell request names no Cell and records neither.

**The sender's list names the Cell from them**: "Hand Young Pro · Fri to Lorna Cruz", "Restart
Youth · Sat with Paolo Reyes". A Cell an approved new-Cell request minted is still named by
what the request asked for.

**They are never rewritten**, on a pending request as on a decided one, and **nothing is
backfilled**: a request sent before migration 0026 recorded nothing and is named by its Cell
ID.

## Why

It is the sender's own record, so the list keeps the ground Section 7 gives it. Rejected:
reading the Cell's present category and day, which is the disclosure above. Accepted cost: a
Cell whose day later changes is still named by the day it had when the request was sent.
Filling in the old requests would write a Cell's present configuration into a past record.

Decision 0346, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-14 — Unsaved attendance marks are kept on the device](0345-unsaved-attendance-marks-are-kept-on-the-device.md)
