# 2026-08-22 — `people.correct_sex`, the twenty-fifth capability, Admin-only


Found by the third `architecture-guardian` pass, and it predates this branch:
§7 declares its capability list closed, §7 says sex "is governed by its own
capability", and no such capability existed. §7 also rules that an endpoint
declaring no capability is denied — so the Stage 2 sex-correction endpoint,
whose behaviour this branch had just specified in detail, could not have
declared a guard at all.

**Admin alone, Whole Church.** Not Senior Pastors, not Leaders. Correcting a
person's sex moves them between Networks and can change totals for periods
already reported, which is the property that keeps `people.merge` and
`records.backdate_effective_date` with the role whose job is data correction. It
also forces the pastoral reassignment §4 requires, so a leader holding it would
have a route to moving people between Networks without ever invoking
`people.manage_pastoral_assignment` — the same escalation §7 closes by keeping
sex out of `people.edit_basic`.

Folding it into `people.manage_lifecycle` was rejected. It adds no name to a
closed list, which is the only thing in its favour, and it would hand Senior
Pastors the power to move people between Networks while bundling two unrelated
rules under one grant.

Landed in one change across the five places a closed enumeration lives: the §7
list, the role catalog, the §4 text that now names it, the `capability` enum in
0001, and `capabilities.ts`. The enum order is asserted against
`ALL_CAPABILITIES`, so the two cannot drift. `read_only` on it is rejected at
creation, since it is a write.

---

Decision 0083, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — A Network change is refused while the person leads anyone](0082-a-network-change-is-refused-while-the-person-leads-anyone.md) | Next: [2026-08-22 — Idempotency covers the authenticated write surface, and applies by default](0084-idempotency-covers-the-authenticated-write-surface-and.md)
