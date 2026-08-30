# 2026-08-20 — Nine modules, each owning its tables

**Partly superseded** on 2026-08-26 by "A module's tables are never written by another" below. "No other module touches them directly" is the half that was narrowed: no other module *writes* them, and one reads them where the query is rooted in a table it owns. Everything else here stands, and the reason the rule exists is unchanged.
`people`, `networks`, `hierarchy`, `auth`, `cells`, `attendance`, `reporting`, `audit`, `admin`. A module owns its tables and no other module touches them directly; cross-module access goes through the owning service interface.

Named because Principle 13's modular monolith is otherwise just a monolith, and because it is what makes "enforced in the domain layer" real: the five §5 invariants have one home only because `hierarchy` is the only writer of `pastoral_assignments`. Organise by module, never by layer. Written to `SKILL.md` §2.

---

Decision 0060 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Three reporting questions are deferred to implementation](0059-three-reporting-questions-are-deferred-to-implementation.md) | Next: [2026-08-20 — Every required structure is named and indexed](0061-every-required-structure-is-named-and-indexed.md)
