# 2026-08-20 — `read_only` is valid only on a read capability

Five capabilities are reads: the four `view_subtree` variants and `audit.view`. The other nineteen are writes — *twenty since `people.correct_sex` was added on 2026-08-22; the rule is the split, not the count* — and a grant of one with `read_only` true is rejected at creation rather than stored and silently ineffective — otherwise an Admin who leaves the flag at its default creates a row that grants nothing, with nothing to explain the denial. Written to `SKILL.md` §7.

---

Decision 0063 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — The guard checks one target; the rest is domain layer](0062-the-guard-checks-one-target-the-rest-is-domain-layer.md) | Next: [2026-08-20 — Migrations are hand-written SQL, and there is no ORM](0064-migrations-are-hand-written-sql-and-there-is-no-orm.md)
