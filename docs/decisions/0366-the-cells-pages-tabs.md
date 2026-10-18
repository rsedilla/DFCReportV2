# 2026-10-18 — The Cells page's tabs

The Cells page had two tabs, *Running Cells* and *Closed Cells*, and *Cells to Approve* for an
account holding `cell.approve_leadership` (decision 0352). Two buttons in its grey bar filtered
the running Cells: *Fewer than 3 members* (decision 0353) and *No meeting in 3 months* (decision
0355). On 18 Oct the owner chose, from real screenshots, to make the two filters tabs of the
Admin's, and to give the Primaries the running Cells alone.

## The ruling

1. **The Admin's tabs are *Active Cells*, *Under 3 Member Cells*, *Inactive (3+ Months) Cells*,
   *Closed Cells* and *Cells to Approve*.** *Running Cells* is renamed *Active Cells*. The two
   filters leave the bar, and each tab shows exactly the list its button showed, from the same
   request. *Close this Cell* stays on the Inactive tab (decision 0355), and *Restart* on Closed
   Cells (decision 0266). The approval tab keeps its name.
2. **A Full view leader's tabs are *Active Cells*, and *Cells to Approve* when they are ticked
   *Approves Cells*** (decision 0352). They are not offered the Under 3, Inactive or Closed lists,
   so a restart of a closed Cell is asked for by the Admin. Record's *Pending CG Records* is
   unchanged. An address naming a list the account is not offered opens Active Cells.
3. **The three lists are offered to an account holding `cell.manage_lifecycle` at Whole
   Church.** Only the Admin closes a Cell (decision 0355), and that is the predicate the server
   already answers as `may_close`; a Full view leader holds the capability over their own branch.
   The screen follows a capability's reach and never a role, as screens follow what the server
   names (decision 0323, point 5) and as decision 0364 chose its panel by the reach of
   `reports.view_subtree`. `reports.view_subtree` was not used here because the lists are the
   ones an administrator acts on by closing, and the Senior Pastors, who hold it at Whole Church,
   have no Cells item.
4. **The *Cells you lead* and *Cells you oversee* totals are on Active Cells alone**, the list
   they count. *Under 3 Member Cells* keeps its month arrows, its *Recorded* column being the
   month's; the Inactive list has none, its window being its own. *Show only Cells I led* stays
   on Closed Cells.
5. **On a narrow phone the tab row wraps onto a second row**, so no tab runs off the edge. Five
   tabs overflowed at 390px, and four at 320px.
6. **Nothing changes in the API, a figure or a permission.** Every list is still answered to any
   holder of `cell.view_subtree` who asks for it; the change is what the screen offers.

## Why

The owner wanted the lists that lead to a closure beside the person who closes, and the
Primaries' page to be the Cells they run. Tabs rather than filter buttons make each list a
place of its own, which is how the Admin works through them.

Decision 0366, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 15 and the sidebar in Section 19.

Previous: [2026-10-18 — No cards above the Primaries' 12](0365-no-cards-above-the-primaries-twelve.md)
