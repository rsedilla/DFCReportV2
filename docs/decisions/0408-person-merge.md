# 2026-10-29 — Person Merge: who may be merged, what moves, and how a merged pair is counted

Owner rulings of 2026-10-27 and 2026-10-29, each chosen from screenshots of the merge screen on
the demo database, drawn beside the alternative. Section 3 already fixed the rest: the Admin alone
merges (`people.merge` at Whole Church), with a reason; a merge is irreversible; the absorbed
Member ID is retired; the absorbed account is disabled and its sessions revoked; a Person who leads
a Cell is not absorbed; and every report counts the pair as one person, past periods included.

## The screen (2026-10-27)

On a person's page the Admin sees "Is this person recorded twice?" and *Merge a duplicate*. The
merge screen sets the two records side by side (name, Member ID, birthday, mobile number, leader,
Cell, DCC Sundays, account), with the record kept on the left and *Swap which one is kept*; lists
what will happen; asks why the two are the same person, which is required; and its button reads
"Merge M-xxxxxx into M-yyyyyy". Where the merge is refused, the screen says why and the button is
not offered.

## What moves (2026-10-27)

1. **The kept record keeps its pastoral leader; the duplicate's open pastoral assignment ends** at
   the instant of the merge.
2. **The kept record keeps its Cell; the duplicate's open Cell membership ends** at the same
   instant. Section 3 asks that two different current facts not be chosen between silently; the
   Admin chooses which record is kept, with both facts in front of them.
3. **A birthday or mobile number the kept record lacks is copied from the duplicate.** Where both
   have one, the kept record's stands.
4. **The duplicate's DCC and Cell attendance, SUYNL lessons and Training graduations count for the
   kept person.** No row is rewritten (Section 3): each is resolved to the kept person when a figure
   is computed.

## What is refused (2026-10-29)

5. **The duplicate pastors anyone.** The merge is refused until the Admin moves each of them to a
   leader, because where each person belongs is a pastoral decision (the same rule as a duplicate
   who leads a Cell).
6. **The two are in different Networks, now or at any time in the past.** The merge is refused
   until the sex is corrected on the record that is wrong (Section 4), so that each Network's
   figures move once, for one stated reason. A correction made from today still leaves the two in
   different Networks before it, where the pair would count in both, so the Admin backdates the
   correction to cover that time first (owner, 2026-10-30, `NETWORKS_DIFFERED`).
7. **The duplicate is a Network root.** A root may be the record kept, and stays the root; it is
   never absorbed. (A root pastors people, so point 5 refuses it too.)
8. **The kept record is archived.** The duplicate may be archived and is joined in as it is; the
   record kept must be current, and the Admin restores it or swaps which one is kept.
9. **Either record has already been merged away, or the duplicate has itself absorbed another
   record.** Section 3 lets a Person be merged once, into a record never merged away, and makes no
   chain of merges; refusing the second case keeps every absorbed record one step from its
   survivor. Nor is the Admin's own record absorbed, since its account would be disabled mid-way;
   it may be the record kept.

## How a merged pair is counted (2026-10-27 and 2026-10-29)

10. **Every figure counts the pair as one person**, in every period, a past one included (Section 3).
    A stored month is cleared by the merge (Section 20).
11. **A Sunday or Cell meeting marked on both records counts once, and Present wins**: if either
    record says the person came, they came. Each leader recorded the record in front of them, and
    an Absent on the other only means that leader did not see them.
12. **A SUYNL lesson or a Training graduation on both records counts once, on the earlier date**:
    the lesson was done when it was first ticked, which is the date Win 3 and any count by period
    read.

13. **In a past month when both records had a pastoral leader, the person is counted under the
    kept record's leader**, and under the duplicate's leader only for a month the kept record had
    none. One rule every month, matching who the person is with now, and each leader's rows still
    add up to the total, which counts the person once.

## The duplicate's page afterwards (2026-10-29)

