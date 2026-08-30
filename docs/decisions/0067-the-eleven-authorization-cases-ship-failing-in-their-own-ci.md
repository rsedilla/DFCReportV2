# 2026-08-20 — The eleven authorization cases ship failing, in their own CI job

They are written against `PUT /api/v1/people/{id}/pastoral-leader`, which Stage 2 builds, and they fail today because nothing serves it. They are not skipped, not marked pending, and not inverted to pass on failure: a test that passes because it expects failure stops being a test the moment the feature arrives.

They run as a separate job that is reported and not required, so the `api` job stays honestly green on an application with no features. Stage 2 is done when they pass, at which point they move into the main suite and that job is deleted. The endpoint contract they pin, including its error codes, is documented at the top of `api/test/authorization/pastoral-assignment.spec.ts`.

---

Decision 0067 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Invariant 4 answers `SCOPE_DENIED`, not `INVARIANT_VIOLATION`](0066-invariant-4-answers-scopedenied-not-invariantviolation.md) | Next: [2026-08-20 — A Network change validates forward from its effective date](0068-a-network-change-validates-forward-from-its-effective-date.md)
