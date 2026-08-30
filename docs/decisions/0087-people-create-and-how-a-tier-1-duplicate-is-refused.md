# 2026-08-22 — `people.create`, and how a Tier 1 duplicate is refused


Two rulings the `people` module could not be written without, both the same shape
as `people.correct_sex`: §7 declares its capability list closed, and had nothing
for either.

**`people.create`, the twenty-sixth capability.** Leader at own/subtree, Admin and
Senior Pastors at Whole Church — the scopes `people.edit_basic` carries, because
§9 has ordinary leaders registering VIPs and that workflow creates most Person
records. Routing them through Admin would stall it.

Scope resolves against **the pastoral leader the new Person is placed under**,
which §9 step 3 already requires the request to carry. That is what stops a leader
placing someone into a branch they do not oversee, and it settles the case a
subtree-scoped actor cannot reach: creating a Person under nobody. §5 permits an
unassigned Person, but only the import creates one, and the import runs as Admin
through the service rather than through this endpoint.

Folding creation into `people.edit_basic` was rejected: §7 defines that capability
as covering "corrections to a person's own descriptive fields", and the name would
stop describing what it grants.

**`DUPLICATE_ACKNOWLEDGEMENT_REQUIRED`, 409, carrying the candidates.** §3 requires
a Tier 1 candidate to be acknowledged before a Person is created, and also says
the system never blocks creation — so this is not a refusal, it is the request for
that acknowledgement. The client shows the candidates and resubmits with them
acknowledged.

Deliberately not `VALIDATION_FAILED`. The input is well-formed and the answer is a
human decision; a client branching on a validation code would render a duplicate
as a field error. That is the argument §22 already makes for
`IDEMPOTENCY_KEY_REUSED` not being one.

Written to `SKILL.md` §7 and §22.

---

Decision 0087 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — A write endpoint records its idempotency completion in its own transaction](0086-a-write-endpoint-records-its-idempotency-completion-in-its.md) | Next: [2026-08-22 — Three rulings the `people` module needed, all found by review](0088-three-rulings-the-people-module-needed-all-found-by-review.md)
