# 2026-09-03 — The accepted disclosure is a Cell argument, and the DCC roster publishes per-person figures by design

Section 7 accepts one bit of disclosure: an actor holding a recording capability and not
the amendment one learns whether the record they sent is the record that is stored. It
accepts it on a bound — recovering N people's attendance costs 2^N submissions, because a
Cell submission names every member at once and the answer covers the whole set — and it
names what would change that: **"a route that reads per-person attendance"**.

That clause said *"which none does today"*, of the whole system, and was false when it was
written. `GET /api/v1/dcc/events/{id}/roster` returns, for each person on the actor's
checklist, `present`, `version` and `recorded_at`. It is guarded by `dcc.take_attendance`
— a recording capability, and one Section 7 does not permit to be granted `read_only`,
because `read_only` is valid only on a read capability.

So the trigger Section 7 set had already fired, for one of the two domains, since the DCC
recording slice. Raised by `architecture-guardian` on 2026-09-03.

## The ruling

**The acceptance was always a Cell argument, and it says so now. The DCC roster publishes
per-person figures deliberately, and that is not a disclosure to be closed.**

Two things follow, and they are different in kind:

**For a Cell meeting, nothing changes.** The Cell roster returns the members and the
meeting's own row and never who was marked present, so the bit still costs 2^N and the
acceptance stands on the bound it was given. The first *Cell* surface that offers those
figures makes it free and revisits this.

**For DCC, the figures are the recording surface.** Section 9 makes a person's attendance
their direct pastoral leader's obligation, and a leader marking a checklist has to see who
is already marked or they cannot do the work — they would overwrite their own colleagues'
entries, or re-ask people who were already counted. Withholding `present` from an actor
holding `dcc.take_attendance` would protect a figure that is already theirs to write. So
the 2^N bound is not the argument for DCC and never was; the argument is that the actor is
the person recording.

**The 2^N bound is also Cell-shaped in a way that does not transfer.** A Cell submission
must name every member exactly once and is answered as a whole; DCC is recorded per line,
with per-line outcomes. A bound derived from an all-or-nothing answer says nothing about a
surface that answers each line.

## What was rejected

**Narrowing the DCC roster to withhold `present`** from an actor holding only the
recording capability. It breaks the primary workflow described above, and it protects
nothing: the same actor may write the value.

**Accepting in both domains on one reason.** There is no single reason. The Cell case rests
on a bound and the DCC case rests on who the actor is, and collapsing them is what produced
the withdrawn claim of 2026-09-03 that a Cell ground covered both paths.

## What this does not settle

**This is not the ordering question**, which is decision 0193, and the two are less coupled
than they look. The DCC roster shows the actor's *checklist*; 0193's oracle concerned a
person *off* it. Publishing `present` for on-checklist people never made the off-checklist
bit free, so 0193 was owed regardless of how this ruling went.

**Whether a person may record their own DCC attendance** stays open, and is recorded in
`CLAUDE.md`.

---

Decision 0194, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-03 — Section 7's contents-ordering rule binds DCC, and the correction-reason refusal moves behind it](0193-section-7s-contents-ordering-rule-binds-dcc.md)
