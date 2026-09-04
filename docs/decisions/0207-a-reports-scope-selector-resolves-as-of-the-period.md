# 2026-09-05 — A report's scope selector resolves as of the period being reported

The Stop Condition decision 0205 raised, withdrawn once on bad reasoning, restored, and
settled by the owner. It blocked Stage 5's first query and nothing else did.

## The question Section 7 left open

Section 7 fixes datedness to the **capability**: "Exactly three capabilities resolve as of
the period being viewed — `cell.view_subtree`, `reports.view_subtree` and `audit.view`, the
*viewing* capabilities." And it said of the dated case, until this ruling amended the last clause: "It is a *dated*
viewing read — one asking about a past month — that owes a resolution as of that period, and
no route asks one yet."

A Stage 5 monthly report is that route. What Section 7 does not say is how a **report scope
selector** — the target it gives a report, rather than a Person — resolves. Its only sentence
on the selector is that "a request for a scope the actor does not hold is `SCOPE_DENIED`,
never silently narrowed", which decides the refusal and not the instant.

**The ruling: the selector resolves as of the period being reported**, on the same terms as
the figures. An open period resolves as of now (decision 0205).

## Why, and the case that forced it

A Leader holds `reports.view_subtree` at own/subtree. Section 17 makes a specific leader a
selectable scope and Section 16 requires every metric to drill down to the underlying
leaders. So: a leader asks for October's figures for a downline leader who left their subtree
in November.

Decision 0205 already computes that actor's own October total from the October tree, so the
total **already contains that leader's people**. Under undated authorization the actor is
shown a number and refused the drill-down that explains it — which contradicts the additivity
Section 20 asserts, and does so on the actor's own screen rather than in the arithmetic.

Dated authorization makes the two halves agree by construction rather than by coincidence,
which is the property Section 7 already bought once for a Cell meeting's frozen responsible
leader.

**The precedent is already in this specification.** Sections 10 and 15 keep a closed Cell's
history and roster visible to the leader who led it, and Section 7 gives that fallback its
reason. Historical visibility follows historical responsibility; this is the same rule
reached through a report rather than through a Cell.

## What it does not do, and this is the load-bearing half

**It does not move a write.** Section 7's rule that authority resolves through the *current*
leader, and that "any write carrying an effective date other than now" is still authorized
now, is untouched. That rule exists because an actor who could authorize as of a past date
"could then reach back far enough to recover it" — privilege reclaimed through a date field.
Nothing here lets anybody do that: a viewing capability confers no write, `read_only` is valid
on it (Section 7), and the period a report names is a period that already happened rather than
a date the actor chooses to act at.

**The cost is stated rather than hidden.** A leader keeps visibility of a person's figures for
periods during which that person was theirs, after the person has moved away. That is
deliberate — the alternative erases a leader's own history the moment somebody is reassigned,
and Section 12 already records the sibling fairness question about a person who attended and
has since left as a question about the rule rather than a defect in it.

**The cost runs in a second direction the first version did not name.** If Manuel led Mark in
October and Manuel is re-parented *under* Mark in November, Manuel may read October reports
covering people who are today in his own upline's subtree. That is the same rule correctly
applied rather than a leak — those people were his in October — but it reads differently from
the departure case, and stating only the departure case would understate what was chosen.

---

Decision 0207, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — The owning module computes and `reporting` composes, and an unassigned person reports under their last leader](0206-the-owning-module-computes-and-reporting-composes.md)
