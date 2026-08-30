# 2026-08-20 — API conventions

Settled in `SKILL.md` §22: JSON only, ISO 8601 with Asia/Manila date-only fields, cursor pagination with no total counts, one error envelope with stable machine-readable codes, `CAPABILITY_DENIED` distinct from `SCOPE_DENIED`, a `VERSION_CONFLICT` body carrying both values and both actors as §14 requires, an `Idempotency-Key` header on every write, explicit named filters with `sort`/`-sort`, and additive-only changes within `v1`.

Fixed before implementation because three clients consume the API concurrently and mobile builds cannot be force-updated, so a convention invented per-controller becomes permanent the moment a phone depends on it.

---

Decision 0032, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Cell attendance records members only](0031-cell-attendance-records-members-only.md) | Next: [2026-08-20 — Cell schedule is effective-dated](0033-cell-schedule-is-effective-dated.md)
