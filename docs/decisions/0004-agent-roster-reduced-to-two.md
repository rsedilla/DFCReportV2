# 2026-08-19 — Agent roster reduced to two

`architecture-guardian` and `qa-engineer` only. Builder agents for UI, frontend, backend, data, and reporting were cut: a subagent starts cold and must re-read `SKILL.md` before it can apply a single domain rule, which costs more than working sequentially in one session that already holds the context. Security review uses `/security-review`. A GitHub integration agent is deferred until a repository exists. Written to Agent Coordination above.

---

Decision 0004, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-19 — Network roots](0003-network-roots.md) | Next: [2026-08-19 — Cell meeting status extended to three](0005-cell-meeting-status-extended-to-three.md)
