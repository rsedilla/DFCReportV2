# 2026-08-20 — Cell monthly attendance reverts to attendees, with a separate roster view

Three attempts to make one report both reconcile and show non-attenders all failed. Attendee-only could not show who was missing; the membership window left people unbucketed; the member population filtered by lifecycle and so broke reproducibility.

They are two jobs, not one. The **monthly report** is statistical: attendee population, reconciles, reproducible, and classification is evaluated as of month end so a closed month stops moving. The **roster view** is operational: every current member and who came, no buckets, reconciles with nothing, and is explicitly not reproducible for a past period.

Monthly-attendance buckets are now a Cell-scope view only. N belongs to a Cell, so aggregating across Cells with different N makes `Completed` mean "attended everything their own Cell happened to record" — inflated by exactly the Cells that recorded least, which is the Goodhart pattern §13 exists to prevent. DCC aggregates because one event set covers the whole church. Written to `SKILL.md` §12, §9, §15, §16, §20.

---

Decision 0058, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — A schedule change takes effect the following month](0057-a-schedule-change-takes-effect-the-following-month.md) | Next: [2026-08-20 — Three reporting questions are deferred to implementation](0059-three-reporting-questions-are-deferred-to-implementation.md)
