# 2026-11-11 — A Network root's account stays with the Admin

Owner ruling, 2026-11-11, on a question `architecture-guardian` raised reviewing the build of
a Network Admin's account powers (decision 0469, point 3). It amends Sections 6 and 7.

## The ruling

A Network Admin's `accounts.manage` and `roles.manage` do not reach a Network root's account,
whatever role it holds. They do not give a root an account, read a root's account, see it in
the Accounts list or its counts, or change it by any route. The whole-church Admin does all of
that.

## Why

Section 7 already says a Network root, "with or without an account, is read and never
changed", and lists edit, archive, restore and move. It also says a Network Admin reaches "an
account holding `LEADER` and no other role, whose Person is in their Network", and a root who
is not one of the two Senior Pastors the configuration names could hold exactly that. The two
sentences did not settle it between them.

A root is the head of the Network the Network Admin serves. Disabling that account, moving it
to another address or clearing its Full view is a change to the root, and the owner kept
every such change with the whole-church Admin.

Considered and rejected: admitting a root's Leader account as any other Leader account, which
reads the first sentence alone; and refusing the writes while listing the account, which
shows a row whose every control is refused.

## What is owed

Built with this ruling: the refusal on every account route, the list and the counts, each
with a test at the API layer.

---

Decision 0470, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 6 and 7.

Previous: [2026-11-11 — A Network Admin administers one Network from outside its tree](0469-a-network-admin.md)
