# 2026-09-04 — The amendment gate binds a lost race, and it binds both domains

`CLAUDE.md` recorded this as one question with two halves, and only the second was ever
really open.

Section 7 owes `cell.correct_subtree` — and `dcc.correct_subtree` — to a submission that
differs from what is stored, and requires every other capability to be decided before the
stored contents can change what a caller is told. A **first** submission that loses a race
and disagrees with the winner amended nothing: it wrote no row at all. So neither reading is
stated outright, and both were defensible.

**What was not defensible is that the two domains answered differently.** The Cell path
gated the disagreeing branch; `DccAttendanceService.conflictAfterLostRace` did not.

## The divergence, and why it is a disclosure rather than an inconsistency

An actor holding `dcc.take_attendance` alone, losing a first-submission race with a body that
disagrees, was answered `409 VERSION_CONFLICT` carrying **the stored value and the name of
the account that recorded it**. The identical body sent sequentially is answered
`403 dcc.correct_subtree`.

The DCC roster publishes neither of those figures to that actor. So the ordering rule Section
7 states — nothing the caller is told varies with the stored contents until the amendment
capability is decided — was being obeyed on one route and not its twin, and **timing decided
what somebody learned about another leader's record**.

That is the same argument that settled the Cell path, applied unchanged. It is why this is
recorded as a defect DCC had rather than a difference the domains were entitled to.

## The ruling

**The amendment capability is checked on the disagreeing branch of a lost race, in both
domains, before anything of the stored record is disclosed.**

**And on that branch only.** A loser carrying what the winner recorded wrote nothing, and
Section 7 owes no amendment capability for a write that writes nothing (decision 0191). That
half is not a matter of taste: checking unconditionally refuses such an actor `403` where the
identical body sent sequentially answers `201`, which is the same
timing-decides-the-answer defect mirrored — and Section 22 stores a 4xx against the
idempotency key, so a conforming retry would replay the refusal for ever, while
`RESOURCE_BUSY` is a 503 and releases it.

The Cell path already had both halves and its comment already argued them. What this ruling
adds is that they are the rule rather than that route's arrangement, and DCC now implements
them.

## What stays open

**Whether the gate is *owed* on a submission that wrote nothing at all** is still not stated
by Section 7, and this ruling does not claim to settle it. What it settles is that whatever
the answer is, it is the same in both domains — and that the conservative direction is the
one to implement while it is open, because the cost of gating a disclosure that turns out not
to need gating is a capability an actor can be granted, while the cost of the reverse is a
figure published to somebody who cannot read it any other way.

The bullet is narrowed rather than retired for that reason.

---

Decision 0201, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — A format validator must not throw on a value it refuses](0200-a-format-validator-must-not-throw-on-a-value-it-refuses.md)
