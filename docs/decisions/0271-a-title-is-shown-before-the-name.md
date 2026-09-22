# 2026-09-22 — A title is its own field, shown before the name and never compared

Decision 0116 kept Bishop, Pastora and the like out of every name field, because a name
field is compared as a name, and it left open where a title does go. The owner's Claude
Design typed titles into names, and not consistently: one senior pastor appeared with
"Bishop" in one place and without it in another. The owner chose this answer from a
drawing of that design beside this one.

## The ruling

**A Person has an optional `title`**, stored apart from the name. Blank is stored as null,
and a database constraint refuses a blank value.

**A displayed name puts it first**: "Bishop Carlo Diaz" on the person's record, in lists,
paths and pickers. The name fields stay as they were.

**Duplicate matching and search never read it.** The same person entered with and without
a title is still a Tier 1 duplicate, and the duplicate list shows the name it matched,
without the title.

**`people.edit_basic` sets and clears it**, alongside the name.

## Why

It is display. No report counts a title and no rule reads one, so it is not effective-dated,
and a past period shows the current title. That is the cost decision 0116 named, and it is
accepted because nothing depends on a past title.

Rejected: a label derived for the two Senior Pastors alone, which cannot say Bishop or
Pastora and leaves every other title unstated.

---

Decision 0271, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-21 — Why a person has no pastoral leader is derived, and the server says it](0270-why-a-person-has-no-pastoral-leader.md)
