# 2026-08-30 — The backdate floor gains two Cell terms, one per mechanism


The last hole in Section 4. The floor's terms were over pastoral rows alone, so a
correction backdated into a Cell stint the person has since handed over stranded every
membership opened during it — this rule's own failure, reached through a date field
rather than an open row. The open list has carried it since the Cell precondition merged.

**A closed Cell leadership bounds on its `ended_at`; a closed Cell membership bounds on
its `started_at`, extended to the last leadership start it spans.** Two clauses rather
than one, because they are bounded by two different mechanisms.

*This thesis said `started_at` alone until the second review pass. The paragraph four
lines below it had been corrected and this one had not — which is the failure the
2026-08-23 reassignment entry records in one line: a heading is what gets skimmed and
quoted, so a stale one travels further than a stale paragraph. It was the heading here,
in the entry that quotes that lesson.*

**Nothing selects a Cell relationship on a Network write**, which is what makes these
terms unlike term (b). `assert_network_change_keeps_edges` reads no Cell table, and the
Cell triggers fire only on writes to their own. So a Cell relationship is stranded by
never being examined again, not by being re-examined and failing, and each term has to
clear the latest instant at which the relationship was ever compared.

*This first said that trigger reads "`pastoral_assignments` and no other table",
"verified by reading its `FROM` clause". It reads `network_assignments` too — its own
`NEW` row, and again through `network_as_of`. The load-bearing half, that it reads no
Cell table, is true; the sentence was not, and it was in `SKILL.md` as well as here.
Found by `architecture-guardian` reading the clause the claim said it had been verified
against.*

**Membership: its `started_at`, extended to the last leadership start it spans.** A
membership is compared twice over — by `assert_membership_same_network` at its own start,
and by the member scan inside `assert_leadership_stays_in_network` at the *incoming
leadership row's* start, for every membership open at that instant. Both are rows of the
membership's own Cell, so the term still needs nothing from other people's records.

***The first version of this ruling bounded it at `started_at` alone, and that was a live
defect.*** It rested on "compared at its start and at no other instant" — true of one
trigger, false across two. The gap is ordinary history rather than a contrivance: joined
in January, the Cell handed over in March, left in June, corrected effective February. The
correction commits and leaves the March handover asserting a Cell containing a member of
the other Network, which is the state that trigger's own message exists to refuse.

Found by `architecture-guardian`, and reproduced against the schema before it was acted
on. The reason it survived my own check is worth keeping: I did examine the member scan,
and asked only whether a *future* handover could bind. It cannot — approval stamps
`clock_timestamp()`, so a future handover is after every closed `ended_at`. Every handover
that matters is in the past, and the question was asked in the one direction where the
answer is no. That is the recurring fault in a new costume: a mechanism checked over the
part of its range being looked at.

**Leadership: `ended_at`, on two grounds that hold over different stints.** Where the
stint ended in a **handover** it is *exact*: `assert_leadership_stays_in_network` reads
the outgoing leader's Network as of the successor's `started_at`, and the contiguity
check forces that to equal the outgoing `ended_at` — so a correction dated at or before
it makes the successor's row retroactively cross-Network. Where the stint ended in a
**closure** there is no successor, and what is stranded is other people's memberships,
opened during the stint and compared against the leader's Network as of each membership's
own start. Those cannot be enumerated from the corrected person's rows, so bounding past
the end of the stint covers them all without trying.

The second ground is the only over-refusal, and it is small: a Cell that never held a
member strands nobody, and its former leader is bounded anyway.

**The uniform `ended_at` form was drafted, and it was refused for what it costs the
membership half.** It is sound — `ended_at` is never earlier than any instant the
membership was compared at, so it dominates — and it refuses writes that are provably
safe: for a membership that spanned no handover, every date after the join leaves it
legal, and for one that did, every date after the last handover does.

**What decided it is an interaction neither the draft nor the open item named.** Section 4
refuses the correction while an open membership stands, so the administrator ends it —
which closes it *today*. Under a uniform `ended_at` the floor would then fall on the
current day, and a backdated correction would be unavailable to anyone who has ever been
in a Cell, which is very nearly every person in the church. Over `started_at` it falls on
the day they joined, and the period before that stays reachable.

