# 2026-09-15 — One person's DCC attendance is read under `dcc.view_subtree`, and their classification comes with it

Section 9 derives a person's DCC classification from their lifetime attendance and says not
to let leaders maintain it by hand. The redesign's People screen offered a "Journey stage"
with *Correct this stage* and a reason, and `docs/DESIGN_RECONCILIATION.md` replaced that
with the stage shown beside the attendance behind it, and no override.

Nothing in Section 22 returns one person's DCC attendance. Its DCC reads are a month's
events, an event's roster and an event's coverage gaps.

## The ruling

**`GET /api/v1/dcc/people/{id}/attendance` returns one person's DCC attendance and the
classification Section 9 derives from it.**

- **It is guarded by `dcc.view_subtree`, resolved against the person**, the target kind
  `GET /api/v1/people/{id}` resolves against. Section 7 gives `dcc.*` everything under
  `/api/v1/dcc`, and `dcc.view_subtree` is that domain's read capability.
- **It names no period, so it asks about now** (Section 7, *An effective date does not move
  the scope decision*). The actor must hold the person in scope today. It is not a dated
  viewing read, and decision 0231 does not reach it.
- **The records are the person's live DCC attendance records, newest event first**, each with
  the event's identifier, the event's date and whether the person was present. It is a
  paginated collection on Section 22's terms.
- **A record on a Sunday that was later removed is listed, marked as removed, and not
  counted.** Section 9 keeps a removed event and the attendance on it, so the list says why a
  Present there does not count rather than hiding it.
- **The classification is Section 9's, counted from every record standing now**: the
  person's present, live records on Sundays that were not removed, which is the rule the DCC
  monthly report applies. No record can exist for a Sunday that has not begun (Section 9),
  so this is everything recorded so far. It is counted over this person's own records,
  because the report's figures cover only the people who attended in the month asked for,
  and a test must hold the two in agreement. A person with no counted attendance has no
  classification.
- **It changes nothing.** A classification that looks wrong is corrected by correcting the
  attendance record behind it, on the route and under the capabilities that already govern
  that record.

## The ground

**A classification shown without its attendance invites the override Section 9 forbids.** A
leader who thinks a stage is wrong needs to see which Sundays produced it, and the
correction then lands on the record, where Section 14's correction history already applies.

**No role changes.** Every role in Section 7's catalog holds `dcc.view_subtree` at the same
scope it holds `dcc.take_attendance`.

## What it widens

Until now the only read naming a person's DCC marks was an event's roster, which carries the
actor's checklist. This route lets a holder of `dcc.view_subtree` read, one person at a time,
the attendance of anyone in their scope: an upline leader sees a person two generations down,
and an account granted `dcc.view_subtree` read-only sees it too. This ruling is where that is
chosen.

## What it costs

A leader cannot read the attendance of somebody who has left their scope, including the
Sundays recorded while that person was theirs, because the route asks about now.
`GET /api/v1/people/{id}` has the same cost for the same reason.

## What this does not settle

- **One person's Cell attendance and Cell classification.** Section 12 has its own
  classification, and a route for it is a separate ruling.
- **Whether Section 20's placement graph may authorize a per-person view**, which `CLAUDE.md`
  records as open. This route is not a report, and it resolves through the pastoral tree in
  force now rather than through the placement graph, so it does not answer that question. The
  owner confirmed that reading on 2026-09-15.
- **Where a merged Person's identity is resolved**, which `CLAUDE.md` records as open.
- **Whether a report may be exported**, which `CLAUDE.md` records as open.

---

Decision 0247, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-15 — A Cell meeting's recorded marks are read under the capability that records it](0246-a-cell-meetings-recorded-marks-are-read-under-the-recording-capability.md)
