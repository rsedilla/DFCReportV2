# 2026-09-02 — The capability decides a meeting's scope resolution, not the HTTP method

Section 13 stated a split in one sentence: a Cell meeting resolves "through the Cell's
leader as of the period being viewed for a read, and through the current leader for a
write". Section 7's general sentence agreed. But Section 7's closed-Cell exception
bundles "the meeting-scoped roster read that write requires" *with* the write, inside a
clause introduced as "A closed Cell has one exception" — so on a **closed** Cell the two
readings coincide, and on an **`ACTIVE`** one they contradict each other.

`leaderForMeetingScope` is one method serving both `GET .../roster` and `POST
.../submit`, so it gave both the write answer, and a leader who handed on an active Cell
was refused the roster of a meeting Section 13 appeared to place in their scope. Nothing
said which reading won. The code had settled it in a port docblock, which called the
asymmetry "section 7's and deliberate" — a settlement the specification did not make.

Escalated as a Stop Condition on 2026-09-02 by `architecture-guardian`, and settled here
because slice 2c adds two more routes to that one method.

## The ruling

**The capability decides, and the HTTP method does not.**

- **Exactly three capabilities resolve as of the period being viewed**:
  `cell.view_subtree`, `reports.view_subtree` and `audit.view`.
- **Every other capability resolves as a write** — through the Cell's current leader, and
  through the leader of the meeting's date only under Section 7's closed-Cell exception.
  Whether the route reads or writes does not enter into it.

**A closed list of three with everything else defaulting, rather than two lists.** The
first version of this ruling wrote two — recording capabilities against viewing ones — and
classified neither in between. That is not academic: three of the **four** capabilities
that guard a Cell-targeted route today fell in neither list — `cell.manage_membership`,
`cell.manage_configuration`, `cell.manage_lifecycle` — and the first of them guards a read,
`GET /api/v1/cells/{id}/members`, which is exactly the shape this ruling exists to decide.
*The fourth, `cell.take_attendance`, was named in the two-list version's recording list,
and this sentence said "none of the capabilities that actually guard a Cell-targeted
route" until 2026-09-02 — false of that one. `SKILL.md` was corrected a commit before this
file was, by a commit whose message quoted this very sentence as the defect.*
Found by `architecture-guardian` and raised as a Stop Condition against the ruling's own
first form.

**It decides which resolution a capability gets and nothing else.** In particular it does
not touch Section 7's closed-Cell fallback, which governs every Cell target whichever class
its capability is in. A second version of this ruling said the two resolutions "both fall
back to the last leader on a plain Cell target", which invited reading the default as
deciding the closed-Cell case too — and Section 7 answers that twice and not identically:
its base bullet gives a closed Cell's last leader the fallback, and its closed-Cell clause
says every write against one resolves through nobody. The code implements the fallback for
both classes and the domain layer refuses the writes. That tension is older than this
ruling, is now recorded as open in `CLAUDE.md`, and is not settled here.

The default is chosen because it is what every Cell-targeted route on an `ACTIVE` Cell
already does. It is **not** chosen for being narrower, and saying so matters: on an
`ACTIVE` Cell that has changed hands the two resolutions name different people rather than
one containing the other.

So `GET .../meetings/{meeting_id}/roster` and the `POST` beside it give one answer, which
on an `ACTIVE` Cell is the current leader for both. Behaviour is unchanged; what changes
is that it is now a rule rather than an artifact of one method serving two routes.

## Why, and why none of the three answers the open item listed

The open item named three: split the resolution in two, amend Section 13 to say the
roster read follows the write it serves, or keep one resolution and state that the read
is narrower than Section 13 reads. The second is closest, and stating it as "the roster
read follows its write" would settle this route and leave every future route to be argued
about individually. The rule below settles the class.

**Section 7 already tied the roster read's capability to the write it serves, in terms
and with a reason.** "A meeting's roster is guarded by the capability that records it,
`cell.take_attendance` for a submission and `cell.correct_subtree` for a correction,
resolved against the meeting... It is deliberately not `cell.manage_membership`."
Having tied the capability, resolving the scope by the other rule would make one route
ask two questions and answer them differently.

**The method is the wrong discriminator.** A `GET` that prepares a write is a write's
pre-flight, which is what Section 7's own phrase — "the meeting-scoped roster read that
write requires" — already says. Section 3's `GET /api/v1/people/duplicate-candidates` is
the same shape one domain over: a read whose scoping is decided by what the write it
precedes is allowed to do.