Section 4 *does* accept exactly that outcome for disciples — clearing them fixes the
effective date to today. The difference is that there it is **forced**, because
`assert_network_change_keeps_edges` selects on `ended_at`; here it would be **chosen**,
over the most common relationship in the church, to make two terms look alike. That is
Section 25 rule 19 in the direction it is usually met: a shape reused without re-deriving
why it has that shape.

**The draft's justification for the uniform form was a false citation, and it was the
load-bearing sentence.** It defended the over-refusal as "the trade this section already
makes one paragraph up, where the uniform strict form is called conservative by one
instant and followed rather than optimised". That sentence is in *this log*, in the
2026-08-23 entry — not in Section 4, and not in `SKILL.md` at all, which carries no
conservatism trade anywhere near the floor. Caught by grepping for it rather than by
reading the paragraph it pointed at. It would have entered the source of truth as the
justification for the one part of the rule that needed one.

The magnitude was wrong with it: a membership over-refusal is the length of the
membership, which is years, and not one instant.

Section 4 now says the two halves must not be tidied into one, and why, because the
tidied form is the one that reads better.

Written to `SKILL.md` Section 4, and verified by grepping that section for each term
rather than by asserting it here. The stale parenthetical below the floor — which said a
Cell floor term was an open question — is corrected in the same change.



**One `architecture-guardian` pass, and it refuted the ruling's central premise.** One
live defect, eight false statements, five unpinned rules. The defect and the premise are
recorded above, where the claim was made; what follows is the rest, because the shape of
it is the useful part.

**Every false statement was a true conclusion with a false reason**, which is this
project's most-recorded fault and which four consecutive passes on the previous slice also
found. In this batch: the `FROM`-clause overclaim above; "compared at its start and at no
other instant", which was in six places at once — Section 4 twice, both docblocks, this
entry, and both commit messages; a description of `assert_network_change_keeps_edges` that
covered only its `INSERT` firing, in the file whose own 2026-08-23 entry exists to record
that describing that trigger from one firing is the recurring error; a directional word
pointing at the wrong paragraph; a paragraph miscount; "the two methods above refuse the
change", which a port cannot do; and a comment in `networks` justifying an uncovered
concurrent closure with "a relationship that is genuinely gone cannot strand anyone" —
which is the exact opposite of this ruling's own second ground for the leadership term,
left standing by the change that falsified it.

**The two commit messages are immutable and carry the false premise.** `f0dce59` and
`dea0031` both state that a membership is compared at its start and nowhere else. They
stand; this entry is the correction.

**Four rules had nothing that could fail on them, and the tie was the sharpest.** The
bound is resolved by a reduce that keeps the earlier candidate, so `>` becoming `>=` would
name the Network row where the pastoral edge should be named — and no case in the suite
asserted the pastoral wording at all, so `MESSAGE_FOR.edges` could have been changed to
anything. The tie is not a corner: `createPerson` writes the Network row at `EPOCH` and
`assignTo` defaults to it, so term (a) equals the Network row's start for most fixture
people, and the one existing case near it deliberately uses an unassigned person and never
reaches the tie.

**One gap was closed by a type rather than a test.** Nothing pinned that the Cell floor is
read through the caller's transaction: passing the pool compiles, and under READ COMMITTED
with the lock held it returns the same rows in every sequential test, while breaking both
the Section 5 rule that a write reads what it relies on after the lock and the Section 24
pooled-connection hazard. `closedRelationshipFloorOf` now takes `Transaction<Database>`
rather than `Db | Transaction<Database>`, so the mistake is a compile error — the standard
Section 2 sets for the capability guard and Section 22 for `completeWithin`. The two
precondition methods keep the wider type, because they are not premises for a later write.

**And one boundary was found by mutating rather than by review.** The span predicate takes
leadership starts in `[cm.started_at, cm.ended_at)`, and widening it to `<=` left the whole
suite green. A handover at the exact instant a member left is not a comparison instant —
the member scan selects on `cm.ended_at > H`, false at equality — so bounding past it would
refuse a correction for nothing. Pinned now.

