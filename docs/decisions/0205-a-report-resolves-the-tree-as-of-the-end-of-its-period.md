# 2026-09-05 — A report resolves the tree as of the end of its period, and attribution has three keys

*Titled "two keys" when written. The body was corrected to three the same day and the heading
was not, so the first line a reader met stated the superseded answer.*

Settled before Stage 5's first query, because it decides every figure Stage 5 produces and
is stated generally in no section.

## A report walks the tree as of the end of the reporting period

Section 18 states the rule: "Historical reports must respect historical pastoral
assignments and Cell category history where applicable." Section 16 gives the instant, for
one metric — `Cell Leaders with 12+ Members` is evaluated "**as of the end of the period
being reported** — which for the current period means now."

**The ruling generalises Section 16's instant to wherever a report walks the tree**, and
Section 20 now states it once rather than leaving it to be inferred from two sections that
each carry half.

*That is an extension rather than a restatement, and saying so is the point.* Section 16
grounds its instant on `Cell Leaders with 12+ Members` being a **current-state** metric, and
Section 3 puts current-state metrics on one side of a line and period-based classification
and monthly attendance on the other. This ruling carries the instant across that line.
*A first version claimed Section 16 "already names it", which is true only of one metric on
the other side of that line.*

**The competing reading is per-record date, not current-tree**, and the grounds below refute
only the latter. Sections 9 and 13 freeze a leader per record, and Section 18's "respect
historical pastoral assignments" supports that reading at least as directly. Period-end is
chosen because a *person*-keyed figure has no record to take a date from — a person's
subtree membership is not a property of any one attendance row — while the figures that do
have such a record are exactly the ones given the frozen key below.

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

## Attribution has three keys, and one is not keyed on a person

*This ruling was first written with two keys and was wrong: it gave Cell figures the person
key, which Section 13 contradicts in terms — "Sections 12 and 20 count a meeting under the
leader it names", naming this section as the one that does it. Section 12 says the same from
the other side. The error was caught by `architecture-guardian` before any query was written,
which is the whole reason rulings precede code here. It is recorded rather than quietly
corrected because the two-key version declared its own list closed, which is what would have
made the third key hard to add later.*

- **DCC unique people, classification and buckets attribute by the person**, placed in the
  tree as of the period's end. Section 16 states the figure directly: "Total People —
  distinct people in the pastoral subtree."
- **Cell unique people and classification attribute by the meeting's frozen responsible
  leader.** Section 10 makes Cell membership independent of pastoral assignment, so for a
  Cell whose members sit outside their leader's subtree the two keys attribute the same
  people to different leaders — which is why this is a second key and not a restatement.
  Cell monthly-attendance buckets exist at Cell scope only, so no tree walk arises for them.
- **Coverage attributes by the obligation, not by the record.** This is the correction that
  matters most, because a coverage key read off existing rows defines a numerator and leaves
  the denominator — the part coverage is *about* — underived. A missing record has no
  responsible leader frozen on it. DCC's denominator is the responsible leaders as of the
  event date; a Cell's is its scheduled meetings, each appearing for the leader who led it on
  the scheduled date, since a meeting has no row until it is reported.

**A Network root proves the keys differ rather than coincide**: Section 9 excludes roots from
coverage denominators and keeps them in every unique-people total.

It follows that a monthly report walks the tree at more than one instant — the period's end
for the person key, each event or meeting date for coverage. The headline rule is stated over
where a report places a *person*; coverage places an *obligation*.

## What this obliges

`HierarchyService.subtreeOf` is **undated** and is the wrong method for every reporting
read. `directChildrenAsOf`, `assignmentsAsOf` and `rootsAsOf` are dated and no dated
*recursive* walk exists, so `hierarchy` owes one — declared there rather than in `reporting`,
because Section 2 makes `hierarchy` the owner of `pastoral_assignments` and subtree
resolution, and a recursive walk written in `reporting` would be the cross-module read
Section 2's closed exemption list does not permit.

## What it does not settle, and three Stop Conditions it raised

`architecture-guardian` raised three questions this ruling cannot answer, each escalated
rather than invented. They are recorded in `CLAUDE.md`. *This sentence said "the third
blocks Stage 5's first query" and was wrong when written — the blocking two were the first
two, which decision 0206 then settled, leaving nothing blocking. It disagreed with
`CLAUDE.md` on the one fact the index exists to carry, and `CLAUDE.md` is the authority.*

- **Where a person with no open pastoral assignment at the period's end lands**, in a period
  they have attendance in. Section 5 makes zero open assignments legitimate for an archived
  Person, for one encoded but not yet assigned, and for an administrator; Section 3 requires
  period-based reports never to be filtered by current lifecycle state. Under the person key
  such a person is in the Whole Church total and in no leader's, so a drill-down loses people
  between two levels — which is the failure Section 9's "nobody is missed between two levels"
  names in the recording direction.
- **Whether `reporting` may root a query in any table beyond the two it owns.** Section 2
  permits one exemption, "a read joined onto a query rooted in a table the reading module
  owns", and `reporting` owns `report_snapshots` and `notifications`. By that rule it may not
  root a query in `dcc_attendance`, `cell_attendance`, `cell_meetings`, `cell_memberships`,
  `persons` or `pastoral_assignments` — so a whole-church monthly report cannot be a join and
  must be assembled through service interfaces. The answer is an amendment to Section 2 in
  either direction, and it is architectural rather than a detail of one query.
- **The dated Person-target scope resolution Section 7 says does not exist.** Section 7:
  "It is a *dated* viewing read — one asking about a past month — that owes a resolution as of
  that period, and no route asks one yet." A Stage 5 monthly report is that route. This ruling
  obliges the dated walk in `hierarchy` and is silent on the authorization half, which decides
  who may read a leader's October figures.

Which instant *within* the end-of-period day. Section 20 already fixes a date-only value to
00:00 Asia/Manila, so "the end of the period" is an instant this specification can express,
and the first query is what should pin it rather than a sentence here. Recorded as open in
`CLAUDE.md`.

---

Decision 0205, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — The Cell roster read is guarded by `cell.view_subtree`, and an undated viewing read asks about now](0204-the-cell-roster-read-is-guarded-by-cell-view-subtree.md)
