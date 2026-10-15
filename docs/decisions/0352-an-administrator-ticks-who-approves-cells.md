# 2026-10-15 — An administrator ticks who approves Cells

Section 10 gave the approval of a Cell leadership request to Admin alone, so every new Cell,
handover and restart in the church waited for one person, who has no pastoral basis to judge
whether somebody is ready to lead. The owner ruled on 15 Oct, from a clickable preview, that
leaders an administrator chooses approve the requests of their own branch, with the Admin
able to step in.

## The ruling

1. **An administrator ticks *Approves Cells* on a Leader account** (owner, 2026-10-15), as
   *Full view* is ticked (decision 0323): it is set and cleared only by an account holding
   `roles.manage`, on the person's page, and each change is audit logged with its previous
   and new value. A new account starts without it, and it changes only what the Leader role
   gives. The tick is what confers the capability, never the person's place in the tree
   (Section 1, Principle 3).
2. **A ticked account holds `cell.approve_leadership` at `SUBTREE_EXCL_SELF`**, as a Leader
   default the tick selects, and approves or declines new Cells, handovers and restarts in its
   own branch. **Both objects a request names must be in that subtree**: the prospective
   leader, and the Cell a handover or a restart names, resolved through the Cell's leader, or
   a closed Cell's last leader.
3. **A ticked approver may not decide** a request they sent, a request naming themselves as
   the new leader, a request naming a Cell they lead themselves, or a request whose new leader
   is their own direct disciple. Those go to the Admin. The last one is there because a
   leader's own direct disciples are what Section 16's *Leaders with 12+ Direct Leaders* and
   Section 27's *Raise 12 leaders* count, so approving one would be approving something that
   counts for the approver.
4. **Nobody approves a request naming themselves as the new leader**, whatever capability and
   scope they hold. It is a domain check, as Section 10's rule for requesting is, because a
   scope value enforces nothing (Section 7).
5. **The Admin keeps approving and declining everything**, at Whole Church, so a request is
   never stuck behind an approver who is away or has no account yet.
6. **An approval the Admin thinks wrong is undone the way Section 10 already provides**: a new
   Cell or a restart is closed as `CREATED_IN_ERROR`, which only the Admin may give (decision
   0330); a wrong handover is handed back by a new request. That closure takes the Cell out of
   *Open a cell*, *Raise 12 leaders*, and every month's # of Cells and # of Cell Leaders
   (decisions 0283, 0286 and 0330); it does not take it out of the other per-month Cell figures,
   which is an open question in its own right. A decision itself stays final (decision 0147).
7. **An explicit grant is unchanged.** `cell.approve_leadership` granted explicitly at any
   scope narrower than Whole Church still covers nothing; the tick is the one way a Leader
   holds it narrower.
8. **Direct creation stays Whole Church only.** `POST /api/v1/cells` is refused to an account
   that holds `cell.approve_leadership` only through the tick.
9. **Where the queue is**: *Cells to Approve*, the third tab of the Cells page, with its
   count, for an account holding `cell.approve_leadership`, listing the pending requests that
   account may decide. Each row names the kind of request, the new leader, the Cell's
   category, day and time, and the leader the request came from. A ticked account without Full
   view, whose screens have no Cells page (decision 0323), is given one holding that tab alone.
10. **The account step is unchanged.** A newly approved leader without an account is given one
    by an administrator, as after every approval today (decisions 0152 and 0276).

## What the build's tests must show

At the API: an account without the tick is refused approving and declining; a ticked account
is admitted for a request inside its subtree and refused for each case in point 3, for a
leader outside its subtree and for a Cell outside it; an Admin who is the named leader is
refused; ticking and clearing are refused to a Leader and to a Senior Pastor, admitted to an
Admin, and audit logged; a ticked account is refused direct creation; and the queue lists, for
a ticked account, only what it may decide.

## Why

The work is spread over leaders who know their own branch rather than queued behind one
person who does not. The first draft of this ruling gave approval to every root's direct
disciple from the tree itself; that gave a capability by hierarchy position, which Principle 3
forbids, so the administrator ticks it instead. Approving by leader and then waiting for the
Admin's confirmation was rejected: every request would still pass through the Admin.

Section 10's reason for Admin-only approval, that approving meant provisioning the account,
stopped holding when decision 0152 left the account step to an administrator afterwards.

Decision 0352, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-14 — Changing a password while signed in](0351-changing-a-password-while-signed-in.md)
