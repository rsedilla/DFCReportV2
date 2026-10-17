# 2026-10-17 — Lists of people in first-name order

Every list of people in the application was ordered by surname, then first name, then Member
ID (decisions 0174 and 0293), while every name on it is shown first name first. A reader
scanning *Lorna Aquino, Bernardo Bautista, Rowena Castillo* sees no order at all. The owner
chose on 17 Oct, from real screenshots of a Cell's members and the SUYNL table, to order every
list by first name, as one rule.

## The ruling

1. **A list of people ordered by name is ordered by first name, then surname, then Member
   ID.** It binds every such list: the People search, a Cell's members, the DCC checklist, the
   leader tables on Reports, Record's lists, the Branch view and the Growth tables, and any
   list added later.
2. **The order is the same wherever the list is assembled.** A query ordering in SQL and a
   list sorted in application code use the one key, and a cursor over the list carries the
   three in that order, so a page boundary falls where the sort put it (section 22).
3. **Nothing else changes**: names are shown as they were, a title is never compared (decision
   0271), lists still never sort by a figure (section 13), and Network order stays where a
   table is split by Network (decision 0294).

## What the build owes

The shared key (`compareRosterKeys`) and every query ordering people by surname take first name
first, with the cursors' comparisons in step. A cursor issued before the change still decodes,
since its fields are unchanged; following one across the deploy may start a page at an
unexpected row, which a reader recovers from by opening the list again. No migration.

## Why

Leaders know their people by first name, and the names are read that way on every screen.

Decision 0359, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-17 — Pending CG Records and Pending DCC Records](0358-pending-cg-and-dcc-records.md)
