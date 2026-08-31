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
  change. It is not additionally required to say that a new key is needed: Section 22's
  own rule that a key belongs to a body already settles that for a client changing one,
  and a requirement with no conforming site and nothing able to fail on it is the shape
  decision 0142 is named after. A draft of this ruling carried that clause.

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

**Three of the four cannot be reached through a request this API accepts, and no single
argument covers them.** Stating the reasons apart matters, because one of them is weaker
than the rest and could stop holding.

The fourth — `NetworksService.floorBreach`'s undated branch — **is** reachable, and its
reachability is the premise this whole ruling rests on: it is the one site with an
end-to-end case behind it, and Section 4 is amended for it.

`requested_by` and the *nullness* of `cell_id` are frozen by the finality trigger and by
a check constraint tying that nullness to a frozen `kind` — enforcement, in the database.
The **value** of `cell_id` on a `PENDING` handover is frozen by nothing; it is unreached
because no code writes it, and whether it should be frozen is on `CLAUDE.md`'s open list.
The two handover refusals rest on neither: a closed Cell is refused earlier by `state`,
`cell_leadership_requests_one_pending_handover` permits one pending handover per Cell,
and both callers of `insert-cell.ts` — which holds the only other writer of
`cell_leaderships` — write a different Cell.

So the refusals are placed by what they would answer if reached, which is the only thing
about them a ruling can decide. A first version of this said all three were frozen by the
trigger and the check constraint — an argument that covers two of the four and was
borrowed onto the rest.

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

**The reason `closureTooEarly` records for its own asymmetry is backwards, and the
asymmetry is real.** Its comment says the undated branch is unreachable for a closure but
reachable in `PeopleReassignmentService`, "because section 5 lets Admin backdate a
pastoral row and a concurrent reassignment can therefore leave a row ahead of the clock".
Backdating writes a row *behind* the clock, so that reason does not follow.

The conclusion does. What separates the sites is the **comparison**, which is stated two
paragraphs above the closure's own floor rule and was not connected to it:

- `NetworksService` and `PeopleReassignmentService` refuse at `effectiveAt <= floor`.
  Their rows are stamped from the host (`new Date()`, millisecond resolution) after the
  lock, so two operations on one person landing in the same millisecond tie — and a tie
  is a breach. Narrow, and reachable.
- `CellsClosureService` refuses at `effectiveAt < floor`, which Section 10 chose
  deliberately: a date exactly at the floor is legal there. An undated closure's instant
  is at or after every row it reads, so no collision can refuse it. Reaching that branch
  needs a row stamped *ahead* of the clock, and nothing writes one. It is kept as a
  fail-safe because the floor is read from rows rather than guaranteed by a constraint.

***A first version of this ruling collapsed the two into one case and amended Section 10
to say an undated closure carries the same exception as Section 4's.*** That is false —
Section 10's bound is inclusive and says so — and it is Section 25 rule 19 committed
inside a ruling written to settle a rule 19 question: Section 4's qualification was
reused where the reason for it, a strict bound, does not hold. `closureTooEarly`'s
comment records that the identical mistake had already been made and corrected once,
which is the sentence the re-derivation should have started from. Found by
`architecture-guardian`, and the amendment is withdrawn.

*A draft of this ruling also attributed the reachability to the database clock running
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

**Section 4** said an undated correction always succeeds, and is corrected: it now says
it succeeds in every case but one, that one being a record for the same person carrying
the very instant the correction is taking, and it answers `RESOURCE_BUSY`. **Section 10
uses the phrase "always succeeds" about a closure and is left alone**, for the reason the re-derivation above gives —
its bound is inclusive, so no collision can refuse an undated closure. A draft of this
ruling amended it too, which was the false rule that draft produced.

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
