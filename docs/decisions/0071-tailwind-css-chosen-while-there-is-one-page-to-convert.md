# 2026-08-21 — Tailwind CSS, chosen while there is one page to convert

Settled in `SKILL.md` §2 (Chosen stack). It affects no architectural boundary: Tailwind is a build-time PostCSS plugin, adds no route, no server action and no data access, and the phones never load the stylesheet.

Chosen now rather than at Stage 5 for the same reason CI was chosen at Stage 1. Converting one placeholder page costs minutes; converting the dashboards, Network Summary and the role-specific screens costs a week, and the framework that arrives after the screens tends to be applied to only half of them.

**The palette carries the §13 and §17 prohibition.** No `success`, no `danger`, no `warning` token exists, and none is to be added. In a utility framework a red-and-green performance palette is one class away, and colouring a leader's row red for declaring `NOT_HELD` destroys the honest reporting that status exists to obtain — ranking the measure destroys the measure. A figure needing attention is surfaced by the attention list (§15), never by being coloured as a failure. The reasoning is written into `web/app/globals.css`, where somebody adding a colour will read it.

---

Decision 0071 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — The unauthenticated surface is a closed list, and `read_only` is not a role concept](0070-the-unauthenticated-surface-is-a-closed-list-and-readonly-is.md) | Next: [2026-08-21 — UI direction: headless primitives the repository owns, and no design-system framework](0072-ui-direction-headless-primitives-the-repository-owns-and-no.md)
