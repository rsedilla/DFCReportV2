# 2026-09-11 — Section 2 argues the shape, and a derived ledger holds the instances

Section 2 exempts one shape from its ownership rule: a read joined onto a query rooted in
a table the reading module owns. It then *enumerated* the instances of that shape and
closed with "Nothing else qualifies today, and adding to this is an amendment rather than a
decision taken in a module."

**The enumeration was wrong on the day it was written, and nothing could tell anyone.**
`cells` joins `persons` in `membersAsOfWithin` and `membersOfWithin`, both rooted in
`cell_memberships`, both exactly the exempt shape, and neither among the instances Section 2
enumerated. *A first version of this sentence said "neither named in Section 2 or anywhere
else", which is false: both were named by name in Section 2's own italic, in the `CLAUDE.md`
bullet being retired, and in decision 0234. What they were not is **authorised** — named as
the gap rather than as an instance — and the sentence collapsed those two senses of named.* That was recorded as a Stop Condition — whether the enumeration is of
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

**Three kinds of cross-module read are inventoried, and only two of them are Section 2's
own.** A `join` and a `subquery` are: that section already uses the second word itself, when
it says `withoutACell` "anti-joins" three Cell tables while being "rooted in `persons`". A
`root` is **not** — it is a second exemption, narrower than the first, permitting shared
infrastructure to root a query in another module's table. *This paragraph claimed all three
were Section 2's own, and the ruling claimed below that it widened nothing. Both were false:
the `root` kind shipped in the ledger and in this file and in no Section, which is the
"all three legs" rule broken by the change enforcing it. Section 2 now states it, and whether
it should admit it at all is escalated as a Stop Condition rather than settled here.* **The
write side has no entry and no exemption**, because a write is what an invariant guards.

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
derivation confirmed independently. *This said the derivation "found" them "without being
told to look", which it did not: it was written against a Stop Condition that named both
methods in the sentence being settled. The one it genuinely found unprompted is the eighth.*
The eighth is `lockCellsWithin` in
`src/database/cell-lock.ts`, shared infrastructure taking the row lock Section 24 orders,
which no clause of Section 2 had ever mentioned in either direction.

It was verified by mutation rather than by being run once: renaming a ledger entry's method
fails twice, once for the unnamed read and once for the drifted entry; adding a table to the
schema fails for having no owner; and a cross-module write fails with no inventory available
to admit it.

## What this does not do

**It does not widen the *first* exemption.** Its shape is unchanged: the two `cells` joins
were always either admitted by it or not, and this settles that they are and records them.
What it does add is a **second** exemption for shared infrastructure, which is stated above
rather than denied, and which is open.

**It does not decide whether an operator may read another person's activation or
password-reset token on a development machine**, which is the other Section 2-adjacent Stop
Condition open at the time of writing and is about Section 6.

## What the mandatory review found

Eight, and three were silent misses in the derivation — the worst class available here,
because this ruling's whole claim is that a derived check is worth more than a prose total.
A probe of thirteen cross-module reads passed at exit 0 on seven of them.

**A cross-module write in raw SQL was invisible.** The reader matched `FROM` and `JOIN` only,
so `UPDATE persons SET …` and `INSERT INTO persons …` reached nothing, and `DELETE FROM` was
filed as a read. That is the one clause Section 2 states with no exemption, passing silently,
while `CLAUDE.md` asserted the check "fails on a cross-module write in any form".

**Six table-taking builders were never examined.** `crossJoin`, `crossJoinLateral`, `using`,
`from`, `mergeInto` and `replaceInto` were in neither enumerated set, and an unenumerated
builder was not refused — it was not a candidate. The fix is not a longer list: any call
handed a known table name by a builder this file does not know is now refused, so the next
one fails loudly instead of being skipped.

**A schema-qualified name was discarded as an alias.** `public.persons` is not in
`interface Database`, and the rule "a name not in `Database` is not a table" is sound only if
every spelling is. It now strips the qualifier.

**The subquery discriminator downgraded a main-rule violation.** It asked only whether an
arrow stood anywhere above the call, and `db.transaction().execute(async (trx) => …)` puts one
above every write path in this repository — so a root in another module's table inside a
transaction was offered a ledger line instead of a refusal. It now asks which builder the
arrow was handed to.

**The ledger's `kind` was an assertion it made about itself.** A `join` entry was admitted by
being written down, with nothing checking Section 2's actual precondition — that the join sits
on a query the reading module roots. That is the distinction this file exists to draw, missed
one level in, and it is now derived.

**`infrastructure` was checked in neither direction**, where `owners` and `crossModule` are
each checked in both. One of its four entries named no directory at all, and two granted
access to tables nothing beneath them reads. It is one entry now, and an entry naming no
directory fails.

*The fix batch introduced a defect of its own, in the way this repository keeps recording:
the repaired regular expression was written with a literal backspace character in place of
``, so it matched nothing at all and the terminal hid it. It was found by printing the
compiled pattern rather than by reading the line.*

---

Decision 0242, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — Four cross-module reads are re-homed, and one of them needs a port](0241-four-cross-module-reads-are-re-homed.md)
