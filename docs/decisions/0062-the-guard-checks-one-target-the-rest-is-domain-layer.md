# 2026-08-20 — The guard checks one target; the rest is domain layer

A grant's scope is evaluated against the request's primary target. Where a rule concerns other objects — §5's requirement that both the source and destination leader be in scope, and that the actor act on neither themselves nor an upline — those are checks in the owning module's domain layer, additional to the guard and never expressible as a scope value.

Stated because a capability and a scope cannot express three objects with three different rules, and a developer who implements the guard and believes the rule is implemented has built half of it. `SUBTREE_EXCL_SELF` survives for `cell.request_creation` alone, where the only prohibited object is the target. Written to `SKILL.md` §7.

---

Decision 0062, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Every required structure is named and indexed](0061-every-required-structure-is-named-and-indexed.md) | Next: [2026-08-20 — `read_only` is valid only on a read capability](0063-readonly-is-valid-only-on-a-read-capability.md)
