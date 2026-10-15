# 2026-10-15 — A new Cell starts with three members

A Cell is a leader and the people they meet with. Section 10 let a new Cell be requested and
approved with nobody in it, so a Cell could be opened, counted and given a Cell Leader before
anybody had agreed to come. The owner ruled on 15 Oct, from a clickable preview, that a new
Cell starts with three members, and that a Cell which later has fewer is listed rather than
acted on.

## The ruling

1. **A request for a new Cell, and a request to restart a closed one, names three members**
   (owner, 2026-10-15). The prospective leader is not one of them and is not counted: a
   Cell's leader holds no membership row (Section 10). A handover names none, because
   the Cell already has its members.
2. **Each member named must be** a current Person (not archived, not absorbed by a Merge), in
   the prospective leader's Network now (Section 4), holding no open Cell membership, and
   different from the other two. Three different people other than the leader is the
   request's shape, refused `VALIDATION_FAILED`; the other conditions are refused
   `INVARIANT_VIOLATION`, naming the line, after the scope checks.
3. **Somebody already in another Cell cannot be named** for now. How a person moves
   between Cells is open (CLAUDE.md), and when it is ruled it decides whether a request
   may name them.
4. **The conditions are checked when the request is sent and again when it is approved**,
   since Section 10 says the state at approval governs. An approval where a named member no
   longer qualifies is refused `INVARIANT_VIOLATION`, naming the person; the request is
   declined and sent again with somebody else, a decision being final (decision 0147).
5. **Approval adds the three as members of the new Cell**, in the same transaction that
   creates it and from the same instant, each audit logged as any membership change is
   (Section 21).
6. **The members a request names are never changed**, pending or decided. They are part
   of what the request asked, like the person it names (Section 10). This replaces decision
   0264's statement that a restart carries no member list.
7. **A request with no members named**, which only one sent before this ruling can be, is
   approved without them.
8. **A Cell with fewer than three current members is on an attention list, *Fewer than 3
   members*** (owner, 2026-10-15): one of Section 15's Cells needing attention, shown on the
   Cells page to whoever lists that Cell. It counts current memberships only; the leader is
   not counted. Nothing happens to the Cell because of it: no closure, no flag on its record,
   and no change to any figure.
   An existing Cell with fewer than three is listed in the same way and nothing else.

## What the build's tests must show

At the API: a new-Cell or restart request is refused for fewer or more than three members, a
repeated person, the prospective leader named as a member, an archived or merged Person, a
person of the other Network, and a person holding a Cell membership; approval is refused when
a member has since joined a Cell, been archived or merged, or moved Network, and otherwise
adds all three in the transaction that creates the Cell, from its first instant; a
handover is unchanged; and the attention list shows a Cell with two members and not one with
three, and does not count the leader.

## Why

Three members is what makes a Cell a group rather than a leader with a title, and the
approver's queue shows who they are. Checking again at approval follows Section 10's rule that
the state at approval governs. A Cell that later shrinks is
listed rather than closed, because Section 10 makes closure a leader's declared decision and
never a rule the system applies.

Decision 0353, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-15 — An administrator ticks who approves Cells](0352-an-administrator-ticks-who-approves-cells.md)
