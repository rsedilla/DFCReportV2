# 2026-10-26 — One leader's Cells start at least two hours apart

Owner ruling, 2026-10-26, agreed from screenshots of the refusal and of the Admin's list, and
confirmed again the same day from screenshots of the built screens' design.

## The ruling

**1. Two Cells led by one person never start less than two hours apart.** Measured by day of
week and start time, to the second, around the week, so it wraps past midnight and past the week's end:
Saturday 23:00 and Sunday 00:30 clash. Two hours exactly is allowed.

**2. What is compared.** The leader's `ACTIVE` Cells, by every schedule row not yet over, so the
time in force and a change waiting for next month both count; and the leader's `PENDING` requests,
a new-Cell request or restart by the day and time it asks for and a handover by the schedule of the
Cell it hands over. A closed Cell and a decided request do not count.

**3. Where it is checked.** Sending a new-Cell request, a restart included, and approving it;
requesting and approving a handover, against the incoming leader's other Cells; changing a Cell's
day or time, against its leader's other Cells; and Admin's direct creation. Each write takes the
leader's person lock before any Cell's row lock and decides under it, so two writes for one leader
cannot both pass.

**4. No exception.** Not for Admin, and not because somebody else runs one of the meetings.

**5. The refusal names what the asker may see** (owner, 2026-10-26, chosen from screenshots
after review): `INVARIANT_VIOLATION`, with `details.clashes` listing each Cell or request it clashes
with by Cell ID where it has one, category, day and time, where the asker may see it: a Cell where
their `cell.view_subtree` covers its leader, a pending new-Cell request where they sent it or may
approve it. Anything else is said only to exist, with `details.others` true: "This leader already
has a Cell Group, or a request for one, starting less than 2 hours from this time." Section 8
withholds a Cell outside the reader's scope, and decision 0390 refuses the same way for the same
reason. Naming every clash was the first version, and the review found it named a Cell being handed
over from a branch the asker cannot see.

**6. Existing clashes keep working.** Nothing already clashing is stopped or changed. Admin sees
them on the Cells page under **Same Leader, Same Time**, read from `GET
/api/v1/cells/schedule-clashes` under `cell.manage_lifecycle` at Whole Church, by the times in
force now, in first-name order, and unpaged, the rule keeping the list from growing. Admin fixes
each by changing a day or time or handing a Cell to the person who really leads it.

## Why

The owner found a leader on live leading Youth on Sunday at 12:00 and Young Pro on Sunday at 12:15.
One person cannot lead two meetings at once, so one of the two records says something that did not
happen, or a Cell is really led by somebody the system does not name. Two hours leaves time for one
meeting and travel to the next. A hard block was chosen over a warning, because a warning is
clicked through, and the list lets the clashes that already exist be found and fixed rather than
breaking the Cells that have them.

Decision 0392, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 10.

Previous: [2026-10-26 — One refusal for anybody outside your scope](0390-one-refusal-for-anybody-outside-your-scope.md)
