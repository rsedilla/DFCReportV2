# 2026-09-28 — The branch view lists DCC too

Decision 0258 point 4 kept DCC out of the Record page's *People I oversee* view: a DCC
checklist is its leader's own, and no screen records on another leader's behalf, so a
Sunday row would offer no act. The owner found the Whose switch doing nothing on the DCC
list, saw a preview running on 2026-09-28, and approved this version, knowing it reverses
that point.

## The ruling

**1. *People I oversee* lists DCC as well as Cell meetings.** One row per Sunday that takes a
record now and per leader in the reader's branch with no DCC record for it, the reader
included, by date and then by name (`GET /api/v1/dcc/owed?month=`). "No record" is coverage's
unit (decision 0224), the same as the Network screen's DCC figure, so a leader partly
through their checklist is not listed.

**2. The branch is the pastoral tree beneath the reader as it stands now**, narrowed to
the leaders `dcc.view_subtree` covers, as for Cell meetings (decision 0258). A Whole Church
grant does not make it the whole church.

**3. The reader's own row carries Record**, and so does the row of a leader holding no
account whose records fall to the reader (section 9), since that leader's people are on the
reader's own checklist. **Any other leader's row carries See checklist**, which opens that
leader's checklist for the month below the list, read only
(`GET /api/v1/dcc/leaders/{id}/checklist?month=`, `dcc.view_subtree` against the leader):
the people whose record they owe that the reader may see now, and each Sunday's mark.
**Such a row does not resolve itself from here**, an exception to section 19's "each entry
carries the action that resolves it"; recording on another leader's behalf is the next
step.

**4. The DCC count on the Record page follows Whose**, as the Cell count does. The reader's
own checklist grid stays under the list until a leader's checklist is opened.

## Why

A switch that changes nothing on one of its two lists reads as broken, and an upline
following up on a downline's DCC records is exactly what the view is for.

---

Decision 0301, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-28 — An account's address is corrected before it is activated](0300-an-address-is-corrected-before-activation.md)
