# 2026-08-21 — Twelve findings from the Stage 1 verification, and why they existed

`architecture-guardian` reviewed the Stage 1 branch **once, before its fixes**, and the branch was merged without re-running it on the eight fixes that review produced. A later pull request established that a fix batch introduces defects about as often as new writing does; a verification pass over merged `main` found twelve, four of them from that unreviewed batch.

The lesson is procedural and is now written into Branches and pull requests above: **the review runs again on what the review produced.** Arriving at human review with findings addressed is the point; merging the addressing itself unreviewed gives that up.

The four that were live defects:

**A counting trigger is not a constraint.** The `SENIOR_PASTOR` cap counted active rows in a deferred trigger, and under READ COMMITTED neither of two concurrent transactions sees the other's uncommitted row — both count two, both commit, three Senior Pastors. This is the failure authorization case 7 exists to warn about, written while citing it. Fixed first with a transaction-scoped advisory lock, and then replaced by the slot column and its unique index (ruling below), which needs no lock and survives a restore.

The reason first recorded for rejecting a `senior_pastor_slot` column — that §7 gives `account_roles` its shape and that shape has no slot — does not survive scrutiny. `refresh_tokens.replaced_by_id` was the counter-example, a column §6's shape did not list, added because a rule required it; that was drift rather than licence, and §6 now carries it. The point stands without the precedent: a shape is amended when a rule needs a column, deliberately and in the same change. The honest position is that the slot with a partial unique index is the **stronger** design, because a unique index is enforced under `pg_restore --disable-triggers` where a constraint trigger is skipped entirely. The lock closed the race; it did not close the restore path. The slot was adopted the same day — see the ruling below — and the trigger is gone.

**Refresh-token rotation was not atomic.** Issue-then-revoke, in two statements, with the revoke's row count discarded — so two requests presenting one token could both mint a replacement while only one revoke landed, and the reuse signal §6 requires was never raised for the loser. Rotation now claims the presented token conditionally inside a transaction and treats a lost claim as reuse.

**Authorization case 3 asserted a fact the tree no longer contained.** Inserting Ben to give case 4 a non-root upline left case 3 asserting Raymond's leader was Oriel. Masked while every case dies on a 404, and it would have blocked Stage 2's own exit criterion the moment the endpoint returned 403 — with the obvious temptation to weaken the assertion rather than fix it.

**The migration guard had a silent off switch.** A file carrying a plain `-- migrate:down` line above the `refuse-if-populated` directive matched the plain one first and disabled the guard, with no error. The directive is now parsed on its own and its placement is checked. Its table list also named five of the nine tables the down drops, omitting the grant history §7 calls audit material.

Also closed: an `-- migrate:irreversible` marker above the up marker recorded an empty migration as applied; the CI job for the eleven concluded success whatever happened, so "failing for the right reason" was asserted and never checked; and two rules — `granted_by` on a role, and `read_only` null for role authority — had no test holding them.

---

Decision 0074 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-21 — WCAG 2.2 Level AA, with something that can fail](0073-wcag-2-2-level-aa-with-something-that-can-fail.md) | Next: [2026-08-21 — Migration 0001 may be corrected in place until first deployment](0075-migration-0001-may-be-corrected-in-place-until-first.md)
