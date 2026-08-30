# 2026-08-20 — Migrations are hand-written SQL, and there is no ORM

Migration files are plain SQL applied in order by a small runner in the repository. Data access is a typed query builder over the PostgreSQL driver.

Both fall out of §5 rather than from taste. The partial unique index, the check constraint, the `DEFERRABLE INITIALLY DEFERRED` constraint trigger and the `CYCLE` clause are not expressible in any ORM's model, and a tool that generates migrations by diffing a model against the database proposes dropping what it cannot see — on every migration, forever. An ORM would therefore have to be fought on exactly the parts of the schema the specification cares most about.

The accepted cost is that table types are hand-written and reviewed rather than generated, kept honest by the schema tests. Written to `SKILL.md` §2 (Chosen stack).

---

Decision 0064 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — `read_only` is valid only on a read capability](0063-readonly-is-valid-only-on-a-read-capability.md) | Next: [2026-08-20 — An endpoint that declares no capability is denied](0065-an-endpoint-that-declares-no-capability-is-denied.md)
