# 2026-10-21 — A Full view leader's Reports are the Senior Pastors' five, for their own branch

A Full view leader's `Reports` had four tabs: *CG Attendance Reports*, *DCC Attendance Reports*,
*Encounter Readiness* and *# of People* (decisions 0340, 0360, 0361, 0376 and 0378). The two
Senior Pastors' had five, each by period or over its last 12 months (decisions 0326 and 0377).
On 21 Oct the owner looked at Bishop Oriel's screens beside a Primary's, in real screenshots,
and asked for the Senior Pastors' five on the Primaries' screens, with these differences.

## The ruling

1. **A Full view leader's `Reports` has five tabs**: *CG Attendance*, *DCC Attendance*, *# of
   Cell Groups*, *# of Cell Leaders* and *# of People*, the Senior Pastors' words, each for the
   leader's own branch. *Encounter Readiness* is hidden from them, as Training and Conquest
   already were, and stays reachable by address; only the Admin's tabs carry it.
2. **By period offers Weekly and Monthly alone.** Quarterly and Year are hidden, and an address
   naming one opens the month. Quarterly and Year stay for the Admin and the two Senior
   Pastors, who keep every period. A Full view leader was the only reader decision 0310's
   finished quarters and years reached, so **that rule now reaches no reader**, which the
   owner confirmed on 21 Oct when `architecture-guardian` raised it. The report routes still
   answer any period that has begun.
3. **There is no *Figures for*.** The leader reads their own branch.
4. **The names of their disciples are plain text** on all five tabs and open nothing.
5. **Each tab has *Last 12 months*, as a line alone**: the leader's own branch, no *Show* list,
   no bars and no other line, and *Show the figures* beneath it, which is the graph's text
   alternative (Section 23).
6. **Two routes are added**, both under `reports.view_subtree` against a `LEADER` selector, the
   guard and the naming of `GET /reports/people/branch` (decision 0364):
   - `GET /api/v1/reports/counts/branch` counts *# of Cell Groups* (with Youth, Young Pro and
     Couple) and *# of Cell Leaders* for one leader's branch over a month, as the Senior
     Pastors' rows are counted (decisions 0326, 0330, 0331 and 0339): at the month's final
     millisecond where it has ended and now where it has not, a Cell towards the leader it had
     then, placed on Section 20's placement graph. The rows and the leader's own row add up to
     the box.
   - `GET /api/v1/reports/trends/branch` draws one figure for one leader's branch over the twelve
     months ending at `period`. **Each month is authorized at its own final millisecond**, as a
     report for that month would be (decisions 0207 and 0214): the guard admits the selector at
     `period`, and every earlier month is checked again. A month the actor could not have read
     is a gap, never a figure.

The Senior Pastors' and the Admin's screens are unchanged.

## Why

The owner wanted the Primaries to read their branch the way the two Senior Pastors read the
church, with less to choose: two period lengths, no picker, one line, and their 12 named
without opening anybody's page. The figures were already defined for the Senior Pastors'
roots' rows; a Primary's branch is the same count one level down, so nothing new is counted,
and the per-month check keeps the twelve-month line from showing a month a by-period report
would refuse.

The owner said "the Primaries". The screens are keyed on Full view and the reach of
`reports.view_subtree`, never on a role (decision 0323), so this is every Full view leader.

Decision 0380, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 13 and 19. Decision 0379, held by work not yet merged when this was written, was built
on 27 Oct and closes these hidden pages to a Full view leader.

Previous: [2026-10-21 — A page not on your screens does not open](0379-a-page-not-on-your-screens-does-not-open.md)
