# 2026-10-16 — An administrator ticks who moves people to another leader

Section 5 let any leader upline of a person move them to another pastoral leader inside their
own subtree. The owner decided on 16 Oct, from real screenshots, that moving people is the
Primaries' decision: in the church a leader does not ask to transfer anybody, the Primary
decides alone inside their own branch, and a move between two branches is agreed by the two
Primaries and made by the administrator.
This replaces the 15 Oct answers on the owner's checklist, in which a leader asked and an
approver decided; that flow was never built.

## The ruling

1. **A Leader account holds `people.manage_pastoral_assignment` only with *Moves people***
   (owner, 2026-10-16). An account holding `roles.manage` ticks it on a Leader account, as
   *Full view* (decision 0323) and *Approves Cells* (decision 0352) are ticked, on the person's
   page, and each change is audit logged as `account.moves_people_changed` with its previous
   and new value. A new account starts without it. It changes only what the Leader role gives,
   so an account that also holds `SENIOR_PASTOR` or `ADMIN` keeps that role's default.
2. **The tick confers the capability, never the person's place in the tree** (Section 1,
   Principle 3; owner, 2026-10-16). It is meant for the Primaries, the direct disciples of the
   two Network roots. The tree shows who they are, but nothing stores a flag for them and
   nothing gives them authority: the administrator ticks each one. Being a root's direct
   disciple gives nothing, so a move that places somebody there gives them nothing either, and
   a Primary moved elsewhere keeps the tick until it is cleared.
3. **With the tick the account holds the capability over its own subtree**, the default the
   Leader role had before this ruling, and every invariant of Section 5 binds it unchanged: both
   the person and the new leader inside its subtree, no cycle, no change to its own assignment
   or anyone upline of it, no edge across Networks, no archived or merged Person. **The move
   takes effect at once**: nobody else is asked, and nothing is requested or approved.
4. **A move between two branches is made by an account holding the capability at Whole
   Church** (owner, 2026-10-16): by default the Admin and the two Senior Pastors, whose
   defaults are unchanged. A ticked Primary choosing a new leader outside their subtree is
   refused `SCOPE_DENIED`, as any leader was before, and the screen says that a move to another
   branch is made by the Admin. **There is no request for it, and the Admin's move is the approval**
   (owner, 2026-10-16): the two Primaries agree between themselves and tell the Admin outside the
   application, and the Admin decides by making the move or not. A Senior Pastor still moves anyone
   directly, as before this ruling, and needs no such agreement.
5. **A Leader without the tick moves nobody, and asks for nothing in the application** (owner,
   2026-10-16). *Move to another leader* on the person's page and *Move* on the Branch screen are
   not offered to such an account, and the API refuses the move `CAPABILITY_DENIED`. Where the
   button stood, the person's page says *Moves to another leader are made by your Primary.*, which
   explains the missing button without inviting a request.
6. **The tick is offered only on an account with Full view** (owner, 2026-10-16), as *Approves
   Cells* is: the Primaries start with Full view (decision 0323), and Branch is a Full view
   screen. Ticking it without Full view is refused `INVARIANT_VIOLATION`, and clearing Full view
   clears it in the same change, audited as its own. It is shown beside the other two ticks.
7. **Awaiting Leader Assignment stays on Record for whoever reads it today** (owner,
   2026-10-16), and for a reader without the capability it is read-only: each row carries the
   person's name and no move, under the line *A new leader is chosen by your Primary.* It is an
   exception to Section 19's "each entry carries the action that resolves it", made so that a
   Full view leader who can see a row still sees it without being offered a move. Who can see a
   row at all is unchanged, and is narrower than it sounds (Section 20).
8. **Whether an explicit grant of the capability narrower than Whole Church covers anything is
   not settled here.** Section 7's rule that a capability given only at Whole Church, apart from
   a default a tick selects, covers nothing when granted narrower now reads as reaching it, and
   `WHOLE_CHURCH_ONLY` in the code does not include it. Nothing writes `capability_grants`, so
   nothing reaches it; it is recorded in `CLAUDE.md` with the open question about a `NETWORK`
   grant of the same capability.
9. **Moving a person to another Cell is not this ruling.** *Move to another Cell* keeps
   `cell.manage_membership` as it is; the open question in `CLAUDE.md`, how a person moves
   from one Cell to another, is where that is settled.

## What the build owes

A migration adds `accounts.moves_people`, boolean, not null, default false, so every existing
Leader account loses the move on deploy until the administrator ticks the Primaries; until then
the Admin and the Senior Pastors move people, and an unticked Primary reads the two lines of
points 5 and 7 about their own branch. Adding a column that defaults to false sets no
effective date and rewrites no history. A route to tick and clear it, refused to an account
without `roles.manage`, beside the Full view and Approves Cells routes.

At the API: an unticked Leader is refused a move `CAPABILITY_DENIED`; a ticked Leader moves a
person inside their subtree at once and is refused one whose new leader is outside it
`SCOPE_DENIED`; the Admin and a Senior Pastor still move across branches; ticking and clearing
are refused to a Leader and a Senior Pastor, admitted to an Admin, and audit logged. **Every
authorization case in `CLAUDE.md` run as Raymond runs with his account ticked**, so that each
still fails for the reason it names rather than for the missing tick; a twelfth case refuses one
move to an unticked Leader and admits the same move once the account is ticked.

## Why

Moving a person changes whose totals they count in and who sees them, which is why Section 5
calls reassignment the highest-risk authorization surface in the system. A few people the
administrator chooses now do it, rather than every leader, and the branch head who knows
everybody in it decides without waiting for anybody. An approval queue was considered and
dropped as more than the church needs: inside a branch the Primary is the one who would
approve, and between branches the administrator is.

This narrows Section 5's *Who may perform it*, which named any leader upline of the person, and
Section 7's Leader default for the capability.

Decision 0356, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-16 — Only an administrator closes a Cell, and Cells with no meeting in three months are listed](0355-only-an-administrator-closes-a-cell.md)
