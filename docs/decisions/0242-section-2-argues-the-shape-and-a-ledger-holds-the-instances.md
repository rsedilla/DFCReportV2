# 2026-09-11 — Section 2 argues the shape, and a derived ledger holds the instances

Section 2 exempts one shape from its ownership rule: a read joined onto a query rooted in
a table the reading module owns. It then *enumerated* the instances of that shape and
closed with "Nothing else qualifies today, and adding to this is an amendment rather than a
decision taken in a module."

**The enumeration was wrong on the day it was written, and nothing could tell anyone.**
`cells` joins `persons` in `membersAsOfWithin` and `membersOfWithin`, both rooted in
`cell_memberships`, both exactly the exempt shape, and neither named in Section 2 or
anywhere else. That was recorded as a Stop Condition — whether the enumeration is of
instances or of *argued* instances — and it is settled here.

## The ruling

**Section 2 argues the shape. `api/module-boundaries.json` holds the instances.**

The section keeps its three arguments, because the reasons are the argument for the shape:
a join that cannot move to the owning module, one that would otherwise become one query per
row, and an attention list rooted in the table of people who hold no Cell. What it stops
doing is claiming a total.

`api/scripts/check-module-boundaries.mjs` runs on every `npm run lint` in `api` and fails
in **both** directions: on a cross-module read the ledger does not name, and on a ledger
entry that matches no read. A list that may only grow silently is the failure this replaces;
a list that may rot silently would be the same failure facing the other way.

## Why not the two alternatives

**Amending Section 2 to name all five** keeps one home and was refused for what it costs
the next join: every one would need a specification amendment before it could ship, and the
list would stay a thing only a person can check. It had already been wrong twice that way,
both times asserting a total, and a third time in the sentence the italic beneath it was
added to prevent.

**Rewording it to admit the shape and stop implying a total** is the cheapest and changes no
code. It was refused because nothing would then be able to fail on this rule at all, which
is the standard every other rule in this repository is held to: the palette, the client
boundary, the UI dependencies, the breakpoints and the screen coverage each have a check
that goes red.

## What the check derives, and what it refuses

**It parses TypeScript rather than scanning text.** `check-screen-coverage.mjs` records why
at length: two regular-expression versions preceded it and both were broken, the second by
text it read *wrongly while believing it had read it*. This is syntax-only — no program and
no type checker — so a string is a string and a comment is a comment, decided by the parser
that compiles the API.

**The table list is derived too**, from `interface Database`. A migration adding a table
cannot ship without that table being given an owner, which is the half a hand-written map
would lose first.

**Three kinds of cross-module read are inventoried**, and the distinction is Section 2's own
rather than an invention: a `join`, a `subquery` — the word that section already uses when it
says `withoutACell` "anti-joins" three Cell tables while being "rooted in `persons`" — and a
`root`, which only shared infrastructure may take. **The write side has no entry and no
exemption**, because a write is what an invariant guards.

**What it cannot resolve, it refuses.** A table argument that is not a literal fails, as does
a raw `sql` template whose `FROM` or `JOIN` target it cannot read. One argument is resolved
rather than refused, and only because the answer is syntactically present: a parameter typed
as a union of string literals names exactly the tables it can be, which is what
`latestWithin` does with `'cell_leaderships' | 'cell_memberships'`.

**A name that is not in `Database` is not a table** and is ignored as a CTE or an alias. That
is sound rather than lenient, because the set it is checked against is itself derived.

## What it found

Eight cross-module reads across six methods. Five are the instances Section 2 argued. Two are
`cells` joining `persons`, which is the gap that made this a Stop Condition and which the
derivation found without being told to look. The eighth is `lockCellsWithin` in
`src/database/cell-lock.ts`, shared infrastructure taking the row lock Section 24 orders,
which no clause of Section 2 had ever mentioned in either direction.

It was verified by mutation rather than by being run once: renaming a ledger entry's method
fails twice, once for the unnamed read and once for the drifted entry; adding a table to the
schema fails for having no owner; and a cross-module write fails with no inventory available
to admit it.

## What this does not do

**It does not widen the exemption.** The shape is unchanged and so is the main rule. The two
`cells` joins were always either admitted by the shape or not; this settles that they are,
and records them.

**It does not decide whether an operator may read another person's activation or
password-reset token on a development machine**, which is the other Section 2-adjacent Stop
Condition open at the time of writing and is about Section 6.

---

Decision 0242, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — Four cross-module reads are re-homed, and one of them needs a port](0241-four-cross-module-reads-are-re-homed.md)
