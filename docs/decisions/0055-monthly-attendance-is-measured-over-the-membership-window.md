# 2026-08-20 — Monthly attendance is measured over the membership window

**Superseded** by "Cell monthly attendance reports on members" below. The membership window was found to reintroduce the unbucketed person it was written to remove, and to give members of one Cell different denominators, leaving the Cell's report with no single bucket axis.
A person is reported under the Cell they belonged to most recently during the month, and their denominator is that Cell's recorded meetings that fell within their membership of it.

This replaces the earlier month-end rule, which had no answer for a person who left a Cell and joined none — permitted when a Cell closes — leaving them with a classification but no bucket, so the two views stopped reconciling. Bounding by membership also fixes the mid-month joiner, who was previously measured against meetings held before they joined and whose roster they were absent from, making `Completed` unreachable. Written to `SKILL.md` §10.

---

Decision 0055, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — A calendar week begins on Monday](0054-a-calendar-week-begins-on-monday.md) | Next: [2026-08-20 — Cell monthly attendance reports on members](0056-cell-monthly-attendance-reports-on-members.md)
