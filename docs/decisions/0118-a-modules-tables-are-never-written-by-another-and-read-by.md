# 2026-08-26 — A module's tables are never written by another, and read by one only where the query is rooted elsewhere


§2 said "**A module owns its tables.** No other module reads or writes them
directly", and the code never matched it. `hierarchy` joins `persons` in two
queries, and when `people` was split into five services somebody — me —
narrowed the rule *in `people.module.ts`'s comment*, on the reasoning that a rule
stated more strongly than the code keeps stops being checkable.

That is right about the danger and was the wrong remedy. Narrowing a rule in one
module's comment leaves every other module to find that comment or not, and a
reviewer to discover that the specification and the code disagree with nothing
saying which governs. Stage 3 builds `cells`, whose author would have found the
comment before the section.

**So the rule is narrowed where it is the rule.** No other module *writes*, ever,
and none reaches a table for anything a service interface can answer. One exemption,
named: a read joined onto a query rooted in a table the reading module owns.
`hierarchy`'s two joins qualify because both start from `pastoral_assignments`,
which `people` cannot query — so the join cannot move to the owning module, and
returning identifiers for the caller to resolve moves it rather than removing it.

**The asymmetry is the point.** A write is what an invariant guards, which is why
§2 gives the five §5 rules one home only while `hierarchy` is the sole
writer of `pastoral_assignments`. A join reads rows the owning module would have
returned anyway.

*The first version of the amendment described the exemption from what it was for
rather than from the queries, and both halves were false: it placed the joins in
`hierarchy`'s recursive walks, which select identifiers and join nothing, and
justified them by "one query into hundreds", which is impossible for
`directLeaderNameOf` because it returns at most one row. Found by
`architecture-guardian` on the third pass — in the paragraph added to stop
exactly that, which is the tenth instance on this project.*

**The exemption list is declared closed with nothing able to fail on it**, and that
is recorded as open below rather than claimed as settled. This repository gates the
pure-client boundary, the refused UI packages, the palette token names and the
module graph; a cross-module table read is greppable in one line and has no gate.

---

Decision 0118, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-25 — The first Admin account is a one-time command, and an administrator need not be in the tree](0117-the-first-admin-account-is-a-one-time-command-and-an.md) | Next: [2026-08-26 — The bootstrap's two service methods guard themselves, and `ts-node` ships](0119-the-bootstraps-two-service-methods-guard-themselves-and-ts.md)
