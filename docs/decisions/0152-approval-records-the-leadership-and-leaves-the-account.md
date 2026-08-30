# 2026-08-30 — Approval records the leadership and leaves the account pending


Settled before the approval endpoint is written, which is the pattern the rest of Stage 3
went well on. Found by reading Sections 10, 6 and 3 whole rather than at a keyboard: the
rule as written could not be implemented at all.

**Section 10 said approval performs the account step "in a single transaction", and
nothing on that path carries what the step needs.** Section 6's first requirement for a
new Cell Leader is "Require email", and it never says who supplies one. Section 3 keeps
email off the Person deliberately — it is a login credential rather than an attribute, and
were it editable under `people.edit_basic` a leader could repoint a downline leader's
address and take over the account through a password reset. A request records none either;
`cell_leadership_requests` has no such column. So the address can only arrive from the
actor, and the approval path has nowhere for it to arrive.

**Approval therefore records the Cell and the leadership and leaves the account step
pending**, writing the audit entry Section 21 already names for that state, with
`POST /api/v1/accounts` provisioning afterwards.

The reason is Section 6's own, and it is stated there in terms: "an actor authorized only
to assign Cell leadership may record the leadership assignment, but must not thereby cause
an account to be created or an activation email to be sent. The account step is left
pending for an authorized actor and is separately audit logged." Section 10 was describing
a step Section 6 already contemplates deferring.

Two further reasons, neither of which is the arithmetic of who holds which capability.
Provisioning is where the dual-authorization rule, the Senior Pastor seat and the
duplicate-address refusal live, and one place that gets those right is better than two —
this also makes direct creation and approval behave identically, since the initial-encoding
path already leaves the account pending. And **an activation email cannot be sent inside a
transaction**: folding the step in puts a delivery failure behind a committed Cell, which
is the shape this repository has already shipped once, where an endpoint committed its
idempotency completion and then failed on a send, handing the client an error while the
store held the success every retry replayed.

Two alternatives were weighed and refused.

**The approval body carrying the email** is the only option that honours Section 10 as
written and is one action for Admin. It was refused because a duplicate address would roll
back the whole Cell creation, because the send still could not be inside the transaction
so the "single transaction" is not literal either way, and because it has Admin supplying
an address for somebody they may never have met.

**The request capturing the email at submission** is better on that last point — the
requester is the upline, who knows the disciple. It was refused on what it stores: a
person's email address on a `PENDING` row that may be declined, and a declined request is
retained permanently as the record of how a leader was developed (Section 10). It also
needs a column on a merged migration, and the address can be stale by the time approval
happens.

**The cost is accepted in writing rather than discovered.** Approving a new Cell and
provisioning its leader's account are two actions rather than one, and Section 19 justifies
the Admin queue partly on a pending request "holding up an account" — under this ruling
approval moves that block rather than clearing it. What stops it being silent is the audit
entry, which is why Section 21 has one; a dashboard tile surfacing Cell Leaders without
accounts is the natural follow-on and is not built here.

Written to `SKILL.md` Section 10 (*Creating a Cell*), and verified by grepping that section
for the rule rather than by asserting it here.

---

Decision 0152, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — Four on the second fix batch, and a pin that pinned nothing](0151-four-on-the-second-fix-batch-and-a-pin-that-pinned-nothing.md) | Next: [2026-08-30 — Three rulings the approval endpoint needed, and a condition nothing could evaluate](0153-three-rulings-the-approval-endpoint-needed-and-a-condition.md)
