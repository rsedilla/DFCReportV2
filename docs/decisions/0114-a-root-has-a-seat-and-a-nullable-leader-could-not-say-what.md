# 2026-08-25 — A root has a seat, and a nullable leader could not say what it meant


Found building toward the tree import, which creates the two Network roots as its
first act and could not. Three things, and the middle one is a defect that was on
`main`.

**§5's "exactly one root leader" per Network was enforced nowhere.** Not by a
constraint, not by application code, not by a test. `pastoral_assignments` carried
no constraint on null-leader rows at all, and the only writer of the table took
`leaderId: string | null` and inserted whatever it was handed. A third root was a
plain `INSERT` away, and every subtree total walking the tree would then have had
two answers with nothing raised. The Definition of Done requires an invariant
expressible as a constraint to exist as one; this one was expressible and did not.

**`pastoral_assignments.root_network`, with a partial unique index**, which is
`account_roles.senior_pastor_slot` again — and adopted by re-deriving its two
reasons rather than by resemblance, since reusing a shape without that is §25 rule
19. A trigger counting open roots is not a constraint: under READ COMMITTED
neither of two concurrent transactions sees the other's uncommitted row, both
count zero, both commit. And `pg_restore --disable-triggers` skips a constraint
trigger while never skipping a unique index.

**Where the analogy does not hold is the interesting part, and the first version
of this entry got it wrong.** The slot works partly because the state it
constrains lives entirely in `account_roles`. A root's Network does not — it lives
in `network_assignments`, effective-dated — so this denormalizes, and a
denormalized value can drift.

I argued it could not drift here, from §5 refusing to reassign a root and §4
refusing a Network change for a root and for anyone leading disciples. **Both are
true of the application and neither was true of the database.**
`assert_network_change_keeps_edges` filters `pa.leader_id IS NOT NULL`, so a root's
own row is by design never examined on a Network write; and
`assert_root_network_matches` compares against `network_as_of(person_id,
started_at)`, frozen history that cannot see a later change however often it fires.
`architecture-guardian` probed it and a Network change on an open root committed,
leaving the seat naming the Network the person had left — one Network effectively
rootless, the other free to take a second root, reached with no pastoral
reassignment. I reproduced the probe before acting on it.

**That is the ninth instance on this project of a rule written by reasoning from a
mechanism's purpose instead of reading its `WHERE` clause** — committed, this time,
in a migration whose own header says "**Re-derived rather than copied**" and cites
§25 rule 19 for it. The claim was three-times-stated: in the migration header, in
§5, and in this entry. Nothing checked any of them, because the thing they asserted
was about a trigger none of them had read.

So both directions are now constrained. `assert_network_not_changed_for_root`
refuses a write to `network_assignments` that would leave an open root seat
disagreeing with its holder — §4's existing refusal expressed as a constraint
rather than as a TypeScript check, in a change whose entire thesis is that a
TypeScript check is the weaker thing.

**The first predicate for it was too narrow, and the second review pass found
that too.** It compared the Network in force at the *written row's* `started_at`
rather than at the *root row's*, and never checked that the person still held an
open Network row at all. Two shapes passed: closing the open Network row and
opening nothing — the UPDATE's own start is still covered by the row it closes, so
the comparison returned the old Network — and moving an open row's `started_at`
forward. The first is the worse one: the person then belongs to no Network while
the index still reads their seat as taken, so that Network has no root and cannot
be given one.

That is the same fault as the finding it was fixing: three places again claimed a
guarantee wider than the check delivered. It was widened rather than the sentences
narrowed, because the wider rule is the one §5 wants. Both shapes are now probed
in `invariants.spec.ts`.

Zero roots in a Network stays legal, because that is what a fresh database holds
before the import runs. "Exactly one" is not expressible without forbidding an
empty database, so the index forbids the second and §2 makes the import refuse a
file that does not carry both.

**The nullable identifier was a booby-trap aimed squarely at the import.**
`CreatePersonInput.pastoralLeaderId` was `string | null`, its comment said null was
"only for the import path", and what null actually did was open **no assignment row
at all** — producing an unassigned Person, which the 2026-08-23 ruling says is
"never a root". So the one caller that field was written for would have passed null
for its two roots, got two unassigned Persons, and built a tree with no roots.
Nothing would have failed: no constraint, no test, no error, and the defect
surfaces only when somebody asks why a subtree total is wrong.

