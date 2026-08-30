# 2026-08-30 — A requester may decline their own request, and a decision is final


The two questions migration 0009 escalated in its own comments rather than answering,
settled together before the leadership-request endpoints are written — which is the
pattern that made the rest of Stage 3 go well: five rulings before a line of Cells code.

**A requester may decline their own request.** Section 10 forbids *approving* one you
submitted and is silent on declining, and the silence had to be resolved in one direction
or the other before the decline endpoint could exist.

The reason for the approval prohibition does not carry. The requester benefits from an
approval — it moves Current Cell Leaders, New Cell Leaders for the period, and their own
progress toward Leaders with 12+ Direct Leaders — which is exactly why section 10 requires
a second party for it. A decline benefits them not at all, so there is no incentive for the
rule to guard against, and `SUBMITTED_IN_ERROR` sits in the fixed list for precisely this
case.

**The strict reading was rejected because it is terminal rather than merely stricter.**
`cell.approve_leadership` is Admin's alone, so on a single-Admin deployment a request that
Admin submitted could be approved by nobody — correctly — and declined by nobody either.
It stays `PENDING` for ever, and `cell_leadership_requests_one_pending_new_cell` then
blocks every future `NEW_CELL` request for that prospective leader, permanently. The fixed
list contains the remedy for that situation and the strict reading made it unreachable for
the actor most likely to need it.

A third option was weighed and refused: permitting self-decline only with
`SUBMITTED_IN_ERROR`, so that withdrawing a request is distinguished from adjudicating one.
It is more precise and it adds a rule section 10 does not have, to guard an incentive that
does not exist — and section 10 already says a decline "never records an assessment of the
person", which is the ground the distinction would have rested on.

Declining still carries `cell.approve_leadership`, so this reaches an Admin who submitted a
request and nobody else. It changes nothing about who may approve, and migration 0009's
`..._approver_is_not_requester` constraint — which deliberately enforces section 10's
stated rule and nothing more — is already correct and unchanged.

**A decision is final.** A `DECLINED` request is never later approved, an `APPROVED` one is
never reversed, and neither returns to `PENDING`. This confirms the conservative direction
migration 0009's finality trigger already took, on the 2026-08-24 reasoning about an
explicit null birthday: a relaxation must not become a capability by omission. What changes
is that it is now a decision rather than a gap nobody had ruled on.

The way forward from a decline is a new request. That keeps the declined row as what
section 10 already requires — the record of how a leader was developed — and keeps
`decided_by` and `decided_at` answering who decided and when, which a re-decision would
overwrite. A `TIMING_DEFERRED` decline followed by a fresh request is the honest record:
two requests, two dates, one outcome each.

**Reversing an approval is a different operation, and naming it as such is the half worth
recording.** A Cell created in error is closed with `CREATED_IN_ERROR`, and a handover
completed in error is corrected by handing the Cell back — each an ordinary authorized
action carrying its own audit entry, rather than a decision rewritten in place. That is the
same shape as the 2026-08-28 ruling that a closure is never reversed, and for the same
reason: the correction is a new fact, not an erased one.

Both written to `SKILL.md` section 10 (*Declining*) in the same change, and verified by
grep rather than asserted.

---

Decision 0147 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Five on the sixth fix batch, all of them what the batch said about itself](0146-five-on-the-sixth-fix-batch-all-of-them-what-the-batch-said.md) | Next: [2026-08-30 — Three small settlements from building step one of the request workflow](0148-three-small-settlements-from-building-step-one-of-the.md)
