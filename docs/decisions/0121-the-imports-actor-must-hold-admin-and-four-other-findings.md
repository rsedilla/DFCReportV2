# 2026-08-26 — The import's actor must hold ADMIN, and four other findings from the review


`architecture-guardian` on the import branch returned five violations, four false
statements and two Stop Conditions. One was a live privilege escalation.

**The capability check did not imply the role, and §2 now says both.** §2 said "the
script is given an **Admin** account" and then stated the refusal in capabilities —
`people.create` and `people.manage_pastoral_assignment` at Whole Church. Those are
not the same requirement, and §7 lets Admin grant authority beyond a role's
defaults, so a Whole Church grant of both to a `LEADER` account is an ordinary
grant. The first version accepted one.

*The reason first recorded here was that neither capability is in
`WHOLE_CHURCH_ONLY`. That is true and explains nothing: `grantCoversNothing` fires
only when a capability is **in** the set **and** the scope is narrower than Whole
Church, and `single-scope.ts` says in terms that "a wider grant is untouched".
Membership never blocks a Whole Church grant of anything. The conclusion held and
the reason did not — recorded because a false reason here is worse than none, and
this is the twelfth instance on this project.*

What the gap opened is the escalation §5 invariant 4 exists to close. Invariant 4
is the one authorization rule in this system decided by **role** rather than by
capability (2026-08-23), precisely so a Whole Church grant does not satisfy it —
and **the import never reaches it**, because every row of the tree is a *first*
assignment rather than a change.

*The harm was overstated in three places and is corrected here.* The entry said
such an account "could name their own Person on a `USE_EXISTING` row and place
themselves anywhere in either tree, root included". That path needs the Leader's
own Person to hold **no** open assignment, because `attachExistingWithin` refuses
one who does — and that state is unreachable through the API: `POST /people`
requires a pastoral leader, and `POST /accounts` refuses `LEADER` outright until
`cells` exists. The test builds it with a direct write. The **reachable** harm is a
Leader writing the entire spine, which is exactly the outcome §2 gives as its
reason for naming an actor at all: "an operator cannot attribute several thousand
records to a Leader." The fix is right; the story told about it was not.

`SENIOR_PASTOR` is deliberately **not** accepted: §2 says an Admin account, and §7
keeps the two Senior Pastors away from administrative operations on purpose.
Widening to them would be a decision about the role catalog taken inside an import.

**The check is made twice, and the first version made it once.** It was put at the
orchestration door in `admin/tree-import` and then described, in three places, as
closing the escalation "for the whole run". `PeopleImportService` is *exported* from
`PeopleModule`, so any module importing it can inject Person creation with no
duplicate gate, no idempotency claim and — as written — no actor check at all. That
is verbatim the shape the 2026-08-26 bootstrap ruling closed, in a file whose own
docblock cites that ruling for the phase check and stopped there. Both checks now
live in the service, which is what the specification requires; the script's copy
survives so an operator is told before adjudicating thirty rows.

The actor reaches the service as an `ActorAuthority` rather than an account
identifier, which is the shape `coversWith` already uses for a decision taken inside
a transaction: it carries the account it was read for, so it cannot decide for
another, and reading it is the caller's job so nothing touches the pool while
holding a transaction (§24).

*This was the Stop Condition the review raised — whether invariant 4 binds an import
opening a first assignment — and it did not need a ruling: §2's own sentence names an
Admin account. §2 is amended in the same change, which the first version did not do
and which is at least this project's **sixth** "written to §x" failure — the fifth is
already claimed at the end of this file, by the §5 invariant-3 item, and the counter
here was written without grepping for the others. A miscount inside the entry
correcting a miscount, which is why the number is now hedged rather than asserted.*

**An existing Person may be seated as a Network root, and refusing it was wrong.**
The second Stop Condition. The first version refused, citing §5's "a root is created
only by the initial import" — a rule about creating the root **row**, which is
exactly what the import does, not about whether the Person existed beforehand. §2
states the opposite directly: a row resolving to an existing Person "receives the
pastoral assignment the tree gives them", with no exception for a root row. Read
together the specification requires the behaviour, and the refusal was a rule
invented in a service.

