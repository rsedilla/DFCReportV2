# 2026-10-29 — A match in another branch names nobody, and a similar name is shown too

Owner ruling, chosen on 2026-10-27 from screenshots of Add a person on the demo database, with
the wording approved there; the archived case settled on 2026-10-29 from screenshots of today
beside two proposals.

## The ruling

**1. A duplicate candidate outside the reader's branch names nobody.** Until now Section 3's
lookup showed such a candidate's full name and Member ID with the line "A possible match. Their
details are visible to the leaders who pastor them." It now carries no name, no Member ID, no
identifier and no sex: only `possible_match: true`, and `archived: true` where decision 0404
applies. The screen shows one line for all of them:

> Someone with a similar name is already recorded in another branch. Ask the Admin before adding
> them.

On Edit details, where nobody is being added, its second sentence reads "Ask the Admin before
saving." Several such matches are one line, since nothing is left to tell them apart by.

**2. An archived match in another branch keeps its *Archived* tag and asks for a restore**,
without a name:

> Someone with a similar name in another branch was archived. Ask the Admin to restore them
> instead of adding them again.

On Edit details its second sentence reads "If this is them, ask the Admin to restore them." It is
a line of its own beside the one above, shown when any match in another branch is archived. The
owner chose this on 2026-10-29 rather than dropping the tag, so that a leader still asks for the
first record back (decision 0404).

**3. A similar name is shown as well as an exact one.** A candidate is Tier 2 on the names alone
where the last names are equal and the first names are a known nickname variant, or the whole
names are closely similar, which is what catches a letter added, dropped, changed or swapped
(`Jon` against `John`, `Jaun` against `Juan`). Both read Section 3's existing nickname list and
whole-name threshold. The whole name rather than the first name alone, so two short first names a
letter apart (`Bo` against `Jo`) are not a match on the last name alone, which Section 3 forbids.
It is asked of the application's own add, edit and pre-flight paths, and of the run that decides
who in another branch appears, and not of the tree import, whose decisions file this ruling does
not reach. It is never Tier 1, so it never stops a save.

**4. Your own branch is unchanged**, apart from a similar name now being shown there too: full
name, Member ID, the tier and the reasons, and a Tier 1 match still stops the save until "These
are different people". A reader whose scope is the whole church, the Admin, sees everyone in full.

## Why it stays safe

Whether somebody in another branch appears is still decided on the names and sex alone (Section
3, which candidates appear), and the similar-name rule reads nothing else, so a different birthday
or mobile number typed gives the same answer. The order in which they are listed is unchanged and
is still a function of the names. Decision 0304's audit entry is unchanged: it still records the
Persons shown, which the response no longer names.

## What it changes

Decision 0389 point 8 kept this lookup reaching the whole church "with its limited fields". It
still reaches the whole church; the fields outside the branch are now none.

Decision 0405, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 3 and 8.

Previous: [2026-10-28 — An archived match is labelled, and the reader is told to ask for a restore](0404-an-archived-match-is-labelled.md)
