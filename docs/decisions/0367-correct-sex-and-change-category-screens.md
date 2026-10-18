# 2026-10-18 — Correct sex and Change category

Two routes had no screen: correcting a person's sex (`PUT /people/{id}/sex`, Section 4) and
changing a Cell's category (`PUT /cells/{id}/category`, Section 10). Both were waived to "after
the pilot — Admin screens" in `web/screen-coverage.json`. On 18 Oct the owner chose from drawn
options where each goes. Neither was in the Claude Design handoff.

## The ruling

1. **Correct sex is its own action on the person page**, never a field in Edit details. It
   sits beside the person's Sex as *Correct*, for an account holding `people.correct_sex` at
   Whole Church, which is the Admin alone (Section 7). It opens a dialog that:
   - states the change and the Network it moves to (*Female, Women's Network → Male, Men's
     Network*) rather than offering a choice, since sex has two values;
   - asks for a reason, which is required (Section 4);
   - asks for a new Cell Leader in the new Network, searching that Network only, when the person
     has a pastoral leader now, and asks for none when they have none;
   - offers an earlier effective date only to an account that may backdate, a blank one meaning
     now;
   - says before the form what refuses it: a Network root is not corrected here (Section 5), and
     somebody who leads people or a Cell has them moved first, each named with a link. The API
     still decides, and a refusal it gives is shown with whoever it names.
2. **Change category sits beside Change when it meets on the Cell's page**, for whoever the
   server allows. One capability, `cell.manage_configuration`, governs both (Section 7): the
   Admin over every Cell and a leader over their own branch's Cells. The dialog offers the
   categories the Cell is not, and says the change takes effect today, the Cell keeps its ID and
   months already past keep the category they had. A closed Cell is offered neither.
3. **The screen ledger names the screens that reach these routes**, and also the three approval
   routes Cells to Approve has used since decision 0352, which it still listed as waived. The
   closure entry names the Inactive (3+ Months) Cells tab (decision 0366) rather than the filter
   it replaced.

Nothing changes in the API, a permission or a figure.

## Why

Section 4 says a sex correction is never an ordinary field edit: it moves a person between
Networks and may move them to a new leader, so it belongs in a form that says so, not beside a
name fix. A category is the same kind of setting as the meeting time and is governed by the same
capability, so it sits with it; giving it to the Admin alone would have needed a ruling taking
it from leaders and splitting what Section 7 keeps as one.

Decision 0367, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 4 and 10.

Previous: [2026-10-18 — The Cells page's tabs](0366-the-cells-pages-tabs.md)