It is now a discriminated union — `{ kind: 'UNDER'; pastoralLeaderId }` or
`{ kind: 'ROOT' }` — at both `CreatePersonInput` and `HierarchyService.openAssignmentWithin`,
so the wrong outcome is a compile error. That is the standard §2 sets for the
capability guard and §22 for `completeWithin`'s transaction parameter: the one
mistake a caller can make is refused by the compiler rather than left invisible at
the call site.

**No `UNASSIGNED` variant, deliberately.** §5 permits zero open assignments for a
Person not yet assigned or an archived one, but nothing *creates* a Person into
that state — archival reaches it by closing a row. The nullable field had silently
offered it, which is a capability nobody decided on; a variant no caller can
justify is the same thing spelled differently. The earlier ruling that "only the
import creates one" was written before the root-is-a-row ruling superseded it, and
nobody updated it — this does.

**A root is created only by the import**, and no endpoint can ask for one:
`POST /people` requires a pastoral leader, and §5 makes who holds a root a
Network-level decision rather than an encoding one. Written to `SKILL.md` §5 in the
same change, and checked by grep rather than asserted.

**Four smaller findings from the same review, each the recurring shape.**

The migration justified `DEFERRABLE INITIALLY DEFERRED` on the honesty trigger by
saying the root row and the `network_assignments` row it checks "are written in one
transaction, and an immediate trigger would reject whichever landed first". Reading
the only caller, the network row is always written first, so there was nothing to
reject. That reason belongs to `pastoral_assignments_same_network`, which is
deferred for §4's atomic pair. The trigger is now immediate, which is also better:
deferred, a violation arrives at `COMMIT` as a raw `check_violation`, the
500-instead-of-an-answer failure recorded here repeatedly.

`SET CONSTRAINTS ALL IMMEDIATE` was justified as flushing pending events for an
`ALTER TABLE`. It is load-bearing for the `CREATE INDEX` too — both are refused
while events are pending — and `ALL` does not merely flush, it switches the mode
for the rest of the transaction, silently including the trigger created further
down the same file. Narrowed to the one constraint it means.

The migration pre-validated one data condition and left its neighbour to abort raw,
though the policy names that neighbour by name. It now checks for pre-existing
duplicate roots as well.

**And the root path had no caller and no test at all.** `kind: 'ROOT'` appeared
nowhere outside its own definition, so the seat could have been written wrong or
omitted with the suite green — a §5 rule stated in the specification with nothing
able to fail on it, which is the pattern this repository keeps refusing to ship.
Four service-level cases now exercise it.

**The concurrency test proved nothing, twice over.** It was first written with two
pooled `db.transaction()` calls awaited together, which may simply run in sequence.
Rewritten to two raw connections with explicit `BEGIN` — copied from the
one-active-assignment case beside it — it was *still* only pinned by dropping the
index, which the sequential case above it already pins: nothing awaited the second
INSERT before the first committed, so it may arrive after the commit and fail
against a committed index with the assertion passing regardless. It now polls
`pg_stat_activity` until a backend is genuinely blocked and asserts the write has
not settled, which is what `person-lock.e2e.spec.ts` does and what pinning
concurrency actually looks like.

**And that rewrite was itself only nearly right.** The helper filtered on a
hardcoded `query LIKE '%pastoral_assignments%'` and took an index name it used
only in the error message, so any backend blocked on any lock touching that table
satisfied it. Not vacuous — `--runInBand` leaves one candidate — but resting on the
harness rather than on what it claimed to check. It now watches the waiter's own
`pg_backend_pid()`.

**Three more from the second pass, all the same shape.** A comment claimed the
Network trigger "never touches the ordinary case" because a Person's first Network
row is written before their assignment row — an argument about an *immediate*
trigger applied to a deferred one, which runs at COMMIT and plainly sees the root
row. The `IMMEDIATE` justification reasoned from one caller of
`openAssignmentWithin` rather than from every writer of the table the trigger is on,
which is the level the question is asked at; re-derived across all four, it holds.
The service-level second-root case asserted only that *something* threw. And the
succession language was corrected in §5 but left standing in the migration and in a
test name, so two files still described an operation §5 had just said the system
does not offer.

---

Decision 0114 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-25 — The decisions file is a CSV, and the fingerprint is over trimmed fields in order](0113-the-decisions-file-is-a-csv-and-the-fingerprint-is-over.md) | Next: [2026-08-25 — The tree is known centrally only to its first level, and no birthday is required](0115-the-tree-is-known-centrally-only-to-its-first-level-and-no.md)
