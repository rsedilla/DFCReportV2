# 2026-10-08 — People I oversee stops two levels down

Record's *People I oversee* lists the outstanding Cell meetings and DCC Sundays of everyone beneath
the reader (decisions 0258, 0301 and 0322, point 4). With about a thousand leaders signing in, a leader
near the top of a large branch gets a list too long to follow up. The owner chose, from the
example Raymond → Jhoemar → Dave → Angelo, that Raymond follows up Jhoemar and Dave, and Dave
follows up Angelo, as each leader looks after their own 12.

## The ruling

**1. For a Leader account with Full view, *People I oversee* stops two levels down** (owner,
2026-10-08): the reader's direct leaders and their direct leaders, in the pastoral tree as it
stands now. A Leader account without Full view keeps its direct leaders alone (decision 0323).
This narrows decisions 0258, 0301 and 0322 point 4 for a Leader account.

**2. A row's depth is the depth of the leader who owes the record**: the one who files the Cell
meeting, or who records the DCC line (Section 9's submitter). The API returns no row whose owing
leader is deeper than point 1 allows, and the reader's own rows stay. For a Leader account, **a DCC row
whose submitter as of the Sunday was nobody, or is outside the pastoral tree beneath the reader
as it stands now, is not listed** (owner, 2026-10-08): nobody beneath the reader owes it. It still counts in every figure.

**3. It narrows a list and nothing else.** A deeper leader still counts in every figure, and the
reader may still read them wherever else they could. A Senior Pastor's and an Admin's list is
unchanged, and so is that of an account that also holds `SENIOR_PASTOR` or `ADMIN`.

**4. What the build's tests must show**, at the API: a Leader account with Full view gets its own
rows and those of its direct leaders and theirs, and none whose owing leader is three levels down;
a DCC line owed by a direct leader for the people of a leader with no account two levels further
down is listed; a DCC line with no submitter as of its Sunday, or one whose submitter is outside the
reader's branch now, is not; without Full view, its own rows and its direct leaders' only; and a Senior Pastor's
and an Admin's list is unchanged.

---

Decision 0324, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-08 — Full view, and the screens of a leader who records](0323-full-view-and-the-recording-screens.md)
