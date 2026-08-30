# 2026-08-31 — A stale premise under a cleanly taken lock is transient

Settled before any Stage 4 code. Five sites already answered this question and did not
agree, and Stage 4 adds every write endpoint in the attendance domain — each of which
reads something, takes a lock, and decides.

**A refusal is placed by one question: could this same body, resubmitted unchanged,
succeed?**

- **Yes** — the refusal reached no decision about the request. It is transient, answers
  `RESOURCE_BUSY` (503), and the client retries **with the same `Idempotency-Key`**.
- **No** — the body must change before any attempt can succeed. That is a decision about
  this body, it answers `INVARIANT_VIOLATION` (409), and the message names what to
  change and says a new key is needed.

## Why the question is the status rather than the wording

Section 22 splits on the status and nothing else: "A 4xx is stored against the key; a
5xx releases it." A stored refusal is replayed for the whole retention, so a 409 whose
own message says "retry" is a 409 telling the client to do the one thing that cannot
work — the answer it gets back is the refusal, for 24 hours, whatever the state of the
database by then. Section 22 says this directly about new codes: "A transient condition
that reached no decision ... must be a 5xx, or every later retry of that key replays
it."

So the choice is not between two shades of meaning. One of the two answers is a dead
end for the client, and which one it is depends on whether the body has to change.

## What this changes, site by site

Four refusals move from `INVARIANT_VIOLATION` to `RESOURCE_BUSY`, and each also loses
the advice to mint a new key, which a 503 makes wrong:

- `NetworksService.floorBreach`, the `!backdated` branch. Its own comment already said
  "this is a 409 and should very likely be a 503", and declined to change it in a fix
  batch because it needed a ruling. This is the ruling.
- `CellsLeadershipRequestService.approve`, the pre-read comparison of `requested_by` and
  `cell_id` against the locked row.
- `assertHandoverApprovableWithin`, where the Cell acquired a leadership row after the
  lock list was built.
- `assertHandoverApprovableWithin`, where the outgoing leader differs from the one the
  lock list covers.

Two already answered `RESOURCE_BUSY` and are unchanged: `CellsClosureService`'s
`closureTooEarly` on an undated closure, and `PeopleReassignmentService`'s
`reassignmentTooEarly` on an undated reassignment.

**One stays a 409, and it is the case that shows the question is the right one.**
`CellsClosureService.assertDecisionsMatchMembershipWithin` refuses a closure whose member
decisions are not the Cell's current members. Resubmitting that body unchanged is
refused again for ever: the fix is to re-read the roster and send a *different* member
list, so the client mints a new key regardless and the stored 409 costs nothing. Section
10 requires a decision about every member, and a decision made about a different list is
not one — this is a decision about this body, and it is the only one of the six that is.

CLAUDE.md's open item counted this one apart from the others, wondering whether it was
the `VERSION_CONFLICT` Section 22 describes. It is not: Section 14 requires a
`VERSION_CONFLICT` to carry both values, both actors and both timestamps so a person can
choose between them, and a roster mismatch has no second value to show — the answer is
to look again, not to choose.

## Two things CLAUDE.md asked whoever settled this to re-derive

**The asymmetry `closureTooEarly` records for itself does not hold.** Its comment says
the undated branch is unreachable for a closure but reachable in
`PeopleReassignmentService`, "because section 5 lets Admin backdate a pastoral row and a
concurrent reassignment can therefore leave a row ahead of the clock". Backdating writes
a row *behind* the clock, so the stated reason is backwards, and re-deriving it makes the
two sites one case rather than two: both are reached when a row for the same subject
carries an instant at or after the one this request is taking. Neither needs backdating
to get there.

**What does make them reachable is resolution, not backdating.** `pastoral_assignments`
and `network_assignments` are stamped from the host (`new Date()`, millisecond
resolution) after the lock; two operations on one person that land in the same
millisecond therefore tie, and a tie is a breach because the comparison is `<=`. That is
narrow and it is not nothing, and it is the same shape at all three floor sites.

*A first draft of this ruling attributed the reachability to the database clock running
6–8 ms ahead of the host's. That was measured rather than assumed and is not true here:
against `dfc_ci`, `clock_timestamp()` was a median of 0 ms and at most 1 ms ahead of a
host stamp read after the query returned, across forty samples. The apparent offset is a
query round trip, which shows up only when a database stamp is compared against a host
stamp taken before the query was sent. The rule in `test/setup/fixtures.ts` — never take
the two ends of one period from different clocks — is unaffected and is about
determinism rather than about an offset.*

## What Section 22 has to say that it did not

`RESOURCE_BUSY` was defined as "the wait timed out or the database chose this
transaction as a deadlock victim". Every site above took its locks cleanly, so on the
old wording none of them qualified — which is exactly the objection three of the code
comments raise against themselves. Section 22 gains the third member: a premise read
before a lock that no longer holds under it. The three share one property and it is the
property the code branches on — no decision was reached, and the same request may
succeed on its next attempt.

Section 4 and Section 10 each say an undated submission "always succeeds", and both are
corrected: it always clears the floor except where a record for the same subject carries
the very instant the submission is taking, and that case answers `RESOURCE_BUSY`.

## What was rejected

**A new code, `PRECONDITION_STALE`.** It names the condition more honestly, and it buys
a client nothing: the client behaviour it implies — retry shortly, same key — is exactly
what `RESOURCE_BUSY` already means, and Section 22 warns that a code is a permanent
obligation on three client codebases that cannot be force-updated.

**Deciding per site by reachability.** That is the status quo, and it is what produced
five sites disagreeing. Reachability is invisible at a call site: the next endpoint
copies whichever neighbour it read, which is how these two groups diverged, and is
Section 25 rule 19 in the form this repository keeps meeting it.

**`INVARIANT_VIOLATION` everywhere.** Keeps `RESOURCE_BUSY` narrow at the cost of
pinning a transient failure to a key for a day. Section 22 already rejected this
trade-off in general terms when it placed the store/release split; applying it here is
following that rule rather than making a new one.

---

Decision 0158, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — A Cell leadership audit entry names the Cell](0157-a-cell-leadership-audit-entry-names-the-cell.md) | Next: [2026-08-31 — A cursor that cannot be resolved is refused](0159-a-cursor-that-cannot-be-resolved-is-refused.md)
