# 2026-08-31 — Four more from the third review, including a key that was wrong

The third `architecture-guardian` pass over the Stage 4 rulings found thirteen more. Four
needed a decision. One of them is a defect in 0162 rather than a consequence of it: the
identity that ruling chose does not survive a case the specification already permits.

## A meeting is identified by its scheduled date, not its week

**`(cell_id, scheduled_date)` is unique, and `{meeting_id}` is the scheduled `YYYY-MM-DD`.**

0162 chose the week, on Section 13's "one logical meeting per Cell per calendar week". That
sentence is true of every week a schedule change does not straddle, and a schedule change
takes effect on the first of a month (Section 10) while a week begins on a Monday (Section
20) — so a month boundary falls inside a week roughly six times in seven.

Worked, because the abstraction hides it. The week of Monday 30 March 2026 runs to Sunday
5 April. A Cell meeting on Mondays that moves to Saturdays from 1 April has a scheduled
meeting on **30 March**, reporting in March, and another on **4 April**, reporting in
April. One week, two meetings, two reporting months.

Keyed on the week, one row can exist and `reporting_month` can name one month. One real
meeting is unrecordable and one of the two months can never reach its coverage
denominator — which is exactly the failure Section 10 refuses mid-month schedule changes to
avoid, arriving through the boundary that ruling treated as safe.

**The date fixes it and costs nothing 0162 was buying.** It is still derivable by a client
from the Cell's schedule before any row exists, still stable, still the same value on two
devices drafting the same meeting, and a reschedule still moves `actual_date` while leaving
the identity alone. `week_starting` and `reporting_month` remain as stored columns, because
they are what the meeting reports in and are not what it is.

Forbidding a schedule change from straddling a week was weighed and refused: it would mean
a change taking effect on a Monday rather than the first, and Section 10's whole reason for
the month boundary is that a month then has exactly one schedule.

## A back-filled Sunday holding no attendance is excluded from N as well as coverage

***Withdrawn with the mechanism it governed.*** The re-entry rule this section added is the
one [decision 0168](0168-the-closed-month-back-fill-is-withdrawn.md) found unworkable —
DCC's N is church-wide, so one Admin correction moves it for everybody — and the back-fill
goes with it.

0166 excluded such an event from coverage and kept it in N, on the ground that N is "a fact
about who attended and not a judgement about anybody's reporting". For a back-fill into a
**closed** month that reason is false in the case it was written about: no leader could
submit against the event, so the system holds no facts about it at all.

The consequence is mechanical and church-wide. N moves from four to five, `Completed (4/4)`
becomes unreachable, and every person who attended every service that month is demoted out
of the top bucket of a report for a month that has closed. That is the manufactured
evidence the coverage exclusion had just removed, one view over. Nothing fails a
reconciliation test, because both views keep the same population — which is why it had to
be found in prose.

**So while it holds no attendance, such an event counts toward nothing: not coverage, not
N, not a bucket.** It exists because the calendar must be honest about which Sundays the
church met, and because Admin can amend a closed month.

**And it re-enters everything the moment there are facts.** Attendance recorded against it
under `records.backdate_effective_date` makes it an event the reports count, in every view.
What is excluded is an event nobody has recorded anything against, which is what "no facts"
means.

## The closed-Cell write resolves through the meeting's own leader

0166 gave the write to the Cell's **last** leader. 0163 freezes each meeting's responsible
leader, and the two disagree wherever a Cell changed hands before it closed.

A Cell led by A, handed to B on 10 March, closed on 20 March: the meeting of 2 March
carries A. Section 19 shows A that outstanding meeting; the last-leader rule resolves the
write through B and denies A. The dashboard item's stated purpose — the only thing making
the permission reachable — is defeated for the one person the record belongs to, and B is
left filing an account of a meeting they did not attend.

**So the fallback resolves through whoever led the Cell on the meeting's date.** Each leader
files their own meetings.

*This ruling said "the meeting's own `responsible_leader_id`, or, for a meeting not yet
recorded, whoever led the Cell on its **scheduled** date" — and Section 13 freezes on the
**actual** date, so a meeting rescheduled across a handover changed hands as it was filed.
[Decision 0168](0168-the-closed-month-back-fill-is-withdrawn.md) authorizes on the date the
submission declares, which is the freeze instant, and carries the roster read with it.*

This is the one target in Section 7's list that resolves per record rather than per Cell,
and that is stated rather than left to be noticed. It resolves that way because the record
carries the answer, which no other Cell-scoped target does.

## The back-fill has a floor, held in `settings`

Section 9 said the command "back-fills a Sunday it finds missing in the past" and gave the
calendar no start date. As written the first run finds every Sunday since the epoch
missing, and refuses each closed month one at a time.

**`dcc_calendar_start` holds the first Sunday the calendar covers.** *Set once when the
calendar is first generated, this ruling said — by the command, which would have made it a
second system-action writer of `settings.updated_by` where Section 7 permits one.
[Decision 0168](0168-the-closed-month-back-fill-is-withdrawn.md) seeds it with the other
defaults instead, and the command only reads it.* The command reaches back to it and no
further, which makes "missing" mean something exact.

A settings key rather than a derived floor: deriving it from the earliest attendance or
Person record would let it move as records are added, so the same command run twice could
reach different Sundays, and a backdated Person would extend it. A fixed number of months
behind the horizon was also refused — a lapse longer than that would be unrepairable, which
is what the back-fill exists to prevent.

Section 7's settings key set is fixed by the specification, so this is an amendment there
as well as in Section 9.

---

Decision 0167, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Three more the second review of the Stage 4 rulings raised](0166-three-more-the-second-review-of-the-stage-four-rulings-raised.md) | Next: [2026-08-31 — The closed-month back-fill is withdrawn](0168-the-closed-month-back-fill-is-withdrawn.md)
