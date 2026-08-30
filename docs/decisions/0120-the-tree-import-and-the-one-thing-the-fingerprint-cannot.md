# 2026-08-26 — The tree import, and the one thing the fingerprint cannot bind


The import section 2 specifies, built in the two phases it requires. Most of it is
section 2 followed rather than decided; four things were not settled by it and are
recorded here.

**`settings` gets a reader, and it is a sub-module of `admin`.** Migration 0002
created the table and seeded `initial_encoding_open` on 2026-08-22, and nothing had
ever read it — so the flag that bounds every relaxation of the encoding phase was,
until now, a value with no consequence. `SettingsService` lives in
`src/admin/settings/`, owns the table, and imports nothing.

The seam is not tidiness. `PeopleImportService` refuses unless the phase is open,
and the import that calls it lives in `admin` — so a phase reader packaged with the
import would put `people → admin` and `admin → people` in the graph at once. That
is the same shape, and the same remedy, as the 2026-08-24 authorization seam: what
`people` needs is a question, not a module full of operations. The 2026-08-24
intra-module ruling is what makes it admissible, and table ownership is unaffected.

**Only the read exists, deliberately.** Closing the phase is an audited Admin action
(section 2) under `settings.manage`, which is an endpoint, and `docs/ROADMAP.md`
puts it in Stage 7. Writing the setter now means writing its authorization as a
comment.

**A missing setting row raises rather than defaulting.** Migration 0002 seeds both
keys so the application never invents a default, and the two directions are not
symmetric: answering `false` presents an unmigrated database as a closed phase, and
answering `true` presents it as an open one — a relaxation with no end, which is the
failure the phase flag exists to prevent.

**The per-row writes are their own service, `PeopleImportService`.** What it offers
is Person creation with **no duplicate gate and no idempotency claim**, which is
legitimate — section 3 forbids adjudicating a Tier 1 candidate with nobody present,
and section 2 moves that decision into the decisions file — and is not something to
put in the file whose job is enforcing section 3. Both write methods refuse on their
own account, following `createSystemAdministratorWithin` and `createFirstAdminWithin`
rather than trusting the one caller, because these are public on a service the
injector resolves.

**`USE_EXISTING` writes `pastoral_assignment.transferred` with a null previous
leader.** Section 21's list is open and its convention is `<noun>.<past-tense verb>`,
so a `pastoral_assignment.opened` would conform — and it would split the one question
a reader asks of this log, *who has led this person*, across two action names for no
gain. A Person created by the import records its leader inside `person.created`,
exactly as `PeopleService.create` does; only an existing Person needs an entry of its
own.

**The fingerprint binds the file and not the database, and the gap that leaves is
stated rather than closed.** The commit re-runs the matcher, which it must do anyway
to know which rows carry a Tier 1 candidate. Where that gives a row its *first* such
candidate, the decisions file is blank or silent for it and the commit refuses — the
"something changed underneath it" case section 2 leaves room for, and it is pinned by
a test that creates a Person between the dry run and the commit.

Where the row already carries a decision, it is **not** caught. Section 2's decisions
file has no candidate column, so a `CREATE` records "I looked at this row's candidates
and decided create" against a candidate set nothing pins — and a new Tier 1 candidate
arriving for an already-decided row is created past an acknowledgement made about
somebody else.

Closing it means adding structure section 2 does not describe: a per-row digest of the
candidate identifiers, carried in the file and compared at commit. That is not
obviously wrong and it is not obviously worth it — the import runs once, on a spine of
thirty rows, against a database whose only other Person is the administrator. It is
listed as open below rather than decided in passing, and the code says so where
somebody would otherwise assume the fingerprint covers it.

**Two smaller things, both section 2 read literally.** The walk is breadth-first from
the roots rather than file order, because a disciple's edge names a leader who must
already exist and the file is in whatever order a spreadsheet held; a row unreachable
from a root raises rather than reporting a finding, because the validator has already
refused cycles, unresolved leaders and a root count other than two, so reaching that
branch means the validator and the walk disagree. And a dry run given `--decisions` is
refused rather than ignoring the file, because a run that appears to be checking
something and is not is worse than one that says no.

---

Decision 0120, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-26 — The bootstrap's two service methods guard themselves, and `ts-node` ships](0119-the-bootstraps-two-service-methods-guard-themselves-and-ts.md) | Next: [2026-08-26 — The import's actor must hold ADMIN, and four other findings from the review](0121-the-imports-actor-must-hold-admin-and-four-other-findings.md)
