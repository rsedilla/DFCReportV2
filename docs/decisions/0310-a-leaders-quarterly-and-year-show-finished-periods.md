# 2026-10-04 — A leader's Quarterly and Year show finished periods, the last four quarters and the last year

Reports › Cell Groups and Reports › DCC open Quarterly on the quarter still running and Year on
the year still running (decisions 0293 and 0294), so on 4 October a quarter of four days reads
like a quarter. The owner asked that a leader not use a quarter or a year before it is time,
chose from a clickable copy of the screen, and settled who keeps today's view.

## The ruling

**1. A reader who does not hold `reports.view_subtree` at Whole Church is offered finished
quarters and years only.** A period is finished once its last day has passed. It keeps the open
label section 17 requires until its submission window closes on the 7th of the following month.
Quarterly opens on the last finished quarter, and its forward arrow stops there, with a line
saying when the next one opens. Year is offered once a year has finished; until then it says
when the first one opens.

**2. That reader reaches back four quarters and one year, and nothing before the DCC
calendar.** The last four finished quarters and the last finished year, none ending before the
first Sunday of the DCC calendar (`dcc_calendar_start`, section 9), on both tabs. A Cell meeting
recorded before it stays in Monthly and in a whole-church reader's view. Until the calendar has
a first Sunday, that reader is offered no quarter or year, and the screen says so. The two tabs' report answers carry the date, under `reports.view_subtree`. A
period outside that reach, asked for in the address, opens the latest one inside it, and the
screen says it did.

**3. A reader holding `reports.view_subtree` at Whole Church keeps every quarter and year**, the
running one labelled as still open, as before. By default that is the Admin and the two Senior
Pastors; a `read_only` grant counts. It is read from the capability's scope and never from the
role name (section 7). A narrower scope, `NETWORK` included, is not whole-church. The reach
follows the reader, including when they open another leader's 12.

**4. Weekly and Monthly are unchanged for everyone**, the running week and month included,
because leaders are still recording them.

**5. The screens apply this, and the API does not.** The report routes answer any period that
has begun, as before (decision 0216); this rule decides what the two screens offer, not what a
reader may read (section 1, principle 4).

## Why

A quarter or a year is for looking back. One that has barely begun invites reading a few days
as the whole period. A leader looking back needs the last year of their own 12; the full history
stays with whole-church readers. A week and a month are the periods leaders record in, so the
running one is the one they need.

Three alternatives were rejected. Limiting a leader to the current calendar year would show no
quarter at all from 1 January until April. Disabling the two buttons would hide quarters already
finished. Following the date initial encoding closes was preferred by the owner, but nothing
closes it yet and no date is stored, so leaders would have had no Quarterly or Year until it
was built; the DCC calendar's start exists now. The owner then settled what a review left open
about it: nothing is offered before it exists, so no leader sees an empty quarter that looks
like data; it travels with the reports a leader already reads rather than behind a new route or
a settings capability; and one floor serves both tabs.

---

Decision 0310, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-03 — The Cells totals are read from a counts route](0309-the-cells-totals-are-read-from-a-counts-route.md)
