# 2026-09-05 — The owning module computes and `reporting` composes, and an unassigned person reports under their last leader

Both were Stop Conditions raised by `architecture-guardian` on decision 0205, and both were
escalated to the owner rather than invented. Settled before Stage 5's first query.

## `reporting` computes nothing over another module's tables

Section 2 permits one exemption — "a read joined onto a query rooted in a table the reading
module owns" — and Section 26 gives `reporting` only `report_snapshots` and `notifications`.
So `reporting` may not root a query in `dcc_attendance`, `cell_attendance`, `cell_meetings`,
`cell_memberships`, `persons` or `pastoral_assignments`, and a whole-church monthly report
cannot be written as a join.

**The ruling: the owning module computes its own aggregates and `reporting` composes them.
Section 2 is not amended.**

`hierarchy` answers the dated subtree walk, because it owns `pastoral_assignments`.
`attendance` computes DCC and Cell figures over `dcc_attendance`, `cell_attendance` and
`cell_meetings`. `cells` answers what it owns. `reporting` calls those interfaces, composes
the result, and owns the snapshot.

The rejected alternatives, and why:

- **Amending Section 2** to let `reporting` read what it reports on. It keeps all reporting
  SQL in one module, which is a real advantage, but the exemption would be vastly larger than
  the one it joins — `hierarchy`'s two joins onto `persons` — and Section 2 says adding to
  that list "is an amendment rather than a decision taken in a module". An exemption covering
  six tables across four modules is not an exemption; it is the rule reversed for one module.
- **Service interfaces returning rows, aggregated in application code.** This satisfies
  Section 2 literally and is the shape Section 20 already rules against: stored figures are
  "a requirement rather than an optimisation" at this church's scale, and pulling every
  person's records through a service call to count them in TypeScript is the cost that made
  it one.

**What it costs, stated rather than hidden:** some logic a reader would call "reporting"
lives in `attendance`. That is the price of Section 2's ownership rule, and it is the same
price every other module already pays — the alternative puts SQL over a table in a module
that cannot be trusted to know that table's invariants.

## A person with no open assignment reports under their last leader within the period

Section 5 makes zero open pastoral assignments legitimate for an archived Person, for one
encoded but not yet assigned, and for an administrator outside the pastoral structure.
Section 3 requires period-based classification and monthly-attendance reports never to be
filtered by current lifecycle state, "for any period including the present one". Decision
0205's person key places a person by the tree at the period's end — and such a person is in
no subtree there, so their real recorded attendance would land in the Whole Church total and
in nobody's leader total.

That is not merely untidy. Section 16 requires drill-down from Whole Church to Network to
leader to the actual people, and Section 17 states the chain; a person reachable at one level
and not the next breaks it silently, which is the failure Section 9 names in the recording
direction as "nobody is missed between two levels".

**The ruling: where a person has no open pastoral assignment at the period's end, they are
placed by the last open assignment they held at any instant within the period.**

It keeps them in exactly one leader's subtree, so both Section 20 identities still sum; it
keeps every level of a drill-down adding up to the level above; and it is reproducible,
because the assignment history it reads is frozen (Section 5, no row is ever deleted).

Where a person held **no** open assignment at any instant of the period — encoded but never
assigned, or an administrator — there is no leader to fall back to, and they appear in the
Whole Church total alone. That is correct rather than a residual gap: no leader discipled
them in that period, so attributing them to one would be inventing a pastoral relationship
the tree never held.

---

Decision 0206, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — A report resolves the tree as of the end of its period, and attribution has three keys](0205-a-report-resolves-the-tree-as-of-the-end-of-its-period.md)
