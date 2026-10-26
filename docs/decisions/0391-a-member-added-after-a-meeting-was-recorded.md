# 2026-10-26 — A member added after a meeting was recorded is asked about, not called not marked

Owner ruling, 2026-10-26, chosen from screenshots of three options. It settles what a recorded
Cell meeting's screen says about a member who has no mark because they joined the Cell after the
meeting was recorded.

## The ruling

**1. They stay on the meeting's roster.** Section 12 reads the roster as everyone in the Cell on
the meeting's date, and that is unchanged: somebody added to the Cell that evening, after the
leader saved, is on that meeting's roster with no mark, and the leader may still mark them.

**2. The roster read says who they are.** Each member on `GET
/api/v1/cells/{id}/meetings/{meetingId}/roster` carries `joined_after_recorded`: true where the
membership's `started_at` is later than the meeting's first `submitted_at`, false otherwise and
on a meeting not yet recorded. It is an additive field
and a reading aid only: no roster, mark, figure or submission rule moves.

**3. The screen asks rather than calling them not marked.** While such a member has no mark, the
recorded meeting counts them as "added after it was recorded" rather than "not marked", says
"*Name* joined the Cell after this was recorded. Was *first name* at this meeting?", adds "Press
Edit meeting to add a mark." wherever the Edit meeting button is offered, and says "Joined the Cell after
this was recorded" under their name.

## Why

The owner saw a recorded meeting reading "6 not marked" on live, CELL-000015 on 25 October:
people were added to the Cell after the leader saved, and "not marked" read as the leader having
skipped them. Two other answers were shown and declined. Leaving such people off that meeting's
roster would amend section 12, and loses the attendance of the person added that night, who in G12
usually came, which is why they were added. Keeping them but marking them as needing no mark loses
the same attendance. Asking the leader keeps it.

## What it does not cover

**"Added" is the moment the membership began, by its `started_at`.** Two cases therefore still
read "not marked":

- a membership whose start is backdated before the meeting was recorded, as a Cell closure's
  dispersal can write (section 10); and
- a membership being added in the same instant the meeting is first saved, whose start can fall a
  few milliseconds before the save while it is not yet visible to it.

Both read as they did before this ruling.

Decision 0391, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 13.

Previous: [2026-10-26 — One refusal for anybody outside your scope](0390-one-refusal-for-anybody-outside-your-scope.md)
