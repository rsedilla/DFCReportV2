# 2026-08-20 — Cell monthly attendance reports on members

**Superseded** by "Cell monthly attendance reverts to attendees" below. A member population filters by lifecycle, because archival ends membership, which breaks the §3 rule that period-based reports are never filtered by current lifecycle state. It also made `None` and `Completed` overlap whenever a Cell had recorded no meetings.
The population of a Cell's monthly report is the Cell's members at month end, not only those who attended. Buckets gain `None`, and the classification view gains `Not yet attended`, so both views cover the same people and reconcile to the member count.

The denominator N is the Cell's recorded meetings for the month and belongs to the Cell, so every member is measured against the same N and `Completed (N/N)` means one thing on the screen. A member's count is their Cell attendance anywhere that month, capped at N, so someone who moved mid-month keeps credit for meetings they attended before moving.

Chosen over the two attendee-only alternatives because a report listing only the people who came cannot show a leader who did not come — and that person is the one most worth seeing. DCC keeps the attendee-only population, because a church-wide service has no roster to report against. Written to `SKILL.md` §12 and §20.

---

Decision 0056 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Monthly attendance is measured over the membership window](0055-monthly-attendance-is-measured-over-the-membership-window.md) | Next: [2026-08-20 — A schedule change takes effect the following month](0057-a-schedule-change-takes-effect-the-following-month.md)
