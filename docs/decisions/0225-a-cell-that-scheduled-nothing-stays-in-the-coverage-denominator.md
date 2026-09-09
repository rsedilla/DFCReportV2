# 2026-09-09 — A Cell that scheduled nothing stays in the coverage denominator

Section 12 states a zero rule for **N**, the meetings a Cell actually recorded: "Where N is
zero, the Cell recorded no meetings, so nobody attended and the population is empty. The
view shows the coverage line alone and no buckets." It never says what a coverage line reads
when its own **denominator** is zero.

Section 5 names that state and treats reaching it as harm: a backdated closure "erases the
scheduled-meeting count a coverage line is read against", so `0 of 4 meetings recorded`
becomes `0 of 0` — "the coverage line being the evidence that its leader reported nothing".

It is reachable without any backdating: any month after a Cell's closure has no schedule row
in force, so the Cell derives no scheduled meetings at all.

**A Cell with no scheduled meetings in a month reads `0 of 0`, and it stays in an aggregate
coverage denominator, contributing zero to both terms.** It is never dropped from the
aggregate.

## Why it is not dropped

Section 12's ground for coverage leading an aggregate view is that its denominator is
derived from the schedule rather than submitted, so **"recording less makes coverage worse,
never better"**. Dropping a Cell that scheduled nothing breaks exactly that: it would make
disappearing from the denominator a way of recording less and looking no worse, which is the
incentive that sentence exists to close.

The arithmetic costs nothing, which is what makes this the cheap answer as well as the right
one: adding zero to both terms changes no ratio. What it preserves is the **membership** of
the denominator, so a leader's aggregate names every Cell they hold rather than every Cell
that happened to have a schedule.

## Why `0 of 0` is shown rather than suppressed

Section 5 already treats it as evidence rather than as an absence, and Section 12 already
requires the coverage line in the neighbouring zero case — where N is zero it asks for "the
coverage line alone and no buckets". Suppressing the line would remove the one figure that
explains a Cell showing nothing, which is the failure Section 12 names for buckets and the
same failure here.

It is not an error state and carries no warning colour: Sections 13, 17 and 19 forbid
encoding a leader or a coverage figure that way, and a Cell closed last month has done
nothing wrong.

## What was rejected

**Excluding zero-scheduled Cells from aggregate denominators.** It is the reading that
breaks Section 12's incentive argument, above.

**Excluding them from the aggregate figure while still listing them individually.** It keeps
the Cell visible and takes it out of the arithmetic, which reads as a defect the first time
somebody adds the rows up and gets a different answer from the total beside them. A figure
and the list that explains it must be over the same set.

## What this does not settle

**Which Cells an aggregate coverage figure ranges over in the first place.** This ruling says
a Cell in that set is not removed for having scheduled nothing; it does not say how the set
is chosen, which is the placement question Section 20 settles for a Cell figure's responsible
leader (decision 0221) and whose residual classes are recorded as open in `CLAUDE.md`.

**Nothing about DCC**, whose own zero denominator is settled in decision 0224 and whose
denominator is a count of responsible leaders rather than of scheduled meetings.

---

Decision 0225, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-09 — DCC coverage over a month is obligations met over obligations owed](0224-dcc-coverage-over-a-month-is-obligations-met-over-obligations-owed.md)
