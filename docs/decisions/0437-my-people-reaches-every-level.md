# 2026-11-04 — My People reaches every level, and says who leads each Cell

Decision 0422 listed a leader's people two levels down, on My People and inside Family Tree alike.
On 2026-11-04 the owner found a member of a leader's own Cell Group missing from that leader's My
People: she was three levels down, the disciple of the leader's disciple's disciple, so the list
left her out while My Cell listed her. The owner asked that a leader without Full view see every
name in their branch, chose from screenshots how each row names the Cell's leader, and chose the
words that say how deep each list goes.

## The ruling

**1. On *My People*, a leader without Full view sees every level of their branch**: the people
they disciple directly and everyone beneath them, as the pastoral tree stands now (Section 5).
**A Full view leader's list inside Family Tree keeps two levels**, their 12 and their 12's 12 (decisions
0324 and 0422), the *Tree* beside it showing every level. The server decides which from the
account's screens (decision 0323), and the counts say which it gave: every account but one with the
Full view screens, a Full view leader's or the Admin's, is given every level.

**2. Each list says how deep it goes**, under its count: "Your 12, their 12 and everyone after
them" on My People, and "Your 12 and their 12 · Tree shows every level" inside Family Tree.

**3. Each row says who leads the person's Cell Group.** On a phone a row is the name, then
"Leader: *full name*" (or "You"), then "Cell Group: *Young Pro · Sat*, led by *first name*" (or "led
by you"), or "Cell Group: none yet". The *Leader* line carries the full name so it names one
person; the Cell line uses the first name so it fits a phone's width, as the Pending lists name a
leader (decision 0368). On a wider screen the Cell Group column reads "*Young Pro · Sat*, led by
*first name*", or *No Cell yet*. A member's Cell is led by its current leader; a Cell the person
leads, by the person. The server always names that leader, and the screen says "you" where it is
the reader. The Cell, and so who leads it, is given only where the reader holds `cell.view_subtree`
over the person, as before.

**4. Nothing in the list is a link or an action**, as before (decision 0422), and **it is kept in
the app's memory for ten minutes** rather than thirty seconds, and read again after any save made
on that device. A change made elsewhere, such as a move, a handover or a Full view tick, shows
within ten minutes or on reopening the app. It is still never kept on the phone, and is forgotten
when the session ends.

**5. Nothing a figure counts changes.** The list is not a report, and the count above it is the
number of rows it holds.

## Why

My People is for knowing who one's people are, and a member of one's own Cell Group missing from it
reads as an error. Full view is ticked by hand rather than by place in the tree, so a leader
without it may lead a large branch; measured on 2026-11-04 on a test database of 10,000 people, a
2,665-person branch at every level answered its first page in about 100 ms and its count in about
30 ms. A Full view leader's list keeps the G12 focus while the Tree shows the rest.

---

Decision 0437, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 19.

Previous: [2026-11-04 — A leader's people are "in your care"](0436-a-leaders-people-are-in-their-care.md)
