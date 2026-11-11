# 2026-11-11 — A Network Admin administers one Network from outside its tree

Owner ruling, 2026-11-11, chosen question by question from a table and screenshots. The
owner wants the account work for about a thousand leaders delegated by Network, to somebody
who can also answer questions about that Network. It replaces the point of 2026-10-07 that a
Network Admin would be one of the Bishop's or Pastora Geraldine's 12, on one account with
their leader role. It amends Sections 3, 5, 6, 7, 8, 9, 10, 14, 19, 20, 22, 27 and 28.

## The ruling

1. **A role of its own, `NETWORK_ADMIN`.** Its holder is a dedicated administrator of one
   Network: not one of the 12, never placed in the pastoral tree, with no Cell and no DCC
   line, and in no count of people. Their Network is set by their sex. They cannot see the
   other Network. Only the whole-church Admin gives this account, and a Network may have more
   than one. The whole-church Admin stays the super admin; the Senior Pastors hold no account
   powers (decisions 0109, 0110 and 0326 stand).
2. **They sign in with the second step** and have the seven-day session. The whole-church
   Admin resets their step on their person page, as for a Senior Pastor.
3. **Accounts.** In their Network they give Leader accounts and the Full view tick, and on
   Leader accounts resend activation, send a reset, change the email, sign out everywhere,
   and disable or re-enable. Nothing on a Senior Pastor, Admin or other Network Admin account.
   Approves Cells and Moves people stay with the whole-church Admin, and clearing Full view
   while either is on is refused them.
4. **Everyday administration, in their Network:** approve and decline new Cells and handovers;
   archive and restore; add people and edit details; move a person to another leader and a
   member to another Cell, inside one branch or between two, a move between two branches once
   the two Primaries agree outside the application; add or remove members, change a schedule
   or category; close a Cell with every reason but *Created in error*.
5. **Recording, in their Network:** record and correct DCC and Cell meetings on a leader's
   behalf while the week is open, a root's 12 included where nobody above has an account; file
   and correct SUYNL, Training and Conquest, recorded as on behalf.
6. **What stays with the whole-church Admin:** other administrators' and Senior Pastors'
   accounts; correcting sex; merging; a Title; backdating and closed weeks; settings and the
   Encounter dates; *Created in error*; direct creation of a Cell; the tree import; the Audit
   Log.
7. **Records they read and do not change:** a Senior Pastor's, the whole-church Admin's and
   another Network Admin's. They edit their own basic details. A Network root's own DCC line
   and own SUYNL, Training and Conquest stay with the root and the whole-church Admin.
8. **Their screens are the Admin's, showing their Network.** The `Admin` item has *Home* and
   *Accounts*, and no *Settings* or *Audit Log*. Search and pickers stay in their Network. The
   duplicate check keeps the nameless line a leader gets for a match elsewhere.
9. **A Network's Cell Group report counts by the Cell's Network**, the Network of the
   meeting's responsible leader at the meeting's date. So in the month somebody's sex is
   corrected, Men's + Women's unique people can exceed the Whole Church total by that person,
   and this is expected. This settles the question left open on what a `NETWORK`-scoped Cell
   figure narrows.

## Why

A role rather than `ADMIN` with limits: several checks test the `ADMIN` role and several
capabilities are Whole Church only, so `ADMIN` with a narrower scope would either break those
checks or inherit what the owner withheld. The role's defaults are stated in the catalog, so
nothing about it is held in data.

Outside the tree because the powers are administrative: somebody inside the tree would be
moving, approving and recording within the figures they are themselves counted in, which is
the incentive Section 7 keeps these powers away from. It is also what makes Section 5
invariant 4 and the *Approves Cells* refusals unnecessary for them, since nobody is upline of
them and nobody is their disciple.

The limit on Full view exists because clearing it clears the two ticks: without the refusal
they could remove what only the whole-church Admin can give back.

Considered and rejected: a server command alone to reset their second step, which would leave
them locked out until somebody ran it; moves only between branches, which leaves a branch with
no ticked Primary to the whole-church Admin and makes every move ask which branch two leaders
are in; hiding the other Network from the duplicate check, which lets a person recorded under
the wrong sex be added twice; counting a Cell figure by each attendee's Network, where the
owner chose the Cell's.

## What is owed

Spec only; nothing is built by this ruling. The stage giving the role
`people.manage_pastoral_assignment` adds a thirteenth case to `CLAUDE.md`'s authorization test
suite with its test: a Network Admin moves a person between branches of their Network, and
cannot move anybody into, out of or inside the other Network. It is not listed there yet
because that list says each case is pinned by a test. The people named must have never held a
place in the pastoral tree.

---

Decision 0469, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md).

Previous: [2026-11-11 — A leader's Cell opens in place to its members](0468-a-leaders-cell-opens-in-place-to-its-members.md)
