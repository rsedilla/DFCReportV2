# 2026-11-05 — An emailed link's code leaves the address once the page has read it

The three links the application emails, to activate an account, to reset a password and to
confirm a new email address, carry their one-time code in the address (`?token=…`). The
2026-11-02 security audit found that the code stayed in the address bar and in the browser's
history after the page opened, so the next person at a shared computer, as church computers often
are, could find it there. Each code is single-use and short-lived, so the exposure is narrow,
but it is not needed. The owner approved the fix on 2026-11-05 from a screenshot of the address
bar before and after.

## The ruling

**Each of the three pages reads the code, then takes it out of the address and out of that page's
history entry.** What the page shows and sends is unchanged.

**The code is kept in that browser tab alone** (`sessionStorage`), so a reload still works, and is
forgotten once the link has been used or the tab is closed. A browser that refuses the storage
keeps nothing, and a reload then shows the page's "missing its token" notice, as a link without
its code always has.

## Why

Clearing the address is the step browsers leave to the page: the code reaches the page in the
address, and only the page can replace the history entry. Keeping it in the tab rather than
nowhere was chosen so that a reload halfway through, which is common on a phone, does not cost
the person their link; tab storage is not shared with other tabs or kept after the tab closes.
The server-side rules are untouched: the code is still single-use, stored only as a hash and
short-lived (Section 6).

---

Decision 0447, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 6.

Previous: [2026-11-05 — *CG Records Due* and *DCC Records Due*](0446-cg-and-dcc-records-due.md)
