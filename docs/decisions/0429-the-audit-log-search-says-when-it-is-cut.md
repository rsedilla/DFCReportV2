# 2026-11-03 — The Audit Log's name search says when it is cut

Decision 0428's search turns a name into the people it matches before it reads the log, and
looks through at most 1,000 of them, in first-name order. `architecture-guardian`'s review of
that ruling found the answer looked complete when more matched: the entries of everybody past
the cut were left out with nothing saying so, the shape `CLAUDE.md` already records as open for
the duplicate-candidate lookup. The owner was shown what other systems do and chose on
2026-11-03 to keep the ceiling and say when it is reached.

## The ruling

**1. A name search looks through at most 1,000 people, and says so when more match.** The
answer carries `truncated: true`, and the tab says "More than 1,000 people match "ma", so some
entries may not be shown. Type more of the name, or use a Member ID." A search by Cell ID is
not cut.

**2. The two-letter minimum is counted on the name as it is searched**, as the People search
counts it: `a-`, `a'` and ` a` are one letter once the name is cleaned up, and `Jr` is none, so
each is refused with the field named. A Member ID is matched by its start and needs no such count.

## Why

A list that stops early and looks whole is the one answer an Admin cannot act on, because nothing
tells them to look again. Systems that cap a search say so and ask for a narrower term, which is
what this does. The ceiling itself stays: it bounds the work one search can cause, and a real
name rarely matches a thousand people.

---

Decision 0429, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 19 and 22.

Previous: [2026-11-03 — The Admin's Audit Log tab](0428-the-audit-log-tab.md)
