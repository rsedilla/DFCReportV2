# 2026-08-31 — The submission window runs through the whole of the 7th

Sections 9, 13 and 20 each say a month may be recorded or corrected "until the 7th of
the following month, at 23:59 Asia/Manila". Read to the letter, that shuts the window at
23:59:00 and leaves the last sixty seconds of the 7th closed.

**The window runs through the end of the 7th.** The first instant a month is shut is
00:00 on the 8th, Asia/Manila.

## Why the literal reading was refused

Nobody wrote a dead minute. `23:59` is how a person writes "the end of the day" on a
clock with no seconds hand, and all three sections reach for it in the same breath as
"after that the month is closed" — which describes a boundary, not a minute-wide gap
before one.

What decides it is that the literal reading is undiscoverable. A leader refused at
23:59:30 on the 7th is told the month closed, and every published rule says it closes at
23:59 on the 7th, which has not passed. There is no screen, message or document from
which they could learn that the minute they are inside is the excluded one. A rule
nobody can find out about is not a rule leaders can comply with, and this one would bite
exactly the leader filing at the last moment — the one the window exists to accommodate.

The cost of the other reading is sixty seconds of additional grace, once a month, on a
boundary the specification chose for pastoral rather than technical reasons.

## What it does not change

The boundary is still read from the database on both ends (Section 24, and decision
0160). Moving it by a minute changes which instant is compared, never where the instants
come from — a window compared against a host clock would be wrong at 23:59 and at 00:00
alike.

It says nothing about a month's *own* boundaries. A reporting month is a calendar month
in Asia/Manila (Section 20); this is about the deadline for filing against one.

## Where it is written

Sections 9, 13 and 20 now say "until the end of the 7th of the following month,
Asia/Manila", and Section 13 — where the window is defined rather than referred to —
carries the reason. `api/src/attendance/submission-window.ts` already implemented this
reading and flagged the line as the one to change if the literal reading were wanted; the
flag is replaced by a citation of this ruling.

---

Decision 0170, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Four that the closed-Cell path produced](0169-four-that-the-closed-cell-path-produced.md) | Next: [2026-08-31 — Four rulings the DCC recording path needed, settled before the code](0171-four-rulings-the-dcc-recording-path-needed.md)
