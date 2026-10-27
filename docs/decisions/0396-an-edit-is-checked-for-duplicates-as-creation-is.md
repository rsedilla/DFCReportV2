# 2026-10-27 — An edit is checked for duplicates as creation is

Owner ruling, 2026-10-27, agreed from screenshots of Edit details beside Add Person.

## The ruling

**1. Edit details shows the "Someone similar is already recorded" box Add Person shows.** Once
a name, the birthday or the mobile number differs from what is saved, the same candidates appear, with the same
reasons and the same withholding for anybody the editor may not see (Section 8). It says "Check
before saving" where Add Person says "Check before adding". The person being edited is never
listed: they match their own record.

**2. A Tier 1 candidate stops the save until it is acknowledged, as on creation.** The API checks
`PATCH /api/v1/people/{id}` the way it checks `POST /api/v1/people`: where the edit changes a
name, the birthday or the mobile number, it compares the record as it will read, and a Tier 1
candidate the editor may see and has not acknowledged answers `DUPLICATE_ACKNOWLEDGEMENT_REQUIRED`
with the candidates. The screen asks "Is this someone already recorded?" and offers "These are
different people — save anyway", which sends the same changes with `acknowledged_duplicate_ids`
under a new key, or "Go back and change the details".

**3. What is not checked.** An edit that changes none of those fields, such as a civil status, is
not checked, and the same values sent back unchanged are not a change. A Tier 1 candidate the
editor may not see does not gate, as on creation: the refusal would ask them to acknowledge
somebody they cannot be shown, and its answer would vary with a birthday Section 8 protects.

**4. Recorded.** The candidates passed over are written into the `person.updated` audit entry,
as creation writes them into `person.created`: only those this check found, and always written,
so an empty list says none was needed.

**5. A pair already confirmed as different people is asked about again** on a later edit to a
name, birthday or mobile number (owner, 2026-10-27, chosen over remembering the answer for the
pair). The answer applies to one save and is not stored, as on Add Person; remembering it would
need a record of its own, and such edits are rare.

**6. Checked before the save's transaction, as creation is.** The check reads many rows, and
made while the record is locked it would hold that lock and a database connection while it ran.
Where somebody changes one of the compared fields between the check and the save, the save
answers `RESOURCE_BUSY`, and sending it again checks it afresh.

## Why

A person recorded with a wrong birthday or a misspelled name and later corrected could become a
second record of somebody already there, and nothing said so: the duplicate check ran only when
a person was added (audit of 2026-10-25, gap 1). The owner chose to give the edit the same
check, in the same words, so that correcting a record cannot quietly create the duplicate the
check exists to prevent.

The candidates shown for another branch are unchanged by this ruling. How a match in another
branch is shown is decided separately (option C) and is built after this.

Decision 0396, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 3.

Previous: [2026-10-26 — A member added after a meeting was recorded is asked about, not called not marked](0391-a-member-added-after-a-meeting-was-recorded.md)
