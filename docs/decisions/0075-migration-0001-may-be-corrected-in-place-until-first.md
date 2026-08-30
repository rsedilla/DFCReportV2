# 2026-08-21 — Migration 0001 may be corrected in place until first deployment

Twice now a defect in `0001_foundations.sql` has been fixed by editing the file rather than by writing a new migration, and both times the choice was made without being recorded. The Running the project section says an applied migration is checksummed and that editing one is refused, so this is either a ruling or it stops.

**It is allowed, and the allowance ends at first deployment.** No durable database has applied 0001: CI builds the schema from empty on every run, and nothing is deployed anywhere. There is no history for a checksum to disagree with, and the alternative is beginning Stage 2 on a schema whose first migration is known to be wrong, carrying a corrective migration that exists only because of the order we happened to review in.

The cost is real and accepted: a developer who applied 0001 locally sees `migrate:up` refuse the changed checksum and must rebuild their development database. That is a minute of work now and impossible later, which is the whole distinction.

**The phase ends the first time this schema is applied to a database anybody depends on.** From that point 0001 is immutable and every correction is a new migration, as the migration policy says. This mirrors the initial-encoding relaxation in §2: a relaxation attached to a phase with no defined end is a permanent relaxation, so the end is defined here.

---

Decision 0075, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-21 — Twelve findings from the Stage 1 verification, and why they existed](0074-twelve-findings-from-the-stage-1-verification-and-why-they.md) | Next: [2026-08-21 — Simultaneous presentation of a refresh token is not reuse](0076-simultaneous-presentation-of-a-refresh-token-is-not-reuse.md)
