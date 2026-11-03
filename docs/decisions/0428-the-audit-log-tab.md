# 2026-11-03 — The Admin's Audit Log tab

Decision 0419 gave the Admin area four tabs and left the fourth, Audit Log, to be built with
the route it needs: no route had ever read `audit_log`. The owner was shown the tab drawn on the
real Admin screen, on a laptop and a phone, with entries from the demo database, and chose to
build it as shown on 2026-11-03.

## The ruling

**1. The Audit Log tab lists the whole log, newest first**, fifty entries a page with Previous
and Next. Each entry says when it happened, in Manila time; who did it, or *System* for an entry
with no actor; what happened, in words, with its detail and its reason beneath; and what it was
about, linked to that person's page or that Cell's. It is a table on a laptop and a card per entry
on a phone.

**2. It is searched and narrowed.** A search finds the entries about a person or made by one, by
name or Member ID, and the entries about a Cell, by its Cell ID. One of eight chips narrows it,
one on at a time: *Everything*, *People*, *Moves*, *Cells*, *Attendance*, *Growth*, *Accounts*
and *Settings*. Every action belongs to exactly one of the seven, and the API holds that
assignment so a new action cannot be added without one. There is no date filter.

**3. Only a Whole Church holder of `audit.view` reads it**, by default the Admin role alone
(decision 0419). Its route is `GET /api/v1/audit-log`, whose target is the church, so a grant of
`audit.view` at any narrower scope reads nothing on it. The capability stays grantable narrower,
as Section 7 keeps it; what that would let somebody read is the open question of what period a
read of the log asks about, which this route does not reach and which binds the first route that
serves a narrower grant.

**4. Reading it is not itself logged** (decision 0419).

## Why

The log exists to answer who did what, and the Admin is the one person asked. Narrowing it by
kind and by the person or Cell concerned is how an Admin finds one entry among thousands; a date
filter was left out for the pilot because newest first already puts the question that is usually
asked, what happened lately, on the first page.

---

Decision 0428, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 7, 19, 21 and 22.

Previous: [2026-11-03 — The Cells list shows each Cell's ID under its name](0427-the-cells-list-shows-each-cell-id.md)
