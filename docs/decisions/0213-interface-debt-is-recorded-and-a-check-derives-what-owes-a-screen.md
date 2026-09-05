# 2026-09-06 — Interface debt is recorded, and a check derives what owes a screen

Two completed stages shipped no interface. Stage 3 delivered Cells and Stage 4 delivered
attendance; `web/app` holds ten screens, and every one of them is authentication, the home
page, or People. Thirty-five route decorators across seven controllers, and nothing a person
can open reaches a Cell, a meeting, or an attendance record.

This settles how that stops being invisible. It is a process rule rather than a domain one,
so it is written to `CLAUDE.md` and `docs/ROADMAP.md` and **not** to `SKILL.md`, on decision
0004's terms — the agent roster is recorded the same way and appears nowhere in the
specification.

## The failure is the divergence, not the ordering

Building the API before the screens is deliberate and is not what went wrong. Section 2
fixes the API-first constraint, and this roadmap's closing note gives the reason: a mobile
client that forces an API change means something was built as a web feature. A stage that
ships API-only is following the rule.

What went wrong is that **a stage's bullet list is scope and its "Done when" is the exit
criterion, and where the two diverge the bullets lapse with nothing recording it.**

Stage 5 shows it live rather than historically. Its scope list already carries
"Role-specific dashboards, with scope and period on every tile (§19)"; its "Done when" is
the reconciliation clause alone. The stage can therefore be declared complete with a listed
deliverable unbuilt — which is the right call, and is now made deliberately and in writing
instead of by omission.

Stage 4 shows the honest form of the same thing: two things it did not finish, both written
down, neither blocking. Stage 3 has no such section — it records plenty about what it did,
and nothing about what it did not. The habit exists in one place and is made an obligation
everywhere.

**Eight of the fifty-three open items in `CLAUDE.md` are deferred to "the first screens"** —
counted rather than remembered. That is a queue of decisions waiting on a deliverable no
stage had scheduled, and one of those items said so in terms: it was recorded "so it is not
lost between a specification requirement and a stage nobody has scheduled it in."

## Three mechanisms

**A stage that ships an endpoint family no person can reach records the debt** twice: per
route in `web/screen-coverage.json`, as a waiver naming the stage that owes the screen, and
as prose in `docs/ROADMAP.md` naming the screens themselves. It may still ship API-only; it
may not do so silently. Written to Definition of Done, which says which of the two halves
can fail.

**The roadmap gains a screens block**, sitting between Stage 5 and the pilot, and Stage 6's
exit criterion gains an interface clause — a month closes with real data recorded and read
*through the interface*. Stage 6's stated risk was "piloting without Stage 5", which stops
being the risk the moment Stage 5 exists and the pilot still has nothing a leader can open.

**A check derives the route list from the controllers and fails on anything a ledger does
not mention.** `web/scripts/check-screen-coverage.mjs`, wired into `npm run lint` in `web`,
in the shape of `check-contrast.mjs`. The first two mechanisms are prose, and `CLAUDE.md`'s
own argument for the accessibility gates binds them: a conformance claim with nothing that
can fail is a wish. That sentence is `CLAUDE.md`'s rather than Section 23's, which commits
the web application to WCAG 2.2 AA and does not itself say it. The check is what makes the
Done rule fail-able **in the half described below**, and it is specified here so that its
absence is visible if it slips. The unqualified form of that sentence stood here for one
commit and is what the paragraph below retracts; it is qualified at the point it is made
rather than three sentences later, because the head sentence is the one a reader quotes.

**It makes half of it fail-able, and the half is named rather than glossed.** The check
reads the controllers and the ledger; it never reads `docs/ROADMAP.md`. So the obligation
to file a per-route waiver naming the stage that owes the screen is enforced, and the
obligation to describe those screens in the roadmap is prose that stays prose. A stage
that files its waivers and writes nothing in the roadmap is green. That is a real gap and
it is written down rather than papered over, because a rule claiming an enforcement it does
not have is precisely the defect this ruling exists to name — and the first draft of this
paragraph committed it, saying the check "makes this fail" of a clause whose subject was
the roadmap. Closing the gap would mean the check parsing prose for a stage name, which
buys less than it costs; naming it is the honest alternative.

