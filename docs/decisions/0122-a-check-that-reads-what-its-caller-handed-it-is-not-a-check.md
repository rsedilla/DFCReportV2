# 2026-08-26 — A check that reads what its caller handed it is not a check


Third review pass on the import. Five findings, and the first is the one worth
keeping: **the service's `ADMIN` check was theatre**, and three docblocks plus a
`SKILL.md` paragraph said it was a guard.

`ImportActor` carried the actor's `ActorAuthority` and the check read
`authority.roles`. Both are plain data interfaces, so the module the check exists
to defend against — anything that can inject the exported `PeopleImportService` —
could hand over `{ roles: ['ADMIN'] }` and satisfy it. On the only real call path
it was worse than weak: `checkPreconditions` reads the authority, tests the role,
passes the same object down, and the service tests the identical array. The two
points could not disagree, so nothing was checked twice.

**The precedent cited for it was the tell.** `createSystemAdministratorWithin` and
`createFirstAdminWithin` each read *their own module's table* for a fact no caller
supplies, and that property is the whole of why they are guards. The
authority-carrying version reused their shape and not their reason — §25 rule 19,
in the batch written to apply §25 rule 19. The stated justification (a pooled read
inside a transaction is the §24 hazard) was true and did not force that design: the
same file's other precondition reads `settings` through the caller's transaction.

`AuthorizationService.honouredRolesWithin(executor, accountId)` is the remedy, and
`activeRoles` gained an executor parameter to provide it. `ImportActor` collapses
to an account identifier, because there is now nothing to pass that could be wrong.
Honoured rather than held: a `SENIOR_PASTOR` row this system refuses to honour must
not satisfy a role check (§7).

**It answers `CAPABILITY_DENIED`, which no section settles.** §22 splits its two
codes over grants and says nothing about a role requirement. `SCOPE_DENIED` is the
worse fit: the 2026-08-20 ruling gives it to a statement about an actor's authority
over a **target**, and this refusal names none. The 2026-08-24 ruling points the
same way, giving `CAPABILITY_DENIED` where a role row names nothing. It has no
client consequence today, because no endpoint reaches this service; it acquires one
the moment another module injects it, which is the stated reason the check exists.

**Seating a root is irreversible, and the argument that dismissed the cost was
false.** The previous entry called seating the wrong Person "a mistake an Admin can
make, like many others they can make with this file". Every *other* `USE_EXISTING`
mistake produces an ordinary edge that `PUT /people/{id}/pastoral-leader` corrects.
This one is correctable by nothing: §5 says plainly that a succession is not an
operation this system offers, reassignment refuses a root, the sex correction
refuses a root, `DELETE` is refused, and migration 0008 freezes that person's
Network. "Like many others" was the sentence carrying the whole decision.

The decision stands — §2 requires the behaviour — but the cost is now stated in §2
and warned on every root row of the dry-run report, because decisions are not read
during a dry run and an adjudicator would otherwise have no way to know.

**Two more false statements, both introduced by the previous batch.** §2 said "both
checks are made again by the module that performs the writes" and the service made
one: it re-checks the role and never inspects the grants, so the capabilities have
no enforcement on a path that does not go through the script. §2 now says which is
which. And inserting `assertActorMayImport` between a docblock and its method left
every sentence of that block false of the method beneath it — the encoding-phase
block, describing a synchronous role check that reads nothing.

**And a miscount inside the entry correcting a miscount.** The previous batch called
its §2 omission "the fifth written to §x failure"; the fifth is already claimed at
the end of this file. It is at least the sixth, and the number is now hedged rather
than asserted, because counting them by memory is what produced both errors.

---

Decision 0122, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-26 — The import's actor must hold ADMIN, and four other findings from the review](0121-the-imports-actor-must-hold-admin-and-four-other-findings.md) | Next: [2026-08-26 — Advice printed at the moment of a decision, and a fix claimed but not made](0123-advice-printed-at-the-moment-of-a-decision-and-a-fix-claimed.md)
