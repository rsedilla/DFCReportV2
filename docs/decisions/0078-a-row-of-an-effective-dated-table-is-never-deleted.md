# 2026-08-21 — A row of an effective-dated table is never deleted

**Partly superseded** the following day by "Seven Stage 2 rulings" below. The closing sentence, that whether `refresh_tokens` and `account_tokens` may be pruned is open, was settled: they may be, thirty days past expiry, and a trigger now enforces the floor. The exclusion itself stands and so does everything else here.
`person_lifecycle`, `network_assignments`, `pastoral_assignments`, and every table that follows their shape. A row entered in error is corrected by closing it and opening the right one, which is what effective dating is for. Enforced by a `BEFORE DELETE` trigger on each, not by convention.

Principle 12 said history is preserved and §5 said a row is never overwritten in place; neither addressed `DELETE`, and the schema permitted it. That made it the one write passing none of the same-Network checks, since both triggers fire on insert and update: removing a person's current Network row turns every open edge beneath them cross-Network, with nothing raised and nothing to revisit it.

It reaches `account_roles` and `capability_grants` too. §7 says a grant is revoked by setting `revoked_at` and never by deleting the row, because the history of who could do what, and when, is part of the audit record — so the rule was already stated for them and only the enforcement was missing.

`refresh_tokens` and `account_tokens` are excluded: they carry operational state rather than history, and whether they may be pruned is recorded as open rather than assumed either way.

`TRUNCATE` fires no row trigger and stays available, because it is how the test suite resets. What is meant to keep it safe is privilege rather than the trigger — §24's least-privilege credentials — and that role does not exist yet, so the exemption is currently unprotected. Recorded as open rather than claimed. Written to `SKILL.md` §5.

---

Decision 0078 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-21 — `account_roles` gains `senior_pastor_slot`](0077-accountroles-gains-seniorpastorslot.md) | Next: [2026-08-22 — A sign-in landing inside a revocation's transaction survives it](0079-a-sign-in-landing-inside-a-revocations-transaction-survives.md)
