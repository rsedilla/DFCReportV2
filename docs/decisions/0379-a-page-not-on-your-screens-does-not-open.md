# 2026-10-21 — A page not on your screens does not open

Decisions 0360, 0364 and 0380 hid screens from some accounts' menus and left them "reachable by
address": Encounter Readiness, Training and Conquest for a Full view leader, and the `Branch`
screen for everybody. The Senior Pastors' and the recording screens likewise have no People
list, Cells list, Growth or other Reports item, yet those pages opened when their address was
typed or kept from an old link, and showed half-working screens full of refusals. On 21 Oct the
owner looked at five such cases in screenshots and chose to guard them rather than delete them
or leave them. The work was paused that day and built on 27 Oct, after the owner saw it again in
screenshots beside today's screens; it was fitted then to decisions 0380 to 0383, which had
changed a Full view leader's Reports and Growth in between.

## The ruling

1. **A page not on an account's screens does not open for it.** Its address shows a short note,
   *This page isn't part of your screens*, naming the account's screens, with one link: *Go to
   your start screen*, Record for most accounts and Reports for the Senior Pastors
   (decision 0372).
2. **An account's pages are those its sidebar items and tabs reach and the pages those open**:
   a Cell's meetings and members from Record, a person from a name, the Encounter seasons from
   Training and Encounter Readiness. Which items an account has is the server's answer
   (decision 0323), never a role. **A link to a page the account does not have is not drawn
   either**, so no page of its screens leads to the note: a Senior Pastor's person page offers
   no People tab, *Back to people*, SUYNL or Training link, and their Cell pages no Cells tab.
3. **What this closes today:**
   - for every account, the `Branch` screen (decision 0364);
   - for a Full view leader, Encounter Readiness, Training and Conquest under Reports, Training
     and Conquest under Growth (decisions 0360 and 0380), and My Cell. The Encounter seasons
     page stays open to them and to the recording screens, as decision 0360 marks SUYNL on it
     for such a reader, though nothing on their screens links to it now;
   - for the Senior Pastors, the People list, Add a person, Awaiting Leader Assignment, the
     Cells list, New Cell, Growth, Family Tree, My Cell, and the Reports tabs that are not
     theirs. A person's page stays open to them until the owner rules on it;
   - for a recording-screens account, Reports, the twelve months, the Cells list, New Cell,
     Awaiting Leader Assignment, Family Tree, Training and Conquest;
   - for the Admin, My Cell and the twelve months, which are not on their screens;
   - New Cell, for any account but a Whole Church holder of `cell.approve_leadership`, to whom
     alone the Cells list offers it.
4. **A Cell's page offers *Change when it meets* and *Change category* only to an account that
   may change a Cell's configuration** (`cell.manage_configuration`), which the Senior Pastors
   do not hold (decision 0326). The route still decides the Cell's scope. Its back link returns
   to where the account's own screens reached it: *Back to Update Records* for the Senior
   Pastors, and *Back to Cells* to My Cell on the recording screens. *Edit details* on a
   person's page is offered likewise only with `people.edit_basic`, which the Senior Pastors do
   not hold either.
5. **Nothing is deleted.** The pages stay in the code, so a later tier is given a screen by
   adding it to that account's screens rather than by building it again.

This replaces decision 0360's and 0380's "the page stays reachable by address" and decision
0364's "still opens at its address".

## Why

A page that opens and then refuses everything it shows reads as the app being broken, and a
button that is always refused reads the same. The server already decides every request
(Section 1, principle 4); the guard only stops the screen offering a page or a button that is
not the account's. Deleting the hidden pages was considered and rejected: each would leave API
routes no screen reaches, and the hidden Growth pages are meant for later tiers.

Decision 0379, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 19.

Previous: [2026-10-20 — The SUYNL report is Encounter Readiness, with no counts of its own](0378-encounter-readiness.md)
