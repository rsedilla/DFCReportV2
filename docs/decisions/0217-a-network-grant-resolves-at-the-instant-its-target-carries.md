# 2026-09-07 — A Network grant resolves at the instant its target carries

Decision 0215, made earlier today on the same branch, refuses a `NETWORK` grant of a dated
capability. Its stated ground is that no dated Network resolution exists.

**One does.** `NetworksService.networkAsOf(executor, personId, at)` is a plain dated read of
`network_assignments`, already called from `cells`, `people` and `networks`, and
`currentNetwork` is a one-line wrapper over it at `new Date()`. The instant is in reach at
the point of refusal: `target.at` is a field on the `report_scope` target, passed to the two
branches immediately above the refused one.

**A `NETWORK` grant resolves through the person's Network as of the instant its target
carries.** Where the target carries no instant, the request is asking about now, and
`currentNetwork` is that instant rather than a different rule.

## The premise 0215 rested on was refuted by its own text

0215's *decision file* says, under Why not the alternatives: "**Build `network_as_of` now.**
`networks` already has the function; what is missing is a ruling that a Network grant
*should* be dated." That is accurate, and it is the right reason to have declined — inventing
the ruling at a keyboard to unblock a route is what the Stop Conditions exist to prevent.

What was wrong is the sentence that reached Section 7 and the service docblock: "no dated
Network resolution exists". The ruling knew the function existed and its own summary said it
did not. Section 7 is the source of truth, so the false half is the half that mattered.

**This ruling is the owner supplying what 0215 declined to invent**, and it is that rather
than a correction of 0215's behaviour: refusing was the right answer while no rule existed.

## What is dated is the request, not the capability and not the scope type

Section 7 fixes datedness to the capability and names three — `cell.view_subtree`,
`reports.view_subtree` and `audit.view`. It does not follow that every request under one of
them names a period. Section 7 already says so, in the sentence that settles what "the
period being viewed" means: "**A viewing request that names no period is asking about now.**"

So there is one rule with two spellings of one instant:

- A **report scope selector** carries the period being reported (decision 0207).
  `network_as_of` is read at whatever instant that selector resolves at, and this ruling does
  not fix which — for a **closed** period decision 0208 makes it the last millisecond of the
  final day, and for an **open** one Section 20 says both that and "as of now", three lines
  apart. That disagreement is recorded as an open Stop Condition and nothing here settles it:
  the Network axis follows the subtree axis to the same instant, whichever it turns out to be.
  *A first version asserted the last millisecond unconditionally. `architecture-guardian`
  caught the identical assertion in Section 7 and it was corrected there and in the route's
  suite — and not here, in the ruling both of those amend, which is the one-rule-one-path
  shape this branch has now produced three times.*
- Every other target carries no instant, so the instant is now, and `currentNetwork` — which
  *is* `network_as_of` at now — answers it.

This is what makes the answer bind all three capabilities without changing the behaviour of
any existing route. `cell.view_subtree` guards one route, which decision 0204 makes undated,
so the current Network is the correct instant there and stays. `audit.view` guards none. The
next dated route inherits the rule instead of rediscovering the question.

**That is the third answer, and neither of the two the question was framed between.** Binding
the refusal to the *capability* would have refused `GET /cells/{id}/members` to a Network
grant holder — a live route, correctly answered today, with no defect behind the regression.
Binding it to the *target kind* would have left the hole open for whichever dated route
arrived next.

## Why the historical Network is the right one

Section 4 states this as the reason the history exists: "A `network` column on the Person
cannot answer which Network someone belonged to during a past month, and **every
Network-scoped report for a closed period depends on that answer**." A Network-scoped grant
reading a closed period is that case exactly.

It is also the same direction Section 7 already took for the subtree. Decision 0207 settled
that a scope selector resolves as of the period reported, on the ground that historical
visibility follows historical responsibility; a leader who was in the Men's Network in June
is who June's report is about, whoever they are today. Resolving one axis dated and the other
undated would have made the two disagree about the same request.

Networks move rarely — only through `people.correct_sex` (Section 4) — so this changes almost
no answer in practice. That is an argument for getting it right cheaply, not for leaving it.

## A Network unknown at that instant covers nothing

`network_as_of` returns null for an instant before the person was encoded, and Section 4 is
deliberate about that. It forbids the reconstruction — "Do not attempt to reconstruct or infer
network history from before the person was encoded" — and then states the positive half, that
"the system is authoritative for network history from each person's encoding date forward".
*Quoted in that order, which is Section 4's. A first version ran the two together as one
continuous quotation with the halves reversed.*

A null is therefore a real answer and not a missing one, and it covers nothing. The comparison
stays `network !== null && network === scope.network`, which is what the undated branch
already does — so a report for a month before its subject existed is refused rather than
guessed at.

## What this removes

Decision 0215's refusal, and with it the branch in `authorize` that produced it and the
message naming the grant. 0215 said in terms what would retire it: "It goes away whichever
way that Stop Condition is settled: a dated resolution makes the grant work." This is that.

0215 is not withdrawn. It was correct for as long as it stood, and the record of a refusal
issued because no rule existed is worth more than a tidy history. Its number is not reused.

*Neither ruling has reached `main`: both are on the branch that introduced the route, and
0215 is superseded before it merges. That is why this reads as one change rather than as a
reversal — a reader of `main` will only ever see 0217, with 0215 recording why the refusal
was the right answer for the hours in which no rule existed.*

Two Stop Conditions leave with it: how a `NETWORK` grant of a dated capability resolves, and
whether 0215's answer bound the other two dated capabilities. The second existed only because
the first was answered for one target kind.

---

Decision 0217, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-07 — A report may not name a period that has not begun](0216-a-report-may-not-name-a-period-that-has-not-begun.md)
