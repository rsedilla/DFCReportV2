# 2026-08-24 — An account holds at most one of `ADMIN` and `SENIOR_PASTOR`


The question the configuration ruling raised and deliberately left open. §7 says an
account holds at most one active row **per role**, which permits two rows of
different roles, and the schema agreed: `UNIQUE (account_id, role) WHERE revoked_at
IS NULL`.

**Refused.** An account's effective authority is the union of its roles' defaults
and Admin's set is a superset of a Senior Pastor's, so the pair does not produce a
Senior Pastor who also helps with administration. It produces an account holding
every capability in the system, for which every capability §7 withholds from the
role is void — `roles.manage`, `accounts.manage`, `records.backdate_effective_date`,
`people.merge`, `people.correct_sex`, `settings.manage` and `cell.approve_creation`.

*A first version of this entry said "§7's five deliberate exclusions" and listed
five. Both halves were wrong: the §7 table withholds **seven** capabilities from the
role, and §7's own "five" counts bullets, one of which is about Leaders rather than
Senior Pastors. Quoting a count out of a neighbouring sentence is the cheapest form
of the fault this log keeps recording.*

It is self-perpetuating, which is what moved it from a caution to a constraint:
such an account holds `roles.manage`, so it can retain the pair and revoke anybody
else's roles. §7's own justification for the exclusions is that "every permission
change has a second party involved", and one row makes that false *of that
account's own permissions* — another Admin may still exist and revoke the row,
which is the narrower and true claim.

*"Grant itself anything further" was in the first version and is vacuous: Admin
already holds all twenty-seven capabilities, so there is nothing further to grant.*

**It would also have masked the identity check merged the same day.** Where the
configuration is lost, that check refuses the `SENIOR_PASTOR` row and the account
falls to nothing — the deliberate fail-closed behaviour. An `ADMIN` row beside it
keeps the account at full authority, so the control never bites for exactly the two
accounts it exists for.

**This closes one route to that authority and not the only one, and the first
version of this entry did not say so.** §7 permits Admin to grant any capability
explicitly, and nothing forbids granting a withheld one to a Senior Pastor's
account — same destination, no `ADMIN` row, no constraint violated, and invisible
to the identity check, which filters role rows and not grants. Found by
`architecture-guardian`, which is the point of running it: the ruling was argued
from the route being looked at. That question is escalated rather than inferred
from this one, and is listed as open below. **Settled the same day** by the ruling
below it: the grant-making pair is refused, the other five may be granted. Migration
`0005`'s own header still says the question is open and is deliberately left alone —
it is merged, and only `0001` may be corrected in place (ruling of 2026-08-21).

**The cost is accepted and is the mechanism, not a side effect.** §6 gives one
Person one Account, so Bishop Oriel and Pastora Geraldine cannot perform an
administrative action at all — provisioning, a merge, a backdated record and a sex
correction are each somebody else's to do. In a small church whose Admin is
sometimes unavailable that is real friction, and it is what "a second party" means.

**Enforced by a partial unique index over `(account_id)` where the role is one of
the two**, not by a check in `auth`. The distinction from the identity half is the
whole reason: that one must live in the application because the database holds no
durable representation of who the two Persons are, while role combination is
entirely inside `account_roles` — so an index decides it where the state lives
rather than where a request happens to pass, and is still enforced under
`pg_restore --disable-triggers`, which is the argument the 2026-08-21 slot ruling
already made on this same table. Not quite *unrepresentable*, which two of the
three copies of this reasoning claimed until a review pointed at the third: a full
restore builds indexes after loading data, so a dump already holding the pair loads
and then fails index creation.

**No domain check was written, deliberately.** `roles.manage` has no endpoint, and
provisioning cannot produce the state — it creates exactly one role on a new
account and refuses a Person who already has one, and it is the only writer of
`account_roles`. Code with no caller is what `58925c8` removed from
`AuthorizationService` on the previous branch, and the same reasoning applies here
before the fact rather than after it. §7 instead states the contract the endpoint
owes when Stage 3 or later builds it: `INVARIANT_VIOLATION` rather than a raw
constraint violation rendered 500.

*The first version of this paragraph called what `58925c8` removed "a check", "two
commits earlier". It was `rolesFor`, an accessor, and it was five commits before
this branch's base. The decision stands; the precedent was misdescribed.*

`LEADER` is outside the limit, and a test pins that rather than leaving it implied:
it confers strictly less than either governing role and carries none of the
excluded capabilities, so an index over *every* role would forbid a legitimate row
and pass every other case. Written to `SKILL.md` §7 and migration `0005`.

---

Decision 0109, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — Naming a Senior Pastor takes effect on the next restart](0108-naming-a-senior-pastor-takes-effect-on-the-next-restart.md) | Next: [2026-08-24 — The grant-making pair is never held by a Senior Pastor](0110-the-grant-making-pair-is-never-held-by-a-senior-pastor.md)
