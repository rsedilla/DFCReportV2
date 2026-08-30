# 2026-08-20 — Three client surfaces used concurrently

Desktop web, mobile web, and native Android/iOS, against one API, by the same people at the same time. Consequences written to `SKILL.md` §2, §6, §14, §23, §24:

- token-based authentication from the first release, never cookie-sessions retrofitted later
- several concurrent sessions per account; sign-out is per device, revocation is account-wide
- version checks on updates, with conflicts resolved by a person rather than by last-write-wins
- idempotency keys, client-generated UUIDs, and server-side sync validation required from the first write endpoint

---

Decision 0015, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Stack pinned: NestJS, PostgreSQL, Next.js as a pure client](0014-stack-pinned-nestjs-postgresql-next-js-as-a-pure-client.md) | Next: [2026-08-20 — DCC has no meeting status](0016-dcc-has-no-meeting-status.md)
