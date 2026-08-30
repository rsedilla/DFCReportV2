# 2026-08-23 — Reading the Network-change trigger fired twice, which is what the section 4 floor is about


Recorded as a mechanism rather than as a decision, because the floor in section 4 is
stated as a rule and is impossible to check against the schema without it — and
because on this project every rule written about this trigger by reasoning from its
purpose rather than its `WHERE` clause has been wrong.

`assert_network_change_keeps_edges` fires **twice** in one correction, and the two
firings select different edges:

- **On the `UPDATE` closing the old Network row**, the bound is the *old row's*
  `started_at`, not the effective date. That selects nearly every edge the person
  has ever held, each compared at `GREATEST(edge.started_at, old_row.started_at)`,
  and it passes only while that instant is still covered by the old Network row —
  that is, while the edge began strictly before `eff`.
- **On the `INSERT` of the new Network row**, the bound is the effective date. Edges
  with `ended_at > eff` are selected, and the old edge closed at exactly `eff` is
  not — which is what makes the one-instant rule in section 4 work at all.

They are listed in that order because that is the order they fire in. The partial
unique index `network_assignments_one_open` forces the close to precede the open, a
deferred constraint trigger's events fire at commit in the order they were queued,
so the `UPDATE` firing is the **first**.

**An earlier version of this entry said the `UPDATE` firing was the second, and
said both strictness rules were properties of it. Both halves were wrong**, and the
second contradicted this entry's own bullets four lines further down. Corrected in
place rather than deleted, because this is the entry written to warn against
describing a mechanism from the part of it being looked at, and it did exactly
that. Found by `architecture-guardian` reading the SQL.

The terms divide between the firings rather than coming from one:

- **Term (a)** comes from the `UPDATE` firing. `eff` equal to the current
  assignment's `started_at` closes it at its own start; the resulting zero-length
  row is selected there and compared at `eff`, where the person already resolves to
  the corrected Network. Hence strictly later.
- **Term (b) at exact equality with a zero-length closed edge** comes from the same
  firing, for the same reason.
- **Term (b) in its ordinary case** — an effective date below a closed edge's
  `ended_at` — comes from the `INSERT` firing, which selects anything with
  `ended_at > eff`. This is the half the earlier wording denied while its own
  bullet asserted it.

**Section 4's uniform strict form is conservative by one instant on term (b), and
that is followed rather than optimised.** For an ordinary closed edge with
`started_at < ended_at`, `eff` equal to its `ended_at` in fact passes both firings.
The strict form refuses it. Narrowing the rule to zero-length rows alone would make
the implementation disagree with the specification to gain one instant, on the part
of this system where reasoning from purpose has already been wrong four times.

**A second bound, on the Network row rather than on the edges.** An effective date
at or before the moment the open Network row began is refused, separately from the
floor.

**The first version of this entry got this wrong in two ways, and both are
corrected here rather than deleted.** It bounded only dates strictly *below* the
row's `started_at`, treating the case as a translation of `CHECK (ended_at >=
started_at)` into a readable message. Equality is the case that matters: it closes
the live Network row at its own start, and section 5 makes such a row inert, so the
person's former Network silently disappears from every as-of query and every
past-period report for them moves. And it claimed the branch was "reachable only
for a null-`leader_id` root row written by an import". That is false. It is reached
by any Person with no pastoral assignment at all — both floor subqueries are empty,
section 4 says such a correction may be backdated freely, and an effective date
before their Network row's start lands there with no root row in the picture.

Both found by `architecture-guardian`. The ruling built on the false claim — that
no further bound was needed because the corner was unreachable — does not survive
it, so the bound is now stated in `SKILL.md` section 4 as a rule rather than
excused as a corner.

---

Decision 0092, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — Six rulings the sex-correction route needed, settled before the code](0091-six-rulings-the-sex-correction-route-needed-settled-before.md) | Next: [2026-08-23 — Three rulings the review of the sex correction forced, and one gap it found](0093-three-rulings-the-review-of-the-sex-correction-forced-and.md)
