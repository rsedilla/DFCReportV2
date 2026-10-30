# 2026-10-30 — The Admin amends a closed week from its own screen

Owner ruling, decided on 2026-10-27 from screenshots of a closed Cell meeting and a closed DCC
Sunday, to be built after Monday 2 November once it was seen how often a closed week needs
correcting; confirmed on 2026-10-30 from the same design redrawn on the real screens.

## What was missing

Sections 9 and 13 let an account holding `records.backdate_effective_date` over the whole church
amend a closed week, with a reason the audit log keeps, as a flag on the ordinary save. No screen
offered it: a closed week read "This week is closed, so this meeting can no longer be changed"
for everyone, the Admin included, so the only way to correct one was a request nobody could send
from the app.

## The ruling

**1. On a Cell meeting or a DCC Sunday whose week has closed, the Admin sees** "This week is
closed. Only the Admin may amend it, with a reason that is kept in the audit log." and an
**Amend Closed Week** button. That is offered to an account holding `records.backdate_effective_date`
at Whole Church, which by default is the Admin alone; the server still decides every save
(Sections 9 and 13). A week closed for another reason, a Sunday with no service or one not yet
held, offers nothing, and so does the meeting of a closed Cell, which Section 7 resolves through
nobody once its week has shut.

**2. Amending opens the page as it is while the week is open**: a recorded meeting's marks and,
where it was recorded as met or not met, that answer; a meeting with no record, the whole form;
a Sunday's checklist. It asks **"Why is this closed week being amended?"**, which is required, and
saves with **Save Amendment**. The save carries the amendment and its reason, and Cancel leaves
everything as it was. The reason is part of what is sent, so a changed reason is a new save.

**3. Leaders see no change.** They keep today's closed page, and nothing else moves.

**4. One reason** (owner, 2026-10-30, from `architecture-guardian`'s review). Where the Admin also
corrects whether the meeting took place, or a recorded mark, the amendment's reason is sent as the
correction reason too, so it is asked once and kept in the meeting's or line's history as well as
the audit log.

**5. A person's Sunday opens the checklist it is on** (owner, 2026-10-30). The Admin's own DCC
checklist holds only the Network roots, so "Open Sunday" on a person's page led nowhere useful for
anyone else. `GET /api/v1/dcc/people/{id}/attendance` now tells an account holding
`dcc.submit_on_behalf` and `dcc.take_attendance` at Whole Church, and nobody else, whose checklist
each line is on (`checklist_of`), by Section 9's submitter walk as of that Sunday from the line's
responsible leader; "Open Sunday" then opens that leader's checklist, where a closed week can be
amended. Null where the walk reaches nobody or the line is a Network root's own.

## What it does not change

What an amendment may do, who may make one, or what it writes (Sections 9, 13 and 21): the
server already took the amendment and audited it. No record or migration changes; one route
gains the field in point 5.

Decision 0411, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 9 and 13.

Previous: [2026-10-30 — A form is as wide as a list, and is set out in sections](0410-a-form-is-as-wide-as-a-list-in-sections.md)
