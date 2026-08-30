# 2026-08-25 — The tree is known centrally only to its first level, and no birthday is required


Two false premises in §2, found by trying to build the file the import consumes and
discovering it cannot exist. Both were mine to find earlier and were not; what found
them was asking the owner where the data actually lives.

**"The leadership tree is known centrally and is small" is not true of this
church.** §2 put the leaders below the Senior Pastors' direct disciples at "the low
thousands" and had Admin import them in one pass. In fact every leader keeps their
own record of the people under their care, and no central roster exists. The owner
holds his own branch and does not have, and has no standing to ask for, another
network leader's.

So the import loads the **spine** — the two roots and each root's direct disciples,
around thirty people — and everything below it is encoded by the leader who holds
it, level by level, as each is given a Cell and an account.

**That is not a workaround; it is the argument §2 already makes one level down.**
Cell members are encoded by their own Cell Leader because "nobody holds a central,
current list", because the leader who holds it is the one who knows it is current,
and because it doubles as their first real use of the application. Every word
carries to the tree itself. The boundary simply sits higher than §2 assumed.

**A birthday is no longer required, anywhere.** §2 required one of the import on the
stated ground that "the central record already holds one for every leader" — which
fails with the premise above. §3 governs, and §3's rule is the one that matters:
never fabricate one.

Requiring it would have been actively harmful rather than merely unachievable.
Thirty rows and a required field nobody can fill produces thirty invented dates;
two of those collide at Tier 1; Tier 1 blocks creation; and a real person is then
refused on the strength of a value nobody meant. §3 makes that argument at length
about email and again about birthdays, and this is the case it was describing.

The matcher's own argument does not bite here either. Two of the three Tier 1 rules
read a birthday, which is real reach across ten thousand people and none at all
across thirty of the most recognisable leaders in the church. Nobody creates a
second Bishop Oriel by accident.

**The validator reports a missing birthday as a warning rather than refusing the
file**, and the severity is the rule rather than a convenience: refusing it is the
surest way to have the field filled with something.

**The cost is stated in §2 rather than discovered.** The initial-encoding phase now
lasts as long as the cascade does — months, not an afternoon — and it holds one
relaxation open throughout: Admin creates Cells directly, without request-and-approve
(§10). A relaxation held open for months is a larger thing than one held open for a
day. It is still bounded by the audited Admin action that closes it, which is what
the 2026-08-20 ruling required of it, and by nothing else.

**One stale cross-reference is deliberately left alone.** Migration `0007`'s header
says the import still requires a birthday. It is merged and applied, and only `0001`
may be corrected in place (ruling of 2026-08-21), so it stands and is corrected
here. §3's own cross-reference, `docs/TREE_CSV.md`, the validator and
`docs/ROADMAP.md` are all amended in this change.

Written to `SKILL.md` §2 (*Initial data load*) and §3, and verified by grep rather
than asserted.

---

Decision 0115, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-25 — A root has a seat, and a nullable leader could not say what it meant](0114-a-root-has-a-seat-and-a-nullable-leader-could-not-say-what.md) | Next: [2026-08-25 — A generational suffix lives in `last_name`, and a title lives nowhere](0116-a-generational-suffix-lives-in-lastname-and-a-title-lives.md)
