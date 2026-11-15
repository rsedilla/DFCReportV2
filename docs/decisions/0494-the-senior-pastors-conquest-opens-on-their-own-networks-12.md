# 2026-11-15 — The Senior Pastors' *Conquest* opens on their own Network's 12, and a name goes a level down

Owner ruling, 2026-11-15, from screenshots of Bishop Oriel's *Conquest* on a phone and a laptop,
today beside the change. The owner asked that each of the four tabs carry links to Bishop Oriel's
and Pastora Geraldine's 12, as *People* and *Cells* already do (decisions 0490 and 0491), for the
two Senior Pastors only, and confirmed that it drills down level by level.

## The ruling

**1. Each of the four tabs opens on the reader's own Network.** On every tab, *Win 3*, *Open a
Cell*, *Completion of 12* and *Raise 12 Leaders*, a Men · Women · Both switch sits under the tab's
box, the reader's own Network first and chosen when the page opens, as on *People* (decision 0490).
The box counts that Network, the whole church under *Both*, or the branch of the leader opened
(point 3).

**2. Under it, the root's 12.** One table per root in the Network chosen, headed with the root's
name and *leaders*: one row per Primary, each with their own progress on the tab's goal, how many
people in their branch, themselves and everyone beneath them, have reached it, and how many people
their branch holds. The root's own row and a *Total* of the two close the table. One *Others* line
follows the tables, shown only where it is not 0, for whoever the box counts beneath no root, so the
rows, each root's own row and *Others* add up to the box. Rows are in first-name order (decision 0359) and never by progress (decision 0009).

**3. A name with people beneath them goes a level down.** It opens that leader's 12 in the same
shape, their own row closing it, keeping the tab and the Network. The way back goes up one level at
a time, naming the leader above, until *Back to Conquest* (decision 0491). A name with nobody
beneath them is plain text.

**4. The search stays.** A search, or *Only my disciples*, shows the list of people as before.

**5. For the two Senior Pastors only.** The Admin and a Network Admin keep the list they have
today. `GET /api/v1/conquest/branches` serves the tables to a holder of `conquest.view_subtree` at
Whole Church and refuses a holder of it over a Network or a branch `SCOPE_DENIED`; it names a period nowhere and reads the tree as
it stands now, as every Conquest read does (decision 0278).

## Why

Bishop Oriel and Pastora Geraldine read their Network by their 12, as every other screen of theirs
now does. One list of everyone, a page at a time, does not say whose branch is moving.

## What it does not change

What a goal means or how it is derived (Section 27), the Admin's and a Network Admin's
*Conquest*, or any other screen. No figure is reported by period.

---

Decision 0494, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 27.

Previous: [2026-11-15 — The Audit Log shows changes, keeps searches under *Lookups*, and shows one save as one row](0493-the-audit-log-shows-changes-and-keeps-searches-under-lookups.md)
