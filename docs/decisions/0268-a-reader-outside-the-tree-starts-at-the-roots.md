# 2026-09-21 — A reader outside the pastoral tree starts the Network screen at the roots

Decision 0252 said what the Network screen shows and not where it opens. It opened on the
reader's own branch, which for an administrator holding no pastoral assignment is empty:
"Nobody reports to you today", with the whole church in scope and nothing to click. The
demo walkthrough of 2026-09-21 found it, and the owner chose this answer from a drawing of
both.

## The ruling

**The screen opens on the reader's own branch, as before. A reader holding no pastoral
assignment opens instead on the Network roots their `people.view_subtree` reaches**, by
name, each with its branch's headcounts and its figures for the month.

**`GET /api/v1/network/my-tree` carries them as `roots`**, empty for anybody holding an
assignment, a root included. Each root is asked of the same guard `GET
/api/v1/leaders/{id}/children` declares, so the list offers no root whose branch the reader
would then be refused: a Whole Church grant reaches both, a `NETWORK` grant its own.

**A root row offers Open and nothing else**, because a root is never moved (Section 5).

## Why

Everyone in the tree already starts somewhere useful, so they are left alone. Whether a reader
holding no assignment who still has disciples should start on their own branch instead is
recorded as open in `CLAUDE.md`.

---

Decision 0268, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-21 — Behind is the meetings that have come and have no record, and the Cells list counts them](0267-behind-is-the-meetings-that-have-come.md)
