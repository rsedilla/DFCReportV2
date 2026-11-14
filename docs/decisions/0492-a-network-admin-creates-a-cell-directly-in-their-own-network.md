# 2026-11-14 — A Network Admin creates a Cell directly in their own Network, as the Admin does

Owner ruling, 2026-11-14, from screenshots of a Network Admin's *Cells* page on a phone and a
laptop, today beside the change. Bishop Oriel asked for it: each Network needs somebody
accountable for setting up its Cells. The owner's words: the Admin's *New Cell* is "the same as the
network admin in men and women".

## The ruling

**1. A Network Admin has the Admin's *New Cell*, for their own Network.** On the *Cells* page the
button sits where the Admin's does, and `/cells/new` opens for them. They create a Cell and its
leadership directly, without a request, for a leader whose Network is theirs. This replaces
decision 0469's line that direct creation stays with the Admin.

**2. On the Admin's terms, and no wider.** Only while initial encoding is open (Section 2): when
the Admin closes it, *New Cell* stops for the Admin and the Network Admins alike, and every new
Cell then comes through request-and-approve, which a Network Admin already decides for their own
Network. The checks are the Admin's: the leader is current, not archived and not absorbed by a
merge, is not a Network Admin, and one leader's Cells start at least two hours apart.

**3. How the server decides.** `POST /api/v1/cells` asks that `cell.approve_leadership` is held.
Held at Whole Church, the Admin's path runs as before: `cell.manage_leadership` at Whole Church
and the `ADMIN` role. Held across a Network, the actor must hold the `NETWORK_ADMIN` role, and both
capabilities must cover the leader, read inside the transaction after the leader's lock so the
leader's Network is the one in force at the write. Held only over a branch, as *Approves Cells*
gives it, the request is refused `SCOPE_DENIED`, as it was.

**4. A refusal says nothing about the other Network.** A leader outside the Network Admin's
Network, and an identifier naming nobody, are both answered `SCOPE_DENIED`, before anything is
said about the person, so the refusal does not tell whether somebody exists there or is archived
(Section 8, decision 0390). A two-hour clash names only Cells the asker may see.

**5. The record names who created it.** The Cell's audit entries carry the Network Admin as the
actor, as they carry the Admin, which is the accountability the ruling is for.

## Why

The Admin cannot set up every Cell of a church this size alone, and Bishop Oriel wants each
Network to have someone answerable for its Cells. The two-step approval exists so that nobody
approves a Cell that counts in their own favour; a Network Admin stands outside the pastoral tree
and is in no count of people, so that reason does not reach them, as it did not reach the Admin.

## What it does not change

Who approves a request, which a Network Admin already did for their own Network. The Admin's home
page keeps its *New Cell* link for the Admin alone. *Created in error*, backdating and the tree
import stay the Admin's. An explicit grant of either capability on a Leader's account gives no
*New Cell*. No figure moves.

---

Decision 0492, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 2, 7 and 10.

Previous: [2026-11-14 — The Senior Pastors' *Cells* and *Services* open on their own Network, and every Network switch reads *Men* · *Women* · *Both*](0491-the-senior-pastors-cells-and-services-open-on-their-own-network.md)
