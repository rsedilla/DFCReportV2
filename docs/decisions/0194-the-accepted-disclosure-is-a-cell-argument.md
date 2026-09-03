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

**For DCC, the figures are the recording surface**, on three grounds. They are given in
order of how much they rest on, because the first two are checkable and the third is an
inference this ruling draws rather than a sentence Section 9 contains.

**The `version` is not discretionary.** Section 14 requires a client to submit the version
it read, and makes a DCC record's unit `(dcc_event_id, person_id)`. A per-person surface
must therefore publish a per-person version or no client can submit a correction at all.
Of the three fields the roster returns, this one is *required* to be published, and no
version of this argument had said so.

**The bound the Cell case rests on does not exist here.** A Cell submission must name every
member exactly once and is answered as a whole, so recovering N figures costs 2^N. DCC is
recorded per line with per-line outcomes, so the same actor could recover N figures in N
probes. The acceptance would be worth very little in this domain whether or not the roster
published anything — publishing is not what makes the figures reachable, which is the
strongest form of the argument and not the one first written.

**And the figures are mostly the actor's own to write.** Section 9 makes a person's
attendance their direct pastoral leader's obligation and says a checklist's lines mostly
repeat what is already recorded, from which a prefilled checklist follows: a leader who
cannot see what is marked re-asks people already counted. *Mostly, not wholly. Where a
record exists and disagrees, changing it requires `dcc.correct_subtree`, so there is a
figure such an actor may read and may not write. A first version of this ruling said
"withholding it would protect a figure that is already theirs to write" without the
qualification, which holds only for a record that does not yet exist.* Section 9 does not
state the prefilled checklist in terms, and this ruling marks it as inferred rather than
quoted.

## What was rejected

**Narrowing the DCC roster to withhold `present`** from an actor holding only the
recording capability. It would break the workflow described above, and it would protect
very little: the version must be published regardless, and the same figures are reachable
in N single-line probes. *An earlier version of this bullet said it "protects nothing: the
same actor may write the value", which is the unqualified claim this ruling withdraws
eight lines above — where a record exists and disagrees, changing it needs
`dcc.correct_subtree`.*

**Accepting in both domains on one reason.** There is no single reason. The Cell case rests
on a bound; the DCC case rests on the three grounds above, of which the mandatory version
is the one that is not a judgement call. Collapsing them is what produced the withdrawn
claim of 2026-09-03 that a Cell ground covered both paths.

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
