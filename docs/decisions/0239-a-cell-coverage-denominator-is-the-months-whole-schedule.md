# 2026-09-11 — A Cell coverage denominator is the month's whole schedule

Decision 0238 refused a Cell meeting a record before its day had begun, and recorded a
question with it: the two domains also disagree about the coverage **denominator**.
Decision 0229 excludes a DCC event that has not happened; `scheduledCountsIn` generates a
day-by-day series across the whole reporting month with no bound at today.

**They are left as they are, and Section 12 now says why.**

## The two figures answer different questions, and always did

The bullet recording this framed it as an asymmetry needing resolution. That was an
overstatement, and reading the two definitions is what corrects it:

- Section 9 defines the Cell figure as "recorded meetings out of **scheduled** meetings".
  The month's whole schedule is exactly that.
- Decision 0224 defines the DCC figure as **obligations** met over obligations owed, and
  decision 0229 says a future event owes nobody. Obligations accrue as events happen.

So each side implements its own definition correctly and neither breaks a rule. What was
missing was a sentence saying so, which is why this ruling amends Section 12 and changes no
code.

## Why the Cell denominator is not bounded at today

**A leader can predict it from their own calendar**, which a bounded one cannot: it would
change every week of the month. Section 12 makes that argument about a neighbouring
question — it rejects resolving mid-month schedule changes per week, partly because the
denominator "becomes something a leader cannot predict from their own calendar" — and the
argument transfers, though it was not made about this and is recorded here as analogous
rather than binding.

**A mid-month line is honest on its face.** Section 17 requires a report to state whether
its period is open, so `1 of 4` sits beside a flag saying the month is still running.

**Nothing acts on it.** Section 15's attention threshold fires on "no meeting held for a set
number of months" and never on coverage, so a partial line puts no Cell on any list and
prompts nobody. That was checked rather than assumed, because a threshold reading a
mid-month figure would have made this a defect rather than a difference.

## What this does not claim

**Not that the two figures are comparable.** They are not, and Section 12 now says the Cell
denominator is the month's whole schedule rather than leaving a reader to infer it from a
count they happen to see.

**Not that either could not have been designed the other way.** Bounding the Cell series at
today was offered and declined: it moves a figure already published on the Cells index and
the dashboard, and it buys a comparability neither section asks for.

---

Decision 0239, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — A Cell meeting is not recorded before its day has begun](0238-a-cell-meeting-is-not-recorded-before-it-has-begun.md)
