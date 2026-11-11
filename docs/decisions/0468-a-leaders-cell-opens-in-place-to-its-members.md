# 2026-11-11 — A leader's Cell opens in place to its members

*Led by your leaders* on My Cell was a card per Cell with *Meetings* and *Members* buttons
(decision 0463). The owner asked for plain text in their place, to keep the page fast with 1,000
leaders, while leaders can still see every member of a Cell. Measured on a production build
with ten such Cells, the page made 6 API calls and 44 link prefetches, 32 of them for those
buttons. On 2026-11-11 the owner was shown the cards beside plain cards and compact rows, then
rows that open in place, and chose those.

## The ruling

1. **Each Cell the reader's leaders lead is a row**: the leader's name, the Cell's size, the
   Cell's short name, and this month's coverage as Section 12's two figures with *to record*
   where it is behind (decisions 0225 and 0267). This replaces points 2 and 3 of decision 0463.
   Nothing on it is coloured by its coverage (Section 13).
2. **A row opens in place** with the **+** that Record's *Leaders Under Me* uses (decision 0311),
   to its schedule and Cell ID, every member's name, and *See this Cell's meetings*. Several may
   be open at once.
3. **A Cell's members are read only when its row is first opened**, from the route its Members
   page reads, and kept. The link in the row is not prefetched.
4. **My Cell keeps what it has read for five minutes.** Every save the server accepts still
   marks it stale at once, so a leader always sees their own save; a save made by somebody else
   can take up to that long to show.
5. **The reader's own Cells keep their cards and buttons**, because those are recorded from
   here (decision 0322).

It adds no route and no figure, and shows nobody the reader could not already see: the members
route is guarded by `cell.view_subtree`, the capability this list is read under (decision 0204).
Measured the same way, the page still makes 6 API calls and now makes 17 prefetches.

## Why

Most rows are never opened, so a leader overseeing many Cells costs the server nothing for
those. Opening a row is one light call, where the Members page reads the Cell's meetings as well
as its members.

Considered and rejected: plain cards with no links, which would leave a fully recorded Cell
with no way in, since Record links to a leader's meeting only while one is outstanding; and
reading every Cell's members with the list, which is better only if leaders open nearly every
row, needs an API change, and makes every visit pay for rows nobody opens. Planning Center, the
closest comparable, opens a group's members on a page of their own; rows were preferred here for
the lighter read and for comparing several Cells at once.

Not part of it: how leaders actually use the rows, which is worth asking a few of them, and a
speed test with many leaders at once, which has not covered this list since it was added.

---

Decision 0468, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 19.

Previous: [2026-11-10 — A Cell's meetings are under Cells, with a simpler top](0467-a-cells-meetings-are-under-cells.md)