The reason offered for it does not survive either. It was the administrator, who
correctly holds no assignment forever (§5 invariant 3, third case) and would
therefore be the ideal Person for a root row to absorb — but reaching that needs an
Admin to write their Member ID against a root row in the decisions file,
deliberately. That is a mistake an Admin can make, like many others available in
that file, and not an escalation.

The root branch now reads `network_assignments` for the Network, exactly as the
`UNDER` branch does — which is the same correction as the one below, and the reason
the refusal survived a review pass at all: refusing made the root branch dead code,
so nothing exercised the derived-Network defect inside it. §2 is amended.

**Section 3's acknowledgement was leaving no record in the system.** The import's
`person.created` entry omitted the acknowledged candidates, so for a row decided
`CREATE` past a Tier 1 candidate, the acknowledgement — the entire reason §2 built
a two-phase import — existed only in an operator's spreadsheet, outside
`audit_log`. It is now `acknowledged_duplicate_member_ids`, deliberately a
different key from `PeopleService.create`'s `acknowledged_duplicate_ids`: the
import's acknowledgement is taken in Member IDs, and recording a UUID would be
recording something the adjudicator never saw.

The docblock had claimed "the same values `PeopleService.create` records ... a
reader searching the log should not have to know which path wrote the entry",
directly above the omission. The eleventh instance on this project.

**Three defects of the ordinary kind, each a rule this repository already states.**

`attachExistingWithin` read `pastoral_assignments` directly. §2 permits one
cross-module read and it is a *join* onto a query rooted in a table the reading
module owns; this was a standalone read rooted in `hierarchy`'s table, with
`HierarchyService.openAssignmentOf` already answering it and already called with a
transaction by a sibling service. It also falsified `people.module.ts`'s "it
touches no table it does not own", which the branch had not updated.

It took two person locks in **two calls**. The ordering guarantee is per call —
`lockPersonsWithin` sorts what it is given — so subject-then-leader is exactly the
cycle §5 names: a concurrent reassignment naming the same pair takes them sorted,
and where the leader's key is lower the two run in opposite orders. That is a
deadlock rather than a wait, so the three-second `lock_timeout` does not bound it;
PostgreSQL picks the victim and raises `40P01`, which nothing classifies.

And it derived the existing Person's Network from their sex. `resolveExistingWithin`
checks the recorded sex against the file, which makes deriving *look* safe — but
this method writes no Network row, so what governs is the row already in
`network_assignments`. Wherever the two disagree, or where the Person carries no
open Network row at all, the pre-check passes on a value the database does not hold
and the deferred trigger raises a raw `check_violation` at COMMIT. That is the
500-instead-of-an-answer failure `assertLeaderIsAssignable` exists to prevent, and
`PeopleReassignmentService` reads the row for exactly this reason.

**Also corrected, all statements rather than behaviour.** The CLI printed "Section
5 invariants were enforced on every assignment", which is an overclaim independent
of the escalation — invariant 2 is enforced by the *file* validator over the CSV
graph rather than by the domain layer over the resulting database graph, and
invariant 1 only by the Whole Church precondition. It now names which invariant was
enforced where. `settings.service.ts` called itself the "only reader and only
writer" of a table it never writes, in a paragraph whose next sentence says so.
`settings.module.ts` named a method on the wrong class. And a bare `catch {}` around
`authorize` reported *any* failure as a missing capability, so a database fault sent
an operator to fix a grant that was not the problem — it now distinguishes them.

**`PRECONDITION_CODES` declared a member nothing emitted**, which is how it survived
being written: `FINDING_CODES` and `DECISION_FINDING_CODES` are each walked by a test
and this list was not. It is walked now.

---

Decision 0121, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-26 — The tree import, and the one thing the fingerprint cannot bind](0120-the-tree-import-and-the-one-thing-the-fingerprint-cannot.md) | Next: [2026-08-26 — A check that reads what its caller handed it is not a check](0122-a-check-that-reads-what-its-caller-handed-it-is-not-a-check.md)
