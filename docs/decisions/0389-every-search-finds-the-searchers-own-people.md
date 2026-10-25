# 2026-10-25 — Every search finds the searcher's own people

Owner ruling, 2026-10-25, made after an audit of every name search in the application and chosen
from screenshots of each picker today and limited to the searcher's own tree. It settles the open
Stop Condition of whether a leader may reach the church-wide directory outside a person picker,
and goes further: a leader no longer reaches it inside one either.

## The ruling

**1. Every search a leader makes finds only people within their own pastoral scope**: the People
screen, as since decision 0244, and now every person picker. Adding a Person names a leader they
oversee, adding a member to a Cell somebody they oversee, and naming a new pastoral leader on a
reassignment a leader they oversee. A new-Cell request's members were already searched this way
(decision 0369). The Network narrowing of decision 0299 is unchanged.

**2. Naming who ran a Cell meeting also offers the leaders above the searcher** on their pastoral
path, because an upline leader who stepped in is outside the searcher's scope. The search sends
`upline=true`; those leaders come back with the five fields Section 8 publishes, as anybody outside
the scope does. What the recording accepts as a facilitator is unchanged (decision 0274): this
ruling narrows the search, not the field.

**3. The church-wide directory is a Whole Church searcher's alone.** `GET /api/v1/people` refuses
`church_wide=true` as `SCOPE_DENIED` to any actor whose `people.view_subtree` scope is not Whole
Church, before the rate limit, so a refused request spends nothing and writes no audit entry. For
a Whole Church searcher, the Admin and the Senior Pastors, nothing changes: their scope is the
church, and decision 0303's bound and audit entry still apply when they ask for it.

**4. Somebody in no Cell, added to one, must be within the actor's own scope.**
`POST /api/v1/cells/{id}/members` now asks that the actor's `cell.manage_membership` cover the
person as well as the Cell when the person holds no membership. Cell membership may still differ
from pastoral assignment (Section 10), but a leader adds only people they oversee, and somebody
from another branch is added by an actor whose grant reaches them, the Admin. It is decided before
the person is read, so `SCOPE_DENIED` says nothing of whether they exist or are archived
(Section 8). **A move is not narrowed** (owner, 2026-10-26): somebody already in a Cell is moved,
and `cell.move_members` over both Cells decides it as decision 0357 says, so a ticked Primary still
moves a member between two of their own Cells whoever pastors them. **A new Cell's three members
keep decision 0369's rule** (owner, the same day): the requester names people beneath them, and
the approval adds them as before.

**5. Who ran a Cell meeting may still be somebody the screen does not offer** (owner, 2026-10-26).
A member another branch placed in the Cell is a valid facilitator under decision 0274 and is beyond
the searcher's scope and upline. That is rare, follows only an Admin's cross-branch placement, and
is accepted rather than widening the search for it.

**6. No new API version** (owner, 2026-10-26). Section 22 asks for one when an existing value
changes meaning, to protect a client that cannot be updated at once. `church_wide=true` sent below
Whole Church now answers `SCOPE_DENIED` where it widened the rows; no native client exists, and the
web client changes in the same release, so nothing relies on the old meaning. It narrows
authorization and is decided here rather than versioned.

**7. Decision 0303's bound and audit entry bind a request that asks for the church-wide
directory**, as before (owner, 2026-10-26): a Whole Church reader's pickers send it, and their
People screen, which never did, still does not.

**8. Section 3's duplicate-candidate lookup is unchanged** and still reaches the whole church, with
its limited fields and its audit entry (decision 0304). It is how a leader learns somebody is
already recorded under another branch, and narrowing it would let the same person be entered twice.

## Why

Three of the four church-wide pickers offered names that saving would refuse: a pastoral leader
outside the searcher's subtree on Add a Person, a new leader outside it on a reassignment, and
anybody already in another Cell on Add a member. The fourth case, adding somebody from another
branch who is in no Cell, let a Cell Leader take a person into their Cell without that branch's
leaders knowing. A new visitor is added under the leader who met them, so they are already in that
leader's tree; a person from another branch is better placed by the Admin, who sees both. And a
leader could reach the directory from outside the application whatever the screens did, which only
a refusal in the API closes.

## What this supersedes

Decision 0244 where it keeps the church-wide directory in the person pickers, and its consequence
in decisions 0274 and 0299 that those pickers search the church. Section 10's allowance that a
leader may add somebody from outside their own subtree to their Cell. Sections 8, 10, 13 and 22 are
amended.

Decision 0389, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 8, 10, 13 and 22.

Previous: [2026-10-25 — A Primary's own line takes its Network's colour](0388-a-primarys-own-line-takes-its-networks-colour.md)
