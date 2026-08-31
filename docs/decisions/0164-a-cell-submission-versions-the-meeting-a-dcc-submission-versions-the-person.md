# 2026-08-31 — A Cell submission versions the meeting; a DCC submission versions the person

Section 14 requires every attendance and meeting record to carry a version, and a write
against a stale one to be refused rather than applied. It does not say what a version
covers when one submission carries many people, and the two domains have different
shapes: Section 13 puts `version` on `cell_meetings` **and** on `cell_attendance`, while
Section 9 puts it on `dcc_attendance` alone.

**A Cell submission carries the meeting's version and the server compares that.** **A
DCC submission compares per `(dcc_event_id, person_id)`.** `cell_attendance.version`
guards a correction to one person's record, which is a different write.

## Why the meeting is the unit for a Cell

**It is Section 14's own example.** "A leader records nine present on a phone, loses
signal, and an upline leader records eight on behalf from a laptop in the meantime. When
the phone reconnects, its submission is based on a version that no longer exists." Nine
against eight is a disagreement about the whole roster, not about any one person — and
several of the people in it may not differ at all.

**One reading of that example is outside this mechanism, and 0162 is why.** If the phone
drafted before *either* submission landed, there is no meeting row and no version to send,
so the race is two first submissions rather than a stale one — and it is decided by the
`(cell_id, week_starting)` uniqueness rather than by a version. That case is settled in
[decision 0165](0165-four-stop-conditions-the-stage-four-rulings-raised.md), which makes
the loser's answer a `VERSION_CONFLICT` carrying a null submitted version, so Section 14's
requirement that a person sees both figures holds either way. The example is about a
version conflict once a version exists, which is the ordinary case and the one this
ruling places.

**It is what the conflict payload needs.** Section 22 fixes the `VERSION_CONFLICT` body
as one `submitted` and one `current`, each with an actor and a timestamp, and requires
that "a conflict response that omits any of them cannot satisfy Section 14, because the
person resolving it cannot tell which record to keep". A per-person comparison over a
roster produces a list of conflicts with no single pair to render.

**And a Cell meeting has one responsible leader** (0163), so one submission is one
person's account of one meeting. There is a natural unit and it is the meeting.

## Why the person is the unit for DCC

**A DCC event is church-wide and many leaders submit against it.** Section 9: "many
leaders each record their own people". Two leaders recording different people must never
conflict, and any unit wider than the person would make them.

**Section 9 gives no per-leader row to version.** `dcc_events` is one row for the whole
church and `dcc_attendance` is per person; the version Section 9 places is on the latter.

**Section 9 also says coverage "measures whether the record exists, never who entered
it"** — a submission made on behalf completes that leader's coverage. A unit keyed on the
submitting leader would cut against that, and inventing a per-leader submission row to
version is structure Section 9 does not describe.

**A DCC submission is nonetheless a batch, and this ruling owed an answer for a collision
across it.** Section 9's checklist covers a leader's own direct children *and* those of
every downline leader without an account, so an on-behalf collision conflicts on every one
of them at once — and the objection raised against per-person versioning for Cells, that a
list of conflicts has no single pair to render, applies here unchanged. 0165 settles it:
the submission applies none of them and names the first, which is one pair and is the
shape Section 22 fixes.

## The asymmetry is the domains, not an inconsistency

The same asymmetry Section 12 already records for monthly-attendance buckets, one layer
down. A Cell meeting belongs to one leader, so it has a unit; a DCC event belongs to the
church, so the finest thing that belongs to one leader is the person. Both follow from
who owns the record rather than from a preference about granularity.

## What `cell_attendance.version` is for

Correcting one person's record, which Section 14 names separately from a submission:
"For already-submitted attendance that requires correction, use `Correct Attendance`."
That write names one person, so it compares one person's version. The row it supersedes
is the history; the version is the concurrency check, which Section 13 already says in
terms — "`version` detects a concurrent write (Section 14) and is not a history
mechanism".

A submission bumps the meeting's version. A correction bumps that person's.

## What was rejected

**Per person in both domains.** One rule, and the finest granularity — two people editing
different members of one roster would never conflict. Refused because it dissolves
Section 14's own example, and because the response shape Section 22 fixes has nowhere to
put a list.

**A per-leader-per-event unit in both domains.** It would give DCC a versioned unit
matching the Cell one. Refused because it needs a table Section 9 does not describe, and
because it makes the submitting leader structural in a domain where Section 9 says
coverage must not depend on who entered the record.

---

Decision 0164, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — A Cell meeting's responsible leader is frozen as of the meeting](0163-a-cell-meetings-responsible-leader-is-frozen-as-of-the-meeting.md) | Next: [2026-08-31 — Four Stop Conditions the Stage 4 rulings raised](0165-four-stop-conditions-the-stage-four-rulings-raised.md)