**The Stop Condition the pass raised is settled in Section 4 rather than left open.**
Section 4 refuses a Network change while an *open* membership stands, and permits a
correction dated inside a membership that has since ended, and those read as opposite
answers to one fact pattern. The difference is not the comparison instant, which is the
same for both. It is that an open membership is a **live** relationship — the person is
presently in a Cell of the Network they no longer belong to, which is a state this
specification holds absolutely against — while a closed one is a historical period, and
Section 4 has already accepted in writing that closed periods keep the Network recorded for
them. The floor is what keeps that bargain honest: it refuses any date that would falsify a
comparison some row still depends on, and permits only dates that leave the record merely
out of date.


**A second pass, scoped to the fix batch, found nothing behavioural.** It confirmed the
membership fix by re-deriving the join predicate against the member scan, and enumerated
every reader of a closed Cell row where the corrected person's Network is an operand —
five sites, all in migration 0009, each cleared by one of the two terms. There is no
third reader. That is the convergence the previous slices took four and five passes to
reach.

What it found was one **new** false reason, in `SKILL.md` rather than in a comment: the
settlement paragraph listed three consequences of stranding an open membership, and the
first — that the Cell can take no further member from its own roster's Network — is false
on the member side. `assert_membership_same_network` compares a joining member against the
Cell's **leader**, never against the members already in it. Those three consequences are
Section 4's for a change to the *leader's* Network, carried across without re-deriving
which survive. Section 25 rule 19, in the paragraph settling a Stop Condition, in the batch
whose own entry says every false statement here is a true conclusion with a false reason.

It also found the ruling's **bolded thesis** and the open-list italic still stating
`started_at` alone, four lines above a paragraph that had been corrected. The lesson is
already in this log verbatim, from 2026-08-23: a heading is what gets skimmed and quoted,
so a stale one travels further than a stale paragraph.

**Of the four mutations that pass reported as unrun, running them settled three
differently than reading them had.** The correlation `spanned.cell_id = cm.cell_id` was
genuinely unpinned and is pinned now, by a case with a second Cell whose handover falls
inside the membership window and which the corrected person never belonged to —
uncorrelated, the term picks up any Cell's handover and over-refuses. The lower bound
`>=` against `>` is unreachable, needing two identical `clock_timestamp()` reads, and is
declared in the docblock rather than pinned by a fixture that cannot arise.

**`max` against `min` was reported as green and is already caught**, which is worth
recording because the reason is not obvious: a Cell's *own first leadership row* starts at
the Cell's `created_at` and therefore sits inside any membership opened at that instant,
so a window holding one handover already holds two rows. The existing case reddens. Run
rather than accepted — the same discipline the report itself asks for, applied to the
report.

**`dea0031`'s commit message overclaims one pin.** It says "Also pinned: the network-row
push"; the three cases that batch added do not pin it. What catches a crude deletion is
the pre-existing case refusing an effective date at the instant the Network row began,
where an empty candidate list makes the seedless `reduce` throw. The message is immutable
and stands; this is the correction.


**A third pass, scoped to the two fix commits, found nothing behavioural either.** It
re-derived the boundary, the correlation case, the closure disjunction and the docblock
caveats against the SQL and confirmed all four. What it found was one new false statement,
two imprecisions, and a fixture dependency nothing declared.

**The new false statement was in the comment written to close the pass before it**, which
is worth recording plainly. That comment justified excluding a handover at the instant a
membership ended by saying "such a membership is zero-length and therefore inert". The
membership is not: a backdated closure at that instant leaves it `[m, H]`, positive length
and fully resolvable. What is zero-length is the **leadership** row, `[H, H]`, because a
closure ends leaderships and memberships together — so the comparison the correction would
falsify belongs to a row no query resolves, and it is not the row whose term is being
computed. Right conclusion, wrong row.

The subject was carried across from `CellsClosureService`'s own inclusivity rationale,
which is written about a membership closed at its own `started_at`. Section 25 rule 19,
inside the comment written to close a Section 25 rule 19 finding.

