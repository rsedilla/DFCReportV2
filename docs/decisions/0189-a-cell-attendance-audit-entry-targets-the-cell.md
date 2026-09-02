# 2026-09-03 — A Cell attendance audit entry targets the Cell, a DCC one the Person

Section 21 said of its two attendance actions: "**Both target the Person**, and a leader
recording their own checklist writes no entry at all", and gave the reason as Section 7's
scope resolution — "a DCC event resolves through nothing, so an entry against the event
would be readable by nobody".

That reason is DCC's. It was written when the only two attendance actions were DCC's, and
the Cell pair diverged from the sentence the day `cell_attendance.submitted_on_behalf` was
added, on `main`. Slice 2c added a second under the same bullet. The rule the code follows
was settled in a comment in `api/src/database/schema.ts`, which `CLAUDE.md` names as
unfinished work: "A decision that lives only in a chat session does not exist", and one
living only in a code comment is the same thing with a longer half-life.

Raised by `architecture-guardian` on the first pass of slice 2c.

## The ruling

**The target is the Person for a DCC entry and the Cell for a Cell meeting entry.**

Section 7 resolves an audit entry's scope through its target, so a target has to be
something a reader's scope can reach. A DCC event resolves through nothing, so those
entries name the Person. A Cell meeting resolves through the Cell's leader, so a Cell
entry names the Cell and is readable exactly where the meeting is.

## Why not one target for both

Because the two domains hang attendance off different things, which Section 12 already
records one layer down: "a Cell meeting belongs to one leader and therefore has a unit,
while a DCC event belongs to the church". The audit target follows the same split for the
same reason, and forcing one answer would break one of the two.

**Naming the Person on a Cell entry would not be wrong, and it would be worse.** A Cell
meeting has many people and one Cell; an entry per Person would be an entry per line,
which Section 21 refuses in the sentence above this one. An entry naming *the responsible
leader* as its target would be readable — but it would make the entry's scope follow a
Person who may be reassigned, where the Cell is what the meeting is a fact about, and it
is the shape decision 0157 already refused for Cell leadership.

## What it costs

**A reader of the audit log needs two rules rather than one**, which is the price of two
domains with different shapes. Section 21 now states both in one bullet rather than
stating one and being wrong about half its subject.

## What this binds

- `cell_attendance.submitted_on_behalf` and `cell_attendance.corrected` target the Cell.
  Both already did; this is what makes that conformant rather than divergent.
- `dcc_attendance.submitted_on_behalf` and `dcc_attendance.corrected` target the Person,
  unchanged.
- The first `audit.view` route reads them through Section 7's resolution, which is where
  the open question about *what period* such a read asks about becomes live.

No code changes.

---

Decision 0189, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-02 — A meeting's scope resolves through its frozen responsible leader](0188-a-meetings-scope-resolves-through-its-frozen-responsible-leader.md)
