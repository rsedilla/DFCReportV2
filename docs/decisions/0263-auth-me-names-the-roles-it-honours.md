# 2026-09-20 — `GET /auth/me` names the roles it honours, and a client never derives one

The owner's Claude Design puts a Role on the Account screen. `GET /api/v1/auth/me` returned
capabilities, scopes and sources and no role, so the screen showed none.

**A first version of this ruling gave a reason that the response refutes**, and it is recorded
because the next reader would have argued from it: it said a role default and an explicit grant
arrive looking alike, and that an unhonoured `SENIOR_PASTOR` row looks exactly like an honoured
one. Neither is true. Every capability carries `source: 'role' | 'grant'`, and an unhonoured role
contributes no role-sourced capability at all, so the two are the most distinguishable pair there
is. The honoured role set is in fact derivable from what the response already sends.

The reason that holds is different. A client mapping role-sourced capabilities back onto a role
name keeps its own copy of Section 7's catalog, and begins lying the day a default moves there.
The server holds the catalog, so the server names the role.

## The ruling

**1. `GET /auth/me` returns `roles`**, the roles the system honours for the calling account.

**2. Honoured, never held.** A `SENIOR_PASTOR` row on an account whose Person is not one Section 4
names authorizes nothing (Section 7). Naming it here would tell a reader they hold authority every
request they make will refuse — the precise failure the screen refused to commit by guessing.
An account all of whose rows are unhonoured reports an empty list.

**3. A list, not a value.** `account_roles` permits more than one active row. Provisioning issues
one, which is a rule about provisioning rather than about this field, and a response shaped around
a rule enforced somewhere else is a response that breaks when that rule moves.

**4. No client derives a role from capabilities.** The field exists so that nothing has to. What a
client may do with the field itself, beyond displaying it, is deliberately not settled here —
decision 0245 rests the sidebar on capabilities rather than on a role, and that ground is
untouched.

## Why

**It discloses nothing.** The response already describes this account's authority in more detail
than a role does: every capability, its scope, and whether it came from a role or a grant. A role
is a coarser statement of the same thing, about the reader, to the reader.

**It is what an administrator needs first.** The screen exists, in its own words, for "the first
time a grant does not behave as an administrator expected". "Which role is this account?" is the
first question asked then, and the honoured/held distinction is exactly what makes the answer
worth having: an account that looks like a Senior Pastor and is not now says so.

**Additive**, which Section 22 permits within `v1`, and read in the same pass as the grants — a
second call would read `account_roles` twice and log a refused row twice with it.

---

Decision 0263, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-20 — A count may carry a proportion bar, and a coverage figure may not](0262-a-count-may-carry-a-proportion-bar.md)
