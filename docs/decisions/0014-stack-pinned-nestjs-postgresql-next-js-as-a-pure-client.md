# 2026-08-20 — Stack pinned: NestJS, PostgreSQL, Next.js as a pure client

Settled in `SKILL.md` §2 (Chosen stack). Two requirements decide it.

Authorization must be enforced structurally: §7 makes the API the sole authority across roughly forty endpoints, and on a team a per-handler convention is only as reliable as the least familiar developer writing the newest route. NestJS guards fail closed.

Mobile clients cannot be force-updated, so the API must deploy independently of the web application. Separate deployables is a requirement, not a preference.

The Next.js application carries no API routes and no server actions. If that boundary proves hard to hold, replace it with a plain React SPA.

---

Decision 0014 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-19 — Role catalog](0013-role-catalog.md) | Next: [2026-08-20 — Three client surfaces used concurrently](0015-three-client-surfaces-used-concurrently.md)
