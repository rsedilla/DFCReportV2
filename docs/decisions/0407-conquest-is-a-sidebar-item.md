# 2026-10-29 — Conquest is an item of the sidebar, for the Admin and both Senior Pastors

Owner ruling, 2026-10-29, chosen from screenshots of the Admin's sidebar and Conquest page on the
demo database, on a desktop and a phone. **It replaces decision 0406**, made the same day, which
put Conquest as a link above the tabs of Reports and Growth: the owner had meant the sidebar.

## The ruling

**1. Conquest is an item of the sidebar of its own**, labelled *Conquest*, after *Growth*, opening
its page at `/conquest`: the four goal cards and each person's goals, headed "Conquest". It is no
longer under Growth, and Growth carries SUYNL and Training.

**2. It is the Admin's and the two Senior Pastors'.** The Admin's sidebar reads Record, Reports,
People, Cells, Growth, Conquest; Bishop Oriel's and Pastora Geraldine's reads Record, Reports,
Conquest. Both Senior Pastors alike, so the role stays one set of screens.

**2a. The item follows the capability, not the role** (owner ruling, the same day, on
`architecture-guardian`'s review). It is the last item of any account holding
`conquest.view_subtree` at Whole Church, and `/conquest` opens for exactly those accounts. The
Admin and Senior Pastor roles hold it there by default, so today that is the three accounts point 2
names; an account holding it at a narrower scope, or not at all, has no item. The first build keyed
the Admin's item on the reach of `reports.view_subtree`, as Growth and SUYNL are told apart, which
would have drawn an item whose routes refuse an account without the capability. Section 19 rests the
sidebar on capabilities (decision 0245).

**3. Nothing else shows Conquest.** The "Conquest goals" link above the tabs of Reports and Growth
(decision 0406) is removed, and so is the Conquest page under Reports (decision 0292), whose four
cards are the head of this page. `/growth/conquest` and `/reports/conquest` forward to `/conquest`,
so a saved link still opens it. A Full view leader and a Leader account without Full view are
unchanged: neither holds the capability at Whole Church, so neither has Conquest (decisions 0360
and 0379).

## What it does not change

**No capability.** The Senior Pastor role has held `conquest.view_subtree` at Whole Church since
decision 0326, which withdrew the screen and not the capability; this ruling gives the screen
back. They read Conquest over the whole church, both Networks, as their Reports do, and file
nothing: every goal is derived (Section 27). No route, record or migration changes.

**On a phone** the Admin's bottom bar holds six items, the most Section 19 allows; each label is
checked whole at 320px.

Decision 0407, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 19, 27 and 28.

Previous: [2026-10-29 — Conquest is a link above the tabs on Reports and Growth](0406-conquest-is-a-link.md)
