# 2026-09-29 — A duplicate check that shows someone outside the branch is recorded

The scraping probe (decision 0303's test) found that Add a Person's duplicate check
confirms guessed whole names across the church: 141 people outside the leader's branch
from 81 requests, limited only by the general 120 a minute and written nowhere. It
cannot find a name the searcher does not already have, and Section 3 already keeps
birthdays and mobile numbers out of what it reveals. The owner chose on 2026-09-29 to
record it rather than limit it.

## The ruling

**1. A duplicate check that shows at least one Person outside the searcher's pastoral
scope is written to the audit log:** the account that looked, the first and last name as
typed, and the Persons outside the scope it showed. It records neither the birthday nor
the mobile number typed, which describe the person being added.

**2. One entry per request, targeting the searching account**, as a church-wide search's
entry does (decision 0303).

**3. A check that shows nobody outside the scope writes nothing.** So a searcher whose
scope is the whole church never writes one.

**4. No new limit.** The check runs as a name is typed, and a limit reached while
encoding would silence the warning the check exists to give.

## Why

The check confirms names rather than discovering them; discovering them goes through
the search, which decision 0303 already bounds and records. What was missing was a
trace of somebody working through a list of names, and only a check that shows someone
outside the branch can be that.

---

Decision 0304, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-28 — Church-wide search is bounded and recorded](0303-church-wide-search-is-bounded-and-recorded.md)
