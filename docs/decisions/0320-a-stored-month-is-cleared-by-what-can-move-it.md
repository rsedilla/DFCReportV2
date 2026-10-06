# 2026-10-06 — A stored month is cleared by what can move it

Section 20 lets a closed month's reports be stored (decision 0038) and asks each stored
figure to carry a version that changes whenever its source records change. It offered one
church-wide counter. Under that counter every Sunday recorded in the open month would make
every stored closed month stale, and each would be computed again on its next read all week,
which is when the database is busiest. The owner chose the narrower rule below, then chose
the database over asking each module, and then chose to state the guarantee rather than the
mechanism, each from a plain-words comparison.

## The ruling

**1. What is stored is `GET /api/v1/reports/dcc/monthly` and
`GET /api/v1/reports/cells/monthly` for a closed month**, not their by-leader lists. A
report on an open month is computed every time. Another report kind is stored only by a
ruling that names what it reads as it stands now.

**2. Each stored month has its own version, in `report_month_versions`, and a change moves
the version of its month and of every later stored month.** Later months move too because a
DCC stage counts attendance up to the month's end (section 12), so a change in March is a
change to April's classification. This widens decision 0038's "that month".

**3. The month is an Asia/Manila month, read from the change:**
- an attendance record, a Cell meeting or its change: the month it reports in;
- a DCC event added or removed: the month of its Sunday;
- an effective-dated row: the month of the earliest instant the write moves, old value or
  new.

A Person Merge moves every month (section 3).

**4. Two guarantees, each with a test that fails if it stops being true.** A stored month is
never served once a committed change has moved it, including a change in flight while the
month was being computed or stored. A write into the open month never waits on this.

**5. The database moves the versions, in one migration owned by `reporting`, never the
routes that write.** This keeps section 20's 2026-09-01 settlement. Section 2 admits it as
SQL in a migration that writes only `report_month_versions`. How it does so is reviewed in
the migration against the tests, not described in SKILL.md.

**6. Every table is either moved by the migration or listed as one the stored reports do not
read, with its reason, and a test fails on a table in neither list.**

**7. A stored month is a cache.** It is never the only copy, and serving it gives the same
answer as computing it.

What a request aborted by a deadlock between two changes that move stored months is
answered is left open, in `CLAUDE.md`.

---

Decision 0320, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-06 — The Encounter God Weekend, and Graduated on the readiness table](0319-the-encounter-god-weekend.md)
