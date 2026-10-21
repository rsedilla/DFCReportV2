# 2026-10-21 — The two Awaiting lists leave Record, for Cells and People

`Record` opened on five lists (decisions 0290 and 0336): *Update Records*, *Pending CG Records*,
*Pending DCC Records*, *Awaiting Leader Assignment* and *Awaiting CG Assignment*, then *Recording
Progress* for a Full view leader and the Admin (decisions 0334 and 0335). On 21 Oct the owner
looked at a Primary's `Record` and said the two Awaiting lists are "not a record thing": nothing
on them is recorded. Shown real screenshots of the move, the owner chose it for the Primaries
and the Admin alike.

## The ruling

1. **`Record` keeps the recording lists**: *Update Records*, *Pending CG Records*, *Pending DCC
   Records*, and *Recording Progress* where it was offered.
2. ***Awaiting CG Assignment* is a tab of `Cells`**, after *Active Cells*, because its remedy is
   putting the person in a Cell. The list, its count, its fifty at a time and its link to the
   person's page are unchanged (decisions 0233 and 0343).
3. ***Awaiting Leader Assignment* is a tab of `People`**, after *Add People* and before *Family
   Tree*, at `/people/awaiting-leader`, because its remedy is moving the person to a leader, not
   anything to do with a Cell. The owner chose `People` over `Cells` for this one. The list, its
   count and its read-only note for a reader not ticked *Moves people* are unchanged (decisions
   0232 and 0356).
4. **Both are on the Full view screens**, a Full view leader's and the Admin's, as they were on
   `Record`; the Senior Pastors' screens and the recording screens have neither, as before. Who
   is listed is still the route's (`GET /api/v1/cells/people-without-a-cell` and `GET
   /api/v1/people/awaiting-reassignment`), unchanged.
5. **An address that still names either list on `Record`** (`/dashboard?list=nocell` or
   `?list=leader`) opens it where it now is.

No route, capability or figure changes.

## Why

`Record` is for what a leader fills in, and a sidebar item's tabs should be about the item. A
person waiting for a Cell is fixed from `Cells`' world, and a person waiting for a leader from
`People`'s, so each list now sits beside the place its action leads to.

Decision 0381, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 15, 17 and 19.

Previous: [2026-10-21 — A Full view leader's Reports are the Senior Pastors' five, for their own branch](0380-primaries-reports-as-the-senior-pastors.md)
