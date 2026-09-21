# 2026-09-21 — Behind is the meetings that have come and have no record, and the Cells list counts them

The owner's Reports design offered **Show only Cells behind** over the coverage table. It was
built on 2026-09-20 and removed the same day: the Cells list carried only the month's whole
schedule (decision 0239), so `recorded < scheduled` called a Cell behind for meetings that had
not happened yet. Two Stop Conditions came out of that — whether a control may key on a
mid-month Cell coverage figure at all, and whether "behind" means one thing across surfaces —
and decision 0266 added a third, whether one attention predicate may range over an `ACTIVE`
Cell's denominator and a closed one's.

The design already had the right figure. Its prototype computes behind as meetings held so far
minus meetings filed; what was missing was the server saying which meetings had come.

## The ruling

**A Cell is behind by the number of its scheduled meetings whose Manila day has begun and which
have no record.** It is the predicate Section 17 already gives the Network screen — "a Cell on
meetings whose day has begun" — counted the way that screen counts it, each due meeting matched
to a record by its scheduled date.

**The Cells list carries it on every row as `coverage.behind`**, in both views, computed by the
server. A client never derives it from the other two figures.

**"Behind" means that everywhere the word appears**: the Network screen, Section 15's attention
list of Cells with meetings still to record, and the Reports coverage table, whose filter now
shows only the Cells behind.

**No control keys on the whole-month denominator.** It stays Section 12's coverage line, two
figures, and `behind` never divides it.

**How many Cells of a list are behind is a count of that list's rows**, over every page, and not
a figure of a report. It is shown in words beside its complement — "2 behind · 9 not behind" —
never as a share, and the rows stay in `cell_id` order.

## Why

**The server counts, because a client cannot.** Knowing which meetings have come means repeating
the schedule derivation — mid-month changes, inert rows, closure — and it would drift the first
time any of them changed. The due dates come from the same fragment as the denominator, so the two
cannot disagree about what the schedule was.

**Matched date by date rather than one count subtracted from another.** A subtraction was the
first version and `architecture-guardian` refuted it: a closure backdated past a meeting that was
already recorded leaves that record outside the schedule, where it would offset a different,
earlier meeting that has none and hide a Cell that is behind. Matching is also exactly what the
Network screen does, which is what makes "one meaning" true rather than nearly true.

**It settles all three Stop Conditions by one predicate.** The control question existed only
because the one figure a control could reach was the wrong one; the "one meaning" question was the
Network screen and the Cells list counting differently; and the attention-list question was the two
views compared on denominators bounded differently. Both views now answer the same question — due
meetings with no record — and a closed Cell's due meetings stop at its closure because its schedule
does.

**What it leaves open**: what a meeting recorded before a backdated closure counts towards. It is
kept exactly as recorded (Section 13) and now offsets nothing in `behind`, but it still counts in
the coverage line's numerator, where it can read "1 of 0". Whether it belongs there is a rule the
specification has not written, and it is recorded in `CLAUDE.md` rather than decided here.

**What it refuses from the design**: the coverage table sorted furthest behind first. Section 13
forbids a worst-first order, so the filter narrows the list and never reorders it.

---

Decision 0267, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-21 — The Cells list has a closed view, and it is where a restart is asked for](0266-the-cells-list-has-a-closed-view.md)
