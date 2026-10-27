# 2026-10-27 — A refused correction offers Reload, and keeps the version the edit began from

Owner ruling, 2026-10-27, in three parts, each agreed from real screenshots: the refusal and its
Reload; what Reload shows on a line somebody else also changed; and, after review, that every
changed line is named and that a reader who may not correct is told the record was made.

## The ruling

**1. Save is checked against the version the edit began from.** The Cell Group meeting screen
pins the meeting's version at the edit's first change, and the DCC checklist pins each line's
version at that line's first change. The screens read their records again in the background,
when the reader returns to the tab, and a Save that sent the version read last would succeed
over a change the reader never saw. A pin is cleared when the edit ends: on Cancel, on Discard,
and on a successful Save, after which a line saved is pinned to what is now stored.

**2. A correction refused as `VERSION_CONFLICT` says what happened and offers Reload.** On the
meeting screen: "Someone else changed this meeting after you opened it. Reload to see it, then
decide again. Your marks are kept." On the DCC checklist the same, with "a mark here" for "this
meeting". Reload reads the record again and starts the edit over from what is stored now.

**3. After Reload the reader's marks are kept, and every line somebody else changed while the
edit was open is named.** Under each such name a note says "Changed by someone else after you
opened it: *saved mark*." Where the reader had marked that line differently, the saved mark
shows and the note adds "You had marked *the reader's mark*."; marking the line again is the
reader's decision, and the note goes with it. A line whose saved mark moved to the reader's own
needs no edit. A correction to *Did not meet* hides the marks, so where any line changed, Reload
puts the answer back to *Met* and the reader sees what changed before deciding again. With only
Present and Absent, a line the reader marked can be changed to something other than their mark
only where it held no record when the edit began: two people recording the same meeting, or the
same person's Sunday, for the first time at once.

**4. Who and when are not named.** Section 14 asks that both values be shown with who recorded
each and when. These two screens show both values and name neither the other person nor the
time: the reader sees the saved mark and their own, and decides. Section 22's conflict body still
carries both for a reader who may correct, and these screens do not render it.

**5. A reader who may record and may not correct, beaten to a first record, is told somebody
else recorded it.** The API answers `ALREADY_RECORDED`, a code of its own (owner, 2026-10-27), so
that `VERSION_CONFLICT` keeps its promise of two sides. It carries the two versions and nothing of
the record: not the stored marks and not who recorded them, which decision 0201 withholds from
an actor without the correction capability, and which such a reader could not act on anyway.
The same answer is given where the two disagree on whether the Cell met (owner, 2026-10-27): a
first record saying *Did not meet* against one recorded as met, or the reverse, was refused as a
status correction without a reason, which this reader may not make with one either.
The screen says "Someone else recorded this meeting after you opened it. Reload to see it."
("a mark here" on the DCC checklist), and Reload shows the record as made, which this reader
may not change. It was answered `403`, saying the correction was outside their scope, which
read as though they had tried to change somebody else's record. A body carrying a version is a
correction, and a reader who may not correct is still refused it as one. The same body sent
after the race answers the same, so timing decides nothing.

## Why

A Save was refused correctly when nothing else happened, and the other person's change was
kept. The gap was a background read: returning to the tab after thirty seconds re-read the
record, and the screen then sent the new version with the old marks, so the Save succeeded over
a change the reader had not seen.

The refusal itself said only "This record changed after you opened it." and offered nothing to
do, where the Growth lists already offered Reload. Keeping the marks means the reader decides
again rather than starts again.

Keeping the reader's mark even on a line somebody else changed was considered and refused
(option B): one Save would then replace the other person's mark with neither of them having
seen both. Showing the saved mark and naming the reader's own means no change is lost unseen,
and it matches the Growth lists, whose Reload drops a draft line made against a record that
has since changed.

Naming every changed line, not only the reader's, was asked for after review found that a line
the reader never touched changed silently, under a refusal that said "Reload to see it". The
plain conflict for a reader who may not correct was asked for after review found that a Senior
Pastor, who records and does not correct, losing a first record was told a correction was
outside their scope.

Decision 0394, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 14 and 22.

Previous: [2026-10-27 — An administrator sends a password reset to an account in use](0393-an-administrator-sends-a-password-reset.md)
