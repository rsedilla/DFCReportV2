# 2026-10-07 — The current tree may be held in memory, checked on every request

A load test on 2026-10-01, with 1,000 leaders, put about a third of database time on
rebuilding who is under whom; the result is on the pilot checklist rather than in this
repository. Almost every request walks the current pastoral tree in the database: the
permission check asks whether one person is within another's subtree, and the Record lists
and the reassignment screen walk it too.

The owner chose to let the API keep a copy of the current tree in memory, and chose, from a
plain-words comparison, that every request confirms in the database that the tree has not
changed before answering from the copy. The alternative, refreshing the copy only after the
API's own writes, was faster by one small query and was set aside: permissions would run on
the old tree for a moment after each move, and a change made outside the API, or a second API
instance, would leave the copy wrong.

## The ruling

**1. The API may hold the current pastoral tree in memory**: every open
`pastoral_assignments` row, a Network root's included, with nobody filtered for being
archived or merged. It answers three questions only: a person's whole subtree, the leaders
above them, and whether one person is within another's subtree. Network membership is not
part of it. Section 2's statelessness holds, because any instance can build it.

**2. An answer from the copy is never older than the database read it replaces.** Before
each answer the database is asked whether the tree has changed since the copy was built, and
the copy is rebuilt first if it has, so a change committed by any route, by the tree import,
directly in the database or by a `TRUNCATE` is seen by the next answer on every instance. The
version never takes a value it has held before, including after a `TRUNCATE` of its own table,
and an absent version never matches a copy. A restore from a backup brings an old version
back, so every API instance is restarted after one.

**3. The copy holds committed state only**: it and its version are read in one snapshot,
outside any transaction a request has opened.

**4. A tree read inside a transaction reads the database, never the copy**, lock or no lock,
so a transaction sees its own writes and section 24's lock-then-decide mechanisms are
unchanged.

**5. Each answer refuses a cycle exactly when the database walk for that question would**
(section 5), and every walk of the copy terminates. A cycle refuses only the answers whose
walk reaches it, and no walk from a Network root reaches one.

**6. Only the current tree is held.** A walk at an instant, and section 20's placement graph,
stay in the database.

**7. How the copy is kept and checked is the code's,** reviewed against the tests section 24
names. Ruling 0320 is the reason: two of the three reviews of a locking mechanism described in
prose each found a race in it, and a test can fail where prose cannot. Any table the check
needs is named in section 26 with the build and owned by `hierarchy`.

---

Decision 0321, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-06 — A stored month is cleared by what can move it](0320-a-stored-month-is-cleared-by-what-can-move-it.md)
