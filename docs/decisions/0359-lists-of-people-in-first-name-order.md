# 2026-10-17 — Lists of people in first-name order

Every list of people in the application was ordered by surname, then first name, then Member
ID (decisions 0174 and 0293), while every name on it is shown first name first. A reader
scanning *Lorna Aquino, Bernardo Bautista, Rowena Castillo* sees no order at all. The owner
chose on 17 Oct, from real screenshots of a Cell's members and the SUYNL table, to order every
list by first name, as one rule.

## The ruling

1. **A list of people ordered by name is ordered by first name, then surname, then Member
   ID**, or the record's identifier as that last tie-break where a cursor already carried it:
   the People search and the lists that page like it, whose cursors would otherwise change
   shape. Either way two people with the same name keep a fixed order. It binds every such
   list: the People search, a Cell's members, the DCC checklist, the leader tables on Reports, Record's lists, the Branch view and the Growth tables, and any
   list added later.
2. **The order is the same wherever the list is assembled.** A query ordering in SQL and a
   list sorted in application code use the one key, and a cursor over the list carries the
   three in that order, so a page boundary falls where the sort put it (section 22).
3. **Nothing else changes**: names are shown as they were, a title is never compared (decision
   0271), lists still never sort by a figure (section 13), and Network order stays where a
   table is split by Network (decision 0294).
4. **The one exception is the list of duplicate candidates** (section 3), which keeps its own
   order (owner, 2026-10-17). It is a check of whether two records are one person rather than
   a list of people to work through, and section 3 ties what its order may reveal to the name
   it shows.
5. **A page open across the deploy may skip or repeat rows once** (owner, 2026-10-17): its
   cursor still decodes and is read in the new order. Opening the list again recovers it. This
   is accepted rather than refused because no native client exists yet, the ground on which
   decision 0328 let the API be narrowed with the web application in one deployment.

## What the build owes

The shared key (`compareRosterKeys`) and every query ordering people by surname take first name
first, with the cursors' comparisons in step. A cursor issued before the change still decodes,
since its fields are unchanged (point 5). The DCC checklist gains `first_name` and `last_name`,
additively, so a screen merging several checklists keeps the order without comparing a
composed name. No migration.

## Why

Leaders know their people by first name, and the names are read that way on every screen.

Decision 0359, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-17 — Pending CG Records and Pending DCC Records](0358-pending-cg-and-dcc-records.md)
