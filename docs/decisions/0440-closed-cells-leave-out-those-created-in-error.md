# 2026-11-05 — Closed Cells leave out those created in error, until asked for

On 2026-11-04 the owner asked for the Cells closed as *Created in error* to be deleted, to keep the
app tidy. Deleting them was advised against: history is never deleted (decision 0078, and the
database refuses the delete), and the record of who created and closed each one would go with it.
On 2026-11-05 the owner chose instead, from screenshots of the Admin's *Closed Cells* on a phone and
a laptop, to have them hidden behind a button and the reason said once.

## The ruling

**1. The closed view leaves out a Cell closed as created in error, unless asked for.** It never ran
and counts for nothing (decisions 0283, 0286 and 0330), and it crowded the list of Cells that did.
It is kept, and nothing about it changes: it is still in the database, still in the audit log, and
still found by asking for it.

**2. The counts route says how many it left out.** `GET /api/v1/cells/counts` carries
`created_in_error`, the number of closed Cells in the reader's scope that were closed as created in
error, as decision 0309 put the Cells page's totals there: a collection returns no total (Section
22). The screen offers *Show N created in error* while there are any, beside *Show only Cells I
led*, saying *those* in place of the number while a search or *Show only Cells I led* is set, as the
number counts the whole scope; `?include_created_in_error=true` adds them to the list in Cell ID order. Asked of the
running Cells, the parameter is refused. Where the whole scope's list is empty while some are left
out, it says so.

**3. A note that only repeats its reason is not shown again.** Where a closure's note says no more
than its reason, as "created in error" under *Created in error*, the reason is said once; a note
that adds anything, such as which Cell it duplicated, is shown.

**4. Nothing else changes.** Who may see a closed Cell, restarting one (which a Cell created in
error never offers), and every figure are as they were.

## Why

The closed view is where a restart is asked for and where a leader's past Cells are found, and the
Cells that never ran were most of what it showed. Hiding them by default keeps that list to Cells
that ran, without deleting a record the rules keep.

---

Decision 0440, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 15, 19 and 22.

Previous: [2026-11-04 — The phone's two bars: room for the home line, a light tab bar, and the name on top](0439-the-phones-bars.md)
