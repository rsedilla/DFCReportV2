# 2026-08-29 — Four on the fifth fix batch, and a disjunction pinned with a member missing


Sixth `architecture-guardian` pass, scoped to the fifth batch. First pass on this branch
where **no finding is a defect the previous batch introduced into a mechanism it had just
built** — the keyset itself was traced and executed and confirmed again, as were the
arithmetic, the empty-cursor alignment, the collation-safety of the fixture and the
cross-module change. The yield across six passes is 12, 10, 10, 7, 5, 4.

**The middle keyset disjunct had nothing that could fail on it**, and the batch before
had claimed the opposite in a commit message, a test comment and this log. Three
mutations were run and reddened; the fourth — deleting only
`last_name = key AND first_name > key` — was not run, and it leaves the whole suite
green. The fixture could not reach it: `alpha` and `twin` share *both* names, so that
disjunct selects nobody at either cursor, and the other two decide every boundary.

**Three members were not enough**, and a fourth — `Santos, Berta` — gives a boundary that
crosses on the first name within an equal last name, which is the only boundary the
middle disjunct decides.

***The rest of what this paragraph said was false and is corrected below.*** It claimed a
second inversion was needed: that a member created after the two Anas holds a higher
Member ID, so the tie-break would reach her and leave the middle disjunct dead unless she
were created second. The tie-break requires `first_name = key.firstName`, and hers is
`Berta` against a key of `Ana` — so it excludes her on the name before a Member ID is
compared, and her creation position cannot affect any mutation. One inversion is
load-bearing, `omega`'s, and it kills exactly one of the four mutations: `member_id >`
alone. The other three redden on the names whatever the Member IDs are.

The claim was made in four places at once — two test comments, an assertion whose stated
purpose was to pin it, this entry, and the commit message — and the assertion pinned
nothing, which is how a false reason gets four witnesses and no test. Found by the
seventh pass, which reproduced it both ways round.

That is the third consecutive batch on this branch to ship a disjunction pinned with a
member missing. The other two are recorded above; what they share is that the mutation
actually run was the one the author had in mind rather than the one the code permits.

**Every sentence saying which assertion catches which mutation was wrong**, in the batch
whose own heading is about statements broader than the code. `Zamora` was said to sort
before `Santos`; the `last_name >` mutation was attributed to the page it does not fail
at. The comments now name the boundary each disjunct decides, and each was checked
against the fixture rather than against the intention.

**`NAME_FIELD_MAX_LENGTH` was not what any DTO enforced.** The constant existed, was read
only by the unit case, and the eight name fields carried the literal `100` — so the drift
the file argues against was live one field over, and widening `first_name` would have left
the case green at 100 characters while the emitted cursor doubled. The DTOs import it now,
which is what makes the bound's premise falsifiable: the mutation is a name field
widening, and it reddens.

**And a re-export nothing imported**, displacing the module's docblock onto itself.
Removed on the 2026-08-24 ground that removed `rolesFor`: code with no caller.

**The premise defect the pass ranked fifth had already been found and fixed**, by checking
my own claim rather than by review — that `1024` was called a *derivation* from a
100-character name limit which only two DTOs enforce, while the column is bare `text` and
the tree import bounds nothing. It is a request-size guard now, says so, and the missing
rule is on the open list.

**One local incident, recorded because it cost the most time in this batch and was not a
defect.** Twenty tests failed, including tests untouched for weeks. Stashing to the
committed state reproduced thirteen failures on a commit CI had already passed, which is
what showed it was environmental: an orphaned `npm test` was still running against the
scratch database, because stopping a background task kills the shell and not the node
processes beneath it, and two jest runs truncating the same database interleave into
duplicate-root violations. The lesson is the diagnostic order — a local failure on a
commit CI passed is an environment claim until proven otherwise, and the cheapest proof
is to run the committed state.

---

Decision 0145 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Five on the fourth fix batch, and a bound that moved underneath its payload](0144-five-on-the-fourth-fix-batch-and-a-bound-that-moved.md) | Next: [2026-08-29 — Five on the sixth fix batch, all of them what the batch said about itself](0146-five-on-the-sixth-fix-batch-all-of-them-what-the-batch-said.md)
