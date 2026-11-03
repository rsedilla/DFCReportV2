# 2026-11-03 — A person's page sets its boxes three across on a wide screen

Decision 0402 made a list or a table up to 1280px wide and one person's page up to 1024px, with
the spare width falling to the right. On a 1920px laptop beside the 240px sidebar that leaves
about 650px empty beside a person's page and about 400px beside every list. The owner raised it
on 2026-11-02 from a screenshot of the live site, and asked for every page to be checked.

An audit of 119 pages, as an administrator, a Primary, a leader and Bishop Oriel, found the
same on all of them. The owner was then shown three things on the real screens at 1920: every
page at full width, every page centred, and today's. Centring was refused ("I don't like
centered components"). Full width was refused for lists and reports because it moves a row's
figures away from its name: on the DCC report the owner pointed at the gap between a leader and
their Total, and on Record the Record button ended up about 1,400px from the date it belonged to.
A person's page was the one place the width bought something, because it holds separate boxes
rather than rows.

## The ruling

**1. A person's page sets its boxes three across from 1536px**, Tailwind's `2xl`, and is up to
1600px wide there: DCC first, Growth with the Cell beneath it second, the details third, with
the account and who opened the record under the details for an administrator. Below 1536px
nothing changes: two columns from `lg`, and one below it.

**2. Every other page keeps decision 0402's widths.** A list or a table, a form and Account stay
up to 1280px, and Where they sit 768px, with the spare width to the right. Nothing is centred.

**3. The accessibility suite scans 1920px**, so the layout `2xl` creates is covered, and the
breakpoint check permits `2xl:` for that reason alone.

## Why

The empty band is a cost on every page, but on a list it is the lesser one: a row read across
1,600px is harder than a row read across 1,200px with space beside it. A person's page is read
box by box, so a third column shortens it by about a third and puts all of it on one screen
of a 1920 laptop without moving anything apart.

---

Decision 0426, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 19.

Previous: [2026-11-02 — The Admin's Settings tab](0425-the-admin-settings-tab.md)
