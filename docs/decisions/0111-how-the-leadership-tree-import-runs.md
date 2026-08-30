# 2026-08-24 — How the leadership tree import runs


Four questions §2's *Initial data load* leaves open and an import cannot avoid
answering. Settled before any code, and each amended into `SKILL.md` §2 in the same
change.

**A script, not an endpoint.** §22 makes a write endpoint record its idempotency
completion inside the transaction that performs the write, so a bulk import over
HTTP is a transaction of minutes holding one of the ten connections §24 bounds —
the liveness hazard that section names. A script calling the domain services in
process satisfies §2's "never as direct database writes" and answers to no request
timeout.

**The actor is named on the command line, verified, and worth less than it looks.**
The script takes an Admin account and refuses unless it holds `people.create` and
`people.manage_pastoral_assignment` at Whole Church. It is not authentication —
whoever can run the script can reach the database directly — and the ruling says so
rather than implying otherwise. What it buys is that the audit entries name an
account that could legitimately have done the work, and that an operator cannot
attribute several thousand records to a Leader. That is the argument §7 already
accepts for `SENIOR_PASTOR_PERSON_IDS`, re-derived rather than borrowed: the editor
already holds everything, so the control is about the honesty of the record.

It also refuses unless the initial-encoding phase is open, because a relaxation
reachable after its phase closed is not a temporary one.

**A row names its leader by `row_id`, never by name.** §3 makes a name not an
identity, a congregation of several thousand certainly holds two people who share
one, and the failure is silent and pastoral — a person under the wrong leader,
invisible until somebody asks why their attendance rolls up oddly. The cost is one
spreadsheet column prepared once. It also gives the dry-run report and the decisions
file the stable key they need, so the choice pays for the ruling below.

**The dry run writes nothing; adjudication returns as a file carrying a fingerprint
of the parsed input.** A file because §2 says *human* adjudication, and a file can
be sorted, emailed to the leader who actually knows whether those two are one
person, and returned. Database state was rejected: it needs a table, and §26 requires
every structure to be named and indexed — permanent shape for a phase that runs once.

The fingerprint is over the **parsed and normalized rows**, not the file's bytes.
Re-saving a spreadsheet changes quoting and line endings without changing a fact, and
a byte-level fingerprint would refuse a file nobody meaningfully touched.

**One transaction, no resume**, and the reason is not simplicity. A resumed run meets
the Persons its own earlier attempt created — each a Tier 1 candidate against the row
that created it — and §3 forbids adjudicating those inline because nobody is present.
Escaping that needs the batch and row recorded against every Person created, which is
permanent structure for a one-off phase.

*An earlier argument against one transaction — that §5's deferred triggers all fire
at `COMMIT`, so a cycle surfaces only after the whole run — was withdrawn on
inspection. Batching does not avoid the late verdict, it delivers it once per batch;
and at 3,000 Persons and 3,000 assignments the transaction and the deferred-trigger
queue are both unremarkable.* What answers it instead is putting the validation
burden on the dry run: cycles, the root count, leader references, sex and Network,
every edge. A commit should fail structurally only where something changed underneath
it.

Written to `SKILL.md` §2 (How the tree import runs) in the same change.

---

Decision 0111 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — The grant-making pair is never held by a Senior Pastor](0110-the-grant-making-pair-is-never-held-by-a-senior-pastor.md) | Next: [2026-08-24 — Birthday is optional on a Person](0112-birthday-is-optional-on-a-person.md)
