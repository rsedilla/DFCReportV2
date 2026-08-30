# 2026-08-31 — One API instance, and the skew bound waits for the second

Settled before Stage 4 because Stage 4 adds a second comparison of the same kind — the
submission window closing on the 7th at 23:59 Asia/Manila (Sections 9, 13 and 20) — and
a bound invented for one of them would have had to be invented again for the other.

**The deployment runs one API instance. Section 24 says so, so the account-wide
revocation comparison is one clock and needs no tolerance.** The skew bound is not
guessed in advance; it becomes owed by the change that introduces a second instance,
and that is written into Section 24 as a condition on the change rather than left as a
note.

## What was open, and what was not

Section 24 required "synchronised clocks on every host running the API" and bounded no
skew. Section 6 requires a token's issued-at and an account's revocation marker both to
be stamped by an API process, and account-wide revocation compares them. On one
instance those are one clock and the comparison is exact. On several they are two, and
skew moves tokens across the boundary in both directions — admitting a token that
should be dead, refusing a sign-in that should work.

What was never in doubt is the *ordering* of a sign-in against a revocation in flight.
The ruling of 2026-08-22 put a row lock on the account, so that ordering is decided in
the database and depends on no clock at all. This is only about the two timestamps.

## Why stating the instance count rather than bounding the skew

**A bound with one instance is a number nothing can fail.** Choosing one now means
choosing it with no deployment to measure, no second host to be skewed against, and
nothing that goes red if it is wrong — which is the shape this repository refuses
everywhere else it has met it: the contrast check, the module graph, the `DateStyle`
startup assertion. A tolerance is the kind of number that is chosen once and then
believed.

**And it would be a loosening, bought for nothing.** Any tolerance admits tokens inside
it that an exact comparison refuses. Revocation is the account's own emergency stop, so
a window in which a revoked token still works is a real cost, and on one instance it
buys nothing at all.

**The single-instance premise is a genuine architectural claim and belongs in the
specification.** Section 2 already makes the API separately deployable and stateless,
which is what makes a second instance possible later; nothing in Sections 2, 6, 22 or
24 said whether one is running. Recording it turns "we happen to run one" into
something a second instance has to be checked against.

## What the second instance owes

Written into Section 24 so the obligation arrives with the change rather than being
rediscovered:

- a stated maximum tolerated skew, and NTP configured to hold it;
- the revocation comparison made skew-tolerant to that bound, in the direction that
  fails safe — a token near the boundary is treated as revoked rather than as live,
  since refusing a valid session costs a sign-in and admitting a revoked one costs the
  thing revocation exists for;
- and every other cross-instance timestamp comparison in the system found and given the
  same treatment. Section 20's month close is one and there will be more.

## What this does not reach

**The submission window is not a cross-instance comparison and gains nothing here.**
Section 13 closes a month at a wall-clock instant in Asia/Manila, compared against the
instant a request is served. Both are read on one host in a single-instance deployment,
and on several instances the correct fix is not a tolerance but reading the boundary
from the database, whose clock every instance shares. Stage 4 is written that way from
the start, so a second instance never has to revisit it: the close is decided by an
instant the database supplies, not by whichever host happened to serve the request.

**Whether the isolation level should be pinned the way `DateStyle` is** stays open. It
sits with the least-privilege database role and the liveness probe as a setting a
deployment owns, and it is unaffected by the instance count.

---

Decision 0160, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — A cursor that cannot be resolved is refused](0159-a-cursor-that-cannot-be-resolved-is-refused.md)
