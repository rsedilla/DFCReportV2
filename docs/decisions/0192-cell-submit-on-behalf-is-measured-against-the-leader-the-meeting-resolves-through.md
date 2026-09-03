# 2026-09-03 — `cell.submit_on_behalf` is required, and measured against the leader the meeting resolves through

Section 7 lists `cell.submit_on_behalf` and gives it to every role. Section 14 describes
what it is for: "A higher authorized leader may take attendance on behalf of a downline
leader within their pastoral subtree." **Nothing consulted it.** The DCC counterpart,
`dcc.submit_on_behalf`, is enforced in `DccAttendanceService`; the Cell one was declared
and never read, so a grant of it conferred nothing and an administrator could not withhold
it.

Found while building slice 2c's correction path, and raised again by
`architecture-guardian` as a Stop Condition when that slice extended the same gap to a
second operation.

## The ruling

**Recording or correcting a meeting requires `cell.submit_on_behalf` when the actor is not
the Person the meeting resolves through** (Section 7's resolution: the Cell's current
leader while it is `ACTIVE`, the record's frozen responsible leader once it is closed and
the window is open). An actor who *is* that leader needs only `cell.take_attendance`.

It is checked **before the roster is compared at all**, which is stronger than "before
`cell.correct_subtree`" and is what the first version of this ruling said. That version put
it beside the amendment capability, after the comparison — and decision 0191's early return
for a submission that changes nothing then answered **201** to an actor lacking this
capability, while a differing roster answered 403. Two probes read the stored roster back
on a meeting the actor may not record.

The ordering is not cosmetic, and `DccAttendanceService` was cited here as having had it
right: "it runs its equivalent for every line whatever the outcome". **That is true of the
outcome and false in general**, and the correction is recorded rather than quietly dropped
because this claim is what the reorder below was argued from. `assertMayRecord` does run
for a `CREATE`, an `UPDATE` and a no-op alike, and `dcc-attendance.e2e.spec.ts` pins the
identical refusal for an agreeing and a disagreeing body — but a `CREATE` line carrying a
`correction_reason` throws before `assertMayRecord` is reached, so for that line the
on-behalf check never runs at all. Whether §7's contents-ordering rule binds DCC is
recorded as open in `CLAUDE.md`.

The Cell ordering does not rest on the DCC one and never did. It rests on the roster read
carrying this route's own capability and target declaration, which
`capability-scope-resolution.spec.ts` asserts and `cell-meeting-roster.e2e.spec.ts`
backs on the response side. The on-behalf check depends on nothing stored beyond who the
meeting resolves through, so it can run first — and it must, because everything after it
branches on what is stored.

## Why the resolution and not the responsible leader

This is the whole of the question, and the two readings differ in exactly one case.

Section 7 resolves an `ACTIVE` Cell's meeting through the Cell's **current** leader;
Section 13 freezes the **responsible** leader as of the meeting's date. On a Cell handed
from A to B, a meeting held under A resolves through B and belongs to A.

Measuring the capability against the *responsible* leader would refuse B — who is not in
A's subtree and holds no on-behalf grant reaching A — a meeting Section 7 says in terms
that they file: "On an `ACTIVE` Cell handed from A to B, a meeting held under A resolves
through B for the roster and for the submission alike — B files it." That sentence was
written on 2026-09-02 to close a defect where *nobody* could correct such a record, and
the responsible-leader reading reinstates it one capability over.

So the measure is the resolution. A successor filing their predecessor's meeting is filing
their own Cell's meeting and is not acting for anybody.

## The one thing that looks inconsistent and is not

**Section 21's `on_behalf` on the audit entry is measured against the responsible leader.**
So a successor filing a predecessor's meeting is *logged* on behalf and owes no on-behalf
capability.

That is two questions about one act, each answered about the thing it asks after. The
entry records whether the **record** was somebody else's — which is what a reader
filtering the log for amendments to other people's records wants. The capability governs
whether the **meeting** was somebody else's to reach — which is what an administrator
issuing a grant is deciding about. Section 21 already fixes its own measure in terms
("'On behalf' is measured against the responsible leader rather than against the
checklist"), so this ruling changes nothing there and says why the two differ.

## What it costs

**Nothing under role defaults**, which is why it can be added to a route already in use:
every role holds `cell.submit_on_behalf` at the same scope as `cell.take_attendance`, so
an actor who could record before can record now. What changes is that the two become
separately grantable — an administrator can give a leader the power to record their own
Cell without giving it for everyone beneath them, which is what listing the capability
promised and what withholding it did not deliver.

## What this binds

- Both operations on `POST /api/v1/cells/{id}/meetings/{meeting_id}/submit` — the first
  submission and the correction.
- The check is against `{ kind: 'person' }` on the resolved leader, asked of
  `leaderForMeetingScopeWithin`, so the guard's answer and this one cannot diverge.
- A null resolution returns without refusing: the guard resolves the same way and has
  already refused it.

---

Decision 0192, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-03 — A write that writes nothing owes no *amendment* capability, and its confirmation is a disclosure](0191-a-write-that-writes-nothing-owes-no-further-capability.md)
