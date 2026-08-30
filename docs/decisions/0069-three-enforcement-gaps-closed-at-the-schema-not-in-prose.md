# 2026-08-20 — Three enforcement gaps closed at the schema, not in prose

Also from the same review, and grouped because each is the same mistake: a rule the specification states, left to an application that does not exist yet.

**`SENIOR_PASTOR` is capped at two active rows by a constraint trigger.** §7 says the two-holder limit is "a constraint the system enforces, not a convention it assumes". The count is enforceable in the database; *which* two Persons hold it is not, because the database has no durable representation of who the Senior Pastors are, and inventing one would put the church's two most consequential accounts behind a row somebody could edit. That half is a domain check in `auth`. Written to `SKILL.md` §7.

**`capability_grants.reason` and `granted_by` are `NOT NULL`.** §7 marks nullability explicitly everywhere else, so their unmarked state means required. An unexplained grant of authority leaves the next administrator nothing to weigh. `account_roles.granted_by` stays nullable for one case, now written down: the first Admin account, granted by a system action, mirroring §21's allowance for `audit_log.actor_id`.

**`migrate:down` refuses to run against populated tables.** The runner made an irreversible migration unexpressible, so the only way to satisfy it was a destructive down — and 0001's down drops `pastoral_assignments`, `network_assignments` and `person_lifecycle`. There is now a `-- migrate:irreversible <why>` marker, and a `-- migrate:down:refuse-if-populated <tables>` directive that stops the down unless the operator passes `--force`. The pattern mattered more than the file: Stage 3 and Stage 4 migrations would have copied it onto `cell_memberships`, `cell_leaderships` and attendance.

---

Decision 0069 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — A Network change validates forward from its effective date](0068-a-network-change-validates-forward-from-its-effective-date.md) | Next: [2026-08-20 — The unauthenticated surface is a closed list, and `read_only` is not a role concept](0070-the-unauthenticated-surface-is-a-closed-list-and-readonly-is.md)
