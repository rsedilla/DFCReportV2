# 2026-08-22 — A write endpoint records its idempotency completion in its own transaction


The gap the claim lease narrowed and could not close. The claim is taken before
the handler and, left to the interceptor, recorded after it — so a failure in
between (a dropped connection, a killed process, a statement timeout) leaves a
committed write with an unfinished claim. The lease then lets a retry perform
that write again, sooner rather than never.

**The completion joins the write's transaction.** The effect and the record of it
commit together or not at all, which is the only arrangement that closes the
window rather than shrinking it.

The two paths compose without coordinating, which is what makes this cheap.
`complete` carries `state = 'IN_FLIGHT'` in its predicate, so once a handler has
set the row to `COMPLETED` inside its transaction, the interceptor's call
afterwards matches nothing and leaves it alone. Nothing has to tell the
interceptor that the handler already recorded itself, and an endpoint that writes
nothing keeps the old path unchanged — there is nothing to perform twice.

Two alternatives were rejected. Requiring every write endpoint to be safe to run
twice puts the burden on each one forever, and §5's reassignment is not naturally
re-runnable: a second run closes and reopens rows that were already correct.
Accepting the window and documenting it is honest but wrong for this system —
attendance exists nowhere else (§24), and a duplicated submission is exactly what
§22 says the header exists to prevent.

`completeWithin` takes the caller's transaction and is the mechanism. Its
parameter is typed `Transaction<Database>` rather than the pooled connection, so
the one mistake a write endpoint can make — recording outside the transaction it
just wrote in, which reopens the whole window and reads as compliant at the call
site — is a compile error rather than an invisible one. That is the standard §2
sets for the capability guard and §22 sets for the interceptor.

**The trade is recorded rather than glossed.** The record now commits *ahead of*
the outcome: the handler names its own status and body inside the transaction,
before the framework has produced a response. Anything that changes the response
afterwards leaves the stored answer disagreeing with the sent one, and the
interceptor cannot correct it, because its own call carries `state = 'IN_FLIGHT'`
and the row is already `COMPLETED`. §22 therefore requires what is recorded to be
the response the endpoint returns, and requires the recording to be the last
statement in the transaction — it holds the key's row lock, and a concurrent
retry waits on that lock instead of being answered `REQUEST_IN_FLIGHT`.

**A claim gained an identity in the same change, closing a defect that was
already on `main`.** The lease lets a request take a key over, and a takeover sets
`state = 'IN_FLIGHT'` again — which was the only thing completion and release
matched on. So a slow request whose lease expired could complete or release the
claim that replaced it: storing its response against another request's work,
discarding that request's completion silently, and, since a takeover also
rewrites the fingerprint, leaving one request's response stored under another's.
Migration 0004 adds `claim_id`, minted per claim including on takeover, and every
write against the row carries the identity it was given.

That defect shipped with the lease and was found only because this branch added a
comment claiming it was handled. The comment was wrong, and being wrong in
writing is what made it visible — which is an argument for stating a mechanism's
guarantees explicitly even when nothing yet depends on them.

*An earlier version of this entry claimed the composition depends on READ
COMMITTED, and that under REPEATABLE READ the interceptor's statement would raise
a serialization failure. That is wrong.* The interceptor's `complete` runs on the
pooled connection with no explicit transaction, after the handler's has already
committed, so it takes a fresh snapshot at statement start under any isolation
level and simply matches nothing. There is no earlier snapshot to conflict with
and no blocked statement. The composition does not depend on the isolation level
at all.

Recorded rather than deleted because it is the same fault the entry above
describes — a guarantee asserted about a mechanism from a partial reading of it —
committed in the entry written to warn against it.

Written to `SKILL.md` §22.

---

Decision 0086 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — A claim and a response are bounded separately](0085-a-claim-and-a-response-are-bounded-separately.md) | Next: [2026-08-22 — `people.create`, and how a Tier 1 duplicate is refused](0087-people-create-and-how-a-tier-1-duplicate-is-refused.md)
