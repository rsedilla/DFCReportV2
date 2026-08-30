# 2026-08-28 — A Cell changes hands by request and approval, and a closure is never reversed


The two Stop Conditions the Stage 3 pre-flight opened, settled together because both
are about what happens to a Cell whose leader is leaving it.

**Handing a Cell to a new leader goes through request-and-approve**, the same two
steps as creating one. This is the ruling withdrawn from the pre-flight, landed now
that the three questions it could not answer are answered.

The reason is Section 10's own. What the workflow controls is not the Cell, it is the
decision that a person is ready to lead one: no leader decides alone that one of their
own disciples should lead. An earlier draft argued it from the counters a handover
moves — New Cell Leaders, the requester's own progress toward 12+ — and that is
false where the incoming leader already leads a Cell, which Section 10 explicitly
permits. The narrower ground holds in both cases and is what Section 10 now says.

**The capability pair is renamed rather than duplicated.** `cell.request_creation`
becomes `cell.request_leadership` and `cell.approve_creation` becomes
`cell.approve_leadership`. One workflow, one pair, and the names then describe what
they guard. A second pair would put two more names on a list Section 7 declares
closed, to express a distinction the workflow does not make.

The precedent is this project's own: `leader_id` became `pastoral_leader_id` on the
reasoning that the only moment to fix a name is before a client depends on one.
Nothing depends on these — they guard no endpoint, and the only grants are role
defaults — so the rename is free today and impossible later. The enum values are
edited in `0001` under the 2026-08-21 exception, as the twenty-seventh capability was.
Migrations `0005` and `0006` name `cell.approve_creation` in **comments** and are
merged, so those comments now name something that does not exist; they stand, because
only `0001` may be corrected in place.

The same is true of this log. Five earlier entries name the old capabilities, and none
is rewritten: an entry records what was decided at the time, and rewriting one would
make the log agree with the present at the cost of no longer recording the past. A
reader meeting `cell.request_creation` in an entry dated before today is reading
history, not a live identifier.

**The guard resolves against the incoming leader; the Cell is a domain check.** A
creation has one object and a handover has two, and they need not share a branch,
since Cell membership does not mirror pastoral assignment. The prospective leader is
what the scope is about, because that is the decision being made, so the guard resolves
against them exactly as for a creation. The Cell carries its own rule — the actor
must have it within their authorized scope, on the same terms that govern closing it
— without which an unrelated upline could give away a Cell in a branch they have
nothing to do with. Section 7 already settles the shape: the guard checks one target,
and a rule about a second object is a check in the owning module.

**Two uniqueness rules, one per kind.** At most one `PENDING` `NEW_CELL` per
prospective leader, because two of those are indistinguishable downstream — the
original reason, which is about a leader legitimately leading many Cells. And at most
one `PENDING` `HANDOVER` per **Cell**, because two of those are contradictory rather
than indistinguishable: both may be approved, and the second silently ends the
leadership the first opened.

The withdrawn draft widened the first rule across both kinds, on a reason that does
not carry to a handover — which names its Cell and is therefore distinguishable —
and left the second absent altogether. Widening it also blocks a legitimate case: a
pending new Cell for a person and a pending handover of a different Cell to the same
person are different questions, and `DUPLICATE_REQUEST` exists in the decline list
precisely so a person adjudicates a case like that rather than an index refusing it.

**A closure is never reversed, including one recorded in error.** Section 10 offered
the reversal as "an Admin correction" and said nothing about the three rows a closure
ends. It is withdrawn: a Cell closed by mistake is corrected the way a ministry that
restarts is served, by creating a new Cell.

This is the only one of three answers needing no exception to a rule stated elsewhere.
**Reopening the ended rows** conflicts with Section 5, which never overwrites a row in
place, and moves months already reported — a Cell closed through March and April had
no meetings and no members, and un-ending its schedule and membership rows gives those
months a denominator, against Section 3's reproducibility guarantee. **Opening new rows
at the reversal date** is honest about the closed period and forces a third case into
a schedule rule settled two days ago to keep a month holding exactly one schedule.

The cost is real and is written into Section 10 rather than discovered: a Cell closed
by mistake keeps its closed record, and its history splits across two Cell IDs. That
is tolerable because Section 10 already accepts that a Cell ID is never reused, that
gaps are expected, and that the ID encodes nothing — and because closure is not an
easy accident, needing a capability, a reason from a fixed list, and an explicit
recorded decision about every member.

Recorded also because the alternative was tempting for the wrong reason. Reopening is
what a person expects of an undo, and the merge ruling of 2026-08-19 is a genuine
precedent for a correction that lowers past-period totals. What separates them is that
a merge corrects a count that was *always wrong* — one person recorded twice —
while a reopened Cell would rewrite months that were correctly reported as closed at
the time. The first is a defect correction; the second is a history rewrite.

**With both settled, Section 11's rule has no third path.** An `ACTIVE` Cell holds
exactly one leadership assignment, and the only writes to `cell_leaderships` are a
creation's approval, a handover's approval, a closure, and the direct creation of the
initial-encoding phase. `cell.manage_leadership` is what each of them exercises, which
is what Section 7 now says it governs — it had sat in the closed list since Stage 1
with nothing defining it.

---

Decision 0133, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-28 — Three rulings before Stage 3, and a fourth withdrawn](0132-three-rulings-before-stage-3-and-a-fourth-withdrawn.md) | Next: [2026-08-28 — The Cell schema, and a test that agreed with itself on one machine only](0134-the-cell-schema-and-a-test-that-agreed-with-itself-on-one.md)
