# 2026-08-31 — Seven settlements from building DCC recording

None of these needed a ruling before the code, and each was a question the code had
to answer in one line. The seventh is the one `docs/ROADMAP.md` makes Stage 4's
"Done when", and it was the last to be settled because running the race is what
settled it. They are recorded because each is a rule a client can observe
and none is derivable from Section 9 as it stood.

## 1. The roster answers for an event that takes no record; the write refuses

Three states stop an event taking a record: it is a removed Sunday, its Manila day
has not begun, or its month has closed. The write refuses all three.

**The read does not.** `GET /dcc/events/{id}/roster` succeeds, carries
`recordable: false` and a reason, and returns the checklist anyway.

Section 9 requires a removal to be "visible on any report covering that month, so
that a month showing four events where the calendar shows five is explained rather
than merely odd", and a 409 on a GET leaves a client with nothing to render but an
error. There is no risk of a client mistaking the answer: the flag is explicit and
the write refuses on the same grounds a moment later.

The refusals differ in code, and the difference is Section 22's. A removed or
not-yet-held event answers `INVARIANT_VIOLATION`, because the body has to change
before any attempt can succeed. A closed month answers `PERIOD_CLOSED`, which
Section 22 gives its own code for exactly this: the record is not wrong, the period
is shut, and only Admin may amend it.

## 2. A resubmitted identical value is left alone

A submission is a whole checklist, and a leader correcting one name resubmits every
other name unchanged. Superseding those rows would write a history entry recording
that nothing happened, and would move a version every other client then has to
resolve against — so a leader fixing one mistake would invalidate every other
client's copy of the roster.

**A line whose `present` equals the stored value writes nothing.** No new row, no
version bump, and the response counts it as `unchanged`.

Principle 12 asks a record to carry its own history, and a history is of changes.
This is that rule read forwards rather than as a licence to write a row per
submission.

It also decides which capability the line is governed by: an unchanged line is not
an amendment, so it sits under `dcc.take_attendance` rather than
`dcc.correct_subtree`.

## 3. One person, one line

A submission naming the same person twice is refused as an `INVARIANT_VIOLATION`.

The two lines are two claims about one record, and applying both would supersede the
first from inside a single request — one submission carrying its own history.
De-duplicating was refused because which of the two the leader meant is not
something the server can decide, and picking the last silently discards a claim
somebody made.

## 4. A correction reason belongs only to a correction

`correction_reason` on a line that creates a record is refused rather than stored.

A reason on a first submission has no subject: there is nothing it explains a change
away from. Stored, it would read afterwards as a reason for the original record,
which is a different claim from the one the field exists to carry.

The reason stays **optional** on a correction, matching the nullable column Section 9
declares and Section 14's "optional/required correction reason as appropriate". A
submission is a whole checklist, and requiring one per changed line puts a dialog in
front of a leader who noticed one mistake in twenty names.

## 5. A version for a person with no record is not a version conflict

It answers `INVARIANT_VIOLATION`.

Section 22 settles this in terms: "A `VERSION_CONFLICT` is none of these. Section 14
requires it to carry both values, both actors and both timestamps so that a person
can choose between them, so a refusal with no second value to show is not one,
whatever went stale." There is no stored record to show, so there is no conflict to
render.

It is also unreachable from any state a client could have read: nothing removes a
`dcc_attendance` row — the no-delete trigger refuses it, and a correction supersedes
and inserts — so a live row exists once one ever has. A client sending a version
here invented it.

## 6. Two audit actions, and both target the Person

`dcc_attendance.submitted_on_behalf` and `dcc_attendance.corrected`. **A leader
recording their own checklist writes no audit entry at all.**

Section 21's list names "Attendance submission on behalf" and "Attendance
corrections" and names no ordinary first submission. That reads as an omission until
the append-only shape is taken into account: the record *is* the entry, carrying its
actor, its timestamp and its own history. An entry per line would double every
submission for no fact nobody already has.

**The target is the Person**, on the reasoning decision 0157 settled one domain over.
Section 7 resolves an audit entry's scope through its target; a Person resolves
through their pastoral position; and Section 7 says in terms that a DCC event
"resolves through nothing" — so an entry targeting the event would be readable by
nobody's scope, which is the defect 0157 found in `cell_leadership.opened`.

"On behalf" is measured against the **responsible leader** rather than against the
checklist. A covering upline submitting for an account-less leader's disciples is on
their checklist and is still recording somebody else's obligation, which is what
Section 9 calls submitting on behalf.

## 7. A lost race answers a conflict, and the index is what enforces it

`docs/ROADMAP.md` requires that "a concurrent double submission produces a conflict
for a person to resolve rather than a silent overwrite". Two races reach one
person's record and both now answer `VERSION_CONFLICT`.

- **Two first submissions.** Neither writer holds a version, so the loser meets the
  partial unique index over `(dcc_event_id, person_id)`. It answers with
  `submitted_version: null` — the case decision 0171 added to Section 22.
- **Two corrections.** Both pass the version check against version N, and the loser's
  supersede matches no row because the winner has closed it. Its insert then meets
  the same index.

The second answers `VERSION_CONFLICT` rather than `RESOURCE_BUSY`, on decision
0158's question: the identical body resubmitted **cannot** succeed, because its
version is now stale. That is a decision about this body, not contention that reached
no decision.

**Both are enforced by the index, and an explicit check was written and removed.**
The correction path first carried a row-count check on its supersede, answering the
conflict directly. It was deleted because no test could distinguish it: with the
index refusing the insert one statement later, the response and the stored state are
identical either way. A branch nothing can fail on is what this log keeps recording
as a defect, and shipping one knowingly would be worse than the two it was written
to guard.

Reporting the conflict after a violation costs a re-read on a fresh connection —
the failed statement aborts the transaction, so nothing can be queried inside it.
The re-read re-runs the version check against the committed state and reports the
first line that now disagrees, which is the same rule the in-transaction check
follows.

---

Decision 0173, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Who submits a person's DCC attendance, and where a root's is recorded](0172-who-submits-a-persons-dcc-attendance.md)
