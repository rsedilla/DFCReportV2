# 2026-08-20 — Invariant 4 answers `SCOPE_DENIED`, not `INVARIANT_VIOLATION`

A leader acting on their own assignment, or on an upline's, is refused with `SCOPE_DENIED` even though the check runs in the `hierarchy` domain layer rather than in the guard. It is a statement about the actor's authority over a target, which is what that code means.

`INVARIANT_VIOLATION` stays for a record the rules reject however it was submitted and by whomever: a cycle, a cross-Network edge, a second active assignment. §22 distinguishes the codes so an administrator can tell which half of a grant failed, and that only survives if domain-layer authority checks answer the same way the guard does. Written to `SKILL.md` §22.

---

Decision 0066 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — An endpoint that declares no capability is denied](0065-an-endpoint-that-declares-no-capability-is-denied.md) | Next: [2026-08-20 — The eleven authorization cases ship failing, in their own CI job](0067-the-eleven-authorization-cases-ship-failing-in-their-own-ci.md)
