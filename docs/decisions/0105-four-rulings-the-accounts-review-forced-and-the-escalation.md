# 2026-08-24 — Four rulings the accounts review forced, and the escalation that prompted them


`architecture-guardian` on the accounts branch returned nine violations, of which
one was a live privilege escalation. Each ruling is amended into `SKILL.md` in the
same change.

**A capability §7's catalog gives only at Whole Church covers nothing when granted
narrower.** The 2026-08-23 ruling closed this for `people.correct_sex` and named the
escalation it prevented. The same hole was open on eight other capabilities, because
the guard asks whether a grant covers the *target* — so a grant issued at
`OWN_SUBTREE` passes for everyone inside that subtree.

`accounts.manage` was the worst of them, and it was reachable: a Leader holding one
such grant could `POST /api/v1/accounts` naming anybody in their own subtree, an
address they control, and `role: ADMIN`; then read the activation mail, set a
password, and sign in as Admin at Whole Church. That is the escalation the entire
role catalog is arranged to prevent, reached through the endpoint this branch added.

Generalised rather than named per capability, because the hole is general and naming
them one at a time is as many chances to miss the next — same argument as §2 gives
for the guard being declarative: an operation that forgets the check looks exactly
like one that does not need it.

**Two things about it were wrong when first written, and both were caught rather
than reasoned out.**

It was enforced where an account's effective authority is assembled, beside the
`read_only` rejection, which is where an earlier version of this entry said it
belonged. That made the account look as though it held no such capability at all,
so the refusal became `CAPABILITY_DENIED` — and CI caught it, because the
sex-correction suite has pinned `SCOPE_DENIED` since the 2026-08-23 ruling. It is
right there: an administrator diagnosing this issued a grant naming the correct
capability with the wrong **scope**, and `CAPABILITY_DENIED` would send them to
grant something they had already granted. The check sits in the scope half of
`authorize` and `coversWith`, and `/auth/me` filters the same grants out of what it
advertises, so a client is not shown an action that is refused every time.

And the set was **derived** from the role catalog rather than stated — "every role
that holds this holds it at Whole Church" — which looked self-maintaining and had
the wrong predicate. Admin and Senior Pastor hold every capability at Whole Church,
so it reduced to "a Leader does not hold it by default", which is a statement about
who gets something automatically rather than about the scope it may be held at.

That produced a false positive on `audit.view`, and §7 refutes it twice in
consecutive lines: "an audit entry resolves through its target" is machinery with no
purpose unless the capability can be held narrower, and the line after it — "a
setting is Whole Church only, and is never in scope at any narrower value" — is this
specification's own way of saying what the rule says, written for settings and
deliberately not for audit. A narrower `audit.view` grants strictly *less* than the
default, so there is no escalation to close and the rule was removing authority §7
offers.

The set is now stated, with eight members and §7's argument for each, and
`single-scope.spec.ts` asserts its membership — which is what makes a stated list
safe, since the objection to one is that it goes stale silently.

**An archived Person is not provisioned an account.** §6 covers the access decision
at archive and reactivation after it, and was silent on creating one for somebody
already archived. Every neighbouring rule points one way — §5 refuses an archived
Person as a pastoral destination, §3 refuses archiving somebody who leads a Cell —
so an archived Person does not acquire new live relationships, and an account is
one. Worth recording that `leader-assignability.ts` reads `person_lifecycle` for the
analogous decision twenty lines from its merged-Person check, and provisioning
carried the second across and not the first.

**The server chooses the Senior Pastor seat.** §7 caps the role at two and the
2026-08-21 ruling calls a slot a seat rather than a rank, so naming one chooses
nothing meaningful and a caller naming an occupied seat would meet a constraint
violation for a decision it should never have been making. Both held is refused with
`INVARIANT_VIOLATION`. The partial unique index remains the enforcement; the read
exists so the ordinary case is an answer rather than a raw violation rendered 500.

Found because the insert omitted `senior_pastor_slot` entirely, which the check
constraint requires — so `SENIOR_PASTOR`, one of the two roles this branch's own new
§6 text says are provisionable, answered 500 on every attempt. No test named it.

**A delivery failure never fails provisioning, and an activation email may be
re-sent.** The completion is recorded inside the transaction, so by the time the send
runs the store already holds a `COMPLETED` 201. Raising there gave the client a 500
while every retry on that key replayed the 201 — and `release` could not help, since
its predicate is `IN_FLIGHT` and the row was `COMPLETED`. An account was left
stranded with a live token nobody held. That is the write-endpoint obligation this
repository states in one line: an endpoint must not commit its completion and then
fail.

The account genuinely was created, so 201 is the honest answer, and
`POST /accounts/{id}/activation-email` is the second path §6 step 3 lacked. Before
it, the only recovery was the holder using the forgotten-password flow, which works
on a `PENDING_ACTIVATION` account by accident and records itself as a password reset.

**Also corrected, and each is the recurring fault rather than a new one:**

- Setting a password reactivated a `DISABLED` account, because it set `ACTIVE`
  unconditionally and never read the current status. An activation token outlives a
  disablement by a week, so an unauthenticated endpoint undid an `accounts.manage`
  decision.
- Account-wide revocation was re-implemented in the credentials service and
  **inverted**: the marker stamped before the tokens were revoked, with its
  timestamp computed before the statement that waits on the lock. §6 states both
  halves and `TokensService` already had them right; it now exposes a
  transaction-taking variant rather than being copied.
- A duplicate email address raised an unrecognised 23505 and rendered
  `INTERNAL_ERROR`, permanently — the 500-instead-of-an-answer failure recorded on
  2026-08-23 for the self-leader check.
- The DTO declared the password bounds alongside the service's own check, under a
  comment saying they shared constants and so could not drift. They shared the
  constants and not the *counting rule*: `class-validator` counts UTF-16 units and
  §6 counts characters, so a 128-code-point passphrase was refused by the pipe while
  the unit tests asserted the service accepts it. One rule, in one place.
- `account.password_reset` did not fit §21's `<noun>.<past-tense verb>` convention;
  it is `password.reset`.

**Three false statements, all written by this branch about itself.** The
provisioning docblock described an operator re-send path that did not exist; the
email port's docblock promised a guarantee its only caller did not provide; and the
single-use test claimed to fail against a read-then-write redemption while being
strictly sequential — which is CLAUDE.md's own authorization-case-7 lesson restated
in a comment asserting the opposite. The concurrent case exists now.

The password-reset docblock claimed the miss branch does "comparable work" as the
hit branch. It does not: the miss branch is a bare early return, so the two are
distinguishable by timing. §6 requires only that the *response* be identical, and it
is — so the code is compliant and the comment was false. It now records the gap
rather than denying it, because a decoy that does not actually match a database
write and a network call would be a second false claim.

---

Decision 0105, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — Three rulings the accounts work needed, settled before the code](0104-three-rulings-the-accounts-work-needed-settled-before-the.md) | Next: [2026-08-24 — The authorization seam is its own module, and a cycle was the reason a rule was being broken](0106-the-authorization-seam-is-its-own-module-and-a-cycle-was-the.md)
