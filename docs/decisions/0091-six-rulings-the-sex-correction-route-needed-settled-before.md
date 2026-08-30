# 2026-08-23 — Six rulings the sex-correction route needed, settled before the code


Section 4 describes the correction in detail and left six things undefined that an
endpoint cannot avoid answering. Each is amended into `SKILL.md` in the same change.

**An effective date is a day; the backdate floor is an instant; the refusal names
the day after the floor's day.** Section 22 makes an effective date a date-only
`YYYY-MM-DD` Asia/Manila field and section 4 states the floor at timestamp
precision, and nothing said how one becomes the other. A date-only field resolving
to an instant takes 00:00:00 of that day in the named zone — written to section 20,
which is the single authority for period boundaries, rather than to the one section
that happened to need it first.

The consequence is arithmetic and holds unconditionally, which is why the refusal
can name a date rather than echoing a timestamp: the start of the floor's own day is
never strictly later than the floor, and the start of the next day always is. An
administrator handed the raw floor would have to work out which day to submit, and
the day containing it is the one day guaranteed to be refused again.

**A correction always carries a reason.** `network_assignments.reason` is nullable
because an initial assignment has nothing to explain. A correction is what the
column exists for, and every one of them is a correction.

**A correction that changes nothing is `VALIDATION_FAILED`.** With two sexes and a
total mapping this is reachable only by submitting the recorded value. Refused
rather than accepted silently: the operation demands a reason and writes an audit
trail, and an audited correction that corrected nothing misleads whoever reads it.
The retry case it might otherwise have served is already served by
`Idempotency-Key`.

**An archived Person's sex may be corrected only where no reassignment is forced.**
Section 5 forbids reassigning an archived Person and the atomic pair is a
reassignment, so the correction is refused while they hold an open pastoral edge —
restore first. Where they hold none, which is the ordinary state after archival,
nothing is stranded and the Network change stands alone. Refusing outright was
rejected: a data correction on an archived record is legitimate, and it is
re-parenting one that section 5 objects to.

**`people.correct_sex` covers nothing at a scope narrower than Whole Church.**
Section 7 gives it one scope and the guard alone cannot hold that, because the guard
asks whether a grant covers the target — so a grant issued at `OWN_SUBTREE` would
pass for everyone inside that subtree. Held there it is precisely the escalation the
capability is Admin-only to close: moving a person between Networks, re-parenting
them on the way, without ever holding `people.manage_pastoral_assignment`. The
operation refuses with `SCOPE_DENIED`, on the same reasoning as the `read_only`
rejection — a row that cannot mean what it appears to mean is refused rather than
honoured in part.

**One operation writes one audit entry per action it performed**, and `action` is
`<noun>.<past-tense verb>`. This closes the vocabulary item this log has carried as
open. Section 21's list is open — it opens with "including" — so what is settled is
the convention, not an enumeration; without it `pastoral_assignment.transferred` and
`pastoral.transfer` are equally defensible and the log cannot be queried.

A correction therefore writes up to four entries in its own transaction:
`sex.corrected`, `network.changed`, `pastoral_assignment.transferred` where one was
forced, and `effective_date.backdated` where the date was set in the past. Section 21
lists each separately and section 5 independently requires the transfer entry to
carry its previous and new leader. One entry describing everything was rejected
because a reader searching for transfers must find that entry whether it arose from
a reassignment or from a correction. They are related by sharing an actor, a target
and an `occurred_at`; `batch_id` is not borrowed for it, because it means one bulk
import and overloading it would make an import indistinguishable from a compound
correction.

---

Decision 0091 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — Membership of a candidate list is itself a disclosure](0090-membership-of-a-candidate-list-is-itself-a-disclosure.md) | Next: [2026-08-23 — Reading the Network-change trigger fired twice, which is what the section 4 floor is about](0092-reading-the-network-change-trigger-fired-twice-which-is-what.md)
