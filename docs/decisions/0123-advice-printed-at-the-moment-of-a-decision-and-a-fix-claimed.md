# 2026-08-26 — Advice printed at the moment of a decision, and a fix claimed but not made


Fourth review pass. The authorization mechanism from the previous batch is
confirmed correct; every finding is in what the batch said about itself, and one is
a fix it claimed and did not make.

**"CREATE is the reversible choice" was false, and it was advice.** The warning
added on root rows listed four mechanisms that make seating irreversible and then
told the adjudicator that `CREATE` avoids them. All four apply to a Person the
import *creates* into that seat exactly as they apply to an existing one —
reassignment refuses a root, the sex correction refuses a root, `DELETE` is
refused, migration 0008 freezes the Network — and none of them asks which decision
produced the row. So the sentence steered toward minting a duplicate into a seat the
real person could then never occupy, which is the outcome §3's whole duplicate
apparatus exists to prevent, printed at the moment of the decision.

Neither `SKILL.md` nor the type's docblock made that claim. The CLI added it alone,
which is its own lesson: the surface furthest from review is the one that talks
directly to the person deciding.

**The warning did not fire where it was most needed.** It was printed inside the
candidate list, and a root row matching nobody never enters that list — so the case
where an operator hand-types a Member ID onto an unwarned root row was silent.
`readDecisionsCsv` accepts `USE_EXISTING` for any `row_id` in the file with any
well-shaped Member ID, candidate or not, so that case is reachable and is the
sharper one. `DryRunReport.rootRows` now carries every root row and the warning is
printed from it, before the candidate list.

**A fix was claimed and not made.** The previous entry named the orphaned docblock —
`assertEncodingPhaseOpen`'s block left sitting above a role check inserted beneath
it — as corrected. It was not: the new block was added *below* the misplaced one, so
one method carried two docblocks, the first describing a different method, and
`assertEncodingPhaseOpen` had none. Fifth consecutive batch carrying a false
statement about itself, and the first where the false statement is that a named
defect was fixed.

**`CAPABILITY_DENIED` was wrong, on a citation that dropped §7's load-bearing
qualifier.** §7 gives that code "where nothing else the account holds carries the
capability" and says twice that the qualifier is load-bearing — and the actor this
check exists to stop is exactly one who *does* hold both capabilities at Whole
Church by explicit grant. §22's gloss, "the actor lacks the capability", is false of
the reachable case, and an administrator reading it is sent to grant what they
already granted.

It answers `SCOPE_DENIED` instead, and **§7 states that rule rather than this being
inferred from it** — a correction to this paragraph's first version, which called it
"the nearest rule rather than a stated one" and listed it as open. §7: where an actor
holds the capability by another route "and it is the withheld **exemption** that
refuses, that is a statement about the actor's authority over a target rather than
about what they hold, and it answers `SCOPE_DENIED`, exactly as Section 5 invariant 4
does for every other actor." That is exactly this refusal — invariant 4's exemption
withheld because the account holds no exempting role — written for the Senior Pastor
identity check and general in its terms. `HierarchyService.assertMayReparent` throws
the same.

*The open item this briefly carried also claimed the first-Admin bootstrap guards
were a competing precedent answering `INVARIANT_VIOLATION`. They are comparable in
placement and opposite in kind: those refuse on whether an account already exists,
which is a rule about what may be recorded whoever submits it — §22's
`INVARIANT_VIOLATION` side, correctly. §22 splits the codes by kind, not by where the
check sits, so the two precedents never disagreed. The item is withdrawn.*

**"Every other `USE_EXISTING` mistake produces an ordinary edge that a reassignment
corrects" is half true**, and all four passes missed it until the paragraph stated it
flatly enough to be wrong. `reassignWithin` is the only writer that closes an
assignment row and it closes-and-opens in one operation, so nothing in this system
removes a subject from the tree. A wrong Member ID on an *ordinary* row also cannot
be undone — that Person is permanently placed, counted in a subtree that does not
contain them, with only their leader correctable. The root case differs in degree,
not in kind. §2 now says so.

Also: `isRoot` had no test, so it could have been inverted with 642 tests green;
`checkPreconditions` still returned an `authority` neither caller read; the
`activeRoles` docblock still described roles leaving the service by one route in the
batch that added a second; and a test comment quoted `account_roles_period_ordered`
as `>` when it is `>=`.

---

Decision 0123 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-26 — A check that reads what its caller handed it is not a check](0122-a-check-that-reads-what-its-caller-handed-it-is-not-a-check.md) | Next: [2026-08-27 — What the web client does with a refresh token, pending three rulings](0124-what-the-web-client-does-with-a-refresh-token-pending-three.md)
