# 2026-08-24 — "Never by layer" is about modules, not about files inside one


Escalated as a Stop Condition by `architecture-guardian`, twice, on the branch
splitting `people.service.ts`. §2 says "Organise by module, never by layer" and
gives as its example a `controllers/`/`services/`/`entities/` tree — which is a
statement about how the *application* is divided. The split cited that sentence as
governing the seams **inside** `people`, and four of its five services are named
for operations while `PeopleReadService` is named for the reads.

**§2 governs module layout and reaches no further.** How one module arranges its
own files is a judgement for whoever writes it.

Two things decide it. The boundary §2 actually enforces is **table ownership** —
that is what gives the §5 invariants one home, and it holds however many files a
module has, because none of them can touch a table the module does not own. And the
failure the rule names is a *module* that is a layer: that is the arrangement
leaving an invariant with four homes and no owner, and a read service inside one
module does not produce it.

The alternative was refusing the read seam and folding those methods back, which
buys nothing the rule was written to buy and costs the cleanest seam in the split —
the one part of `people` sharing no transaction, no lock, no idempotency claim and
no audit entry with anything else.

Recorded because it was unanswerable from the specification at the moment it was
needed. `people` is the first module large enough to need dividing, `cells` is next
in Stage 3, and an implementer reading §2 literally would have concluded the read
seam was forbidden. Written to `SKILL.md` §2 (Modules), which now says the rule does
not ask about intra-module seams, and why.

**The citation in the code softened with it.** `people.module.ts` claimed §2
*required* the split's shape; it now says the read seam is a judgement and names
table ownership as the thing actually enforced. A rule cited as a requirement where
it is silent is the same defect as a rule stated more strongly than the code keeps
it — both of which this branch corrected elsewhere.

---

Decision 0103, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — What an identifier's field name is, and the second walk over a body](0102-what-an-identifiers-field-name-is-and-the-second-walk-over-a.md) | Next: [2026-08-24 — Three rulings the accounts work needed, settled before the code](0104-three-rulings-the-accounts-work-needed-settled-before-the.md)
