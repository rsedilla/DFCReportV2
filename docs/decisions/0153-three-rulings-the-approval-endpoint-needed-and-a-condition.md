# 2026-08-30 — Three rulings the approval endpoint needed, and a condition nothing could evaluate


Settled before a line of approval code, by reading Sections 10, 11, 7, 21 and 22 whole —
the pattern the rest of Stage 3 went well on, and the pattern that produced the withdrawal
of 2026-08-28 when it was skipped. Section 10 specifies approval closely enough to build and
leaves three things an endpoint cannot avoid answering. One of them is a condition the
section states and no implementation can evaluate.

**"Had their Network changed" is caught by the subtree condition, and the fourth condition
is withdrawn.** Section 10's revalidation list named it beside "archived", "absorbed by a
Merge" and "moved outside the requester's authorized subtree" — and nothing records the
prospective leader's Network when the request is made. `cell_leadership_requests` carries no
such column, so the condition had no baseline and could not be evaluated at all. It is the
same shape as the closure floor: a rule stated in prose that the schema cannot answer.

It needs no baseline. A Network change forces a pastoral reassignment into the new Network
at the same instant (Section 4), and `assert_assignment_same_network` makes a cross-Network
pastoral edge impossible (Section 5) — so every ancestor of the moved person is in the other
Network, the requester is not among them, and the subtree condition fires. The refusal then
names the thing that actually changed: the pastoral relationship the request rested on.

**The residual is one scope value, and the first version of this entry called it "a
wider grant".** That was wrong and the review caught it. Every role holds
`cell.request_leadership` at `SUBTREE_EXCL_SELF`, so the ordinary case is covered entirely;
of the wider values an Admin-issued grant may carry, a `NETWORK` grant catches a Network
change *more* directly than the subtree condition does, because `scopeCovers` compares the
person's current Network against the granted one. Only `WHOLE_CHURCH` misses it, returning
true on its first line before the target is read.

Section 10 itself calls a Network grant wider, eighty lines above the sentence that had said
wider grants miss this — so the claim was refutable from the section it was being written
into. Nothing is corrupted where it does miss: a new Cell inherits its leader's Network as it
stands at approval, and a handover is refused by the leader-to-leader check. What survives is
a stale request nobody is told about, which is a pastoral cost.

That the wider grant is possible at all is the open item this log already carries: whether
Section 7 should refuse a grant of `cell.request_leadership` wider than `SUBTREE_EXCL_SELF`.
This ruling does not settle it and does not depend on it either way.

Recording the Network on the request was the alternative and was rejected: a column, a
migration and a rule, bought to detect a state the tree already reports and whose only
undetected form is harmless.

**Both revalidations are asked of the requester, and asked whole.** Each is the question the
request step itself asked — `cell.request_leadership` over the prospective leader,
`cell.manage_lifecycle` over the Cell — put to the account in `requested_by` rather than to
the approver. Section 10 already required that for the Cell and gave the reason; this states
it for both and settles what the predicate is.

**One refusal, and which half moved is deliberately not distinguished.** Re-evaluating the
whole of the requester's authority answers no where the person or the Cell moved out of
reach, and equally where the requester has since lost the capability or the role carrying it.
Those are different facts and they get one answer. That is "the state at approval governs"
applied without qualification, and it takes the conservative direction where Section 10 would
otherwise be silent — the 2026-08-24 reasoning on an explicit null birthday, that a
relaxation must not become a capability by omission.

*The first version of this entry, and the Section 10 sentence it was written into, both said
the predicate also answers no where the requester's account has been **disabled**. That is
false, and it was false when committed.* `activeRoles` and `effective` join `accounts` and
filter on neither `status` nor anything derived from it, so a disabled account keeps every
role and grant it held; Section 6 makes disablement an authentication decision, which stops
the holder signing in rather than emptying their authority. The claim was checked against the
service before any approval code was written and corrected in the next commit — which is
the only reason it is a correction rather than the seventh false "written to Section x" claim
in this log. Section 10 now states the limit rather than the opposite: account status is not
consulted, and an approval is not evidence that the requester could still act today.

Whether it *should* be consulted is deliberately not opened. It is a rule about what a grant
means, so it belongs to Section 7 and to all twenty-seven capabilities at once rather than to
this endpoint, and inventing it here would be the shape this log keeps recording — a rule
adopted from a neighbouring sentence by its shape rather than by re-deriving why it has
it.

**The strict reading is safe here and was terminal for declining**, which is the distinction
worth keeping. The 2026-08-30 ruling on self-decline refused a strict reading because a
single-Admin deployment would have left a request approvable by nobody and declinable by
nobody, `PENDING` for ever, with the per-leader index blocking every later request for that
person. Nothing here strands: declining stays available on every pending request, so a
request whose requester has left is declined `SUBMITTED_IN_ERROR` and submitted afresh by
whoever now holds the relationship. It answers `SCOPE_DENIED`, which Section 22 reserves for
a statement about an actor's authority over a target.

It costs one accessor. `cells` cannot read `accounts` (Section 2), so resolving the
requester's Person to build the `Actor` that `scopeCovers` needs is a small addition on
`AuthorizationService`, which owns that table. `coversWith` thereby acquires its first caller
asking a counterfactual about somebody other than the acting account; its guard that the
authority and the actor name one account is unaffected, because both name the requester.

**The account-pending audit entry is written on every approval of either kind,
unconditionally.** Section 10 said a handover to somebody who already leads a Cell leaves
"nothing pending at all", which reads as a condition on the entry, and that sentence is
amended.

Leading a Cell and holding an account are not the same fact, and the state where they part
company is the one the entry exists for. Direct creation during initial encoding and every
earlier approval both produce a current Cell Leader with the account step still pending
(Section 6, Section 7), so conditioning on Cell leadership suppresses the entry in precisely
the case where an account is genuinely owed.

**The honest test is one this module may not perform, and the module graph is what decides
it.** Whether an Account exists for that Person is an `auth` fact. `auth` imports `cells` so
that provisioning can ask whether a Person is a current Cell Leader (Section 6), and asking
back would close the cycle the 2026-08-24 seam ruling removed. So the choice was never
between three options; it was between over-recording and under-recording, and a spurious
entry is resolved by looking while a missing one leaves the only trace of a pending account
nowhere at all. It also matches what `CellsService.createDirectly` already writes.

**`/approve` rather than `/approval`.** The merged sibling is `POST .../decline`, and a pair
that reads `/approval` and `/decline` is one word of inconsistency on an API Section 22 makes
additive-only — the moment before a client depends on a name is the only moment to fix it,
which is the argument that renamed `leader_id` to `pastoral_leader_id`. `/closure` is a noun
because a closure is a record the Cell carries; approving and declining are decisions on the
request row, which carries its own state and mints no record of its own.

**Section 22's route list gained all four leadership-request routes**, which the request
slice built and did not document. That is not this ruling's subject and is fixed with it,
on the precedent of 2026-08-23: a pre-existing gap of the class a branch is about is closed
by that branch, because leaving it means the next reader checks the citation and finds it
still missing.

Written to `SKILL.md` Section 10 (*Creating a Cell*) and Section 22, and verified by grepping
both for each rule rather than by asserting it here.

---

Decision 0153 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — Approval records the leadership and leaves the account pending](0152-approval-records-the-leadership-and-leaves-the-account.md) | Next: [2026-08-30 — A Network change is refused while the person leads a Cell](0154-a-network-change-is-refused-while-the-person-leads-a-cell.md)
