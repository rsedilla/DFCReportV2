# 2026-08-22 — A sign-in landing inside a revocation's transaction survives it

The marker is the boundary. A refresh token whose `issued_at` is at or before `sessions_revoked_at` is dead whatever its own row says; one issued after it is a new session and is untouched.

Found by `architecture-guardian` reviewing the lock-order fix. Issuing a refresh token takes no lock on the account — the foreign key's `FOR KEY SHARE` does not conflict with the `FOR NO KEY UPDATE` the revocation holds — so a sign-in can commit inside the revocation's transaction, after the marker's timestamp is read and before the transaction commits. The code let it survive, one comment asserted it was killed, and `SKILL.md` did not address it at all, so the behaviour was a consequence of a lock mode rather than a rule anyone had chosen.

`FOR UPDATE` would close the window, by making the insert's foreign-key check wait on the account row too. It is rejected because it achieves nothing: revocation ends the sessions that existed when it ran and was never a bar on signing in again, so somebody holding the password succeeds a moment later regardless. The window is not a security boundary and cannot be made into one by a lock.

It is **not** rejected on the cost first recorded here, that it would put a lock on the sign-in path. Sign-ins already wait on that row — `recordLogin` stamps `last_login_at` on the account before a token is issued — so most of that cost is paid already, and the window is correspondingly narrower than it looks: reaching it needs `recordLogin` to have committed before the revocation took the row, leaving only the insert inside. The first version of this entry had the cost wrong and the conclusion right, which is worth recording, because the reason is the part that gets reused.

Written to `SKILL.md` §6, which now carries three rules for immediate revocation rather than two.

---

Decision 0079, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-21 — A row of an effective-dated table is never deleted](0078-a-row-of-an-effective-dated-table-is-never-deleted.md) | Next: [2026-08-22 — Seven Stage 2 rulings, settled before any Stage 2 code](0080-seven-stage-2-rulings-settled-before-any-stage-2-code.md)
