# 2026-08-26 — The bootstrap's two service methods guard themselves, and `ts-node` ships


Three Stop Conditions from the second review of the first-Admin work, decided
together because they are one failure in three places: a rule holding by convention
rather than by construction.

**Both new service methods refuse on their own account.**
`AccountProvisioningService.createFirstAdminWithin` was creating an `ADMIN` with a
null `granted_by`, no audit entry and no `accounts.manage` check, guarded by a
docblock asking callers not to — on a service the API already uses.
`PeopleService.createSystemAdministratorWithin` was creating a Person with zero
pastoral assignments, which is the capability the 2026-08-25 ruling removed from
`CreatePersonInput` for being one nobody could justify. Offering it again as an
unguarded method is that capability once more, with a docblock instead of a type.

Each asks **its own module's table**, which is what keeps them independent.
`people` cannot ask `auth` whether an account exists: `auth` imports `people` (the
2026-08-24 seam) and the reverse restores the cycle that ruling removed. It asks
whether any Person exists. The two are not equivalent — a foreign key makes a
non-empty `accounts` imply a non-empty `persons` and not the reverse — so
§6 states both conditions and says a database holding Persons and no account
is refused deliberately, being a partly-built installation rather than a fresh one.

**The refusal is an `INVARIANT_VIOLATION`, not a bare `Error`.** The whole argument
for the guards is that these are public on services the API uses, so the caller
they anticipate is an endpoint — and a bare `Error` reaches
`ApiExceptionFilter` unrecognised and renders `INTERNAL_ERROR`, the
500-instead-of-an-answer failure recorded for the self-leader check and the
duplicate-email `23505`. It carries `details.refused_by` so the three sites are
distinguishable by something other than a message string.

**`ts-node` moves to `dependencies`.** §6 makes the command the sole path to a
first Admin, and a host built with `npm ci --omit=dev` had none — so a fresh
production installation had a migrated database, an importable tree, and nobody who
could sign in. Two unit cases pin the loader and the dependency against
`package.json`, which is a weak instrument and the only one that reaches a fact no
runtime test can: the behaviour lives on a host installed without dev
dependencies, and the suite runs from a full checkout under `ts-jest`.

**Three layers pinned a disjunction and no member of it.** Every case reached the
guards through `bootstrapFirstAdmin`, so deleting any one left the suite green
— the same finding CLAUDE.md records for the identifier work on 2026-08-23,
with the same remedy: each guard is now called directly, and each was verified red
on its own.

---

Decision 0119 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-26 — A module's tables are never written by another, and read by one only where the query is rooted elsewhere](0118-a-modules-tables-are-never-written-by-another-and-read-by.md) | Next: [2026-08-26 — The tree import, and the one thing the fingerprint cannot bind](0120-the-tree-import-and-the-one-thing-the-fingerprint-cannot.md)
