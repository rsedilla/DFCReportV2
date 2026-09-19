# 2026-09-18 — A Cell recorded at setup counts as opened, and nobody is asked

Section 27 derived Open a cell from an approved `NEW_CELL` request and asked a leader about
every Cell recorded during initial encoding, which has no such request: was it opened, or
taken over? Both answers were recorded, so the question could be dismissed. The owner
reviewed the Growth screen as a working mock-up on 2026-09-18 and found the question hard to
understand and easy to forget, on a tab where everything else is derived. This records what
was decided instead.

## The ruling

**1. A Cell recorded at setup counts as opened by whoever held its earliest leadership**,
dated the day that leadership began. Open a cell is then derived for every Cell, and nobody
is asked.

**2. The question and its two answers are withdrawn.** `conquest_confirmations` keeps one
kind of row: a goal reached before the church was encoded, stated with its date. It loses
`cell_id` and `reached`, because both existed only for the setup question — so a Cell opened
before encoding and closed before it, which no `cells` row holds, can now be confirmed like
any other goal.

**3. The cost is stated rather than hidden.** Somebody who took a Cell over before the church
was encoded reads as having opened it. The owner judged that rarer and less harmful than the
alternatives: asking every leader, or never counting a setup Cell and so withholding the goal
from the leaders who have led longest. Conquest is not a report (Section 27), so no church
figure moves.

## What this does not decide

How a goal reads on screen is not a rule and is not recorded here. Where the one remaining
confirmation is filed stays open in `CLAUDE.md`, narrowed to that confirmation.

---

Decision 0255, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-18 — Reports lists coverage by leader, and each row counts that leader's own obligations](0254-reports-list-coverage-by-leader.md)
