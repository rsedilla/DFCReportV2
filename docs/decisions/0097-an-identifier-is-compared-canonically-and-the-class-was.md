# 2026-08-23 — An identifier is compared canonically, and the class was wider than the instance


Fifth `architecture-guardian` pass, and the only finding was the one that mattered
most on the branch: **§5 invariant 4 was bypassable by spelling the target's
identifier in uppercase.**

Both halves of the check are JavaScript string comparisons — the target against the
actor, and the target against the actor's ancestors — between a client-supplied path
parameter and identifiers that came out of `uuid` columns. Everything else on that
path normalizes for free, because everything else ends in a SQL comparison: the
capability guard, the reads, and (since the previous batch) the lock key. Invariant 4
does not, and it is the only check on the path that fails **open**. Admin and Senior
Pastor return early, so those two comparisons are the entire protection against the
one actor class the rule exists for, and a mis-spelled identifier removed it.

`UUID().uuidString` on iOS is uppercase by default and §2 names iOS as a client, so
this is reachable input rather than a contrivance.

**The batch before this one fixed exactly this defect in the lock key and did not
look for the rest of the class.** That is the lesson worth keeping. The recorded
rationale for the lock fix — a `uuid` column compares case-insensitively and
TypeScript does not — applies verbatim to every identifier comparison in the
application, and there were four more — *the entry as first written said three and
listed three, having itself missed one, which is the same fault one layer in*:

- **Invariant 4**, above. Fails open; a security defect.
- **The duplicate-acknowledgement gate** (§3), where a client echoing candidate ids
  back in uppercase never satisfies it — so the refusal is permanent and that Person
  can never be created. That is the block §3 says must never happen, and it is worse
  than the duplicate it guards against. Introduced before this branch and fixed here
  because one change closes both and because leaving it would recreate the defect the
  moment somebody read the lock fix as complete.
- **`isWithinSubtree`**, in *both* halves. Its self-check fails closed and merely
  denies. Its ancestors comparison is the `OWN_SUBTREE` scope decision — and one of
  its two callers is not a guard at all but the `canSeeReasons` predicate, where a
  false answer *skips* the §3 acknowledgement gate rather than denying. So the two
  halves of one function failed in opposite directions. The self-check was fixed in
  the first attempt and the ancestors comparison was not, which the sixth review
  found.
- **The self-leader check in the correction**, which compares two *client-supplied*
  values — the body's `pastoral_leader_id` against the path's `{id}`. Mis-cased, it
  fell through to the `no_self` check constraint: a raw constraint violation
  rendered `INTERNAL_ERROR`, which is the 500-instead-of-an-answer failure that
  module exists to prevent.

**Fixed in two places deliberately.** A pipe normalizes path parameters and a
transform normalizes the identifier fields of every DTO, so nothing downstream has to
remember; and the authority check normalizes again, because a check that fails open
must not depend on a caller having wired a pipe. Written to `SKILL.md` §7, beside
invariant 4's own rule, because the consequence is an authorization one.

**`audit_log.target_id` is canonicalized too, and only where it is a UUID.** It is
the one place a client-supplied identifier is *stored* as free text rather than
compared, the comparison it will eventually face is case-sensitive `text`, and
migration 0002 makes the row unrepairable — so a mis-cased target would be an entry
permanently invisible to the lookup §7 resolves scope through. Narrowed to
UUID-shaped values because §21 makes the column `text` precisely so a setting can be
keyed by its `key`, and lowercasing every target would canonicalize the identifiers
and corrupt anything else.

**The two layers are pinned separately.** Every end-to-end case passes if *either*
the boundary or the defensive comparison is present, so together they pin the
disjunction and neither half. §7 requires both, and a rule with nothing that can
fail on it is the thing this repository keeps refusing to ship — so the authority
check and the acknowledgement gate are each called directly, with an uppercase
identifier, bypassing the pipe and the DTO.

**Also in this batch, found without the review:** the lock-timeout predicate had been
put in `database/person-lock.ts` and imported by the exception filter, which points
`common` at a module. It moved to `common/errors/postgres-errors.ts`, so both arrows
point the same way. Behaviourally identical; it is about which direction the
dependency runs.

---

Decision 0097 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — Three corrections to the lock, and two rules that were never written down](0096-three-corrections-to-the-lock-and-two-rules-that-were-never.md) | Next: [2026-08-23 — A backdated reassignment is bounded by §4's floor and one rule of its own](0098-a-backdated-reassignment-is-bounded-by-4s-floor-and-one-rule.md)
