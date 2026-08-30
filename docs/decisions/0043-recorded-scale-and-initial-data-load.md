# 2026-08-20 — Recorded scale and initial data load

The church runs roughly 800 active Cells with 3,000 to 4,000 attending DCC weekly, giving around 50,000 attendance records a month. That is a small PostgreSQL database and changes no technology choice, but it makes materialized closed months and first-migration indexes requirements rather than optimisations.

Initial encoding is a distinct phase: Admin imports the leadership tree centrally, and each Cell Leader encodes their own members. Cell-creation approval and individual attribution are relaxed for that phase only; duplicate matching applies at full force, since a large encoding effort across many hands is the likeliest source of duplicates this system will see. Written to `SKILL.md` §2.

---

Decision 0043, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Submission rolls up to the nearest upline with an account](0042-submission-rolls-up-to-the-nearest-upline-with-an-account.md) | Next: [2026-08-20 — Cell creation is request then approve](0044-cell-creation-is-request-then-approve.md)
