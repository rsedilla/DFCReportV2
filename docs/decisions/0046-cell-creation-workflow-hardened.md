# 2026-08-20 — Cell creation workflow, hardened

Third architecture review found nine problems with the workflow as first written. The rules now standing:

Creation is reachable only through request-and-approve. `cell.manage_lifecycle` governs closure and confers no power to create — previously it did, at own/subtree, which made the whole workflow optional.

Nobody may name themselves on a request. A leader whose only Cell closed keeps their account and could otherwise restore their own Current Cell Leader status with no upline involved. §5 invariant 4 writes the same prohibition for pastoral assignment.

Approval revalidates the target as of approval, not request: archived, merged, moved out of scope, or Network-changed all reject. Without it, approval would create a leadership assignment for an archived Person and provision their credentials.

The approval transaction opens the category and schedule rows, not only the Cell. A Cell without a schedule row has no coverage figure for its first month. Everything takes effect at approval, so a request made 30 September and approved 2 October belongs to October.

Requests are `PENDING`, `APPROVED`, or `DECLINED`, at most one pending per prospective leader, declines retained. Decline reasons are a fixed list — `LEADER_DEVELOPMENT_CONTINUING`, `TIMING_DEFERRED`, `DUPLICATE_REQUEST`, `SUBMITTED_IN_ERROR`, `OTHER` with a note — because a decline is a durable record about a named person and free text is where a judgmental label would be written.

Pending requests appear on the Admin dashboard. The earlier wording forbade any surface at all, leaving the approver nowhere to see a request that blocks a leader's account.

Written to `SKILL.md` §10, §7, §19, §21.

---

Decision 0046 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Admin creates the initial Cells](0045-admin-creates-the-initial-cells.md) | Next: [2026-08-20 — Initial encoding ends by an audited Admin action](0047-initial-encoding-ends-by-an-audited-admin-action.md)
