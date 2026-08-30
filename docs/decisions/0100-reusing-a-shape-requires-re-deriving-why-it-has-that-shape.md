# 2026-08-23 — Reusing a shape requires re-deriving why it has that shape


`SKILL.md` §25 gains rule 19, the only rule there about the act of writing rather
than about the domain. It is earned rather than general advice: it is the mistake
this log has now recorded seven times, and three of them happened on one branch.

The three on Stage 2 step 6, each of which looked right at the call site:

- **§4's backdate floor was adopted whole.** Its term (b) reaches closed rows in
  either direction *because the trigger it guards selects edges both ways*. A
  reassignment fires a different trigger, which reads only the row being written,
  so the reason does not carry — and carrying it anyway refused a legitimate
  correction for every leader who had ever had a disciple moved.
- **An executor was threaded through a call chain** to make reads honour a
  caller's transaction, and stopped one frame short: the predicate read the
  account's grants before evaluating any scope, so it kept touching the pool
  however many executors it was handed. The comment above it asserted the opposite.
- **A test copied from a working lock test** did not dispatch its request. The
  supertest object is lazy; the original handled that and the copy did not, so the
  probe correctly found no waiter. This repository had already fixed that exact
  defect once, in `19dfe3c`.

The earlier four are the backdate floor's first version, the zero-length row, Nest's
status ordering, and the §8 redaction — all recorded as "a mechanism described from
the part of it being looked at", which is the same fault in the reading direction
rather than the writing one.

**What makes the rule usable is that the check is one sentence and is answerable**:
*this had that shape because X; does X hold here?* Nothing detects a breach — not a
type, not a constraint, not a passing test — which is why it is written down rather
than left to care.

---

Decision 0100, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — The application runs at READ COMMITTED, and that is now load-bearing](0099-the-application-runs-at-read-committed-and-that-is-now-load.md) | Next: [2026-08-23 — Identifier normalization is global, and a pastoral leader has one field name](0101-identifier-normalization-is-global-and-a-pastoral-leader-has.md)
