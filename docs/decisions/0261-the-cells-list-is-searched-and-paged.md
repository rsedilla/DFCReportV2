# 2026-09-20 — The Cells list is searched and paged, and each row carries its size

Section 2 records roughly 800 Cells. The Cells screen read one page of fifty and offered no way
to the rest, so a whole-church reader saw the first fifty and nothing said so. On 2026-09-20 the
owner asked what happens at that size and chose a search over the whole scope rather than a
filter over the page on screen.

## The ruling

**1. `GET /api/v1/cells` takes `q`**, which narrows the page to Cells whose identifier contains
the term, where the term carries a digit, or whose leader's name contains it, normalized. Two
characters minimum, counted on the term as it is searched, as the Person search counts it
(decision 0259). It narrows what the reader's scope already lists and widens nothing, so no
capability moves.

**The digit rule is not a nicety.** Every identifier begins `CELL-`, so matching a letter prefix
would return the whole scope, and the digits a leader reads off a row are not at its start.

**2. It never reorders.** The list stays in Cell ID order, searched or not: ordering a list of
Cells by anything a leader could read as a score is what decision 0009 refuses.

**3. Each row carries the Cell's name — its category and meeting day — its identifier, and its
current member count**, so the list says which Cell it is and how big, without opening it.

**4. The screen pages ten at a time, with Previous and Next**, and states no total (Section 22).
Changing the month, the Mine filter or the term starts the list again, because a cursor belongs
to one set of rows.

## Why

**A filter over the page on screen would search ten Cells out of eight hundred.** The design's
box said "in this view", and at church scale that finds nothing; only the server can narrow the
whole scope.

**Searching by a leader's name is how somebody looks for one Cell**, which is why the search
joins `persons` onto a query rooted in `cells` — Section 2's exempt shape, named in
`api/module-boundaries.json`.

**The audit found three other lists worth the same treatment.** DCC coverage gaps could not be
read past its first page at all; people without a Cell and people awaiting reassignment stepped
forward and back to the start but never back one page. Each now pages with Previous and Next. No
rule changes for those: Section 22 already pages them, and the screens did not.

---

Decision 0261, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-19 — A person's page carries their Sundays of the month, counted out of N](0260-a-persons-page-carries-their-sundays-of-the-month.md)
