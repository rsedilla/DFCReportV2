# 2026-09-07 — A `CELL` report scope selector resolves through the Cell's leader, and the closed-Cell fallback reaches it

`report_snapshots.scope_type` enumerates `CELL` (Section 20) and Section 12 puts
monthly-attendance buckets at Cell scope and nowhere else, so the first Cell monthly report
has to make a Cell a scope selector. Section 7 says what happens next **twice, and not
identically**, which is why this was recorded as open with this route named as its trigger.

- The **Cell target** bullet: a Cell "resolves through the Cell's leader **as of the period
  being viewed**, falling back to its last leader where the Cell is closed".
- The **report scope selector** bullet: the selector "is itself the target", resolving at the
  period's final millisecond (decisions 0207 and 0218) — with **no fallback stated, and no
  statement of what it resolves through** at all.

**A `CELL` selector resolves through the Cell's leader in force at the instant the period
resolves at, and where the Cell holds none there, through its last leader.**

## The two bullets were never rivals about the same clause

The selector bullet supplies an **instant** and has never supplied a **person**: it was
written for `LEADER`, which names its person directly, and extended to `NETWORK`, which names
no person at all (decision 0219). A Cell is the first selector that names an object and has
to be resolved to somebody. So the base Cell bullet is not a competing rule to be chosen
against — it is the only sentence in Section 7 that says what a Cell resolves *through*, and
reading the two together gives one rule with no gap in it.

What genuinely diverges is the narrow half: whether the fallback survives into a target the
selector bullet governs. That is what this settles, and it settles it in the direction the
base bullet already states for every other Cell target.

## The case that decides it is not the empty one

`CLAUDE.md` recorded this as "not blocking: a report for a month after closure is empty
either way". That is true and it is not the case that matters.

**A Cell closed on 15 October holds no leadership at October's final millisecond, and October
is not empty.** It holds two weeks of `HELD` meetings with real attendance, recorded by the
leader who ran them. Section 12 contemplates that month in terms — "A Cell created or closed
part-way through a month has fewer, and that is not an anomaly" — so the specification is
explicit that the closure month is reportable.

Under a no-fallback reading, the one month Section 12 goes out of its way to say is
reportable would be readable by a Whole Church grant alone, and refused to the leader who
recorded every row in it. That is not a conservative answer; it withholds a figure from the
only person who can explain it.

## The fallback is narrower than it reads

It fires **only where the instant finds nobody**, which is three states and no others:

- **After closure** — the period this bullet was framed around. Empty.
- **The period the closure falls in** — the case above, and the reason for the ruling.
- **Before the Cell existed** — a Cell created in June, asked about March. Empty.

The enumeration is exhaustive because leadership is **contiguous**, which the schema enforces
(migration 0009) — so a gap, which would be a fourth state reaching the fallback, cannot be
committed. *Which constraints deliver it is deliberately not restated here: two attempts to
enumerate them were refuted, once for being too narrow and once for being too broad and
sourced to a comment that says otherwise. Read the migration.*

A **handover** does not invoke the fallback. A Cell held by A until June and by B after
resolves each past period to whoever held it at that period's end, because the instant finds
somebody; the fallback never arises.

**The instant does move the month a handover falls in, and that is worth stating separately**
— it is decision 0218's doing rather than this ruling's. That month resolves through the
**incoming** leader while holding rows the outgoing leader recorded, which is the mirror of the
closure month this ruling turns on. What it decides was left open in `CLAUDE.md` rather than
settled here, and §13's own answer one unit down — decision 0187, which gives a meeting on the
handover *day* to the **outgoing** leader — is the reasoning nothing had carried up to a
period.

*Settled on 2026-09-10 as decision 0231, which keeps this ruling's answer and supplies the
reasoning: 0187 turns on attribution not depending on when a record was entered, and a period
has no date of its own but two ends, so choosing its final instant is a choice of end rather
than of clerk. That ruling took this question together with the same question asked of
`GET /api/v1/cells`, on the ground that one shape asked of two routes should not end up under
two rules.*

