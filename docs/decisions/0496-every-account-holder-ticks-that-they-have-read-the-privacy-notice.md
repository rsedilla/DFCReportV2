# 2026-11-16 — Every account holder ticks that they have read the Privacy Notice

Owner ruling, 2026-11-16, from screenshots on a phone and a laptop, today beside the change:
the activation email, the page that sets a first password, a one-time screen for somebody who
already has an account, and the Admin's Account box on a person's page. The owner asked for a
tick box as evidence that each leader read the Data Privacy Act notice, and answered "Yes, build
it" to all four.

## The ruling

**1. Setting a first password asks for a tick.** The activation page carries an empty box, "I
have read the Privacy Notice, and I will use DREAMS only to care for the people I lead", with
*Privacy Notice* linking to `/privacy`. *Activate account* does nothing until it is ticked. The
box starts empty and nothing ticks it for the person.

**2. Somebody who already has an account is asked once, the next time DREAMS opens.** In place
of every other screen, as soon as the website knows who is signed in, a *Before you continue*
screen says DREAMS holds the personal information of the
church's members, children among them, under the Data Privacy Act of 2012, and carries the same
box, a *Continue* button that does nothing until it is ticked, and *Sign out*. It is never shown
again for that account, unless the notice changes.

**3. Every account is asked**, whatever its role: Leaders, Network Admins, the Senior Pastors and
the Admin.

**4. What is kept is the account, the notice it was ticked against, and when.** The notice is
named by its *Last updated* date (`2026-11-16` today). A tick is a row in its own table, never
changed and never removed. When the notice's date changes, every account is asked again at its
next open, and the earlier rows stay.

**5. The activation email says it is coming.** Before "Your account is ready", a paragraph says
DREAMS holds the personal information of the church's members, children among them, under the
Data Privacy Act of 2012, and that setting the password asks them to read the Privacy Notice and
tick a box. The email carries no tick: email security scanners open links by themselves, so only
a click on DREAMS's own page shows the person did it.

**6. The Admin sees it on the person's Account box**, under the email: "Privacy Notice: read on
Nov 16, 2026, 9:14 AM." or "Privacy Notice: **not read yet**. {First name} is asked the next time
DREAMS is opened.", which for an account not yet activated ends "is asked when setting a
password." There is nothing to click. Whoever may see an account there sees this line.

**7. The Privacy Notice says the tick is kept.** Its *What we keep* line for somebody who leads
and has an account adds "and when you ticked that you read this notice", because DREAMS now keeps
that (Section 24 asks the page to change with what is kept). The notice keeps its date, November
16, 2026: nobody can tick before this change is deployed, so no tick is ever made against the
wording without that line.

## Why

The Data Privacy Act and the National Privacy Commission's rules ask that consent and
acknowledgment be shown in written, electronic or recorded form, from a box the person ticks
themselves, and that continuing to use a system is not evidence. A leader reads the personal
information of the people in their care, children among them, so the church wants a record that
each one read the notice and promised to use it only for that care. It is the leader's
acknowledgment and promise, not the members' consent.

## What it does not change

What DREAMS keeps about a member who has no account, who may see anything, or any other route. An account that has not
ticked keeps its access to the API: the screen is the website's, and a tick records a fact rather
than granting anything. The activation route still accepts a request that carries no notice date,
and that account is asked at its first open.

---

Decision 0496, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 6, 7 and 24.

Previous: [2026-11-16 — The Privacy Notice says the information is used solely for the church](0495-the-privacy-notice-says-the-information-is-used-solely-for-the-church.md)