14. **The old page stays, read only, and says "This record was merged into M-yyyyyy"**, with a link
    to the kept record, who merged it and when. It offers no action and shows no leader or Cell.
    A printed report or a saved link that names the old Member ID still explains itself.

## Six more, from `architecture-guardian`'s review of the build (2026-10-29)

Each was chosen by the owner from a screenshot of the real screen on the demo database, today's
behaviour beside the alternative.

15. **Two or more duplicates merged into one record.** In a past month when the kept record had no
    pastoral leader and more than one of its duplicates had one, the person is counted under the
    leader of the **newer** duplicate: the record created later, the higher Member ID breaking a
    tie. One person, one leader, and the month's reports still open; as first built, two edges for
    one person made every figure of that month refuse (Section 20, decision 0212).
16. **Meetings a merged-away record led count where the kept record sits.** A duplicate that led a
    Cell before handing it over keeps those meetings; every figure that places a meeting by its
    responsible leader resolves that leader to the kept record, as point 4 resolves the person who
    came. Recording Status, which counts leaders, counts the two records as one leader, the record
    kept, for Cell and DCC alike, so what the merged-away record owed is listed in the kept
    record's branch rather than under *Others*; what was owed and recorded is unchanged (point
    19). So each leader's rows still add up to the total.
17. **The old page opens for anyone who may open the kept record.** The merge ends the duplicate's
    pastoral assignment, so no leader's scope reaches the old record itself; its page is authorized
    against the record kept, so that a leader's saved link explains itself as point 14 promises. A
    reader who may not open the kept record is refused, as before.

    *What follows is derived from point 14, not chosen from a screenshot.* The kept record's scope
    is lent to **read capabilities only**, so a leader is never authorized to write to the old
    record through it; a first build lent it to writes too, which let a leader edit a merged
    record, and a test caught it. A Whole Church holder passes every scope check, so each route
    that writes a Person or an account refuses a merged one itself (`INVARIANT_VIOLATION`):
    editing its details, reassigning or archiving it, and re-enabling or changing its account.
18. **The merge's reason is not shown on the old page.** Point 14 names who merged it and when; the
    reason is free text an Admin typed, and stays in the audit log (Section 21).
19. **Past DCC coverage is not changed by a merge.** Coverage counts a leader's obligation for each
    Sunday they had someone to record (decision 0224). A leader whose only disciple that Sunday was
    the duplicate did owe that record, and may have filed it; the merge removes neither.
20. **Unticking a lesson or graduation reaches both records.** Where the kept person's row shows a
    SUYNL lesson or a Training graduation that came from a duplicate, unticking it withdraws it on
    every record of the person, as any untick withdraws (Section 28), so a wrong one shown can
    always be corrected.

## Two more, from the second review (2026-10-29)

Chosen by the owner the same way, from screenshots of the real report beside today's answer.

21. **A Cell meeting a merged-away record led is recorded against the kept record's branch.**
    Point 16 reaches the coverage line too: a Cell report's "meetings recorded", and its rows by
    leader, place the meeting where the kept record sits, so one report never puts one meeting in
    two branches. It differs from point 19 because a Cell meeting is owed by the person who led
    the Cell, and that person is the record kept; a DCC Sunday is owed by the leader of the
    person recorded. The church total does not change.
22. **A report opened for a merged-away leader shows the kept record's report**, with a line
    saying the old record was merged into it, as the old page does (point 17); it opens only for
    a reader who may read the kept record's report. The Cell Groups report likewise.

## One more, from the third review (2026-10-29)

23. **A Cell meeting a merged-away record led, on a date when the kept record had no pastoral
    leader, is counted in the branch of the leader the duplicate had on that date**, as point 13
    places a person for a month the kept record had none. Otherwise the meeting would sit in the
    church total and in no branch, and the rows would stop adding up to it. Chosen by the owner,
    on the recommendation.

Decision 0408, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 3.

Previous: [2026-10-29 — Conquest is an item of the sidebar, for the Admin and both Senior Pastors](0407-conquest-is-a-sidebar-item.md)
