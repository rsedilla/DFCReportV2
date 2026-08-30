# 2026-08-30 — Three small settlements from building step one of the request workflow


None of these needed a Stop Condition, and each was a place where the specification said
something in prose that had to become a capability, a check or an identifier — the
conversion this project keeps finding is where rules quietly change shape.

**The Cell check on a handover resolves `cell.manage_lifecycle`, and section 10 now says
so.** Section 10 required the actor to hold the Cell "within their authorized scope, on
the same terms that govern closing it", and named the resulting set of actors in prose
rather than naming a capability. Converting that sentence is not free: the obvious reading
is to reuse the capability the guard just used, and that one is `SUBTREE_EXCL_SELF`.

The commonest handover there is has the actor **as** the Cell's current leader — a leader
stepping down and naming their own disciple — so a self-excluding scope resolved against
the Cell's leader refuses precisely the case the workflow exists for. `cell.manage_lifecycle`
is `OWN_SUBTREE` and includes the actor, which is what makes section 10's own list fall out
of the scope rather than being restated in code.

The narrow cost is written into section 10 rather than left in a docblock: an actor granted
`cell.request_leadership` and not `cell.manage_lifecycle` cannot request a handover. No role
is in that position by default, and the outcome reads correctly anyway — somebody who could
not close a Cell also cannot give it away.

**Nothing about the prospective leader is revalidated at request, and the cost of that is a
slot.** Section 10 puts revalidation at approval — "the state at approval governs, never the
state at request" — so a request naming somebody since archived is refused there, creating
nothing. Adding a request-time refusal would be a rule section 10 does not state, and it
would be the wrong one: a `PENDING` request is not a live relationship, so section 3's bar on
an archived Person acquiring one is not engaged.

What that costs is real and is now recorded where somebody will meet it. A `PENDING`
`NEW_CELL` request occupies its prospective leader's slot under the per-leader unique index,
so one that can never be approved blocks every later request for that person until it is
declined. Declining is cheap and is the remedy; what it needs is for somebody to *see* the
stale row. That is the argument for section 19's queue being part of this slice rather than
deferred with approval — a stale request nobody can see is a slot nobody frees.

**Section 21's first request action was reworded rather than transliterated.** It read "Cell
leadership requested, with the kind", beside "Cell leadership request approved" and "Cell
leadership request declined" — one workflow's three actions under two nouns. Read literally
it gives `cell_leadership.requested`, and a reader asking how a leader was developed, which
is exactly what section 10 calls the retained decline record, would need to know both nouns
to find the whole story.

The convention is `<noun>.<past-tense verb>` and the noun is the thing the action happened
to: a request is submitted, approved and declined, whereas no leadership exists yet to be
"requested" and none at all is touched by a decline. Section 21's list opens with
"including", so this is a wording amendment rather than a rule change.

**The amendment is the point rather than the naming.** The alternative was to keep the
literal wording in the specification and explain the deviation in a code comment — which is
the shape this log records going wrong repeatedly: the specification and the code disagree,
and only the code says why. `cell_leadership_request.submitted` and `..._declined` exist;
`approved` is deliberately absent until the endpoint that emits it does, because a member of
a closed union that nothing writes is what was already removed once from
`PRECONDITION_CODES`.

Written to `SKILL.md` sections 10 and 21, and verified by grepping each section for the rule
rather than by asserting it here.

---

Decision 0148 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — A requester may decline their own request, and a decision is final](0147-a-requester-may-decline-their-own-request-and-a-decision-is.md) | Next: [2026-08-30 — Section 10's "at any scope" was resting on a scope value](0149-section-10s-at-any-scope-was-resting-on-a-scope-value.md)
