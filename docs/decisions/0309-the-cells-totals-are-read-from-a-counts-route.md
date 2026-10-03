# 2026-10-03 — The Cells totals are read from a counts route

Decision 0289 put two totals at the head of the Cells page — the Cells a person leads and the
Cells in their scope — and said they count every page of running Cells, since the list
returns no total. Counting that way read every Cell with its month's figures, twice, for two
numbers. Section 22 says a collection returns no total, and that totals have their own
endpoints.

The owner chose a counts route over leaving the totals as they were (checklist row
perf-cells-totals).

## The ruling

**`GET /api/v1/cells/counts` returns the two totals: `in_scope`, the running Cells
`GET /api/v1/cells` lists for the reader, and `led_by_me`, those it lists with
`led_by=me`.** Nothing else: no figures, no rows.

**It counts the list's own set.** The same capability against the reader, `cell.view_subtree`,
the same scope, and the same running Cells, so a total can never count a Cell the list would
not show. It names no period and asks about now (Section 7), as the totals are dated as of
today.

## Why

Two numbers should cost two counts, not a read of every Cell in the church. Answering the
totals from the list's own set keeps decision 0289's promise that each total is the filter
showing those Cells.

---

Decision 0309, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-02 — A read of up to 50 named people needs no cursor, and leaves out who the reader may not see](0308-a-read-of-named-people-needs-no-cursor.md)
