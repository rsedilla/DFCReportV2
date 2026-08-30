# 2026-08-20 — A Network change validates forward from its effective date

The same-Network trigger, on a Network change, checks every assignment open at the change's effective date **or beginning after it**, comparing each as of the later of the two dates.

Found by `architecture-guardian` on the Stage 1 branch. `records.backdate_effective_date` lets Admin set the effective date in the past, so an assignment can begin after that date and therefore not be open at it. A correction backdated to April, with an assignment opened in June that was legal when made, would commit and leave a permanent cross-Network edge — and nothing revisits it, because no row of `pastoral_assignments` is written and the assignment trigger never fires.

§4's guarantee is absolute, so the check reaches forward rather than stopping at the effective date. Written to `SKILL.md` §5 (Database enforcement), with a regression test in `api/test/database/invariants.spec.ts`.

---

Decision 0068 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — The eleven authorization cases ship failing, in their own CI job](0067-the-eleven-authorization-cases-ship-failing-in-their-own-ci.md) | Next: [2026-08-20 — Three enforcement gaps closed at the schema, not in prose](0069-three-enforcement-gaps-closed-at-the-schema-not-in-prose.md)
