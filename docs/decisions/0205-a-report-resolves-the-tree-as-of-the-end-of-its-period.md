# 2026-09-05 — A report resolves the tree as of the end of its period, and attribution has two keys

Settled before Stage 5's first query, because it decides every figure Stage 5 produces and
is stated generally in no section.

## A report walks the tree as of the end of the reporting period

Section 18 states the rule: "Historical reports must respect historical pastoral
assignments and Cell category history where applicable." Section 16 gives the instant, for
one metric — `Cell Leaders with 12+ Members` is evaluated "**as of the end of the period
being reported** — which for the current period means now."

**The ruling generalises Section 16's instant to every report**, and Section 20 now states
it once rather than leaving it to be inferred from two sections that each carry half.

Three things already depend on this reading and none of them works under the alternative:

- **Reproducibility.** Section 3 guarantees that re-running October's report returns the
  same figures. Resolving against the *current* tree means any reassignment in November
  silently rewrites October.
- **Section 20's invalidation list**, which says a backdated effective date "invalidates
  every period the effective date reaches back into, **because it changes which subtree a
  person belonged to during those periods**". That sentence has no meaning unless a period's
  figures are computed against the tree as it stood in that period. Under the current-tree
  reading every reassignment would invalidate everything, and the list would not single
  backdating out.
- **Section 9's freeze.** A DCC record's `responsible_leader_id` is fixed as of the event
  date precisely so that "a later reassignment never moves historical records".

An **open** period resolves as of now, which is Section 16's own parenthesis and not an
exception: the end of the period has not happened yet, and Section 17 already requires a
report to say whether the period it shows is open.

## Attribution has two keys, and they are different keys

Section 9 defines them separately, and reading either as the other breaks a figure.

- **Population, classification and monthly-attendance buckets attribute by the person**,
  placed in the tree as of the period's end. Section 9: "totals aggregate upward through
  the tree, so no leader re-records people their downline has already recorded, and nobody
  is missed between two levels." A leader's unique-people total is the people in their
  subtree, not the people whose records name them.
- **Coverage attributes by the frozen `responsible_leader_id`.** Section 9 defines DCC
  coverage as "how many responsible leaders have a record for the event", and says a
  submission made on behalf "completes that leader's coverage" — so coverage is a fact
  about the record, and about who owed it, rather than about where the person sits.

The two coincide in the ordinary case and diverge exactly where Section 9 says they should:
a person reassigned mid-month has October records naming their October leader, and appears
in the October subtree totals of whoever led them at the end of October.

**A Network root is the case that proves they are different keys.** Section 9 gives a root
no responsible leader and excludes roots from coverage denominators, while stating that they
"remain in every unique-people total; nothing here removes the two Senior Pastors from the
figures they appear in." One key excludes them, the other does not.

## What this obliges

`HierarchyService.subtreeOf` is **undated** and is the wrong method for every reporting
read. `directChildrenAsOf`, `assignmentsAsOf` and `rootsAsOf` are dated and no dated
*recursive* walk exists, so `hierarchy` owes one — declared there rather than in `reporting`,
because Section 2 makes `hierarchy` the owner of `pastoral_assignments` and subtree
resolution, and a recursive walk written in `reporting` would be the cross-module read
Section 2's closed exemption list does not permit.

## What it does not settle

Which instant *within* the end-of-period day. Section 20 already fixes a date-only value to
00:00 Asia/Manila, so "the end of the period" is an instant this specification can express,
and the first query is what should pin it rather than a sentence here. Recorded as open in
`CLAUDE.md`.

---

Decision 0205, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — The Cell roster read is guarded by `cell.view_subtree`, and an undated viewing read asks about now](0204-the-cell-roster-read-is-guarded-by-cell-view-subtree.md)
