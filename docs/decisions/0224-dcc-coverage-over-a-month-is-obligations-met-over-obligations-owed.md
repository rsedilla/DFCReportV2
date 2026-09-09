# 2026-09-09 — DCC coverage over a month is obligations met over obligations owed

Section 9 defines DCC coverage **per event**: it "counts **how many responsible leaders
have a record for the event**, not how many events exist". Section 20 gives the same
per-event shape — the denominator is the responsible leaders as of the event date, the
numerator those holding a record. Section 9 then asks for the figure "at every scope, as a
single line".

A month holds N events, and nothing said how N per-event figures become one line.

**DCC coverage for a month is the number of leader-events with a record, over the number
of leader-events owed**, summed across the month's events. Both terms are reported. It is
never divided into a percentage or a score (Section 13).

## Why this rather than the two alternatives

**Section 20 already says what coverage attributes by.** It "attributes by the obligation
rather than by the record, because coverage exists to surface the records that are
*missing* and a missing record has no responsible leader frozen on it". A leader owes one
record for each event they were the responsible leader at; coverage is the fraction of
those obligations discharged. This ruling is that sentence made arithmetic rather than a
new idea.

**It follows the instant Section 20 already fixes.** The denominator is "the responsible
leaders **as of the event date**", so a leader assigned in the third week owes records for
the events from that date and not for the ones before it. Nothing further is needed to make
a mid-month arrival correct: the per-event denominator already excludes them, and summing
per-event denominators inherits it.

## What was rejected

**The mean of the per-event ratios.** It weights every Sunday equally regardless of how
many leaders it involved, so a sparse event — a holiday week, a month's first Sunday before
most of a generation was assigned — moves the month's figure as much as a full one. That
makes the line depend on the shape of the calendar rather than on what was recorded.

**Leaders fully covered over leaders**, where a leader counts only if they recorded for
every event. It answers a different question, one about per-leader completeness rather than
about records existing, and one missed Sunday removes a leader from the numerator entirely.
Section 13's prohibition is on ranking and scoring leaders; an all-or-nothing per-leader
measure is not a ranking, but it is the shape from which one is easiest to build, and
Section 9 asks for a figure that "measures whether the record exists".

## A zero denominator

**Where no leader owed a record for any event in the month, the figure is `0 of 0` and is
shown.** It is not an error, not a gap, and not omitted. Section 5 already names `0 of 0`
for the Cell domain as a real state — "the coverage line being the evidence that its leader
reported nothing" — and the same reading holds here: a scope with nobody responsible for
anybody has nothing to report and says so.

*This is the DCC half of the zero-denominator question. The Cell half — what an aggregate
denominator does with a Cell that scheduled no meetings — is a different question about a
different denominator and is settled separately.*

## What this does not settle

**Whether a month with a calendar gap is reportable at all.** Section 9 says a report
covering a month with a gap is "wrong until the gap is filled", and what a DCC report does
when N is zero for that reason is recorded as open in `CLAUDE.md` and is untouched here.
This ruling fixes how per-event figures combine; it does not decide whether the month
should have been reportable.

**Nothing about Cell coverage.** Section 9 states plainly that "DCC coverage is shaped
differently from Cell coverage": a Cell has one leader and counts recorded meetings out of
scheduled meetings. That figure is already monthly and needs no aggregation rule.

---

Decision 0224, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-09 — A Cell meeting roster carries the marks it asks to be resubmitted](0223-a-cell-meeting-roster-carries-the-marks-it-asks-to-be-resubmitted.md)
