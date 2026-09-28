# 2026-09-28 — Church-wide search is bounded and recorded

Section 8 keeps the church-wide directory reachable from the person pickers, and decision
0244 left two questions open: whether a leader may reach it outside a picker, and whether
a search reaching it is written to the audit log. The API cannot tell a picker's request
from any other, so a leader's own login could page the whole church, two letters and 200
rows at a time, with nothing recorded. The owner chose on 2026-09-28 to keep the directory
for the pickers and to make scraping it slow, small and visible.

## The ruling

**1. A church-wide search needs a term of at least three characters** once normalized. A
search of the searcher's own scope still needs two.

**2. A church-wide search returns at most 20 people per request.** With no `limit` it returns
20, and a `limit` above 20 is refused as `VALIDATION_FAILED` rather than quietly cut, as
Section 22 refuses a cursor it cannot resolve. The pickers page on with Show more. Section 22's maximum of 200 still governs every other collection, the searcher's
own scope included.

**3. An account may make at most 30 church-wide searches a minute.** Past it the search is
refused as a rate limit (Section 24) until the minute has passed. It is counted per account.

**4. Every church-wide search is written to the audit log:** the account that searched, the
term as searched, and how many people that request returned. The entry targets the searching account, as
the second sign-in step's entries do. It writes one entry per request, Show more included,
and none for a refused search.

**5. All four apply to every request sending `church_wide=true`,** whoever sends it. An
administrator or a Senior Pastor, whose own scope is already the whole church, is bounded
and recorded the same way. One rule is simpler to state and to test than one that asks
whether this particular search reached past the searcher's scope.

## What it does not settle

Whether a leader may reach the directory outside a picker stays open. Any leader can still
send the flag from their own login. This ruling makes doing so slow, small and recorded, and
does not confine it.

## Why

A scraper needs many searches, short terms and large pages. Each limit takes one of those
away, and the audit entry turns what remains into something an administrator can find.

---

Decision 0303, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-28 — Administrators and Senior Pastors sign in with a second step](0302-administrators-and-senior-pastors-sign-in-with-a-second-step.md)
