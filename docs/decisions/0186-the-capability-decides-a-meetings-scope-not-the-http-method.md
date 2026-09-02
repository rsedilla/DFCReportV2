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

- A route carrying a **recording** capability — `cell.take_attendance` or
  `cell.correct_subtree` — resolves as a write: through the Cell's current leader, and
  through the leader of the meeting's date only under Section 7's closed-Cell exception.
  Whether the route reads or writes does not enter into it.
- A route carrying a **viewing** capability — `cell.view_subtree`,
  `reports.view_subtree`, `audit.view` — resolves as of the period being viewed.

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
write requires" — already says. Section 5's `GET /people/duplicate-candidates` is the
same shape one domain over: a read whose scoping is decided by what the write it precedes
is allowed to do.

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
yet. That is a gap in the surface rather than in the rule, and it closes with Stage 5's
reporting reads.

Stating it as a cost rather than as an argument, because the alternative reading of
Section 13 is not unreasonable: a past leader asking about a past meeting *is* asking
about a period. The answer is that they should ask a route whose capability says so.

## What this corrects elsewhere

**The audit-log open item's trigger has not fired, and a note in `CLAUDE.md` said it
had.** That item says to settle what period a read of the audit log asks about "with the
first dated read", and the roster item claimed to be that first dated read. Under this
ruling it is not a read in Section 7's sense: `leaderForMeetingScope` is a dated
resolution serving a **recording** capability. The first dated *read* is still Stage 5's
reporting, and the audit-log item still waits for it.

## What this binds

- `leaderForMeetingScope` stays one method for both routes, and the port docblock says so
  as a rule rather than as an observation.
- Every recording route slice 2c adds — the correction, the reschedule, the
  `RESCHEDULED → NOT_HELD` transition — resolves the same way, with no per-route argument.
- Stage 5's first Cell-scoped reporting read resolves as of the period being viewed, and
  needs a dated resolution of its own that this one is not.

---

Decision 0186, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-02 — A date-only field that is not a day is refused at the edge, by one predicate](0185-a-date-only-field-that-is-not-a-day-is-refused-at-the-edge.md)
