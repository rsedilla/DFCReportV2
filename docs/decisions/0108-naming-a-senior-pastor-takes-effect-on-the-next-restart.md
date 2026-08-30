# 2026-08-24 — Naming a Senior Pastor takes effect on the next restart


Confirmed rather than discovered. `SENIOR_PASTOR_PERSON_IDS` is read once, by the
`AppConfigModule` factory, and nothing reloads it — so setting it after the initial
import, and any later succession, requires a restart.

Kept deliberately, and it is worth saying why the alternative was refused. A
hot-reload would make the answer to "who are the two Senior Pastors" change under a
running process, with no deployment event marking it and nothing in the audit log —
which is most of what makes configuration a safe home for this in the first place.
A restart is an operational act somebody performs and can see. The ruling that put
the identity in configuration rests on its editor already holding `JWT_SECRET`; it
does not follow that the value should be quietly re-readable.

The cost is a short window: between the import finishing and the restart, no
`SENIOR_PASTOR` account can be provisioned and any such row grants nothing. That is
the fail-closed default and is correct for every moment before the two Persons
exist — but it is not obvious from either document alone, so `docs/ROADMAP.md` now
records the ordering (import, read the ids, set the variable, restart) beside the
two Stage 2 items it spans, and `.env.example` says it where the operator reads.

Written to `SKILL.md` §7 with the identity ruling, which is where the mechanism was
already described; this entry is what makes it a decision rather than a description.

---

Decision 0108 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — Who the two Senior Pastors are is read from configuration, and checked twice](0107-who-the-two-senior-pastors-are-is-read-from-configuration.md) | Next: [2026-08-24 — An account holds at most one of `ADMIN` and `SENIOR_PASTOR`](0109-an-account-holds-at-most-one-of-admin-and-seniorpastor.md)
