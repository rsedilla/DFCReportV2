# 2026-10-11 — A Cell created in error is in no month's count

Owner ruling, 2026-10-11, on a Stop Condition `architecture-guardian` raised on decision 0327's
build. It settles what decision 0326 left unsaid and amends Sections 10 and 19.

## The ruling

**A Cell closed `CREATED_IN_ERROR` is counted in no month's # of Cells or # of Cell Leaders,
including the months before its closure.** Those two figures, on the Senior Pastors' tabs and
in Trends, count the Cells running at the month's final millisecond (the current month at now)
and leave out every Cell whose closure reason is `CREATED_IN_ERROR`, whenever it was closed. So a
month's figures can fall after the month is over, by the Cells later found to have been created
in error.

It concerns those two counts alone. Attendance recorded at such a Cell is not touched.

**Only an Admin may close a Cell `CREATED_IN_ERROR`.** The Cell's leader and the leaders above
them still close it for every other reason; one who finds a Cell was entered by mistake asks an
Admin. The closure route refuses that reason from anyone without the `ADMIN` role as
`CAPABILITY_DENIED`.

## Why

That closure says the Cell should never have existed (Section 10). Conquest already treats it so,
for Open a cell and Raise 12 leaders (decisions 0283 and 0286), and correcting a record already
lowers past totals elsewhere (decision 0012, for a merge). Counting it in the months it was
running would keep in the church's figures a Cell the church has said was never real.

The reason is Admin's because it now lowers figures already reported, as far back as the Cell
ran, and a closure is never reversed. A merge, backdating and a sex correction also lower past
totals, and each of those is Admin's, as data correction. `architecture-guardian`
raised who may make it; the owner ruled the same day.

Nothing is stored to refresh: these counts are computed when they are asked for.

Decision 0330, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-10 — Record's tabs are sized to their words](0329-record-tabs-are-sized-to-their-words.md)
