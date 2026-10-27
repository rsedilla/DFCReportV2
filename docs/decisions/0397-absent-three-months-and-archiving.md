# 2026-10-27 — Absent 3+ Months, and archiving a person

Owner rulings, 2026-10-16 (the list and who archives, from widgets), 2026-10-27 (the tab's name
and seven choices, each from real screenshots drawn on the demo People page).

## The ruling

**1. People gains a fourth tab, *Absent 3+ Months*, with no count.** It is on the screens a Full
view leader and the Admin have, after *Family Tree*. A Full view leader sees their whole branch
on it, read-only, with no Archive button. The Admin sees the whole church, with Archive. It is
served by `GET /api/v1/people/absent`, under `people.view_subtree` against the actor, resolved
now, and lists people in first-name order (decision 0359), paged by cursor.

**2. Who is listed.** The three months are the last three calendar months that have finished, in
Asia/Manila (Section 1); on 27 October they are July, August and September. A current Person
(neither archived nor absorbed by a merge, and not outside the pastoral tree, decision 0339) is
listed when **each** of the three months:

- is one they were in a Cell, or under a pastoral leader and so on that leader's DCC checklist,
  **for the whole month** (owner's choice 2, A). Someone who joined on 20 July is not counted
  for July, so nobody new is listed;
- carries **at least one Absent mark** for them at a Cell meeting or a DCC Sunday (choice 3, A).
  A month in which nothing was recorded for them does not count: that is a leader behind on
  records, not somebody who stopped coming;
- carries **no Present mark** for them at any Cell meeting or DCC Sunday; and
- holds no meeting, held or moved to a date in that month, of a Cell they lead (choice 4, A). A
  Cell's leader is not one of its members, so nobody marks them at their own meetings, and
  leading a Cell that met counts as being there.

Marks are the current line of each record, so a correction counts and what it replaced does not.

**3. What a row shows.** Name (opening the person's page), their pastoral leader, their Cell
(or *Leads* and the Cell they lead), *Last at Cell* and *Last at DCC*, each the date of their
most recent Present mark or *Never*. For the Admin each row carries Archive, except for somebody
who leads a Cell: that row has no Archive button and reads "Leads CELL-000012 (3 members): hand
it over or close it first", the Cell ID opening the Cell (choice 5, A).

**4. It is not Section 16's Participation**, which looks back over a rolling window and counts
attendance alone. This list uses calendar months and needs Absent marks. The page says which
months it covers, and its words stay neutral (Section 1, Principle 7).

**5. Only the Admin archives and restores, and nobody asks in the app.** `people.manage_lifecycle`
stays Admin-only at Whole Church. The Admin talks to the Senior Pastors first; there is no
"ask to archive" step for a leader, which replaces Section 7's "requested by a leader". Section
6's Senior Pastor role does not carry the capability, as decision 0326 already said; the sentence
there that still listed it is corrected.

**6. Archive is offered on the list and on the person's page** (choice 7, A), for somebody who
has not been away three months: passed away last week, moved abroad, or a record entered by
mistake. It is `POST /api/v1/people/{id}/archive`. The dialog asks why, from seven reasons
(choice 1, B): *Working away*, *Studying away*, *Moved away*, *Attends another church*, *Passed
away*, *Record created in error*, and *Other*, which needs a comment. `NO_LONGER_IN_CURRENT_NETWORK`
stays on the rows that carry it and is given for no new archive. Migration 0032 adds the five
values and refuses a new archive with no reason, with the retired one, or with *Other* and no
comment.

**7. What archiving does, from that moment.** It is effective now and is never backdated. It
closes the Person's `CURRENT` row and opens an `ARCHIVED` one with the reason and comment. It ends
their open pastoral assignment with no replacement, so their own disciples appear on *Awaiting
Leader Assignment* (decision 0232). It ends their Cell membership, keeping the record. Where they
have an account that is not disabled, the dialog asks *Disable account access*, selected, or
*Keep account access* (Section 6); completing it needs `accounts.manage` too, disabling ends
every session at once, and the choice is audit-logged either way. Every count of current people
leaves them out from that day; no past month moves (Section 3).

**8. Archiving is refused** for somebody who leads a Cell (the refusal names each Cell and its
members, Section 3), for a Network root (Section 5 offers no succession), for the Admin's own
Person, and for somebody already archived or absorbed by a merge. Each answers
`INVARIANT_VIOLATION`.

**9. Restore, and where archived people are found** (choice 6, A). The tab has an *Absent 3+
Months | Archived* switch for the Admin only. *Archived* lists everyone archived, newest first,
with their last leader and Cell, the date and the reason, each with Restore; it is
`GET /api/v1/people/archived` under `people.manage_lifecycle`. Restore is also beside the line on
the person's page. It is `POST /api/v1/people/{id}/restore`, and it returns the Person to
`CURRENT` and nothing else: no account, Cell or leader comes back with them, each being its own
act (Sections 3, 6 and 10).

**10. An archived person's page keeps a read-only line**, "Archived on 27 Oct 2026 · Moved away",
for every reader who may open the page, with the comment beneath it where there is one.

**11. Audited.** `person.archived` records the reason, the comment and the account decision;
`account.disabled` follows it where access was disabled; `person.restored` records the restore
(Section 21).

## Why

Under ground reporting a Cell leader adds members and cannot remove them (owner, 2026-10-07).
Somebody who stopped coming stays on rosters and checklists and in every count, and nothing puts
them in front of the person who can decide. The owner chose a list anyone overseeing a branch can
read and one person who acts on it, after talking to the Senior Pastors, because archiving lowers
a leader's own People count (Section 3) and should not be the leader's decision.

The four definitions are there so the list names only people who really stopped coming: not
somebody new, not somebody nobody recorded, and not a leader running a Cell every week. Archive
is on the person's page too because the list can only show somebody after three months.

Decision 0397, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 3, 6, 7, 10, 15, 16, 19, 21 and 22.

Previous: [2026-10-27 — An edit is checked for duplicates as creation is](0396-an-edit-is-checked-for-duplicates-as-creation-is.md)
