# 2026-08-20 — Backups are daily, not weekly

Daily minimum, 30 days retention, point-in-time recovery where the host supports it, and a restore tested before go-live and annually after.

Weekly was considered and rejected: attendance exists nowhere else, so a week of loss is one DCC Sunday and around a hundred and forty Cell meetings that nobody can reconstruct, and corruption is typically noticed weeks after it happens. The database is small enough that daily costs almost nothing. Written to `SKILL.md` §24.

---

Decision 0039, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Closed months may be materialized](0038-closed-months-may-be-materialized.md) | Next: [2026-08-20 — Two capabilities were referenced but never named](0040-two-capabilities-were-referenced-but-never-named.md)
