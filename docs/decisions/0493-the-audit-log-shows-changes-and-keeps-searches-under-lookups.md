# 2026-11-15 — The Audit Log shows changes, keeps searches under *Lookups*, and shows one save as one row

Owner rulings, 2026-11-15, four questions, each chosen from screenshots of the Admin's *Audit Log*
on a phone and a laptop, today beside the change. The owner observed that the log recorded every
click. What filled it was searches, duplicate checks, one row per lesson ticked and one row per
Sunday the calendar adds, around the changes the log exists for.

## The ruling

**1. *Everything* shows changes, and searches are under *Lookups*.** A ninth chip, *Lookups*, after
*Settings*, finds the two entries that record a reading rather than a change: a church-wide search
(decision 0303) and a duplicate check that showed somebody outside the searcher's care (decision
0304). *Everything* finds every other entry, and no longer these two. Both are kept as before; only
where they are listed moves. Under *Everything* the line above the list reads *Every change, newest
first. Searches and duplicate checks are under Lookups.*, under *Lookups* *Searches of the whole
church and duplicate checks, newest first.*, and under any other chip *Newest first.*, each followed,
as before, by *Reading it is not itself recorded.*

**2. A repeated search is one row.** Owner ruling, 2026-11-15, on a Stop Condition
`architecture-guardian` raised reviewing the first version of this point, which wrote a repeat
within ten minutes once and so reversed decision 0303's one entry per request without saying so.
The owner kept every search in the record and asked only that the list show repeats as one row. Church-wide searches one account made for the same words,
compared trimmed and without regard to case, next to each other in the list and each within ten
minutes of the one before, are shown as one row, *Searched the whole church · 3 times*, with the
words, which opens to list each search with how many it found. Every search is still written, a
second page included, as decision 0303 requires; only how the list shows them changes. The ten
minutes are decision 0414's, which treats a second opening of one page by one person within them
as the same opening.

**3. One save is one row.** Entries the same account made with the same action in one save carry one
instant, since a save is one transaction, and the screen shows a run of them as one row: *6 SUYNL
lessons filed*, naming the first three and how many more, which opens to list each. Each entry is
still stored on its own and is still found by a search for its person. Only how the list shows them
changes. The log breaks a tie between entries of one instant on a random identifier, so the
entries of one save are joined wherever they fall among that instant's entries, and the row stands
where the first of them does. Only entries on one page are joined: a run split by a page break shows
as two rows.

**4. The calendar's runs, the same.** The DCC calendar adds a year of Sundays in one run, each its own
*System* entry; by point 3 a run is one row, *5 Sundays added to the DCC calendar*, with the first
and last dates. It has no chip of its own. Other *System* entries, such as a sign-in paused after
wrong passwords, are listed as before.

## Why

An audit log that lists a reading beside every change has recorded the history and hidden it. The
split is the one Google Cloud's audit logs make between administrative activity and data access, and
OWASP's logging guidance warns against logging too much as well as too little. Who searched for whom
still matters in a church that holds minors' records, so every search is still written: the reading
entries keep their own place, and a repeat within minutes, which a reader need not scan twice, is
shown once and opened when wanted.

## What it does not change

Who reads the log (decision 0430), what any action records, or what a search returns. Each
entry keeps its own row in the database. The two-letter minimum and the 1,000-person ceiling of the
log's name search are unchanged (decision 0429).

---

Decision 0493, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 19.

Previous: [2026-11-14 — A Network Admin creates a Cell directly in their own Network, as the Admin does](0492-a-network-admin-creates-a-cell-directly-in-their-own-network.md)
