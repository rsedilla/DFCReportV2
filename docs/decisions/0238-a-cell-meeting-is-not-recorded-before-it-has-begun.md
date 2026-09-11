# 2026-09-11 — A Cell meeting is not recorded before its day has begun

Section 9 refuses a DCC record against an event whose Manila day has not begun (ruling of
2026-08-31), and gives the reason: such a record "advances a person's classification in
months nobody has reported", and would stand for two months before any window closed over
it.

**Section 13 stated no counterpart and `CellMeetingsService` applied no check**, so a first
submission naming a scheduled date days in the future was accepted as `HELD`, with
attendance marks. Found by walking the DCC path on the demo database on 2026-09-10, which
held two such meetings — dated 2026-09-12 and 2026-09-16, filed on the 10th — and whose
dashboard read `3 people attended` and `3 of 7 meetings recorded` while two of the three
had not happened.

**Section 13 now carries Section 9's rule.**

## The same predicate, and it is the day's *beginning*

The refusal fires when the current instant precedes the start of the scheduled date's
Manila day. Not its end: a leader filing on the night of the meeting is exactly who Section
13 is written for, and Section 9 chose the same boundary for the same reason — its own VIP
workflow records attendance during the service.

So nothing a leader does on the day changes. What stops is a record for a day nobody has
lived through.

## Why the symmetry is the argument

The two domains agree on everything else this touches: a month closes on the 7th for both
(Sections 9 and 13), both attribute by an obligation rather than by a record, and both
compute a lifetime classification truncated at the month's end. A record against a day that
has not begun corrupts that classification identically in either domain.

**Nothing in Section 13 argued for the difference.** Its submission window states only when
a month *shuts*, which is why a future date inside the current month sits in an open window
and the route admitted it. That is a silence rather than a decision, which is what made
this a Stop Condition rather than a defect.

## What this deliberately does not settle

**The coverage denominator, which the two domains also disagree about.** Decision 0229
excludes a DCC event that has not happened from its coverage figure; the Cell denominator
counts every scheduled day of the month, with no bound at today. So from this ruling a
Cell mid-month reads `1 of 4` where the equivalent DCC line reads `1 of 1`.

That asymmetry is **not** created here — it exists today — but refusing the numerator makes
it visible, because a leader who has recorded everything they *could* still reads short. It
is recorded in `CLAUDE.md` as open rather than folded in: it moves a published figure, and
it is a question about what a denominator counts rather than about what may be written.

*Settling both together was offered and declined. They are separable, and this project has
already paid for interlocking rulings drafted as one — decision 0211 was withdrawn for it.*

**A reschedule's `actual_date` is a different question and stays open.** That bullet asks
what bounds a date a meeting is *moved* to; this asks whether a meeting that has not
occurred may be recorded at all.

---

Decision 0238, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — The `settings` write moves to its owner, and is audited](0237-the-settings-write-moves-to-its-owner-and-is-audited.md)
