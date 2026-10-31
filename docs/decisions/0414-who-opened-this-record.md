# 2026-11-01 — Who opened this record, shown to the Admin

Owner ruling, chosen on 2026-11-01 from screenshots of a person's page today and with the
proposed section, side by side, and the alert chosen the same day. Points 5 to 8 were settled
the same day, on the owner's answers to questions `architecture-guardian`'s reviews raised.

## What was missing

Every change to a record was kept, and opening one left no trace. A leader, or somebody
holding a leader's sign-in, could read every record their scope reaches and nobody would know.

## The ruling

**1. Each time somebody opens a person's page, who and when is kept**, and point 5 widens that
to every read of the record. Lists and searches do not count. (A church-wide search is already
recorded, decision 0303.)

**2. The Admin sees it at the foot of that person's page, *Who opened this record*, newest
first**: "Each time somebody opens or looks up this record, newest first. Shown to the Admin
only, and kept for one year." A viewer who is the person's pastoral leader now is marked "(pastoral leader)".

**3. An entry is removed a year after it was written.**

**4. When one person opens more than a hundred different person pages in an hour, each active
Admin is emailed**, with no new screen. (The owner left out an alert for every sign-in from a
new device: leaders change phones often, and it would mostly be noise.)

**5. Every read of a person's full record counts, whichever screen asked**, and the section says
"Each time somebody opens or looks up this record". The record is also read by the Reports and
Branch drill-downs, the Cell dialogs, Add a Person and the Account page.

**6. A read of one's own record is not kept.** Leaders read their own on Account and Add a
Person all the time, and their own name would fill their log.

**7. "The Admin" is `accounts.manage`**, and Section 7 says so: the capability that already
manages accounts, which only the Admin holds, also covers reading this log. A dedicated
capability would be tidier and is one more thing to manage.

**8. A list or search row no longer carries a birthday, civil status or mobile number.** The
People search and the person pickers sent each row's whole record, which no screen shows, so
somebody could page through them and copy those details with nothing kept. They now come only
with reading the one record, which is kept. Section 22 permits removing the fields before the
first native client (decision 0328); the web application changes with it.

## How it is built, where the owner's words left a choice

- **`accounts.manage` rather than `audit.view`**, which the two Senior Pastors hold too. The
  page offers the section to that capability at Whole Church, as it offers the Account section,
  rather than to a role (decisions 0245 and 0263).
- **A second read by the same person within ten minutes is the same one**, so a page that
  refreshes itself does not fill the log. Two reads arriving at the same instant may both be
  kept; nothing counts them.
- **A refused read is not kept**: the guard refuses it before the record is read.
- **The alert is capped as decision 0413 caps the sign-in alert**: at most once a day for one
  person, and twenty times a day in all, Manila days, so it cannot spend the mail provider's
  daily allowance that reset emails need.
- **The log is a table of `people`'s own, `person_views`** (migration 0036), rather than the
  audit log: the audit log is never shortened, and these entries are removed after a year. It
  names the viewer by their Person, so the page is named from `persons`, and the Admin's
  addresses come through `ADMIN_ACCOUNTS_PORT`, because `auth` owns accounts and imports `people`.
- **A read is recorded once the record is known to exist**, so a request naming nobody leaves
  nothing. A failure to record is logged and never fails the answer. A row is removed at the
  first read after it is a year old, and never shown once it is. An alert whose send fails still
  spends that day's alert.
- **The Privacy Notice now says so** (decision 0412, point 5): who opens or looks up a person's
  record, and when, is kept for one year, and the Admin can see it. Its "Last updated" date, which
  decision 0412 point 4 set to October 21, 2026, becomes the day this goes live, November 1,
  2026, as the owner agreed.

## What it does not change

Who may open a person's page, or what it shows.

Decision 0414, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 7, 8 and 21.

Previous: [2026-11-01 — A pause after ten wrong passwords, and the Admin is told](0413-a-pause-after-ten-wrong-passwords.md)
