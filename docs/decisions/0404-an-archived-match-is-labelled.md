# 2026-10-28 — An archived match is labelled, and the reader is told to ask for a restore

Owner ruling, 2026-10-28, chosen from screenshots of Add a person on the demo database, today
beside the proposal, with an archived person typed again.

## The ruling

**1. A duplicate candidate who is archived now says so.** Section 3's duplicate-candidate lookup
already reaches archived Persons, and only a Person absorbed by a merge is left out. Until now an
archived match looked like any other, so an encoder outside their branch added the person a second
time instead of asking for the first record back. Each candidate whose lifecycle state is
`ARCHIVED` now carries `archived: true`, inside the reader's scope and outside it, on the lookup
and on the refusal that asks for a Tier 1 acknowledgement. The state is read as it stands now.

**2. The screen shows an *Archived* tag and one line.** On Add a person: "This person was archived.
Ask the Admin to restore them instead of adding them again." On Edit details, where nobody is being
added: "This person was archived. If this is them, ask the Admin to restore them." The line takes
the place of "A possible match. Their details are visible to the leaders who pastor them."

**3. No *Open this record* link where the reader sees no details.** An archived match outside the
reader's scope opens a page that shows nothing they can act on, so the link is left out. Inside the
reader's scope the link stays, since the reader may open the record.

**4. Everyone sees the label, the Admin included.** The owner chose this on 2026-10-28 rather than
leaving the Admin's list as it was: an Admin sees the tag and the line, and keeps the link, from
which they restore the person.

## What it discloses, and why that is accepted

Section 8 withholds a person's lifecycle state outside the reader's scope. This ruling discloses it
for one case: a person whose names an encoder has typed, on the list that exists to stop that person
being recorded twice. The owner chose it because restoring the first record keeps their history
whole, and two records of one person are hard to put back together (Section 3). The flag is put on
candidates already shown and decides nobody's place on the list, so membership and order are still
a function of the names and sex alone. It is not derived from a birthday or a mobile number, so it
reopens neither oracle Section 3's redaction rules close. Section 3's audit entry for a lookup that
shows somebody outside the scope is unchanged.

## What it does not settle

Who restores. Section 7 gives restoring to `people.manage_lifecycle`, an Admin's by default, and the
line names the Admin for that reason. A screen to request a restore is not part of this ruling.

Decision 0404, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 3 and 8.

Previous: [2026-10-28 — A past Sunday stays with whoever held an account that Sunday](0403-a-past-sunday-stays-with-who-held-an-account.md)
