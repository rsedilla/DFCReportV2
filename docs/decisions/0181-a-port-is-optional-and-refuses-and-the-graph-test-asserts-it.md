# 2026-09-01 — A port is optional and refuses, and the graph test asserts it is bound

`CLAUDE.md` has carried this since 2026-08-30, and it says to settle it **before a
second port is declared, because the answer should be the same for both**. The Cell
meetings slice is what makes that due: `AttendanceModule` today imports no
`CellsModule` and its docblock says it "touches no table it does not own", while
§13 needs the Cell's schedule, its leadership as of a date, its membership as of a
date, and its closure state — four questions `cells` owns.

## The question, as `cell-relationships.port.ts` states it

Should a port a module cannot bind for itself be injected `@Optional()` and refuse the
operation when unbound, or be mandatory so an unbound port fails at startup?

That file already carries the argument and says in terms that the question "should be
settled from this paragraph rather than from the first one" — the first one having
recorded a reason that turned out to be false. Both prior recordings of it were wrong
in a way worth keeping, because the same mistake is available to anyone re-deriving it:

- **"Only `AppModule` can bind an implementation, so the injection has to be optional."**
  False. Nest resolves a provider's dependencies in the module that *registers* it, so
  a binding module registered alongside works.
- **"It is `@Global()`, so the token is always there."** Also false, and narrower than
  it looks: a global module publishes its exports to every module *of a graph that
  includes it*, not to every context anywhere. Mandatory works today because the one
  test graph omitting the binding, `cycle-safety.spec.ts`, constructs no
  `NetworksService`. That is "no such graph exists yet", not a guarantee.

## Two kinds of port, and only one of them is the question

The bullet asks about "a port a module cannot bind for itself", and that phrase is doing
work this ruling nearly discarded. The repository has three port tokens and they are not
the same thing:

- **An inversion port** exists because the implementation *must* come from another
  module — that module owns the tables — and a direct dependency would be a cycle, since
  `cells` already imports `NetworksModule`. The consuming module cannot supply a default,
  and a binding module joins the two. `CELL_SCOPE_PORT` and `CELL_RELATIONSHIPS_PORT`,
  both injected `@Optional()`.
- **An adapter port** exists to swap an implementation — a real provider for a logging
  one — and the owning module ships a default binding that is always present.
  `EMAIL_PORT`, injected **mandatorily** in `CredentialsService` and
  `AccountProvisioningService`.

*A first draft of this ruling said "a port" without qualification, which would have
obliged somebody to make `EMAIL_PORT` optional. That is decision 0100's pattern —
reusing a shape without re-deriving why it has that shape — committed in the ruling
written to stop the next port re-deriving anything.*

## The ruling

**An inversion port is injected `@Optional()` and the operation refuses when it is
unbound — and `test/unit/module-graph.spec.ts` asserts that the binding resolves.** Both
halves, and the second is what makes the first cost nothing.

`CELL_SCOPE_PORT` set the precedent and stated the reason: "a missing binding closes
every Cell-scoped endpoint rather than opening one". `CELL_RELATIONSHIPS_PORT` followed
it. This makes that the rule rather than a repeated coincidence, and binds every
inversion port declared from here.

**An adapter port stays mandatory**, and the difference is what an absent binding means.
For an adapter port it means the owning module was not imported, which is a build fault
with no sensible runtime behaviour — there is no operation to degrade, because every
caller needs it. For an inversion port it means one binding module is missing from a
graph that is otherwise complete, and exactly one operation depends on it.

## Why the trade-off the open list describes is not a real one

`CLAUDE.md` framed this as a genuine choice with a cost on each side, and the cost it
named against optional is real and was paid: `test/unit/module-graph.spec.ts` exists so
a wiring fault fails in seconds without a database, and `@Optional()` defeats it —
which is why binding `CELL_RELATIONSHIPS_PORT` in the wrong context surfaced as
**fifteen red end-to-end cases** rather than one red unit case.

But that cost belongs to *nothing asserting the binding*, not to optionality. An
assertion in the graph test recovers the fast local failure and keeps the live
degradation:

- **Unbound in development**: one unit case goes red in seconds, naming the token.
- **Unbound in production**: the process starts and one operation refuses, rather than
  the whole application failing to boot over a Network change nobody was making.

Mandatory injection buys only the first. There is no reading on which it buys more, so
the argument that looked balanced was balanced only while the graph test was assumed
fixed.

§7 already takes both sides of the underlying question elsewhere, which is why neither
answer could be derived from the specification alone: an absent
`SENIOR_PASTOR_PERSON_IDS` fails closed and the process starts, while a malformed one
stops it. The distinction that ruling drew is **absent versus wrong**, and it is the one
applied here. An unbound port is absent.

## What an inversion port owes, so this is a rule and not an anecdote

Every inversion port declared from here:

1. **Is injected `@Optional()`** at its consumer.
2. **Refuses the operation when unbound**, and never skips the check. A fail-open
   reading turns a wiring fault into a silent hole in whatever rule the port was
   answering — which for `CELL_RELATIONSHIPS_PORT` is a rule §4 states absolutely.
3. **Is asserted bound in `test/unit/module-graph.spec.ts`**, by resolving the token
   from the compiled `AppModule`. That test builds the injector without opening a
   connection, so it runs anywhere.
4. **Has one case exercising the unbound refusal**, overriding the binding to
   `undefined`, as `network-change-port-unbound.e2e.spec.ts` does. Without it the
   fail-closed branch is unreachable — every other test builds the real `AppModule`,
   which binds the port — and a mutation removing that branch leaves the suite green.
5. **Declares its interface where it is needed and is implemented where the tables
   live**, bound by a module whose only job is the binding. That is the inversion
   `CELL_SCOPE_PORT`, `EMAIL_PORT` and `CELL_RELATIONSHIPS_PORT` already use, and it is
   what keeps §2's dependency direction acyclic — `cells` imports `NetworksModule`, so
   a direct dependency the other way would be a cycle.
6. **Takes the caller's executor on every method** where its answer is a premise for a
   write. A pooled read answers from the state the request arrived with and asks a
   bounded pool for a second connection while holding one (§24). Where the answer is
   relied on after a lock, the parameter is typed `Transaction<Database>` rather than
   the union, so it is a compile error rather than a comment.

Point 3 is new. Points 1, 2, 4, 5 and 6 describe what the two existing ports do, written
down so the third does not re-derive them — decision 0100's rule, that reusing a shape
requires re-deriving why it has that shape, discharged once here instead of at each port.

## What this obliges the Cell meetings slice to do

Declare its port into `cells` under these six points, and extend the graph test to
assert that **all three** existing tokens resolve alongside the new one —
`CELL_SCOPE_PORT`, `CELL_RELATIONSHIPS_PORT` and `EMAIL_PORT`. None is asserted today
(`grep` finds no `_PORT` in `module-graph.spec.ts`), and the assertion is worth having
for the adapter port too: mandatory injection catches it only when something constructs
the consumer, which in a partial test graph may be nothing.

---

Decision 0181, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-01 — A migration is frozen by merging, not by its number, and two on the seventh pass](0180-a-migration-is-frozen-by-merging-not-by-its-number.md) | Next: [2026-09-01 — A closed month is amended on the routes that record it](0182-a-closed-month-is-amended-on-the-routes-that-record-it.md)
