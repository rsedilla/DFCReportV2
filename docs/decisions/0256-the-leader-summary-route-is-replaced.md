# 2026-09-19 — The leader summary route is replaced by the Network screen's routes

Section 22 listed `GET /api/v1/leaders/{id}/summary` with no response shape, no capability
and no scope, and no ruling ever gave it one. The owner's Claude Design handoff draws what a
leader summary shows: four summary cards on the Network screen.

## The ruling

**1. The route is removed from Section 22.** Nothing is built for it and nothing calls it.

**2. The Network screen's summary cards are served by the routes that screen already reads**
(decision 0252), each under its own capability.

## Why

**One combined route was considered and refused.** It would return figures read under three
capabilities in one response, which decision 0252 separates so that a reader lacking one sees
neither that figure nor a zero.

**Keeping it listed as owed was refused** because a route with no stated contents is not
something a later stage can build without a ruling first.

---

Decision 0256, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-18 — A Cell recorded at setup counts as opened, and nobody is asked](0255-a-cell-recorded-at-setup-counts-as-opened.md)
