# 2026-09-03 — Section 7's contents-ordering rule binds DCC, and the correction-reason refusal moves behind it

Section 7 says every capability a write owes except the amendment one "is decided before
the record's **contents** can change what the caller is told, and must be", where contents
means the per-person attendance figures. *Section 7 read "before the record's contents are
read" when this ruling was made, and was restated hours later because no implementation
obeyed the stronger form — both load a record before deciding, and must, since the
amendment capability is decided by what it says. Quoted here as amended, because the
weaker sentence is the one this ruling was actually applying.* `DccAttendanceService.writeWithin` did not obey it. It derived a
line's outcome from the stored `present` and refused a `CREATE` carrying a
`correction_reason` — *"There is no record to correct for this person"* — both before
`assertMayRecord` decided `dcc.submit_on_behalf`.

So one request discriminated on stored per-person state:

- the person has no live record → `INVARIANT_VIOLATION`, **409**
- the person has one → `SCOPE_DENIED`, **403**

Raised as a Stop Condition by `architecture-guardian` on 2026-09-03, reviewing the fix
batch that had withdrawn a claim that this path was safe. It is the same defect the Cell
path was given and fixed one slice earlier (decision 0192), reached from the other side.

## Who could observe it

An actor holding `dcc.take_attendance` over a person who is **off** their checklist and
outside their `dcc.submit_on_behalf` scope. `assertInScope` admits them; the DCC roster,
built from the checklist walk, never shows them that person's record.

**Nobody could, under role defaults.** The two scopes are equal for every role —
`OWN_SUBTREE` for `LEADER`, `WHOLE_CHURCH` for `ADMIN` and `SENIOR_PASTOR` — so the
on-behalf check never refuses where the recording capability admitted. *The load-bearing
fact is the equality and not the value; a note saying "both are `OWN_SUBTREE`" was true of
one role in three and would tell a reader checking `ADMIN` the opposite.* It becomes
observable under an asymmetric grant, which Section 7 explicitly permits an Admin to
issue.

## The ruling

**The rule binds DCC. The refusal moves behind `assertMayRecord`.**

The alternative was to write DCC an exception into Section 7. It was rejected because
nothing distinguishes the two domains here: the question the ordering protects — is this
record the actor's to touch at all — is answered by `onChecklist`, which depends on
nothing stored about the record. `assertMayRecord`'s own docblock had already set the
standard this path failed:

> the ordering costs nothing, so it is not left resting on which grants happen to be
> issued.

An exception would have been that resting, written down. Two domains under one rule is
also cheaper to hold than one rule and one carve-out, and the carve-out would have had to
be re-derived by every reader of Section 7 who reached DCC.

**Section 9 permits the move and does not require it.** It requires the refusal to exist
and says nothing about where in the order it falls, so this is Section 7's question
rather than a change to Section 9's.

## What this binds

- `writeWithin` decides `dcc.submit_on_behalf` before refusing a `CREATE` that carries a
  `correction_reason`. Deriving `outcome` beforehand is not a violation: it is not
  observable, and the amendment capability is decided by contents *by design*.
- An actor lacking `dcc.submit_on_behalf` receives the identical refusal — 403,
  `SCOPE_DENIED`, naming that capability — whether the person has a live record or not.
- The Cell and DCC paths now state one rule. Neither is argued from the other:
  `dcc-attendance.e2e.spec.ts` pins this one, and the Cell ordering rests on its own
  roster declaration.

---

Decision 0193, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-03 — `cell.submit_on_behalf` is required, and measured against the leader the meeting resolves through](0192-cell-submit-on-behalf-is-measured-against-the-leader-the-meeting-resolves-through.md)
