# 2026-10-16 — The Primary moves a member to another Cell

Section 10 let any leader holding `cell.manage_membership` over both Cells move a member from
one Cell to another, and remove one. The owner decided on 16 Oct, after deciding the same for
moving a person to another leader (decision 0356), that moving a member between Cells is the
Primary's decision too: the leaders talk it over with their Primary outside the application,
the Primary moves the person inside their own branch, and a move to a Cell in another branch is
made by the Admin. This replaces the 7 Oct decision, in which the old Cell's leader was asked
first, and the one recorded on the owner's checklist on 15 Oct, in which a leader asked and an approver
decided; neither was built.

## The ruling

1. **A new capability, `cell.move_members`, governs moving a member out of a Cell**: to another
   Cell, or to none, which is removing them (owner, 2026-10-16). It is a write capability.
   `cell.manage_membership` now governs adding somebody who is in no Cell, and nothing else.
2. **A Leader account holds `cell.move_members` over its own subtree only with *Moves people*
   and Full view**, the tick decision 0356 created, so the Primaries the administrator has
   ticked hold it with no further step. There is no second tick: one tick moves people both to
   another leader and to another Cell. **The Admin holds it at Whole Church. A Senior Pastor
   does not**: decision 0326 gives the Senior Pastors no Cell management capability, and this
   ruling changes nothing there, so a Senior Pastor neither moves nor removes a member, as
   today.
3. **A move needs the capability over both Cells**, each resolved through its leader as Section
   7 resolves a Cell. A move to a Cell outside the actor's subtree is refused `SCOPE_DENIED`,
   and the screen says that moves outside the actor's branch are made by the Admin. **There is
   no request for it, and the Admin's move is the approval**: the two Primaries agree between
   themselves, tell the Admin outside the application, and the Admin decides by making the move
   or not. The old Cell's leader is not asked.
4. **Removing a member needs the capability over their Cell** (owner, 2026-10-16). A person
   removed holds no Cell and appears on *Awaiting CG Assignment*, where any leader with them in
   scope may add them to a Cell. That is the only way open to a Leader for a person to leave a Cell
   without a new one, so a leader who cannot move a member cannot empty them out of a Cell for
   somebody else to add elsewhere.
5. **Adding somebody who is in no Cell is unchanged**: any holder of `cell.manage_membership`
   over the Cell adds them at once, from the Cell's *Add a member* or the person's *Add to a
   Cell*. **Choosing somebody who is already in another Cell is a move**, and is refused to an actor
   without `cell.move_members`: `CAPABILITY_DENIED` where they hold it nowhere, `SCOPE_DENIED`
   where they hold it but not over both Cells.
6. **A Leader without the capability is offered no *Move to another Cell* and no *Remove***, and
   asks for nothing in the application. Where *Move to another Cell* stood, the person's page
   says *Moves to another Cell are made by your Primary.*, and the *Add a member* dialog says
   that somebody already in another Cell is moved by their Primary.
7. **A new-Cell request may name somebody already in a Cell** (owner, 2026-10-16), replacing
   decision 0353's refusal of such a person. They stay in their Cell while the request waits, and
   **move into the new Cell when it is approved**, in the approval's transaction, their old
   membership closing at the instant the new one opens. **Only an approver who may move them
   approves it**: one holding `cell.move_members` over each such member's current Cell, by default
   the ticked Primary of that branch or the Admin. An approver without it is refused
   `SCOPE_DENIED` or `CAPABILITY_DENIED` and the Admin decides. Sending the request moves nobody,
   so it needs no `cell.move_members`. The old Cell's leader is not asked. A restart names its
   members the same way and follows the same rule. **A request an approver may no longer approve,
   because a named member is in a Cell outside its reach, is neither listed for it nor declinable
   by it**, as with decision 0352's refusals; it reaches only the Admin. The queue therefore reads
   each named member's current Cell.
8. **Unchanged**: closing a Cell, which only the Admin does and which moves or releases every
   member as Section 10 says (decision 0355), its destination Cells still checked under
   `cell.manage_membership`; a Recording-only account, which already adds and
   never removes (decision 0323); the same-Network rule; and the audit entry every membership
   change writes (Section 21).
9. **Whether an explicit grant of `cell.move_members` narrower than Whole Church covers
   anything is not settled here**, for the reason decision 0356 gives for its own capability: it
   is recorded in `CLAUDE.md`, and nothing writes `capability_grants`.

## What the build owes

A migration adds `cell.move_members` to the `capability` enumerated type, and the application's
list gains it. It is a write capability, so `capability_grants_read_only_is_a_read`, the second
migration Section 7 names for a read capability, is not changed. No column is added; the tick is
0356's.

At the API: a Leader without the tick is refused moving and removing and admitted adding
somebody in no Cell; a ticked Leader moves a member between two Cells of its branch at once and
is refused a destination outside it `SCOPE_DENIED`; the Admin moves across branches; a Senior
Pastor is refused moving and removing; a new-Cell request naming somebody in a Cell is sent,
leaves them in their Cell while it waits, and on approval moves them, refused to an approver
without `cell.move_members` over their Cell. On the web: the buttons above follow `/auth/me`, and the two lines are shown.

## Why

Moving somebody between Cells changes whose meetings record them and which Cell they count in,
so it is decided by the branch head who knows everybody in it, as moving them to another leader
now is. One tick for both kinds of move keeps the rule to one sentence for the leaders. Removal
goes with moving because otherwise it is a move in two steps that skips the Primary. A request
queue was considered and dropped for the reason decision 0356 gives.

This narrows Section 10's *Managing Cell membership*, which gave moving and removing to every
holder of `cell.manage_membership`, and adds a capability to Section 7.

Decision 0357, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-16 — An administrator ticks who moves people to another leader](0356-an-administrator-ticks-who-moves-people.md)
