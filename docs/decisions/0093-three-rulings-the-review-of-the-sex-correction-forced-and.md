# 2026-08-23 — Three rulings the review of the sex correction forced, and one gap it found


`architecture-guardian` returned six findings on the first pass. Two were live
defects, three were false statements in the files written to record the mechanism,
and one was a test that survived deleting half the rule it was checking. The three
that needed rulings are below; the two false statements are corrected in place in
the entries above, which is where they were made.

**Section 5 invariant 4 binds every operation that reassigns, not only the
reassignment endpoint.** The sex correction performs a reassignment and checked no
part of it. The Whole Church rule settled earlier the same day does not cover it and
cannot: that one asks how far a grant reaches, this one asks who the actor is
relative to the target, and a holder of an explicit Whole Church grant passes the
first while needing to fail the second.

The gap was reachable and this branch's own test built the precondition for it: a
`LEADER` account granted `people.correct_sex` at Whole Church, correcting its own
record and naming any leader in the other Network, detaches itself from its own
upline. That is the escalation section 7 gives as the *reason* the capability is
Admin-only — reached without ever holding `people.manage_pastoral_assignment` — and
section 5 calls it privilege escalation through the org chart.

It now lives in `hierarchy`, because `PUT /people/{id}/pastoral-leader` owes it too
and would otherwise reinvent it. It is the one authorization rule in the system
decided by **role** rather than by capability, which is how section 5 states it: the
point is that Admin and the Senior Pastors sit outside the pastoral incentive, not
that they were granted something extra.

**Recorded because the reasoning failed the same way twice in one day.** The
position this replaces was "the capability is Admin-only, so the role catalog
satisfies invariant 4" — a rule enforced by a table nothing checks, which is the
argument this project rejects everywhere else and which was accepted here without
being written down.

**A correction may not be dated at or before the moment the Network it corrects took
effect.** Separate from the floor and not a term of it: it bounds the Network row
rather than the pastoral edges. At exact equality the live row is closed at its own
`started_at`, and section 5 makes such a row inert — so the period the person spent
in their former Network vanishes from every as-of query and every past-period report
for them moves, with nothing raised. Section 5 reserves a zero-length close for a row
entered in error; a correction is effective-dated, and section 4 already accepts in
writing that closed periods keep the Network recorded for them. Erasing the period is
the opposite of that bargain rather than a stronger form of it.

Reachable wherever the floor is empty, which is most ordinarily a Person with no
pastoral assignment — the case section 4 says may be backdated "freely". Freely means
as far back as the record goes, not before the record begins.

**Where no date can clear the floor, the refusal names none.** The floor falls on the
current day whenever a disciple has just been moved aside, which section 4 calls the
*ordinary* outcome — and the day after today is tomorrow, which no correction may
take. The refusal was therefore naming the one answer guaranteed to be refused again,
which is precisely what section 4 requires the system not to do. It now says the
correction cannot be backdated and will take effect now if submitted without an
effective date, which always succeeds: every bound is read from a row already
written, so it lies in the past.

*Superseded in one respect on 2026-08-31 by [decision 0158](0158-a-stale-premise-under-a-cleanly-taken-lock-is-transient.md).
"Always succeeds" is now "succeeds in every case but one": the floor refuses a date at or
before the bound, so an undated correction whose instant ties with a record already
written for that person is refused — and that branch answers `RESOURCE_BUSY` rather than
`INVARIANT_VIOLATION`. Nothing else here changes.*

**A Network root is not moved between Networks by a data correction.** Derived rather
than invented: section 5 gives each Network exactly one root and says changing who
holds a root position is a Network-level decision, so moving one here would leave one
Network rootless and the other with two. Refused before the disciple refusal, so a
root — who by construction leads people — is refused for the reason that applies.

The guard detects the representation the schema carries, an open row with a null
`leader_id`. Section 5 also describes a root as having no active assignment at all,
and under that reading this does not fire. That ambiguity is the root-representation
item this log has carried as open since 2026-08-22; this is a fail-closed guard on
the representation in use, not an answer to "is this person a root", and it is the
first code that would benefit from settling it.

**The sixth finding needed no ruling and is worth recording as a test lesson.**
Term (b)'s `person_id` disjunct could be deleted from the floor query with the whole
suite still green: every floor case bound on term (a) or on the leader side, and the
subordinate side was covered only against the *trigger*, never against the code that
computes the floor. The failure it would have allowed is the one the floor exists to
prevent — a raw `check_violation` at `COMMIT`, a 500 instead of a date the
administrator can act on. "What mutation would this fail against" is the question
that finds these, and it has to be asked per rule rather than per test.

---

Decision 0093, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — Reading the Network-change trigger fired twice, which is what the section 4 floor is about](0092-reading-the-network-change-trigger-fired-twice-which-is-what.md) | Next: [2026-08-23 — The root is a row, and a person lock serializes the same-Network rule](0094-the-root-is-a-row-and-a-person-lock-serializes-the-same.md)
