# 2026-08-22 — Four enforcement gaps found reviewing the Stage 2 rulings


Grouped because each is the same shape as the two ruling defects above: a rule
stated in prose with nothing able to fail on it.

**The §6 retention floor is a trigger, not a convention.** `refresh_tokens` and
`account_tokens` gain a `BEFORE DELETE` trigger refusing any row whose
`expires_at` is not yet thirty days past. The ruling permitting the prune is a
security control — the obvious retention query, `DELETE ... WHERE expires_at <
now()`, deletes exactly the rows still carrying the reuse signal — and the
Definition of Done requires an invariant expressible as a constraint to exist as
one. It lands in 0002 as additive DDL on 0001's tables.

**`audit_log.target_id` is `text NOT NULL`, not `uuid`.** §21 lists "System
setting changed" as auditable and §7 keys `settings` by `key`, so a `uuid`
column left the one auditable action migration 0002 introduces unable to name
its target, and §7's rule that an audit entry resolves scope through its target
with nothing to resolve. No foreign key: an append-only entry outlives the row
it describes. §21's shape is amended in the same change.

**`settings.updated_by` is nullable, and §7 now says so.** It is null for the
system action that seeds the defaults, mirroring `account_roles.granted_by`.
The 2026-08-21 slot ruling settled that a shape is amended when a rule needs a
column, deliberately and in the same change; leaving the migration more
permissive than the shape is the same drift by the other route.

**The idempotency key is unique per account, and that is in §22 rather than in
a migration comment.** Two accounts may present the same key. It is
client-generated and therefore not a secret, so global uniqueness would let a
client that reused an observed key receive another account's stored response,
or deny that person their own retry. `IDEMPOTENCY_KEY_REUSED` means "already
used by this account for a different request".

Also corrected: `error` was added to the web palette's forbidden token names,
which §23 rejects by name but the check could not fail on; the 2026-08-21
no-delete ruling is annotated as partly superseded by the pruning ruling; and
`migrate:down --all` no longer claims a guard "stops the whole descent", since
each migration's down commits in its own transaction and a guard firing at N
does not undo the drops already made for N+1.

---

Decision 0081 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — Seven Stage 2 rulings, settled before any Stage 2 code](0080-seven-stage-2-rulings-settled-before-any-stage-2-code.md) | Next: [2026-08-22 — A Network change is refused while the person leads anyone](0082-a-network-change-is-refused-while-the-person-leads-anyone.md)
