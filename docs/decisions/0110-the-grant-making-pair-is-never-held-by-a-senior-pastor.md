# 2026-08-24 — The grant-making pair is never held by a Senior Pastor


The Stop Condition the role-combination ruling escalated. §7's role catalog says
"Anything beyond a role's defaults requires an explicit, Admin-issued grant" and
names no exception, so the index added in migration 0005 closed the role-combination
route and left the explicit-grant route wide open: a Whole Church grant of
`roles.manage` reaches the same authority with no `ADMIN` row, nothing violated, and
invisibly to the identity check, which filters role rows and not grants.

**`roles.manage` and `accounts.manage` may never be held by an account holding
`SENIOR_PASTOR`, by role or by grant. The other five §7 withholds may be granted.**

Three options were weighed and the middle one is not the compromise it looks like —
it is the only one that matches §7's own argument.

**Refusing all seven** is wider than §7. It would refuse `people.merge` and
`people.correct_sex` to the people most likely to *know* a correction is needed,
and it buys nothing: neither is self-perpetuating, each use is one audited
operation, and an Admin can revoke the authority afterwards.

**Permitting all seven** is what the specification said by omission, and it is how
a small church's authorization model actually dies. Granting "the admin bundle" in
a hurry on a Saturday hands over `roles.manage`, after which the holder can grant
themselves the rest and revoke the Admin who granted it. Every step is a legal use
of a legally issued grant. The Monday revocation never happens, because the person
who would perform it no longer can.

**The pair is the line because the pair is what removes the second party
permanently.** §7 justifies withholding `roles.manage` and `accounts.manage` on
exactly that ground — "every permission change has a second party involved" — and
justifies `records.backdate_effective_date` and `people.merge` on a different one,
that they move totals for periods already reported. `people.correct_sex` it argues on that same
second ground, explicitly. `settings.manage` and `cell.approve_creation` it
withholds in the table and argues nowhere. Treating the seven alike was a
simplification of mine, not §7's position, and the review that found the hole is
what made the difference visible.

*The first version of this entry, and three other files with it, put
`people.correct_sex` in the "argued nowhere" group. §7 argues it 87 lines above the
sentence denying it, on the same ground as `people.merge`. Migration 0005 is not the
counter-example this entry first cited: its header says §7 "argues four of them and
is silent on" two, which accounts for six of the seven. Its list of silent ones is
right and its count is one short, because §7 argues five. **Which** capability 0005
left out cannot be read off it — it never enumerates its four — so nothing more is
claimed than that the count is wrong. Asserting it was `people.correct_sex` would be
a guess about that file inside a paragraph correcting a previous guess about it. The
ruling is unaffected, since self-perpetuation is what
decides the line and `people.correct_sex` is not; what was wrong was the taxonomy
offered as its justification, asserted without grepping §7 for the third member.*

**Two triggers, not one, and not an index.** The rule spans `account_roles` and
`capability_grants`, so no index reaches it. Enforcing on grants alone is walkable
from the other side — grant first, add the role second — so whichever row arrives
second is refused.

**Each path locks the account before it looks, and that is the half worth
recording.** A deferred trigger sees only its own transaction's commit-time state,
so two concurrent transactions writing the role and the grant would each find
nothing and both commit — the exact defect the 2026-08-21 ruling records in the
`SENIOR_PASTOR` counting trigger, whose remedy there was a unique index. No index is
available here, so both paths take `FOR NO KEY UPDATE` on the account instead.
`FOR NO KEY UPDATE` rather than `FOR UPDATE` because it conflicts with itself, which
is all that is needed, and not with the `FOR KEY SHARE` a foreign key takes — the
same reasoning §6 records for the revocation lock.

**Deferred, but not for §4's reason, and the difference is why it is written down.**
There, neither order works and an immediate trigger makes a mandated operation
unperformable. Here every conflict has a legal order — revoke the grant, then add
the role — so an immediate trigger would be satisfiable. It is deferred so the order
is not a trap, and so a row written and revoked inside one transaction has nothing
left to validate.

**The cost is the rule rather than a side effect.** The two Senior Pastors cannot be
handed grant-making authority even temporarily, so an unreachable Admin is answered
by a second Admin account and not by widening theirs. A capability joins the pair
only by amending §7, which is where the argument for refusing rather than auditing
has to be made.

**Two things the review added, recorded here because this log's own record on "written
to §x" claims is bad.** The triggers were the whole of the enforcement at first, and a
constraint trigger is what `pg_restore --disable-triggers` skips — which §7 argues
twice in that same section, for the 0005 index and for the identity check. So a
grant-making capability is refused a second time where authority is assembled, reading
the role **row** rather than an honoured role so the two points refuse the same states.
And that refusal answers `CAPABILITY_DENIED` where nothing else the account holds
carries the capability, which is client-visible and therefore §7's to state.

The qualifier on that is load-bearing and §7 now says what it leaves open: the other
route to these two capabilities is an `ADMIN` role row, which this point does not
touch. That pairing is refused by 0005's index, and 0005's index is the one §7 already
concedes is "not quite unrepresentable" — a full restore fails at index creation rather
than at the write. So the role half rests on the index and on that failure being acted
upon; only the grant half is refused twice.

Written to `SKILL.md` §7, §24 and migration `0006`.

---

Decision 0110, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — An account holds at most one of `ADMIN` and `SENIOR_PASTOR`](0109-an-account-holds-at-most-one-of-admin-and-seniorpastor.md) | Next: [2026-08-24 — How the leadership tree import runs](0111-how-the-leadership-tree-import-runs.md)
