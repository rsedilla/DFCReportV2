# 2026-08-31 — Eleven on the DCC recording review, and the one that was a disclosure

The `architecture-guardian` pass on the DCC recording slice found eleven — seven
behavioural, four prose. The checklist descent, the responsible-leader freeze, the
all-or-nothing rule and the idempotency contract were confirmed correct. What it
found was concentrated in three places none of the mutation runs reached: refusal
**ordering**, connection discipline, and clocks.

Three of the eleven changed a rule and are recorded here. The rest were corrections
to code or to prose and are described in the commit.

## 1. A refusal chose its capability from the record, and that was an oracle

`assertMayRecord` picked between `dcc.take_attendance` and `dcc.correct_subtree` from
the line's *outcome*, which is derived from the stored `present` value, and then named
that capability in the `SCOPE_DENIED` body.

Every leader holding `dcc.take_attendance` reaches this route — the guard's target is
the actor, by decision 0171 — and Section 8 publishes every Person's identifier
church-wide. So two requests against anybody in the church read the stored record out
of the refusal: `dcc.correct_subtree` back meant a record exists and disagrees with
the value sent, `dcc.take_attendance` meant there is none. Section 8 withholds "DCC
attendance, DCC history, or DCC classification" for a person outside the viewer's
pastoral scope. There was a space to sweep, and the endpoint answered it.

**The scope check now runs before anything about the record is read**, against
`dcc.take_attendance` alone. The amendment capability is checked after it, reached
only by an actor already in scope — for whom a record's existence is not withheld.

This is the shape Section 22 already names: "where revealing that a record exists
would itself disclose something, return `NOT_FOUND` rather than a denial". The answer
here is not `NOT_FOUND` — a Person's existence *is* church-wide — but the principle
is the one that was broken, one field over.

**The same ordering fault was one step further in.** The lifecycle refusals ran before
the scope check too, so an out-of-scope actor could read, from `error.details`,
whether somebody is archived, the identifier of the record they were merged into, and
whether they had a pastoral leader on a given date. None of the three is among the
five fields Section 8 publishes church-wide. Only "no such person" stays first, and
that is safe by Section 22's own words: "People are not such a case."

## 2. An unchanged line takes no part in the version check

A covering upline holding a stale roster, submitting a value that already agrees with
what is stored, received a `VERSION_CONFLICT` whose two sides carried the **identical
value**.

Section 22 requires a conflict to carry "both values, both actors and both timestamps
so that a person can choose between them", and Section 14 says a conflict is resolved
by a person. Two identical values is not a choice, so the response was one Section 22
says cannot satisfy Section 14.

**The version guards against overwriting a change nobody saw. A line that writes
nothing overwrites nothing**, so an `UNCHANGED` line is skipped. This is Section 9's
"a line whose value equals the stored one writes nothing" and Section 14's stale-version
rule reconciled, in the one place they collided — and it is settled on Section 22's
text rather than on preference.

Reachable in exactly the arrangement Section 9 builds the checklist for: a leader
covering an account-less downline, working from a roster their downline has since
changed.

## 3. An on-behalf correction is one action that says it was on behalf

Section 21 lists "Attendance submission on behalf" and "Attendance corrections", and
an upline correcting a downline's record is both — under the old code it wrote only
`dcc_attendance.corrected`, so a reader filtering the on-behalf action for what an
upline did to other people's records missed every correction.

**One entry, carrying `on_behalf` and the responsible leader.** Section 21 asks for
one entry per action performed, and the action is a correction; whether it was
somebody else's record to correct is an attribute of it rather than a second action.
Writing two would have been the other defensible answer and was refused because it
double-counts one act in a log whose whole purpose is to say what happened.

Decision 0173's sixth settlement asserted the two actions without addressing their
intersection. This is that gap closed.

## What was left as a constraint rather than a convention

The correction path stamped `superseded_at` from the host clock while `recorded_at`
fell to the column default — the database's. One row's live period, two clocks, and an
inversion whenever the elapsed time was shorter than the difference. The rule against
that is stated in `test/setup/fixtures.ts`, whose *stated reason* this same branch had
corrected two commits earlier while breaking the rule here.

The line is fixed. What makes it stay fixed is **migration 0012**, which adds the
`period_ordered` check that migration 0011 omitted, to both attendance tables. No test
can reliably fail on the choice of clock — the offset on this machine is a fraction of
a millisecond and on a CI runner is unbounded — so the application line is a
convention and the constraint is the enforcement. That is the Definition of Done's
rule applied rather than quoted, and it is the same split the lost-race handling
already rests on: the unique index is what refuses, and the code turns the refusal
into an answer.

The Cell side gets the constraint now rather than when Cell recording is built, on the
argument Section 23 makes for version checks and idempotency: it is cheap before
anything writes the table and expensive after.

## What the review found that is not fixed here

Two are Stop Conditions and are on `CLAUDE.md`'s open list: whether a person may
record their own DCC attendance, which `dcc.submit_on_behalf` permits today and no
section addresses; and what a closed month's Admin amendment does, which Sections 9,
13 and 20 all require and no route provides.

One is noted and not acted on: `checklist()` reports a **historical diamond** as a
cycle, because `pastoral_assignments_one_active` is partial on open rows and two rows
overlapping at a past instant are not refused by the schema. It needs corrupt history
to reach. The docblock now describes the visited set as a termination guard rather
than as cycle detection equivalent to `CYCLE`, which is what it is.

---

Decision 0175, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — The fourth cursor, and the two that share a key](0174-the-fourth-cursor-and-the-two-that-share-a-key.md) | Next: [2026-08-31 — Eight on the fix batch, and the outcome that was a 500](0176-eight-on-the-fix-batch-and-the-outcome-that-was-a-500.md)
