# 2026-11-12 — A Network Admin's reach over a Sunday follows the person's Network now

Owner ruling, 2026-11-12, on a question raised while a Network Admin's recording powers were
built (decision 0469, point 5). It amends Section 7.

## The ruling

Where a person's sex is corrected while a week is still open, they move to the other Network
(Section 4). **The Network Admin of the Network they are in now records and corrects their
DCC line for that Sunday, and the Network Admin of the Network they left does not.**

## Why

Decision 0469 gives a Network Admin "their own Network" and does not say which instant
decides it for a Sunday already past. A DCC checklist is walked as of the Sunday (Section 9),
while `dcc.take_attendance` resolves as of now (Section 7), so the two could have been read
either way.

The owner was shown both and chose the Network the person is in now. A Network Admin's reach
is then one thing on every screen: the people of their Network today.

Considered and rejected: the Network the person was in on the Sunday, which would leave a
Network Admin recording for somebody they can no longer open.

## What is owed

Nothing on the server, which was built this way and is pinned by
`network-admin-recording.e2e.spec.ts`. The checklist that Sunday was on belongs to a leader
of the Network the person left, so the Network Admin of the new Network is not told whose it
is and no screen leads them to the line; the Admin reaches it from that checklist.

---

Decision 0474, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 7.

Previous: [2026-11-11 — A Network Admin's Cell powers reach every Cell of their Network](0473-a-network-admins-cell-powers-reach-every-cell-of-their-network.md)
