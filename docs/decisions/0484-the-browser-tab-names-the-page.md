# 2026-11-13 — The browser tab names the page, and a control's border is dark

Owner ruling, 2026-11-13, chosen from screenshots of the Senior Pastors' CG Attendance on a phone
and a laptop, today beside the proposal, after a WCAG 2.2 AA audit of the web application's code.

## The ruling

**1. The browser tab names the page**: the current sidebar item, then the application's name,
*Reports – DREAMS*, and *DREAMS* alone on a page that is no item's. Every page said *DREAMS* before,
so a screen reader was not told where a click had gone (WCAG 2.4.2).

**2. A control's boundary takes the `edge` token, never `line`**, which is a divider. The *Figures
for* and period boxes on CG Attendance, DCC Attendance and Trends had taken `line`, about 1.3:1
against white, where 1.4.11 asks 3:1 of a control's boundary. They now take `edge`, the dark green
every other box carries.

## Why

Section 23 commits the web application to WCAG 2.2 AA, and the build's contrast check reads the
palette, so it cannot see which token a screen puts on a control; the faint boxes passed it. The
page title is wording a leader sees in the tab, so it is ruled rather than slipped in.

Three further fixes from the same audit make no visible change and need no ruling, being what
Section 23 already requires: a search's result is said to a screen reader on People and in the
person picker (4.1.3), each *Choose* button in the picker carries the person's name (4.1.2), and an
error message is no longer announced twice.

Considered and rejected: naming each tab inside a page as well (*CG Attendance – Reports – DREAMS*),
left for a later change; and leaving the boxes as they were, which fails 1.4.11.

## What is owed

The audit read the shared components and the screens leaders use every week, not every screen:
the Admin area, Growth, Conquest, the person page, My Cell, the Account page and the dialogs one by
one were not read, and nothing was tried with a keyboard or a screen reader in a browser.

---

Decision 0484, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 23.

Previous: [2026-11-12 — A Primary's Reports: two Attendance tabs, one control bar, and *not counted*](0483-a-primarys-reports-two-tabs-one-bar-and-not-counted.md)
