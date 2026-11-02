# 2026-11-02 — The Admin's Settings tab

Decision 0419 gave the `Admin` item four tabs and built two, leaving *Settings* to be built
with its routes, and Home to carry the date the DCC calendar reaches once it was. Section 7
names three church-wide settings and offered no way to change two of them except by writing
to the database. The owner was shown the tab and Home's new line on a laptop and a phone on
2026-11-02, and chose the recommendation on each open point.

## The ruling

**1. *Settings* is the third tab**, after Home and Accounts, for a holder of
`settings.manage` at Whole Church, and every route behind it carries that capability: a
read at `GET /api/v1/settings`, and the two changes below. Each change is audited as
`setting.changed` with its previous and new values (sections 7 and 21).

**2. The attention threshold is changed here**, from two to six whole months, three the
usual, at `PATCH /api/v1/settings/cell-attention-months`. Setting the value it already holds
records nothing. One month would flag a Cell that skipped a holiday month, and past six a
quiet Cell is told to nobody for half a year. *Inactive N+ Months* carries the number on every
screen that names it, as section 15 already said it should, the counts route sending it.

**3. Initial encoding is closed here, once**, at `POST /api/v1/settings/initial-encoding/close`,
after a dialog saying it cannot be undone (section 2, decision 0047). Nothing reopens it; a
second close is refused as `INVARIANT_VIOLATION`, and of two closes at one moment one
succeeds, the write naming the open value.

**4. The DCC calendar is shown and not changed**: how far it reaches and the first Sunday it
covers. The first Sunday is set once by the scheduled command (section 9), and moving it
would change which months are filled, so the tab offers no control for it.

**5. The Encounter God Weekends are set on this tab and nowhere else.** Growth's Encounter
seasons page stays as a list to read, saying where the dates are set, and the SUYNL report's
link leads an administrator here.

**6. The verse on Record is set here.** An administrator sets one verse and its reference,
which every account sees under the welcome on Record, at `PUT /api/v1/settings/record-verse`;
both left empty show no verse, and one without the other is refused. Any signed-in account
reads it at `GET /api/v1/settings/record-verse`, since it describes nobody. It begins as
1 Peter 5:2 (NIV), the verse the owner chose, seeded by migration 0038. One verse for the whole
church, not a list that rotates; the reference carries its translation.

**7. Home carries one line under *The church***: *DCC calendar*, *Ready to* its last Sunday,
with a link to Settings.

**8. A table puts its text columns first and its number columns last**, each number
right-aligned with its heading. Three tables broke the rule every other one kept, and now
keep it: Active Cells (Cell, Leader, Meets, Members, *Meetings Recorded*), the Inactive list,
and Recording Progress. On a phone those lists are cards and do not change.

## Why

The verse is there to encourage: leaders open Record to do the work, and the owner chose
1 Peter 5:2 for why they do it. An administrator changes it for a season without waiting for
a release.

A church-wide setting changed by editing the database leaves no audit entry, which section 7
forbids, and puts the change out of the administrator's reach. One tab holding every such
setting, the Encounter dates included, is one place to look and one place each change is
recorded.

---

Decision 0425, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 7, 19 and 28.

Previous: [2026-11-02 — The website is the phone app](0424-the-website-is-the-phone-app.md)