## Why the check derives its list rather than declaring one

A hand-maintained list is a list somebody eventually forgets to extend, which is Section
20's own argument for keying a stored figure to a source version rather than enumerating
its invalidators. The Section 22 storability check is the instance that has already paid:
it derives its own field list and found one nobody would have listed, `SearchPeopleDto.q`.

So the ledger is compared against routes read out of `api/src/**/*.controller.ts`, and a
route the ledger does not mention fails the build. A new endpoint cannot merge without a
line saying which screen reaches it, a waiver naming the stage that owes one and why, or
a statement that no screen is owed at all.

## Why the ledger starts with every route already in it

It ships pre-populated for every route that exists today — thirteen reached by a screen,
twenty-one waived and one owing none — so it is green on
the day it lands and red the moment route thirty-six arrives unledgered — including during
the screens block itself, which is when new routes appear fastest.

The alternative was to ship it with the first screen, on the axe-core precedent in
`CLAUDE.md`: a browser harness for a placeholder page checks nothing. That precedent does
not transfer. Axe-core has nothing to measure until a screen exists; this check has
thirty-five things to measure now, and deferring it leaves the gap open across exactly the
period the debt is being incurred.

**The waiver list is the weak point and is recorded as one.** A file of twenty-one waivers
can rot into a rubber stamp, each new one copied from the line above. A waiver must name the
stage that owes the screen, **and the check refuses a stage name it does not know** — the
permitted stages are declared once in the ledger and a waiver naming anything else fails the
build. That much is enforced; whether naming a stage is *enough* to stop the rot is not
proven, and nothing here claims it is.

*The first version of this ruling claimed the naming requirement was enforced when the check
tested only that the string was non-empty, so `"waived_to": "banana"` passed. The check was
given the closed list rather than the claim being softened, because the alternative was a
specification describing a guarantee its implementation did not provide — which is the defect
this ruling is named after.*

## What was rejected

**Screens as a stage deliverable** — "a stage that adds an endpoint family is not done until
a person can reach it". It would have blocked Stages 3 and 4, which were right to be
API-only, so it forbids the practice rather than the silence.

**Binding every scope bullet to its "Done when"** — requiring each to appear in the exit
criterion or be struck with a reason. It attacks the general divergence rather than the
interface case and touches every stage's text.

*It was rejected here as buying "nothing the recorded debt does not", and that was false.*
The adopted rule fires only on an endpoint family no person can reach, so a scope bullet
with **no endpoint at all** never triggers it — and Stage 5 carries one, "Materialized
closed months", which could go unbuilt with nothing owed. The rejected alternative is
therefore strictly wider, and the ground for rejecting it is cost and reach rather than
equivalence. That this branch voluntarily wrote Stage 5's full divergence does not rescue
the claim: the comparison is between two rules, and the adopted rule does not compel that
paragraph.

## The check merges first

The Definition of Done clause names `web/screen-coverage.json` as where a waiver is filed,
and both that file and the check arrive in a separate change. **That change merges before
this one.** Merged the other way round, the clause requires a waiver in a file that does not
exist and no check runs, so neither half can fail — the state this ruling exists to end,
reached by merge order. The dependency is recorded here because nothing else can hold it:
branch protection orders no pair of pull requests.

## What is not settled here

The contents of the eight screens, and the eight open items deferred to them. Those stay
open; what changes is that they now have a stage to be settled in rather than a deliverable
nothing had scheduled. Network Summary stays deferred past the pilot, so the screens block
is Section 19's leader sidebar minus Network Summary, plus the Cell meetings screen Stage 4
shipped without.

---

Decision 0213, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — A placement graph that is not functional refuses the figures it corrupts](0212-a-placement-graph-that-is-not-functional-refuses-the-figures-it-corrupts.md)