*That sentence first said "the third time on this branch", and there are two: the three
consequences carried from the leader case into the member-side settlement, and this one.
The candidate third is the original defect, and the entry above classifies it correctly as
the older and separate fault — a mechanism checked over the part of its range being looked
at — while the uniform-`ended_at` refusal is rule 19 **succeeding**. A count asserted from
memory rather than enumerated, in a paragraph about carrying a claim across without
re-deriving it, and two screens below this log's own "a miscount inside the entry
correcting a miscount".*

**Two imprecisions, both true in conclusion.** Section 4's surviving consequence named the
member scan as the mechanism that stops a stranded Cell changing hands, and that closes one
of the two successors: a successor in the *outgoing* leader's Network is refused by the
member scan, and one in the *stranded member's new* Network by the leader-to-leader check.
Section 4 already states the fuller form one paragraph over, for the leader case. And the
implementation docblock said `cell_leadership_is_opened_open` refuses "a second write" to
`ended_at`, where it refuses a write that *changes* an already-set one — the ordinary
null-to-value close is permitted, which is the whole point.

**The `max` pin was real and rested on something nobody had declared.** It works because
the `extends` fixture creates its Cell at the very instant the member joins, so the Cell's
own opening leadership row falls inside the membership window and gives it two rows — while
the docblock two files over declares that same equality unreachable in production. Both
statements were true and nothing connected them. A second case now pins `max` on the
ordinary shape, a Cell that pre-exists the membership with two genuine handovers inside the
window, so the pin no longer depends on a fixture artefact.

**And the correlation case is a negative one**, so it pins the correlation only alongside
`extends`: a case asserting that something is *accepted* cannot distinguish a term that is
correctly narrow from one that is absent. Said in the comment rather than left for somebody
to discover by deleting the term and finding this case still green.


**A fourth pass confirmed the batch and found one miscount, above. It also supplied a
mechanism for an intermittent failure this branch did not cause and does widen the window
for**, which is worth recording because "did not reproduce" had been the whole of the
account.

One full run failed a single test; eight subsequent runs are green, three of them
targeting the timing-sensitive suites. The mechanism is a **fixed wall-clock deadline
racing pre-lock work**. `api/test/api/person-lock.e2e.spec.ts` holds an advisory lock,
dispatches a request, and polls `pg_locks` for a waiter every 50 ms against a 2.5-second
budget — shorter than the code's own three-second `lock_timeout`, deliberately, because
past that the waiter is gone. Between dispatch and `pg_advisory_xact_lock` the request has
to complete an HTTP round trip, verify a token, run the guard's `account_roles` and
`capability_grants` reads and any subtree walk, validate its DTO and open a transaction. On
a machine loaded enough to take 433 seconds over a suite that elsewhere takes 219, that
work exceeding 2.5 seconds is ordinary — and then `waiting` stays zero and the assertion
fails **while the system is behaving correctly**. `invariants.spec.ts` has the same shape
with bounded attempt counts.

The branch does not introduce it: those deadlines and the lock code are untouched. It
widens the window, by adding five end-to-end cases that create Cells, take person locks and
run full requests, on a suite that is now 987 tests.

**It is not fixed here, and that is a scope judgement rather than an oversight.** The fix
is to make the probes' budget a function of observed progress — poll until the waiter
appears *or* the request settles — rather than of a wall clock the machine's load can
outrun. That is a change to concurrency tests on a branch about a backdate floor, and this
repository has already recorded a fix batch destroying a test's ability to fail. It is
flagged for its own change instead.

Two weaker candidates are named so they are not rediscovered: a fixture reading
`new Date()` while the refusal re-reads `Date.now()`, which flips the "names no date" branch
if the two straddle Manila midnight — real, and around one run in ten million; and the
30-second case timeout against a 2× slowdown for the probes that poll for five seconds while
holding connections.

---

Decision 0155 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — A Network change is refused while the person leads a Cell](0154-a-network-change-is-refused-while-the-person-leads-a-cell.md)
