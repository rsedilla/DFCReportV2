# 2026-11-06 — The duplicate check allows sixty a minute, and reads indexes

Add a Person and Edit details look for somebody already recorded as a leader types, through
`GET /api/v1/people/duplicate-candidates`. The lookup reads the whole church, by design (Section
3): the duplicate a leader cannot see is the one they are about to create. The 2026-11-02 security
audit raised it as its fifth finding: its only bound was the route default of 120 requests a
minute, and every lookup read the whole `persons` table, since none of the columns it searches
was indexed. The owner chose on 2026-11-06, from screenshots of Add a Person, a limit of sixty
and a message saying why the matches are not shown, and then, once told what saving does and
does not check, that the save waits while the check is paused.

## The ruling

**One account may make sixty duplicate lookups a minute.** Past that the lookup is answered
`RATE_LIMITED`, counted per account apart from the route default and from the church-wide search's
thirty, and only once the query has passed validation, so a refused query spends nothing.

**Past it, the matches box says so, and the save waits.** Add a Person and Edit details show
"Checking for similar names is paused for a minute. You checked 60 names in the last minute. It
runs again by itself in a minute and shows any match it finds, in your branch or another. Add Person waits until it has." (Edit details says Save.) The button reads "Add
Person (after the check)", or "Save (after the check)", and cannot be pressed while the check is
paused; the screen asks again by itself a minute later. Before this ruling a refused lookup left the box empty, which a
leader cannot tell from nobody matching. Any other failed lookup still does, paused or not.

**Why the save waits.** Saving asks the leader to confirm only for somebody very like the person
*in their own branch* (the Tier 1 refusal, Section 3). A match in another branch is shown by this
check and by nothing else, so a save made while it is paused could create the cross-branch
duplicate the check exists to catch. The hold is on these two screens; the create and edit routes
themselves do not wait.

**This is not a block.** Section 3 says the system never blocks creation, because a matcher that
blocks is worked around by staff inventing spellings. The hold is caused by the number of checks,
never by a match, and it refuses nobody.

**Every branch of the lookup reads an index** (migration `0043`): the surname's first letter, the
first name and the two names swapped on expression indexes built on the lookup's own normalizing
expressions, character for character, and the birthday and the mobile number on plain ones. One
unindexed branch of the five would make the planner read the whole table again.
`duplicate-check-indexes.spec.ts` asks the planner and fails if the query and the indexes drift.

## What this replaces

Decision 0304's fourth point said the check takes **no new limit**, because a limit reached while
encoding would silence the warning it exists to give. This ruling replaces that point. The
silencing it feared is what the held save answers: on these two screens the save waits while the
check is paused. Points 1 to 3 of 0304, the audit entry, stand.

## Why sixty

A lookup runs after each pause in typing a name, and again when the birthday or the mobile number
changes, so one person entered takes several. Thirty, the church-wide search's limit, would stop
an encoder entering people quickly; sixty still halves what a single login could read in a minute.

## Not changed

The audit also asked that the rows the lookup returns be built from a list of named fields. They
already are: since decision 0405 a row in the reader's scope carries its identifier, Member ID,
name, sex, tier, reasons and archived flag and nothing else, and a row outside it carries only that
somebody matched and whether they are archived (decision 0404).

---

Decision 0449, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 3 and 24.

Previous: [2026-11-06 — A wrong current password counts in the sign-in pause](0448-a-wrong-current-password-counts-in-the-sign-in-pause.md)
