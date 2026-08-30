# 2026-08-20 — An endpoint that declares no capability is denied

`SKILL.md` §2 already said a NestJS guard fails closed; §7 now says what that means as a rule, and names the only two exemptions: an endpoint reachable without authentication, and an endpoint that requires authentication and acts solely on the caller's own session. Each names its reason where it is written, so the whole exempt set is one search.

Stated as a rule because the alternative failure is silent. An endpoint missing its declaration looks exactly like an endpoint that needs no declaration, and on a team the difference is invisible in review unless the guard refuses it. Written to `SKILL.md` §7.

---

Decision 0065, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Migrations are hand-written SQL, and there is no ORM](0064-migrations-are-hand-written-sql-and-there-is-no-orm.md) | Next: [2026-08-20 — Invariant 4 answers `SCOPE_DENIED`, not `INVARIANT_VIOLATION`](0066-invariant-4-answers-scopedenied-not-invariantviolation.md)
