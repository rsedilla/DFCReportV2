# 2026-08-21 — `account_roles` gains `senior_pastor_slot`

Two slots; a holder occupies one; a partial unique index over the slot permits no second occupant. Revoking a row frees its slot, which is how a succession happens. The number is a seat, not a rank, and it orders nothing.

This replaces a constraint trigger that counted active rows. The count was made race-free with an advisory lock and was still the weaker design, because `pg_restore --disable-triggers` skips a constraint trigger and does not skip a unique index — so a restore could load a third Senior Pastor in silence, at exactly the moment nobody is watching.

The reason first recorded for refusing the column, that §7's shape has no slot, was the wrong test. A shape is amended when a rule needs a column, deliberately and in the same change, which is what this is. Written to `SKILL.md` §7.

---

Decision 0077, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-21 — Simultaneous presentation of a refresh token is not reuse](0076-simultaneous-presentation-of-a-refresh-token-is-not-reuse.md) | Next: [2026-08-21 — A row of an effective-dated table is never deleted](0078-a-row-of-an-effective-dated-table-is-never-deleted.md)
