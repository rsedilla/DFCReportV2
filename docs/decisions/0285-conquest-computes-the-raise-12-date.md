# 2026-09-24 — Conquest computes the Raise 12 leaders date

Raise 12 leaders is reached when twelve of a person's direct disciples each qualify as a
leader (Section 11). Its date, like Win 3's (decision 0284), depends on two modules' tables
together: the discipling edges in `hierarchy` and the Cell leaderships in `cells`.

The owner chose this answer from a drawing of the options.

## The ruling

**`conquest` computes it, as it computes Win 3's.** `cells` returns the periods in which
each person was a current Cell Leader, and `conquest` finds the earliest instant at which
edges to twelve different disciples are in force, each disciple inside such a period at that
instant. Nothing is stored.

## Why

One rule for both dated goals. Having `cells` compute it would put a Conquest rule in
`cells`, the reason the same option was not taken for Win 3.

Whether a leadership of a Cell later closed `CREATED_IN_ERROR` counts toward it is not
settled here.

---

Decision 0285, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-24 — Conquest computes the Win 3 date](0284-conquest-computes-the-win-3-date.md)
