# 2026-11-04 — The phone's two bars: room for the home line, a light tab bar, and the name on top

On 2026-11-04 the owner sent a screenshot of the installed app on an iPhone: the home line was drawn
over the *People* and *Cells* labels of the tab bar. They asked whether the buttons were too small,
for the bar to be checked against other installed web apps on every phone they use, and then, seeing
*People* twice on one screen, for that to be fixed too. They chose from screenshots of the real
pages, today beside each proposal, on six iPhone sizes and on Android, light and dark.

## The ruling

**1. The phone's bars keep clear of what the phone draws.** The page runs to the screen's edges
(`viewport-fit=cover`), so iOS reports the home line's room and the bar takes it; a phone turned
sideways keeps its corners and camera clear at the sides. Without it iOS reported that room as zero.
Zoom is left on, unlike the many apps that pair this with turning it off (Section 23).

**2. A phone's tab bar is light** (design E): white, or near black in the dark theme, its items grey,
24px icons over 12px words, the current one an extra bold dark green word with its icon on a pale
green pill (in the dark theme a light green word on a dark green pill). Its weight tells the current tab apart without colour (1.4.1), with `aria-current`; the
pill is too pale against the bar to count as a shape on its own. This narrows decision 0423's
seventh point, "the current one keeping its bar", to the sidebar, which keeps its emerald rows.

**3. The phone's top bar carries the DfC globe and *DREAMS*, not the section's name.** The page's
own title says where you are and the tab bar's pill which section, so no title shows twice. The
Admin button beside the account (decision 0419) stays.

**4. Nothing else changes.** The sidebar at a laptop's width, every page, and what any account may
see or do are as they were.

## Why

Both phone platforms mark the current tab with a pill or tint on a light bar and keep the home line
clear, and the installed web apps leaders use (X, Instagram, YouTube, Facebook, Messenger, Threads,
Telegram) all declare `viewport-fit=cover`. The top bar named the section only by a code comment's
convention, and with the page's own title beneath it that read as a repeat.

---

Decision 0439, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 19.

Previous: [2026-11-04 — My Cell counts the Cell Groups in the leader's care](0438-my-cell-counts-the-cell-groups-in-your-care.md)