**Nothing becomes unrecordable, and that is what makes the strict reading safe.** On an
`ACTIVE` Cell handed from A to B, a meeting held under A resolves through B for the
roster and for the submission alike. B files it; Section 13 freezes
`responsible_leader_id` to A; the record exists and rolls up to the right person. The
strict reading costs nobody a record.

**The permissive reading would hand somebody a roster they cannot submit.** Splitting the
resolution grants A a read whose only purpose is a write that is then refused — an
endpoint that exists to prepare an operation, answering for an operation the same actor
is denied. That is a worse shape than a refusal, and it discloses a roster to somebody
with nothing to do with it.

## What it costs

**On an `ACTIVE` Cell, a former leader cannot see the roster of the meeting they led.**
Not because Section 13 denies them a past period — it does not — but because the surface
that would serve it is a viewing capability, and no route carries `cell.view_subtree`
yet. That is a gap in the surface rather than in the rule, and it closes with the first
route that carries a viewing capability against a Cell.

Stating it as a cost rather than as an argument, because the alternative reading of
Section 13 is not unreasonable: a past leader asking about a past meeting *is* asking
about a period. The answer is that they should ask a route whose capability says so.

## What this corrects elsewhere

**The audit-log open item's trigger has not fired, and a note in `CLAUDE.md` said it
had.** That item says to settle what period a read of the audit log asks about "with the
first dated read", and the roster item claimed to be that first dated read. Under this
ruling it is not a read in Section 7's sense: `leaderForMeetingScope` is a dated
resolution serving a **recording** capability.

**What settles that item is the first `audit.view` route**, which is the event it already
names. Not a Stage 5 report: Section 7 resolves an audit entry through *its target*, and
an aggregate report reads no audit entry and resolves no Cell — the same argument this
ruling makes forty lines below about the check's own trigger, which a version of this
paragraph failed to apply here while making it there. **And that route is also what
reddens the check**, since an `audit.view` read of a Cell-targeted entry is a viewing
capability against a Cell-resolved target. The two triggers coincide on it, and an
earlier version of this paragraph asserted they were different.

## What can fail on it

**The guard cannot enforce this rule, because it branches on the target's `kind` and never
reads the capability.** `{ kind: 'cell' }` takes `leaderForScope` and
`{ kind: 'cell_meeting' }` takes `leaderForMeetingScope`, whichever capability sits beside
them — so a route declaring a viewing capability against a Cell-resolved target would
silently get a resolution this ruling forbids.

Nor can the guard be made to enforce it, yet: **neither resolution it has is the viewing
one.** `leaderForScope` is the undated current-or-last leader and says so in its own
docblock, and `leaderForMeetingScope` is the dated resolution serving a recording
capability. "As of the period being viewed" is not implemented anywhere.

So `test/unit/capability-scope-resolution.spec.ts` asserts the rule that can fail today:
no route declares one of the three viewing capabilities against a Cell-resolved target,
and every `cell_meeting` target carries a recording capability. It walks the compiled
module graph rather than the source, and it carries a vacuity case — every assertion in it
is over a filtered list, and a scan finding nothing would satisfy them all.

**The first Cell-targeted viewing route reddens that file**, which is the moment the dated
read resolution is owed. Stated that way rather than as "the first Stage 5 report":
Section 7 makes a report's target a scope selector rather than a Cell, so an aggregate
report would not reach the check at all, and two paraphrases of this ruling said it would. A red test naming the route is a better way
to learn that than a report quietly answering through the wrong leader. Added after
`architecture-guardian` pointed out that the ruling had nothing that could fail on it,
which is decision 0142's finding reached again.

## What this binds

- `leaderForMeetingScope` stays one method for both routes, and the port docblock says so
  as a rule rather than as an observation.
- Every recording route slice 2c adds — the correction, the reschedule, the
  `RESCHEDULED → NOT_HELD` transition — resolves the same way, with no per-route argument.
- The first **Cell-targeted** viewing route resolves as of the period being viewed, and
  needs a dated resolution of its own that this one is not. Stage 5 may not be what
  produces it: an aggregate report's target is a scope selector (Section 7), not a Cell.

---

Decision 0186, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-02 — A date-only field that is not a day is refused at the edge, by one predicate](0185-a-date-only-field-that-is-not-a-day-is-refused-at-the-edge.md)
