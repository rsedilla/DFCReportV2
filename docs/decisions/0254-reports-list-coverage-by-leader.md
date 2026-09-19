# 2026-09-18 — Reports lists coverage by leader, and each row counts that leader's own obligations

The owner's Claude Design handoff draws a "Recording coverage by leader" table in Reports, whose
rows give each leader what they are "responsible for" and what they filed. A drill-down that
broke a report's total into subtrees was specified instead, on 2026-09-17 and 2026-09-18, and
review found it did not add up once somebody was reassigned within the period. The owner rolled
it back and decided again with the design beside each choice. This records what was decided.

## The ruling

**1. A report may list its coverage by leader.** The list holds every leader who owns an
obligation within the report's scope and period — the reader first where they own one, then the
rest by name.

**2. Each row counts that leader's own obligations and no one else's.** For DCC that is the
leader-events decision 0224 counts; for a Cell it is the scheduled meetings decision 0239 counts,
each owned by the leader who led the Cell on its date (Section 20). An obligation has one owner,
so the rows add up to the report's coverage. The exception is a scheduled meeting whose Cell had
no leader that day, which `CLAUDE.md` already records as open and unreachable.

**3. Figures are plain and nothing is ranked or coloured** (Section 13). A row opens that
leader's report, which counts their whole branch and so can show a larger
figure than the row.

**4. A row is named exactly when the guard would admit that leader as a `LEADER` scope selector**
at the period's final millisecond (decision 0214). That is decided outside the report's snapshot,
because Section 24 forbids measuring reach against the snapshot a report is computed from. A
leader who owns obligations in the scope and is not admitted is counted in one line that names
nobody, does not open, and is not shown when it counts nobody.

## Why

Rows that count a subtree move when somebody is reassigned, so one obligation can fall in two
rows or in none. Rows that count owners do not move: an obligation's owner is fixed on the date
it was owed.

---

Decision 0254, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-17 — A report scope selector naming nobody answers `NOT_FOUND`, and scope is checked first](0253-a-scope-selector-naming-nobody-answers-not-found.md)
