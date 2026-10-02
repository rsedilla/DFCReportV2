# 2026-10-02 — A read of up to 50 named people needs no cursor, and leaves out who the reader may not see

The People list asked for each row's Cell one request at a time. A read answering the
page's people at once is faster, and Section 22 asks every collection to page by cursor
and says nothing of a read whose people the caller names. Asked on 2026-10-02, the owner
chose to allow it.

## The ruling

**1. A read that answers people the request names, at most 50, is not a collection in
Section 22's sense, and carries no cursor.** It always fits in one answer, so a cursor
would only ever say there is nothing more.

**2. A person the reader may not see is left out of the answer, and so is an identifier
naming nobody.** Asked about one at a time, each would be refused; leaving them out tells
the reader nothing more.

**3. The first such read is `GET /api/v1/cells/people/membership`**, the People list's
Cell column, under `cell.view_subtree` per person (decision 0248).

## Why

The rule exists so that no client is handed a list longer than it can take, and a read
whose length the client chooses, up to a fixed bound, cannot be one.

---

Decision 0308, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-01 — An administrator disables and re-enables an account from the person page](0307-an-administrator-disables-and-re-enables-an-account.md)
