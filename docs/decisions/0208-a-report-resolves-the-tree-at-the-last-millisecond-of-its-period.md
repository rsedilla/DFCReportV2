# 2026-09-05 — A report resolves the tree at the last millisecond of its period's final day

Decision 0205 settled that a report walks the pastoral tree as of the end of the period
being reported, and deliberately declined to fix the instant within that day, leaving it to
the first query. This is that query, and the item is retired.

## The question

Section 20 resolves a date-only value to 00:00 Asia/Manila. So "the end of October" admits
two readings — `2026-10-31T00:00+08:00`, or the last instant of that day — and they disagree
about every assignment recorded *on* the 31st. Under the first, a reassignment made that
morning is invisible to October's report; under the second it is not.

## The ruling: the last millisecond of the final day, which is `endOfManilaDay`

**No new convention.** Section 13 already had to name an instant for the identical reason at
the closure boundary, and `endOfManilaDay` already implements it — `recording-instant.ts`
uses it for a DCC record's responsible leader. Reporting adopts the existing helper rather
than deriving a second answer to the same question, which is what `CLAUDE.md` asked for when
it recorded the item.

Its docblock already carries the reasoning, and all of it transfers:

- **The last millisecond, not the next day's midnight.** Rows are in force over
  `[started_at, ended_at)`, so an assignment beginning exactly at midnight belongs to the
  following day. Handing that midnight back as "the end of this day" would pick up a
  November edge and place it in October's tree — the precise error this ruling exists to
  avoid.
- **A millisecond rather than a microsecond**, because that is the resolution both ends
  share: PostgreSQL stores `timestamptz` to the microsecond and a JavaScript `Date` holds
  milliseconds, so a microsecond step would not survive the round trip and would silently
  become no step at all. That is the repository hazard about carrying a database instant
  through a `Date`, met head-on rather than worked around.
- **The cost, stated where the helper states it.** An assignment whose boundary lands inside
  the final millisecond resolves to its predecessor. Nothing can place a boundary there
  deliberately — an effective date is a day, and an undated write takes `clock_timestamp()`
  — so the exposure is one clock tick in 86.4 million per day, against a rule that has to
  name some instant.

**An open period resolves as of now**, which decision 0205 already settled and this does not
disturb: the end of the period has not happened, and Section 17 requires a report to say the
period is open.

## What this does not decide

Nothing about which *rows* a report reads — only the instant it hands the tree walk. The
attribution keys are decision 0205's and the module that computes each is decision 0206's.

---

Decision 0208, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — A report's scope selector resolves as of the period being reported](0207-a-reports-scope-selector-resolves-as-of-the-period.md)