**Who reads it is a containment rule, and is stated only as one.** §7 resolves a `CELL`
selector to a Person, and a subtree grant asks whether that Person is within the actor's
subtree at the instant. So **the month is refused to exactly those actors whose subtree does
not contain the incoming leader at that instant** — a Whole Church grant reads it, a `NETWORK`
grant naming that leader's Network at that instant reads it, and every common ancestor of the
two leaders reads it. *Two attempts to restate this as a loss to named parties were refuted,
and it is not attempted a third time: the containment rule is the whole of it.*

**The accepted cost is stated rather than left to be found**: the last leader can read every
period after the closure and every period before the Cell existed, all empty and all
concerning a Cell that person led.

## Which grants cover a `CELL` selector

It resolves to a Person, so this follows from the resolution rather than being decided
beside it, and all three branches are the ones already built:

- a **Whole Church** grant covers it;
- a **subtree** grant covers it where that leader is within the actor's subtree **at the same
  instant**, on `is_within_subtree_as_of`;
- a **`NETWORK`** grant covers it where that leader's Network at that instant is the granted
  one, on `network_as_of` (decision 0217).

**Decision 0219's "no subtree grant" reasoning does not carry over, and that is the point of
saying so.** It rests on a `NETWORK` selector naming **no Person**, so there is no containment
to test. A `CELL` selector names one as soon as it is resolved. The two selectors therefore
differ on this and it is not an inconsistency.

**A Cell that does not exist resolves through nobody, so every grant narrower than Whole
Church refuses it as `SCOPE_DENIED`** — the same answer an out-of-scope Cell gets, and the
idiom `common/identifiers.ts` already carries for a target the caller cannot be shown to
exist.

**A Whole Church grant is the exception, and stating it unqualified was wrong.**
`scopeCovers` returns true at Whole Church *before* the target is read, so such an actor
receives a well-formed report of zeroes rather than a refusal. That is not this rule failing:
it is the open question about a scope selector naming somebody who does not exist, which
`CLAUDE.md` already records for a `LEADER` selector and which now reaches a second target
kind. Nothing is disclosed either way — the payload is zeroes — and the sentence is narrowed
here rather than the behaviour changed, because changing it would settle that question by
implementation.

## What was rejected

**`leaderAsOfWithin` alone** — the dated read with no fallback. It is the narrower and more
obviously principled-looking answer, and its cost is the closure month above. It would also
have made the `CELL` selector the only Cell target in Section 7 that does not fall back,
without Section 7 anywhere saying why that target is different.

**Resolving through the leader who led each meeting** rather than through the Cell. Section
20 does attribute a Cell figure by "the meeting's responsible leader, frozen as of the meeting
date", so this is not an idle alternative — but that is the **attribution** key, deciding
which meetings land in an aggregate scope's population. A `CELL` selector names one Cell and
asks who may read it, and answering that per meeting would let a Cell's report be partly
readable, which no scope answer in this system is.

## What this does not change

**No write moves.** A viewing capability confers none, and Section 7's rule that authority
resolves through the current leader is untouched.

**No figure moves.** This is an authorization answer; the population, the buckets and the
identities are Section 12's and Section 20's, and none of them consults the actor.

**It does not settle the closed-Cell tension recorded as open in `CLAUDE.md`.** That question
is whether the fallback survives for a capability that resolves **as a write**, and
`reports.view_subtree` is a viewing capability under decision 0186 — so this ruling stands
entirely inside the half of that bullet Section 7 is not in two minds about, and leaves the
`GET /api/v1/cells/{id}/meetings` case exactly where it was.

---

Decision 0220, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-07 — A Network's reporting population is its membership](0219-a-networks-reporting-population-is-its-membership.md)
