# 2026-08-20 — The unauthenticated surface is a closed list, and `read_only` is not a role concept

Two corrections to rulings made earlier the same day, both found by the review reading the new §7 text against the code it was written for.

The exemption sentence claimed the unauthenticated set was sign-in and the password flows; the API also exposes token refresh and a liveness probe. Rather than leave the specification describing something narrower than the code, §7 now carries the closed list — sign-in, token refresh, password reset, activation, and the probe — and says that adding to it is an amendment rather than a decision taken in a controller.

`read_only` is defined by §7 as a column on `capability_grants` and says nothing about role defaults, so deriving one for a role default and publishing it from `/api/v1/auth/me` invented a rule for clients to branch on. Authority carried by a role now reports no value. Written to `SKILL.md` §7.

---

Decision 0070, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Three enforcement gaps closed at the schema, not in prose](0069-three-enforcement-gaps-closed-at-the-schema-not-in-prose.md) | Next: [2026-08-21 — Tailwind CSS, chosen while there is one page to convert](0071-tailwind-css-chosen-while-there-is-one-page-to-convert.md)
