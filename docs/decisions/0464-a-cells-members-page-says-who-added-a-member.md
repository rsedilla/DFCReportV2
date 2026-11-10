# 2026-11-10 — A Cell's Members page says who added a member

Section 10 lets a leader add somebody to any Cell in their branch, so a Cell's own leader can find
a member they did not add, with nothing saying how they got there. On 2026-11-10 the owner
weighed letting only a Cell's own leader add to it, was shown each place a leader adds somebody
today beside that rule, and chose to keep both able to add and to show who did, from screenshots
of the Members page today beside the proposal.

## The ruling

1. **Who may put somebody into a Cell is unchanged**: the Cell's leader, a leader above them
   within their branch and an Admin, adding directly (section 10, decision 0389); an approver
   approving a new-Cell request that names its three members (decisions 0352 and 0353); and an
   Admin moving members when closing a Cell (decision 0355).
2. **A Cell's Members page says who added a member, where it was not the Cell's current
   leader**: *Added by* and that person's name, under the date they joined, at every width. A
   member the current leader added carries no line, so the line marks only what that leader did
   not do; after a handover, members the previous leader added carry that leader's name.
3. **It is read from the membership's own audit entry.** Section 10 records a membership's actor
   in `audit_log` and deliberately not on the row (migration 0009), so `GET
   /api/v1/cells/{id}/members` gives each member `added_by`, the Person behind the latest
   *added* or *moved* entry naming that Cell. It is null where that Person is the Cell's current
   leader, and where no entry names anybody, such as a membership encoded at setup. The server
   leaves the leader out rather than the client, because the roster's reader need not hold what
   the client would read the leader from. A member who left and came back is named by whoever
   added them the second time.
4. **A new Cell's starting members are named by whoever asked for the Cell, not by its
   approver** (owner, 2026-11-10). The request names the three members and the approver only
   agrees, and the person who chose them is whom the new leader would ask. A starting membership
   is the one the approval opened at the Cell's first instant, for a person the approved request
   names.
5. **It discloses one fact and nothing else of the log**: who made the membership the reader is
   already looking at, under the roster's own capability, `cell.view_subtree`. No other entry,
   field or action is reachable through it, so it is not the audit log read `audit.view` guards,
   and the name is one section 8 already publishes church-wide.

## Why

A leader who oversees others can place a new person straight into the right Cell, so nobody waits
for a hand-off, and the Cell's leader still sees what happened and whom to ask. Letting only a
Cell's own leader add was considered and rejected by the owner: it adds a hand-off between the two
leaders, which is where a new person is most easily lost.

Considered and rejected: a column on `cell_memberships` recording the adder, which section 10
declines for the reason it gives (the actor lives in the log), and which would hold a second
copy of a fact that could disagree with the first.

---

Decision 0464, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 10.

Previous: [2026-11-10 — My Cell lists the Cells your leaders lead](0463-my-cell-lists-the-cells-your-leaders-lead.md)
