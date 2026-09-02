# G12 Church Management - Claude Project Instructions

## Source of Truth
Before planning or implementing any feature, read the repository `SKILL.md`.

`SKILL.md` is the authoritative source for G12 ministry rules, terminology, permissions, reporting definitions, attendance rules, and organizational behavior.

If an agent instruction conflicts with `SKILL.md`, `SKILL.md` wins.

## Architecture Principles
The thirteen non-negotiable principles are in `SKILL.md` §1. The platform architecture is in `SKILL.md` §2. Read them there.

They are deliberately not restated here. A second copy goes stale the moment `SKILL.md` changes, and a partial copy is worse than none, because it reads as if it were the whole list.

Rules that belong to this file rather than to `SKILL.md`:

- Do not duplicate domain rules into agents, prompts, or code comments. Reference `SKILL.md` by section.
- When any other instruction disagrees with `SKILL.md`, `SKILL.md` wins (Source of Truth, above).
- A decision that changes or settles a rule is recorded as a numbered ruling in `docs/decisions/`, indexed under Decisions below, **and** amended into `SKILL.md` in the same change. All three, or the work is unfinished. A decision that lives only in a chat session does not exist.

## Agent Coordination
Two agents are defined in `.claude/agents/`. Everything else is done inline in the main session or through built-in skills.

- **architecture-guardian** — read-only review of a change against `SKILL.md` domain invariants. Reports findings; does not edit.
- **qa-engineer** — writes and maintains tests, and owns the authorization test suite below.

Built-in skills cover the rest. Use `/security-review` for security review, `/code-review` for correctness and cleanup, and `/run` to launch the app. Do not create agents that duplicate them.

Do not spawn builder agents for UI, frontend, backend, data, or reporting work. A subagent starts cold and must re-read `SKILL.md` before it can apply a single domain rule, which costs more than doing the work sequentially in one session that already holds the context. Delegate only where a cold, independent read is the point — that is review, not construction.

Git and GitHub operations are performed inline. Revisit a dedicated integration agent once a repository exists.

## Mandatory Review
A change **must** receive `architecture-guardian` review before it is considered complete when it does any of the following:

- changes authorization, capabilities, or pastoral scope
- changes the pastoral hierarchy, or how a subtree is resolved
- changes person lifecycle, archival, or merge behaviour
- adds or changes a reporting metric, or how any total is counted
- changes database schema, constraints, or a migration
- changes attendance recording, correction, or the applicable-meeting calculation

Copy edits, styling, and changes confined to a single screen with no domain-rule impact do not require it.

## Definition of Done

A change is not complete until it is verified.

- Domain rules added or changed in `SKILL.md` have corresponding tests.
- Reporting changes include a reconciliation test asserting `SKILL.md` §20: classification buckets and monthly-attendance buckets must each sum to the same unique-people total. A reconciliation failure is a data-integrity defect, not a rounding issue.
- Authorization is tested at the API layer, not only the service layer, because the API is the sole authority for authorization (`SKILL.md` §7).
- Invariants that can be expressed as database constraints are verified to exist as database constraints, not only as application code.

### Write endpoints

Four things a write endpoint owes, none of which anything detects. They are here
rather than only in `SKILL.md` §22 because a reviewer needs a list, and because
the three that concern the completion are invisible in a passing test suite.

- **It records its idempotency completion inside the transaction that performs
  the write** (`completeWithin`), never after it. Recording afterwards leaves a
  window where the write has committed and the claim has not been closed, and the
  claim lease then lets a retry perform the write again.
- **What it records is the response it returns.** A replay reproduces what was
  stored, not what was sent, so a divergence hands two identical requests two
  different answers. It follows that an endpoint must not commit its completion
  and then fail: the client would receive the failure while the store holds the
  success every retry replays.
- **The recording is the last statement in the transaction.** It takes the key's
  row lock, and a concurrent retry waits on that lock rather than being answered
  `REQUEST_IN_FLIGHT`.
- **It lets a lost claim abort the write.** `completeWithin` throws when it
  matches nothing; that exception is not caught and the transaction is rolled
  back. Swallowing it commits a write nothing recorded.

`api/test/api/idempotency.e2e.spec.ts` carries the exemplar to copy,
`records-its-own-completion`, and three probes that exist to break one rule each
so a test can catch it: `divergent-completion` records a body it does not return,
`rolls-back` fails after recording itself, and `slow-write` holds its transaction
open until its claim is taken. Each is labelled where it is written; none is the
shape to copy.

### Accessibility

`SKILL.md` §23 commits the web application to **WCAG 2.2 Level AA**. A conformance claim with nothing that can fail is a wish, so it is discharged in three parts.

- **The palette is checked on every build.** `web/scripts/check-contrast.mjs` computes 1.4.3 and 1.4.11 against the tokens in both themes and fails `npm run lint`. Contrast is decided by the palette, so a defect there is a defect on every screen at once, and no browser is needed to find it.
- **From the first real screen, axe-core runs in CI** over every route, and a violation fails the build. That arrives with Stage 2, because a browser harness for a placeholder page checks nothing. Automated rules catch only part of AA — treat a green axe run as the floor, not the ceiling.
- **A pull request that adds or changes a screen states how it meets the criteria automation cannot see**: keyboard operable end to end, with focus visible and the focused control never entirely obscured (2.4.7, 2.4.11); targets at least 24 by 24 CSS pixels (2.5.8); and, on the sign-in path, paste and password managers unobstructed (3.3.8). §23 names these alongside the two the contrast check covers.

Conformance concerns whether a person can perceive and operate the interface. It never licenses encoding meaning in colour: §13, §17 and §19 forbid encoding meeting status, coverage or a leader that way, whatever its contrast ratio.

### Migration policy

Migrations touch the history that `SKILL.md` guarantees is preserved. Treat every one as capable of destroying it.

- **Additive by default.** New columns are nullable or carry a default.
- **Never `DROP` a column or table holding historical relationship or attendance data.** Deprecate in place and stop writing to it. A column removed from the specification is not thereby removable from the database.
- **Reversible, or explicitly marked irreversible** and escalated as a Stop Condition before it runs.
- **A backfill that sets an effective date is backdating** (`SKILL.md` §5). It requires the same authorization, a reason, and an audit entry. Defaulting `started_at` on existing rows silently rewrites every historical report.
- **Validate constraints against existing data before enforcing them.** Adding the partial unique index to a table that already holds two active assignments for one person aborts mid-deploy. Find and fix the data first.
- **Snapshot before, reconcile after** for any migration touching `pastoral_assignments`, `cell_memberships`, `cell_leaderships`, network assignments, or attendance. Re-run the `SKILL.md` §20 reconciliation test on completion.
- **Constraint DDL is written by hand.** No ORM generates partial unique indexes, constraint triggers, or cycle-safe recursive queries; keep the SQL in the migration history rather than outside it.

### Authorization test suite

Pastoral assignment is the highest-risk authorization surface in the system (`SKILL.md` §5, Changing a person's pastoral leader). These cases must be pinned by tests and must stay green.

Using the example tree `Raymond -> Manuel -> Mark`:

1. Raymond cannot pull a person from a sibling branch into their own subtree.
2. Raymond cannot push a person out of their own subtree to a leader they do not oversee.
3. Raymond cannot change their own pastoral assignment.
4. Raymond cannot change the assignment of anyone upline of them.
5. Assigning a leader under one of their own descendants is rejected as a cycle.
6. An assignment whose leader and person belong to different Networks is rejected.
7. Two active assignments for one person are impossible, including under concurrent writes.
8. Bishop Oriel can reassign within the Women's Network, and Pastora Geraldine within the Men's.
9. Reassigning a leader moves their whole subtree with them, and no descendant assignment row is rewritten.
10. An archived Person cannot be reassigned.
11. A non-Admin cannot backdate an assignment's effective date.

Case 7 must be exercised concurrently, not only sequentially — a sequential test passes against application-layer checks alone and will not detect a missing database constraint.

## Working in this repository

### Branches and pull requests

`main` is protected. Work on a branch and open a pull request. Direct pushes are blocked for everyone but an administrator, and an administrator pushing directly to `main` is bypassing the review this file requires.

Name branches with a type prefix and a short description: `spec/cell-lifecycle`, `feat/attendance-api`, `fix/subtree-cycle`.

**Run `architecture-guardian` before requesting human review**, not after. If the change meets any Mandatory Review condition above, run it yourself and resolve what it reports. Arriving at review with its findings already addressed is the point of having it; asking a reviewer to discover them is not.

**Then run it again on what you changed in response.** A batch of fixes breaks something about as often as new writing does — measured on this repository, across four passes on two pull requests, every fix batch introduced defects of its own, including one that reinstated the exact failure the specification warns about. A review of the original that is not followed by a review of the fixes has checked the version nobody merged.

A pull request needs one approval. Changes to `SKILL.md`, `.claude/`, `.github/`, `docs/`, `api/migrations/`, and any `CLAUDE.md` or `AGENTS.md` **at any depth** additionally require a code owner (`.github/CODEOWNERS`). The last two are unanchored deliberately: an agent instruction file inside an app directory is read by every agent working there, and anchored patterns would have let one merge with neither owner seeing it.

Resolve every conversation before merging. Approvals are dismissed when new commits are pushed, so push fixes before asking for re-review.

Keep a pull request to one coherent change. A branch carrying six unrelated decisions is a branch nobody reads carefully.

### Commits

```text
<type>(<scope>): <summary, imperative, <= 72 characters>

<body: why, not what>
```

Types:

- `spec` — a change to `SKILL.md`, the domain source of truth
- `docs` — README and other non-normative documentation
- `feat`, `fix`, `refactor`, `test` — application code
- `chore` — tooling, configuration, CI

Scope is optional and names the area: `spec(cells)`, `feat(auth)`, `fix(reports)`.

**The body matters more than the subject.** A domain rule almost always has a reason that the diff does not show, and in six months the reason is the only part anyone needs. Write why the rule exists, and what was considered and rejected. A body that restates the diff is wasted.

Cite the specification section a commit implements or amends.

One commit per coherent change. Do not mix a rule change with unrelated tidying.

### Secrets

**This repository is public.** Nothing secret belongs in it, including in history. A committed secret is compromised even after it is deleted, because the commit remains reachable.

- No credentials, tokens, connection strings, or keys in any file, at any time.
- Configuration comes from the environment. Commit `.env.example` with variable names and no values. Never commit `.env`.
- Test fixtures use invented data. Never real member names, birthdays, or mobile numbers — the church holds records for minors, and a fixture is as public as the rest of the repository.
- If a secret is committed, **rotate it first and clean history second**. Rotation is the fix; removing the commit is tidying.

### Running the project

Two applications, each with its own dependencies: `api/` (NestJS) and `web/` (Next.js). Node 22 or later, and Docker for the local database.

```bash
cp .env.example .env                 # POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
docker compose up -d                 # PostgreSQL 16, the minimum version (SKILL.md §5)

cd api && npm ci && cp .env.example .env
npm run migrate:up
npm run start:dev                    # http://localhost:3001/api/v1

# Two databases, not one. `npm test` truncates every table before every case, so
# the one it uses must never be the one holding data — the imported leadership
# tree, above all. Set TEST_DATABASE_URL to a scratch database and migrate it too:
#   DATABASE_URL=<the scratch url> npm run migrate:up
# Left empty it falls back to DATABASE_URL, which is right for CI and wrong here.

cd ../web && npm ci && cp .env.example .env.local
npm run dev                          # http://localhost:3000
```

`api/.env` and `web/.env.local` are not committed. `JWT_SECRET` must be at least 32 characters, and the application refuses to start without it rather than falling back to a default that would be wrong in production.

| Command | In | What it does |
| --- | --- | --- |
| `npm run lint` | `api`, `web` | ESLint. In `web` it also fails on an API route or a server action |
| `npm run typecheck` | `api`, `web` | `tsc --noEmit` |
| `npm run format:check` | `api` | Prettier |
| `npm test` | `api` | The suite that must stay green, the eleven authorization cases included. Needs a migrated database, and **truncates it before every case** — point `TEST_DATABASE_URL` at a scratch one |
| `npm run migrate:up` / `:down` / `:status` | `api` | Applies, reverts one, or lists migrations |
| `npm run validate:tree -- <file>` | `api` | Checks the leadership-tree CSV against everything decidable from the file alone. No database |
| `npm run import:tree -- --dry-run` / `--commit` | `api` | The two phases of the tree import (`SKILL.md` §2). `docs/TREE_CSV.md` carries the flags and what refuses a commit |
| `npm run bootstrap:admin` | `api` | Creates the first Admin account, once, and refuses while any account exists (§6) |
| `npm run build` | `api`, `web` | Production build |

There is no seed command. Section 2 of `SKILL.md` loads real data through the import flow rather than through fixtures, and test fixtures are built by the tests that need them.

Migrations are plain `.sql` files in `api/migrations/`, applied in filename order by `api/scripts/migrate.ts`. Each holds a `-- migrate:up` and a `-- migrate:down` section, and an applied migration is checksummed: editing one that has already run is refused, because the file and the database would otherwise disagree with nothing to say so. Write a new migration instead.

**One exception is in force, and it lapses per file.** A migration **not yet merged to `main`** may be corrected in place; one that has been merged is frozen and is corrected by writing a new migration. See the rulings of 2026-08-21 and 2026-09-01 below — the first granted this to `0001_foundations.sql` alone, and the second widened it to the fact the first was actually reasoning from. Rebuild your development database when the checksum refuses.

The line is merging rather than deployment because merging is the observable event: after it, the file is what every other branch builds from and what a reviewer has already read. Before it, a migration exists only on the branch writing it, and correcting the file there is cheaper and more honest than shipping a corrective migration for a defect found hours later in code nobody else has seen.

## Stop Conditions
Stop and request architectural clarification rather than inventing a rule when:
- `SKILL.md` does not define a required ministry rule.
- A requested change conflicts with an established rule.
- Authorization or pastoral scope is ambiguous.
- A reporting metric does not have an exact definition.
- A migration may destroy or rewrite historical data.

## Decisions

Rulings that shape the system and are not derivable from `SKILL.md` alone. Each entry records the decision, the date, and where it now lives in the specification.

This log is an index of rulings, never a substitute for `SKILL.md`. If a decision is here but not written into the specification, the work is unfinished.

The rulings are in `docs/decisions/`, one file each, numbered in the order they
were made. This index is what a reader scans; the file is where the reasoning is.
Adding a ruling means adding both, in the same change.

**They were written as one sequence and refer to each other positionally** —
"the ruling below", "the entry above", "superseded the same day". Nothing has been
rewritten to remove that language, because resolving each by inference is how a
false cross-reference gets introduced, and this log records enough of those
already. Each file carries previous/next links instead, so a positional reference
resolves exactly as well as it did in the single file and no better.

- 2026-08-19 — [Who may reassign a person's pastoral leader](docs/decisions/0001-who-may-reassign-a-persons-pastoral-leader.md)
- 2026-08-19 — [Senior Pastors may reassign across both Networks](docs/decisions/0002-senior-pastors-may-reassign-across-both-networks.md)
- 2026-08-19 — [Network roots](docs/decisions/0003-network-roots.md)
- 2026-08-19 — [Agent roster reduced to two](docs/decisions/0004-agent-roster-reduced-to-two.md)
- 2026-08-19 — [Cell meeting status extended to three](docs/decisions/0005-cell-meeting-status-extended-to-three.md)
- 2026-08-19 — [Cell monthly denominator](docs/decisions/0006-cell-monthly-denominator.md)
- 2026-08-19 — [Attendance submission window](docs/decisions/0007-attendance-submission-window.md)
- 2026-08-19 — [Facilitation is not leadership](docs/decisions/0008-facilitation-is-not-leadership.md)
- 2026-08-19 — [Sorting permitted, ranking prohibited](docs/decisions/0009-sorting-permitted-ranking-prohibited.md)
- 2026-08-19 — [Reporting time zone is Asia/Manila](docs/decisions/0010-reporting-time-zone-is-asia-manila.md)
- 2026-08-19 — [Development reports DCC VIPs and Cell VIPs separately](docs/decisions/0011-development-reports-dcc-vips-and-cell-vips-separately.md)
- 2026-08-19 — [A merge lowers past-period totals](docs/decisions/0012-a-merge-lowers-past-period-totals.md)
- 2026-08-19 — [Role catalog](docs/decisions/0013-role-catalog.md)
- 2026-08-20 — [Stack pinned: NestJS, PostgreSQL, Next.js as a pure client](docs/decisions/0014-stack-pinned-nestjs-postgresql-next-js-as-a-pure-client.md)
- 2026-08-20 — [Three client surfaces used concurrently](docs/decisions/0015-three-client-surfaces-used-concurrently.md)
- 2026-08-20 — [DCC has no meeting status](docs/decisions/0016-dcc-has-no-meeting-status.md)
- 2026-08-20 — [Cell membership workflow](docs/decisions/0017-cell-membership-workflow.md)
- 2026-08-20 — [Duplicate matching rules](docs/decisions/0018-duplicate-matching-rules.md)
- 2026-08-20 — [Member ID generation](docs/decisions/0019-member-id-generation.md)
- 2026-08-20 — [No "on behalf" for pastoral assignment](docs/decisions/0020-no-on-behalf-for-pastoral-assignment.md)
- 2026-08-20 — [DCC submission window](docs/decisions/0021-dcc-submission-window.md)
- 2026-08-20 — [Archiving a Person who leads a Cell](docs/decisions/0022-archiving-a-person-who-leads-a-cell.md)
- 2026-08-20 — [Migration policy](docs/decisions/0023-migration-policy.md)
- 2026-08-20 — [Cell lifecycle, and closure is declared](docs/decisions/0024-cell-lifecycle-and-closure-is-declared.md)
- 2026-08-20 — ["Qualifies as a leader" means current Cell Leader](docs/decisions/0025-qualifies-as-a-leader-means-current-cell-leader.md)
- 2026-08-20 — [DCC monthly buckets derive from N](docs/decisions/0026-dcc-monthly-buckets-derive-from-n.md)
- 2026-08-20 — [Dashboard rules](docs/decisions/0027-dashboard-rules.md)
- 2026-08-20 — [Mobile number is the only contact detail; no email on a Person](docs/decisions/0028-mobile-number-is-the-only-contact-detail-no-email-on-a.md)
- 2026-08-20 — [Responsible leader for DCC attendance](docs/decisions/0029-responsible-leader-for-dcc-attendance.md)
- 2026-08-20 — [Cell ID generation](docs/decisions/0030-cell-id-generation.md)
- 2026-08-20 — [Cell attendance records members only](docs/decisions/0031-cell-attendance-records-members-only.md)
- 2026-08-20 — [API conventions](docs/decisions/0032-api-conventions.md)
- 2026-08-20 — [Cell schedule is effective-dated](docs/decisions/0033-cell-schedule-is-effective-dated.md)
- 2026-08-20 — [DCC events are generated ahead, not lazily](docs/decisions/0034-dcc-events-are-generated-ahead-not-lazily.md)
- 2026-08-20 — [Notifications go to the two Senior Pastors and their direct leaders only](docs/decisions/0035-notifications-go-to-the-two-senior-pastors-and-their-direct.md)
- 2026-08-20 — [Attention threshold is one church-wide Admin setting](docs/decisions/0036-attention-threshold-is-one-church-wide-admin-setting.md)
- 2026-08-20 — [Network is assigned from sex, not proposed](docs/decisions/0037-network-is-assigned-from-sex-not-proposed.md)
- 2026-08-20 — [Closed months may be materialized](docs/decisions/0038-closed-months-may-be-materialized.md)
- 2026-08-20 — [Backups are daily, not weekly](docs/decisions/0039-backups-are-daily-not-weekly.md)
- 2026-08-20 — [Two capabilities were referenced but never named](docs/decisions/0040-two-capabilities-were-referenced-but-never-named.md)
- 2026-08-20 — [DCC attendance is face to face only](docs/decisions/0041-dcc-attendance-is-face-to-face-only.md)
- 2026-08-20 — [Submission rolls up to the nearest upline with an account](docs/decisions/0042-submission-rolls-up-to-the-nearest-upline-with-an-account.md)
- 2026-08-20 — [Recorded scale and initial data load](docs/decisions/0043-recorded-scale-and-initial-data-load.md)
- 2026-08-20 — [Cell creation is request then approve](docs/decisions/0044-cell-creation-is-request-then-approve.md)
- 2026-08-20 — [Admin creates the initial Cells](docs/decisions/0045-admin-creates-the-initial-cells.md)
- 2026-08-20 — [Cell creation workflow, hardened](docs/decisions/0046-cell-creation-workflow-hardened.md)
- 2026-08-20 — [Initial encoding ends by an audited Admin action](docs/decisions/0047-initial-encoding-ends-by-an-audited-admin-action.md)
- 2026-08-20 — [A DCC attendance record requires a pastoral leader](docs/decisions/0048-a-dcc-attendance-record-requires-a-pastoral-leader.md)
- 2026-08-20 — [A person who changes Cell mid-month reports under the new Cell](docs/decisions/0049-a-person-who-changes-cell-mid-month-reports-under-the-new.md)
- 2026-08-20 — [A rescheduled meeting takes its roster from the actual date](docs/decisions/0050-a-rescheduled-meeting-takes-its-roster-from-the-actual-date.md)
- 2026-08-20 — [Notifications go to the direct leaders and Admin, not the Senior Pastors](docs/decisions/0051-notifications-go-to-the-direct-leaders-and-admin-not-the.md)
- 2026-08-20 — [`settings.manage` for church-wide operational settings](docs/decisions/0052-settings-manage-for-church-wide-operational-settings.md)
- 2026-08-20 — [A mid-month schedule change is resolved per week](docs/decisions/0053-a-mid-month-schedule-change-is-resolved-per-week.md)
- 2026-08-20 — [A calendar week begins on Monday](docs/decisions/0054-a-calendar-week-begins-on-monday.md)
- 2026-08-20 — [Monthly attendance is measured over the membership window](docs/decisions/0055-monthly-attendance-is-measured-over-the-membership-window.md)
- 2026-08-20 — [Cell monthly attendance reports on members](docs/decisions/0056-cell-monthly-attendance-reports-on-members.md)
- 2026-08-20 — [A schedule change takes effect the following month](docs/decisions/0057-a-schedule-change-takes-effect-the-following-month.md)
- 2026-08-20 — [Cell monthly attendance reverts to attendees, with a separate roster view](docs/decisions/0058-cell-monthly-attendance-reverts-to-attendees-with-a-separate.md)
- 2026-08-20 — [Three reporting questions are deferred to implementation](docs/decisions/0059-three-reporting-questions-are-deferred-to-implementation.md)
- 2026-08-20 — [Nine modules, each owning its tables](docs/decisions/0060-nine-modules-each-owning-its-tables.md)
- 2026-08-20 — [Every required structure is named and indexed](docs/decisions/0061-every-required-structure-is-named-and-indexed.md)
- 2026-08-20 — [The guard checks one target; the rest is domain layer](docs/decisions/0062-the-guard-checks-one-target-the-rest-is-domain-layer.md)
- 2026-08-20 — [`read_only` is valid only on a read capability](docs/decisions/0063-readonly-is-valid-only-on-a-read-capability.md)
- 2026-08-20 — [Migrations are hand-written SQL, and there is no ORM](docs/decisions/0064-migrations-are-hand-written-sql-and-there-is-no-orm.md)
- 2026-08-20 — [An endpoint that declares no capability is denied](docs/decisions/0065-an-endpoint-that-declares-no-capability-is-denied.md)
- 2026-08-20 — [Invariant 4 answers `SCOPE_DENIED`, not `INVARIANT_VIOLATION`](docs/decisions/0066-invariant-4-answers-scopedenied-not-invariantviolation.md)
- 2026-08-20 — [The eleven authorization cases ship failing, in their own CI job](docs/decisions/0067-the-eleven-authorization-cases-ship-failing-in-their-own-ci.md)
- 2026-08-20 — [A Network change validates forward from its effective date](docs/decisions/0068-a-network-change-validates-forward-from-its-effective-date.md)
- 2026-08-20 — [Three enforcement gaps closed at the schema, not in prose](docs/decisions/0069-three-enforcement-gaps-closed-at-the-schema-not-in-prose.md)
- 2026-08-20 — [The unauthenticated surface is a closed list, and `read_only` is not a role concept](docs/decisions/0070-the-unauthenticated-surface-is-a-closed-list-and-readonly-is.md)
- 2026-08-21 — [Tailwind CSS, chosen while there is one page to convert](docs/decisions/0071-tailwind-css-chosen-while-there-is-one-page-to-convert.md)
- 2026-08-21 — [UI direction: headless primitives the repository owns, and no design-system framework](docs/decisions/0072-ui-direction-headless-primitives-the-repository-owns-and-no.md)
- 2026-08-21 — [WCAG 2.2 Level AA, with something that can fail](docs/decisions/0073-wcag-2-2-level-aa-with-something-that-can-fail.md)
- 2026-08-21 — [Twelve findings from the Stage 1 verification, and why they existed](docs/decisions/0074-twelve-findings-from-the-stage-1-verification-and-why-they.md)
- 2026-08-21 — [Migration 0001 may be corrected in place until first deployment](docs/decisions/0075-migration-0001-may-be-corrected-in-place-until-first.md)
- 2026-08-21 — [Simultaneous presentation of a refresh token is not reuse](docs/decisions/0076-simultaneous-presentation-of-a-refresh-token-is-not-reuse.md)
- 2026-08-21 — [`account_roles` gains `senior_pastor_slot`](docs/decisions/0077-accountroles-gains-seniorpastorslot.md)
- 2026-08-21 — [A row of an effective-dated table is never deleted](docs/decisions/0078-a-row-of-an-effective-dated-table-is-never-deleted.md)
- 2026-08-22 — [A sign-in landing inside a revocation's transaction survives it](docs/decisions/0079-a-sign-in-landing-inside-a-revocations-transaction-survives.md)
- 2026-08-22 — [Seven Stage 2 rulings, settled before any Stage 2 code](docs/decisions/0080-seven-stage-2-rulings-settled-before-any-stage-2-code.md)
- 2026-08-22 — [Four enforcement gaps found reviewing the Stage 2 rulings](docs/decisions/0081-four-enforcement-gaps-found-reviewing-the-stage-2-rulings.md)
- 2026-08-22 — [A Network change is refused while the person leads anyone](docs/decisions/0082-a-network-change-is-refused-while-the-person-leads-anyone.md)
- 2026-08-22 — [`people.correct_sex`, the twenty-fifth capability, Admin-only](docs/decisions/0083-people-correctsex-the-twenty-fifth-capability-admin-only.md)
- 2026-08-22 — [Idempotency covers the authenticated write surface, and applies by default](docs/decisions/0084-idempotency-covers-the-authenticated-write-surface-and.md)
- 2026-08-22 — [A claim and a response are bounded separately](docs/decisions/0085-a-claim-and-a-response-are-bounded-separately.md)
- 2026-08-22 — [A write endpoint records its idempotency completion in its own transaction](docs/decisions/0086-a-write-endpoint-records-its-idempotency-completion-in-its.md)
- 2026-08-22 — [`people.create`, and how a Tier 1 duplicate is refused](docs/decisions/0087-people-create-and-how-a-tier-1-duplicate-is-refused.md)
- 2026-08-22 — [Three rulings the `people` module needed, all found by review](docs/decisions/0088-three-rulings-the-people-module-needed-all-found-by-review.md)
- 2026-08-22 — [A duplicate candidate outside the viewer's scope carries no tier](docs/decisions/0089-a-duplicate-candidate-outside-the-viewers-scope-carries-no.md)
- 2026-08-22 — [Membership of a candidate list is itself a disclosure](docs/decisions/0090-membership-of-a-candidate-list-is-itself-a-disclosure.md)
- 2026-08-23 — [Six rulings the sex-correction route needed, settled before the code](docs/decisions/0091-six-rulings-the-sex-correction-route-needed-settled-before.md)
- 2026-08-23 — [Reading the Network-change trigger fired twice, which is what the section 4 floor is about](docs/decisions/0092-reading-the-network-change-trigger-fired-twice-which-is-what.md)
- 2026-08-23 — [Three rulings the review of the sex correction forced, and one gap it found](docs/decisions/0093-three-rulings-the-review-of-the-sex-correction-forced-and.md)
- 2026-08-23 — [The root is a row, and a person lock serializes the same-Network rule](docs/decisions/0094-the-root-is-a-row-and-a-person-lock-serializes-the-same.md)
- 2026-08-23 — [`RESOURCE_BUSY`, and why its status carries the rule](docs/decisions/0095-resourcebusy-and-why-its-status-carries-the-rule.md)
- 2026-08-23 — [Three corrections to the lock, and two rules that were never written down](docs/decisions/0096-three-corrections-to-the-lock-and-two-rules-that-were-never.md)
- 2026-08-23 — [An identifier is compared canonically, and the class was wider than the instance](docs/decisions/0097-an-identifier-is-compared-canonically-and-the-class-was.md)
- 2026-08-23 — [A backdated reassignment is bounded by §4's floor and one rule of its own](docs/decisions/0098-a-backdated-reassignment-is-bounded-by-4s-floor-and-one-rule.md)
- 2026-08-23 — [The application runs at READ COMMITTED, and that is now load-bearing](docs/decisions/0099-the-application-runs-at-read-committed-and-that-is-now-load.md)
- 2026-08-23 — [Reusing a shape requires re-deriving why it has that shape](docs/decisions/0100-reusing-a-shape-requires-re-deriving-why-it-has-that-shape.md)
- 2026-08-23 — [Identifier normalization is global, and a pastoral leader has one field name](docs/decisions/0101-identifier-normalization-is-global-and-a-pastoral-leader-has.md)
- 2026-08-23 — [What an identifier's field name is, and the second walk over a body](docs/decisions/0102-what-an-identifiers-field-name-is-and-the-second-walk-over-a.md)
- 2026-08-24 — ["Never by layer" is about modules, not about files inside one](docs/decisions/0103-never-by-layer-is-about-modules-not-about-files-inside-one.md)
- 2026-08-24 — [Three rulings the accounts work needed, settled before the code](docs/decisions/0104-three-rulings-the-accounts-work-needed-settled-before-the.md)
- 2026-08-24 — [Four rulings the accounts review forced, and the escalation that prompted them](docs/decisions/0105-four-rulings-the-accounts-review-forced-and-the-escalation.md)
- 2026-08-24 — [The authorization seam is its own module, and a cycle was the reason a rule was being broken](docs/decisions/0106-the-authorization-seam-is-its-own-module-and-a-cycle-was-the.md)
- 2026-08-24 — [Who the two Senior Pastors are is read from configuration, and checked twice](docs/decisions/0107-who-the-two-senior-pastors-are-is-read-from-configuration.md)
- 2026-08-24 — [Naming a Senior Pastor takes effect on the next restart](docs/decisions/0108-naming-a-senior-pastor-takes-effect-on-the-next-restart.md)
- 2026-08-24 — [An account holds at most one of `ADMIN` and `SENIOR_PASTOR`](docs/decisions/0109-an-account-holds-at-most-one-of-admin-and-seniorpastor.md)
- 2026-08-24 — [The grant-making pair is never held by a Senior Pastor](docs/decisions/0110-the-grant-making-pair-is-never-held-by-a-senior-pastor.md)
- 2026-08-24 — [How the leadership tree import runs](docs/decisions/0111-how-the-leadership-tree-import-runs.md)
- 2026-08-24 — [Birthday is optional on a Person](docs/decisions/0112-birthday-is-optional-on-a-person.md)
- 2026-08-25 — [The decisions file is a CSV, and the fingerprint is over trimmed fields in order](docs/decisions/0113-the-decisions-file-is-a-csv-and-the-fingerprint-is-over.md)
- 2026-08-25 — [A root has a seat, and a nullable leader could not say what it meant](docs/decisions/0114-a-root-has-a-seat-and-a-nullable-leader-could-not-say-what.md)
- 2026-08-25 — [The tree is known centrally only to its first level, and no birthday is required](docs/decisions/0115-the-tree-is-known-centrally-only-to-its-first-level-and-no.md)
- 2026-08-25 — [A generational suffix lives in `last_name`, and a title lives nowhere](docs/decisions/0116-a-generational-suffix-lives-in-lastname-and-a-title-lives.md)
- 2026-08-25 — [The first Admin account is a one-time command, and an administrator need not be in the tree](docs/decisions/0117-the-first-admin-account-is-a-one-time-command-and-an.md)
- 2026-08-26 — [A module's tables are never written by another, and read by one only where the query is rooted elsewhere](docs/decisions/0118-a-modules-tables-are-never-written-by-another-and-read-by.md)
- 2026-08-26 — [The bootstrap's two service methods guard themselves, and `ts-node` ships](docs/decisions/0119-the-bootstraps-two-service-methods-guard-themselves-and-ts.md)
- 2026-08-26 — [The tree import, and the one thing the fingerprint cannot bind](docs/decisions/0120-the-tree-import-and-the-one-thing-the-fingerprint-cannot.md)
- 2026-08-26 — [The import's actor must hold ADMIN, and four other findings from the review](docs/decisions/0121-the-imports-actor-must-hold-admin-and-four-other-findings.md)
- 2026-08-26 — [A check that reads what its caller handed it is not a check](docs/decisions/0122-a-check-that-reads-what-its-caller-handed-it-is-not-a-check.md)
- 2026-08-26 — [Advice printed at the moment of a decision, and a fix claimed but not made](docs/decisions/0123-advice-printed-at-the-moment-of-a-decision-and-a-fix-claimed.md)
- 2026-08-27 — [What the web client does with a refresh token, pending three rulings](docs/decisions/0124-what-the-web-client-does-with-a-refresh-token-pending-three.md)
- 2026-08-27 — [Every tab of one browser profile is one session](docs/decisions/0125-every-tab-of-one-browser-profile-is-one-session.md)
- 2026-08-27 — [`field-invalid` follows the field, not the error code](docs/decisions/0126-field-invalid-follows-the-field-not-the-error-code.md)
- 2026-08-27 — [An idempotency key belongs to a body, not to an attempt](docs/decisions/0127-an-idempotency-key-belongs-to-a-body-not-to-an-attempt.md)
- 2026-08-27 — [A re-presentation whose replacement was never used is a retry](docs/decisions/0128-a-re-presentation-whose-replacement-was-never-used-is-a.md)
- 2026-08-28 — [Membership and order disclose as loudly as fields did](docs/decisions/0129-membership-and-order-disclose-as-loudly-as-fields-did.md)
- 2026-08-28 — [Two engines, and the width argument gets something that can fail](docs/decisions/0130-two-engines-and-the-width-argument-gets-something-that-can.md)
- 2026-08-28 — [A pastoral path says which end is a root](docs/decisions/0131-a-pastoral-path-says-which-end-is-a-root.md)
- 2026-08-28 — [Three rulings before Stage 3, and a fourth withdrawn](docs/decisions/0132-three-rulings-before-stage-3-and-a-fourth-withdrawn.md)
- 2026-08-28 — [A Cell changes hands by request and approval, and a closure is never reversed](docs/decisions/0133-a-cell-changes-hands-by-request-and-approval-and-a-closure.md)
- 2026-08-28 — [The Cell schema, and a test that agreed with itself on one machine only](docs/decisions/0134-the-cell-schema-and-a-test-that-agreed-with-itself-on-one.md)
- 2026-08-29 — [Direct creation, and a subtree check where Section 2 asks for Whole Church](docs/decisions/0135-direct-creation-and-a-subtree-check-where-section-2-asks-for.md)
- 2026-08-29 — [A Cell is placed in the tree by its leader, and a move is two changes](docs/decisions/0136-a-cell-is-placed-in-the-tree-by-its-leader-and-a-move-is-two.md)
- 2026-08-29 — [Six rulings the closure endpoint needed, and two the review raised](docs/decisions/0137-six-rulings-the-closure-endpoint-needed-and-two-the-review.md)
- 2026-08-29 — [A second schedule change corrects the pending one](docs/decisions/0138-a-second-schedule-change-corrects-the-pending-one.md)
- 2026-08-29 — [The closure ordering and the closure floor, settled by running the database](docs/decisions/0139-the-closure-ordering-and-the-closure-floor-settled-by.md)
- 2026-08-29 — [Twelve findings on the closure, and the three the review escalated](docs/decisions/0140-twelve-findings-on-the-closure-and-the-three-the-review.md)
- 2026-08-29 — [Ten more on the fixes, and the one the fixes introduced](docs/decisions/0141-ten-more-on-the-fixes-and-the-one-the-fixes-introduced.md)
- 2026-08-29 — [Ten on the second fix batch, and the rule written with nothing that could fail on it](docs/decisions/0142-ten-on-the-second-fix-batch-and-the-rule-written-with.md)
- 2026-08-29 — [Seven on the third fix batch, and a 500 on a documented parameter](docs/decisions/0143-seven-on-the-third-fix-batch-and-a-500-on-a-documented.md)
- 2026-08-29 — [Five on the fourth fix batch, and a bound that moved underneath its payload](docs/decisions/0144-five-on-the-fourth-fix-batch-and-a-bound-that-moved.md)
- 2026-08-29 — [Four on the fifth fix batch, and a disjunction pinned with a member missing](docs/decisions/0145-four-on-the-fifth-fix-batch-and-a-disjunction-pinned-with-a.md)
- 2026-08-29 — [Five on the sixth fix batch, all of them what the batch said about itself](docs/decisions/0146-five-on-the-sixth-fix-batch-all-of-them-what-the-batch-said.md)
- 2026-08-30 — [A requester may decline their own request, and a decision is final](docs/decisions/0147-a-requester-may-decline-their-own-request-and-a-decision-is.md)
- 2026-08-30 — [Three small settlements from building step one of the request workflow](docs/decisions/0148-three-small-settlements-from-building-step-one-of-the.md)
- 2026-08-30 — [Section 10's "at any scope" was resting on a scope value](docs/decisions/0149-section-10s-at-any-scope-was-resting-on-a-scope-value.md)
- 2026-08-30 — [Ten on the request fix batch, and a fix claimed in the past tense that was never made](docs/decisions/0150-ten-on-the-request-fix-batch-and-a-fix-claimed-in-the-past.md)
- 2026-08-30 — [Four on the second fix batch, and a pin that pinned nothing](docs/decisions/0151-four-on-the-second-fix-batch-and-a-pin-that-pinned-nothing.md)
- 2026-08-30 — [Approval records the leadership and leaves the account pending](docs/decisions/0152-approval-records-the-leadership-and-leaves-the-account.md)
- 2026-08-30 — [Three rulings the approval endpoint needed, and a condition nothing could evaluate](docs/decisions/0153-three-rulings-the-approval-endpoint-needed-and-a-condition.md)
- 2026-08-30 — [A Network change is refused while the person leads a Cell](docs/decisions/0154-a-network-change-is-refused-while-the-person-leads-a-cell.md)
- 2026-08-30 — [The backdate floor gains two Cell terms, one per mechanism](docs/decisions/0155-the-backdate-floor-gains-two-cell-terms-one-per-mechanism.md)
- 2026-08-30 — [`DateStyle` is pinned by the connection, not inherited](docs/decisions/0156-datestyle-is-pinned-by-the-connection-not-inherited.md)
- 2026-08-31 — [A Cell leadership audit entry names the Cell](docs/decisions/0157-a-cell-leadership-audit-entry-names-the-cell.md)
- 2026-08-31 — [A stale premise under a cleanly taken lock is transient](docs/decisions/0158-a-stale-premise-under-a-cleanly-taken-lock-is-transient.md)
- 2026-08-31 — [A cursor that cannot be resolved is refused](docs/decisions/0159-a-cursor-that-cannot-be-resolved-is-refused.md)
- 2026-08-31 — [One API instance, and the skew bound waits for the second](docs/decisions/0160-one-api-instance-and-the-skew-bound-waits-for-the-second.md)
- 2026-08-31 — [The DCC calendar is advanced by a scheduled command](docs/decisions/0161-the-dcc-calendar-is-advanced-by-a-scheduled-command.md)
- 2026-08-31 — [A Cell meeting has no row until it is reported](docs/decisions/0162-a-cell-meeting-has-no-row-until-it-is-reported.md)
- 2026-08-31 — [A Cell meeting's responsible leader is frozen as of the meeting](docs/decisions/0163-a-cell-meetings-responsible-leader-is-frozen-as-of-the-meeting.md)
- 2026-08-31 — [A Cell submission versions the meeting; a DCC submission versions the person](docs/decisions/0164-a-cell-submission-versions-the-meeting-a-dcc-submission-versions-the-person.md)
- 2026-08-31 — [Four Stop Conditions the Stage 4 rulings raised](docs/decisions/0165-four-stop-conditions-the-stage-four-rulings-raised.md)
- 2026-08-31 — [Three more the second review of the Stage 4 rulings raised](docs/decisions/0166-three-more-the-second-review-of-the-stage-four-rulings-raised.md)
- 2026-08-31 — [Four more from the third review, including a key that was wrong](docs/decisions/0167-four-more-from-the-third-review-including-a-key-that-was-wrong.md)
- 2026-08-31 — [The closed-month back-fill is withdrawn](docs/decisions/0168-the-closed-month-back-fill-is-withdrawn.md)
- 2026-08-31 — [Four that the closed-Cell path produced](docs/decisions/0169-four-that-the-closed-cell-path-produced.md)
- 2026-08-31 — [The submission window runs through the whole of the 7th](docs/decisions/0170-the-submission-window-runs-through-the-whole-of-the-7th.md)
- 2026-08-31 — [Four rulings the DCC recording path needed, settled before the code](docs/decisions/0171-four-rulings-the-dcc-recording-path-needed.md)
- 2026-08-31 — [Who submits a person's DCC attendance, and where a root's is recorded](docs/decisions/0172-who-submits-a-persons-dcc-attendance.md)
- 2026-08-31 — [Seven settlements from building DCC recording](docs/decisions/0173-seven-settlements-from-building-dcc-recording.md)
- 2026-08-31 — [The fourth cursor, and the two that share a key](docs/decisions/0174-the-fourth-cursor-and-the-two-that-share-a-key.md)
- 2026-08-31 — [Eleven on the DCC recording review, and the one that was a disclosure](docs/decisions/0175-eleven-on-the-dcc-recording-review-and-the-one-that-was-a-disclosure.md)
- 2026-08-31 — [Eight on the fix batch, and the outcome that was a 500](docs/decisions/0176-eight-on-the-fix-batch-and-the-outcome-that-was-a-500.md)
- 2026-08-31 — [Six on the third pass, and a fix that was never applied](docs/decisions/0177-six-on-the-third-pass-and-a-fix-that-was-never-applied.md)
- 2026-08-31 — [The fourth pass found nothing behavioural, and one thing with teeth](docs/decisions/0178-the-fourth-pass-found-nothing-behavioural-and-one-thing-with-teeth.md)
- 2026-08-31 — [A symmetry that was not there, and the index a claim needed](docs/decisions/0179-a-symmetry-that-was-not-there-and-the-index-a-claim-needed.md)
- 2026-09-01 — [A migration is frozen by merging, not by its number, and two on the seventh pass](docs/decisions/0180-a-migration-is-frozen-by-merging-not-by-its-number.md)
- 2026-09-01 — [A port is optional and refuses, and the graph test asserts it is bound](docs/decisions/0181-a-port-is-optional-and-refuses-and-the-graph-test-asserts-it.md)
- 2026-09-01 — [A closed month is amended on the routes that record it, and §20 already said who invalidates](docs/decisions/0182-a-closed-month-is-amended-on-the-routes-that-record-it.md)
- 2026-09-01 — [A record closed with nothing replacing it names itself](docs/decisions/0183-a-record-closed-with-nothing-replacing-it-names-itself.md)
- 2026-09-01 — [A Cell meets on the day it was created, and the bound is a date at both ends](docs/decisions/0184-a-cell-meets-on-the-day-it-was-created.md)
- 2026-09-02 — [A date-only field that is not a day is refused at the edge, by one predicate](docs/decisions/0185-a-date-only-field-that-is-not-a-day-is-refused-at-the-edge.md)
- 2026-09-02 — [The capability decides a meeting's scope resolution, not the HTTP method](docs/decisions/0186-the-capability-decides-a-meetings-scope-not-the-http-method.md)
- 2026-09-02 — [A handover on a meeting's own day leaves the meeting with the outgoing leader](docs/decisions/0187-a-handover-on-a-meetings-own-day-leaves-the-meeting-with-the-outgoing-leader.md)

### Open — awaiting a ruling

**One item awaits a ruling, and it blocks Stage 5. Thirty-six other things are
unsettled, none of them blocking. They are listed at the end, so this section is the
whole of what is open.**

*Both numbers here are the same number and have to move together — this bolded sentence
and the italic below it. The batch that added the thirty-second bullet updated the italic
alone, because the instruction to recount lives only in the italic, and the bolded twin
is what a reader meets first. Anyone adding a bullet updates both.*

*Thirty-six distinct items across thirty-six bullets. **Three arrived on 2026-09-02** with the dated Cell-meeting scope, and **all three left the same day**, settled before slice 2c as decisions 0185, 0186 and 0187. One was found by its own suite failing on its first run: which leader a meeting belongs to when the Cell changed hands on the meeting's own day, which the date comparison section 13 requires at the closure boundary cannot decide — and which decides reporting attribution rather than only a scope answer, the first version of that bullet having said otherwise on a claim about the other two paths that was false of both. Settled as the earlier-starting row, on the one ground that is not a frequency claim: the other answer made a meeting's permanent attribution depend on whether the handover had been recorded when somebody filed it. **One item arrived with the fix batch for those three** and is below: §7 answers twice, and not identically, whether a closed Cell's last-leader fallback survives for a capability that resolves as a write. The second was found by architecture-guardian and **left on 2026-09-02**: whether a meeting-scoped roster read follows section 7's write rule or section 13's read rule, which disagreed on an ACTIVE Cell and which the code had settled in a port docblock rather than in the specification. Settled as decision 0186, and by neither of the two readings the bullet framed it between — the capability decides and the HTTP method does not, so a recording capability resolves as a write whether its route reads or writes. Behaviour is unchanged; what it removes is a rule living in a docblock. **The third left the same day it arrived**: what an API does with a date-only value that is well-shaped and is not a day, settled as decision 0185 before slice 2c, which adds more date-carrying routes than anything built so far. It closed with it the live defect that bullet had named — a Cell closure written effective on 2026-03-02 because `2026-02-30` was normalised rather than refused, with the response and the audit entry both reporting the invented day back. **One arrived and left on 2026-09-01**, which is the shortest any item on this list has lived: whether a Cell meets on the day it was created, found by a mutation on the Cell meetings listing rather than by a reviewer, and settled as decision 0184 before the recording slice that turns it from a display choice into a refusal. It counts, and the bound is a Manila date at both ends — the closing edge because section 13 requires it, the opening edge because a bound granular one way at one end and the other way at the other is two rules wearing one name. **Three others left the same day**, settled together before any Cell meetings code as decisions 0181, 0182 and 0183, and one arrived with them. Whether a port a module cannot bind for itself is optional-and-refuse or mandatory: optional and refusing, with the module-graph test asserting the binding resolves — which is what makes the cost the bullet named against optional disappear rather than be accepted. *Settled without its own trigger firing, and the first version of that ruling invented one: no second port is being declared, because `attendance → cells` is not a cycle and §2's ordinary service-interface rule covers it.* What a closed month's Admin amendment does: a flag on the two submit routes rather than a third endpoint, and **the half that looked blocked on Stage 5 was not** — section 20 says four lines below the clause that stored figures are keyed to a version of their source records rather than enumerated by the write paths that dirty them, so the amendment owes nothing and the obligation was always the snapshot's. That is the second time on this project a clause was called undefined while its own section defined it. And whether an attendance record may be closed with no replacement: the row names itself, and section 13 now states that as the idiom rather than as a workaround. The one that arrived is whether such an amendment may **create** a record for a person who had none, which moves a closed month's numerator while its coverage denominator is frozen. One arrived on 2026-08-31 with the `architecture-guardian` review of the DCC recording slice: whether a person may record their own DCC attendance, which `dcc.submit_on_behalf` permits today and no section addresses. One left on 2026-08-31 with the DCC roster, which is the fourth cursor the retired bullet said would settle it: two of the four page by the identical key and now share one pair in `common/roster-cursor.ts`, and the two whose keys differ keep their own — so it closed by being answered rather than by being dropped. One arrived on 2026-08-31 with the audit-target ruling, raised by the second architecture-guardian pass on it: what period a read of the audit log is asking about, which Section 7 leaves one layer in from a phrase it does define, and which three drafts of that ruling got wrong three different ways. That cursor item had arrived by being **found already claimed** — `leadership-request-cursor.ts` said the question was "recorded as open" and it was not, the sixth false "recorded as" claim on this project — and it is noted here because the claim outlived the thing it was false about by one day. Three left on 2026-08-31, settled together before any Stage 4 code and recorded above: which target a Cell leadership audit entry carries, answered as the Cell; what error code a refusal answers when a value read before a lock differs under it, answered by a question rather than by a list — could this same body, resubmitted unchanged, succeed? — which places six of the seven refusals on `RESOURCE_BUSY` and leaves the seventh an `INVARIANT_VIOLATION`; and what a collection endpoint does with a cursor it cannot resolve, answered by refusing it. (Seven, rather than the five the retired bullet claimed or the six a method-count gives: decision 0158 fixes the unit as one error-producing branch, this branch having counted it three ways before noticing. That aside is parenthesised because it interrupted the list of three above when it was not.) A fourth was narrowed rather than closed the same day and is still below: the instance count is settled at one, and the skew bound it was carrying is now owed by whatever change introduces a second instance. One arrived on 2026-08-30 with the `DateStyle` pin and was raised by the review of it: whether the isolation level should be pinned the same way, the ruling having assumed the two differed in kind on a belief that turned out false. One left on 2026-08-30 with the `DateStyle` pin, which settled it in the direction of both the answers that could fail: the pool pins it and the application refuses to start unless the pin took effect. One left on 2026-08-30 with the backdate floor's Cell terms, which settled what it asked: a closed Cell leadership bounds on its `ended_at`, and a closed Cell membership on its `started_at` extended to the last leadership start it spans. One arrived with the Network-change precondition — whether a port a module cannot bind for itself should be optional-and-refuse or mandatory — and left on 2026-09-01 with decision 0181, though **not** for the reason its own instruction gave. That instruction said to settle it before a second port is declared, and no second port is being declared: the ruling's first version claimed Cell meetings forces one, which the module graph refutes in a single command — `attendance → cells` is not a cycle, `CellsModule` already exports `CellsReadService`, and §2's ordinary cross-module rule covers it. What makes the ruling due instead is that the two ports already in the tree are injected optionally and **nothing asserts either is bound**, which is a gap rather than a hypothetical. Two arrived with the Cell leadership approval slice, both escalated by its first architecture-guardian pass: which kind of target a leadership audit entry carries, which left on 2026-08-31, and whether a request's `cell_id` should be frozen while it is PENDING, which has not. A third was *widened* rather than added by that slice's third pass — the error code a stale-premise refusal answers, which left on 2026-08-31 — and a batch that claimed to widen it duplicated it instead, which is why this sentence is one a reader should not trust without recounting. Three arrived with the leadership
request slice — the third being whether the application should pin the database session's
`DateStyle`, raised by the third review pass. The first two are: how a requester sees the outcome of a request they submitted, which
section 19 requires and section 7 names no capability for, and whether section 7 should
refuse a grant of `cell.request_leadership` wider than `SUBTREE_EXCL_SELF`. Both are
named here because the sentence whose job is the count named one of them and left the
other to be found by counting. Three arrived with the closure
endpoint's reviews — whether a Cell roster read deserves a capability of its own, what a
collection endpoint does with a cursor it cannot resolve, which left on 2026-08-31, and
whether a name has a
maximum length — and two left on 2026-08-30, both settled before the leadership-request
endpoints were written: a requester may decline their own request, and a decision is
final. A further
two left on 2026-08-29. Those two are the
pair that had come back: the closure effective-date floor and the cross-class lock
ordering, each written three times in prose and refuted three times, both settled by
the closure endpoint running the database rather than by a fourth formulation. The
outlive-closure question left with the floor, having been the thing the floor was
blocked behind. It said "twenty" from the day it was written through six commits that
added fourteen bullets without touching it, which is the miscount this log keeps
recording, committed against the sentence whose only job is the number. Anyone adding
a bullet updates it here, and counts rather than remembers:
`awk '/^### Open — awaiting a ruling/,0' CLAUDE.md | grep -c '^- \*\*'`.*

The two Stage 3 questions that stood here — how a Cell changes hands, and what reversing a closure does — were settled the same day by the ruling above: a handover goes through request-and-approve, and a closure is never reversed. Nothing in Stage 3 is now blocked.

The refresh-token question that stood here since 2026-08-27 — what a client does
with a presentation whose outcome is unknown — left this list the same week, settled
by the ruling above: a rotated token presented again, whose replacement was never
used, is a retry rather than reuse, inside a bounded window. The client behaviour it
describes stops being interim with it.

Nine items that stood here on 2026-08-22 were settled that day and are recorded
above. Seven were Stop Conditions for Stage 2, and the last two were opened and
closed the same day by `architecture-guardian` passes.

The `audit_log.action` vocabulary left this list on 2026-08-23, settled by the
ruling above: the convention is `<noun>.<past-tense verb>`, and section 21's list
stays open.

**What an aggregate Cell attendance view offers in place of buckets.** Monthly-attendance buckets are a Cell-scope view only, because N belongs to a Cell and aggregating across different N inflates `Completed` for the Cells that recorded least (`SKILL.md` §12). At leader and Network scope the spec offers unique people, classification and coverage, and does not say whether anything should replace the buckets. Settle it in Stage 5 against real data.

Two related questions have defined behaviour and are recorded in `SKILL.md` §12 as fairness questions rather than Stop Conditions: whether a leader should see someone who attended and has since left, and whether a mid-month joiner measured against the whole month is acceptable. An implementer follows the stated rules and does not stop on either.

**Unsettled, and not blocking anything.** None of these is a Stop Condition. An implementer proceeds and settles them in passing; they are listed here because a reader looking for what is open should not have to find it inside the body of a ruling.

- **What period a read of the audit log is asking about.** Section 7 resolves an audit entry through its target and resolves a Cell "through the Cell's leader as of the period being viewed, falling back to its last leader where the Cell is closed" — and it *does* define that phrase, under **An effective date does not move the scope decision**: the period a request under a **viewing** capability is asking about, everything else being "acted on now". *It read "the period a read is asking about" until 2026-09-02, and this bullet quoted those words as §7's for one commit after they stopped being. `audit.view` is one of the three capabilities §7 now names, so the phrase reaches this log by capability rather than by method — which changes nothing about the question below.* What is open is one layer in from there. A report asks about a month; a read of this log might be a single entry, which is an **instant**, or a filtered range, which is a range. Under the first, a Cell-targeted leadership entry resolves through whoever led the Cell when it was written — for `cell_leadership.opened` that is the person the entry names, so it never diverges from a person target. Under the second it resolves through whoever led the Cell across the range asked for. The two disagree about who may read a past leadership entry. Not blocking, and the distinction is worth keeping: **writing** an entry is identical under both, so the 2026-08-31 target ruling stands either way and Stage 4 may write freely; what the answer binds is the first route that **reads** the log, and `audit.view` has none. Nor is the code an answer yet — `CellsReadService.leaderForScopeWithin` resolves the latest leadership row and every Cell-scoped path goes through it, but `cell-scope.port.ts` says in terms that this is "the undated case rather than a claim that dates do not matter". *It also said a past-period read "will need a dated variant", and the branch of 2026-09-02 built one -- so that half of the quotation now survives in that file only inside the retraction recording that it was left standing one commit too long. **The trigger this bullet names has not fired, and for two days this paragraph said it had.** Decision 0186 settles that a meeting's scope resolution follows its capability rather than its HTTP method, so `leaderForMeetingScope` is a dated resolution serving a **recording** capability and is not a read in section 7's sense. The first dated read is still Stage 5's reporting, and this question still waits for it — a read asking about a period, which a report is whatever target it declares. That is a **different** trigger from the one `capability-scope-resolution.spec.ts` carries, which is a Cell-*targeted* viewing route and may never be a report at all; the two were one sentence for a commit.* Settle it with the first dated read, and note that the phrase governs every Cell-resolved target rather than the audit log alone. Raised by `architecture-guardian` after two drafts of that ruling asserted a divergence mechanism and a third called Section 7 silent.
- **Whether a person may record their own DCC attendance.** Section 9 makes a person's attendance their *direct pastoral leader's* obligation, so a person is never on their own checklist — the submitter walk starts at their leader. But `dcc.submit_on_behalf` at `OWN_SUBTREE` covers the actor themselves (`scopes.ts`: "The actor's pastoral subtree, including the actor"), so a line naming the actor is admitted today, written with their leader as responsible leader and themselves as `recorded_by`, and it completes their leader's coverage. Section 14 permits recording "on behalf of a downline leader within their pastoral subtree" and says nothing about oneself; section 5 has an explicit prohibition on acting on oneself for pastoral assignment and section 9 has no counterpart. Whether that is right is a pastoral question rather than a technical one: section 9 rests recording on "a leader knowing who was in the room", and self-reporting is a different basis. Not blocking — the record is honest either way and nothing is corrupted — and decision 0172 deliberately declined to settle what an actor may submit for beyond their own roster. Raised by `architecture-guardian` on the DCC recording slice.
- **Whether an Admin amendment of a closed month may create a record for a person who had none.** The ruling of 2026-09-01 settled where the amendment lives and what it owes for stored figures, and deliberately left this. Correcting a record that exists is plainly an amendment of the month; creating one raises that month's numerator while Section 13 freezes its coverage denominator at close, so the two halves of the coverage line stop coming from the same population. Not blocking, and not decidable here: it is a question about a figure, the figures are Stage 5, and the reconciliation test Section 20 requires is the thing that would show it. Settle it with the first closed-month report.
- **Whether a name has a maximum length.** Section 3 says a name may hold any character and is silent on how many. `persons.first_name`, `middle_name` and `last_name` are bare `text` with only not-blank checks; the create and edit DTOs bound each at 100 UTF-16 units, and the tree import — which writes through the services rather than through a DTO — bounds nothing. So 100 is an implementation choice on two paths rather than a property of the data. It surfaced because a pagination cursor carries two names, so its length is unbounded exactly where the name's is: no finite bound on `CURSOR_MAX_LENGTH` is provable, and the constant is a request-size guard rather than a derivation, which its docblock now says. Not blocking — the guard sits about four times clear of anything a validated path produces, and far beyond what the spine import carries. What would settle it is a stated maximum in section 3, enforced as a `CHECK` constraint (the Definition of Done: an invariant expressible as a constraint exists as one) and applied to the import; that is a domain rule with a migration attached, which is why it is not decided in a pagination file. Whoever settles it should also say whether the limit counts characters or UTF-16 units, since section 6 already had to make that distinction for a password and got it wrong once.
- **Whether section 7 should refuse a grant of `cell.request_leadership` wider than `SUBTREE_EXCL_SELF`.** Section 10's "no holder of the capability, at any scope, may name themselves" is now a domain check, so the rule holds however the grant is issued. What is unsettled is whether a wider grant should be refusable at all: section 7 permits Admin to grant beyond a role's defaults, `WHOLE_CHURCH_ONLY` refuses only grants that are too *narrow*, and neither section has a mechanism for a capability whose scope value carries a prohibition. A Whole Church grant of this capability is legal today and means strictly less than it appears to — the holder may name anyone in the church except themselves — which is defensible and is not what an administrator issuing it would necessarily expect. Not blocking, because the prohibition is enforced in the domain layer. Settle it if a second capability ever takes a scope value that carries meaning; one instance does not justify a general mechanism.
- **How a requester sees the outcome of a request they submitted.** Section 19 puts "the outcome of a Cell leadership request the user submitted, of either kind" in every user's own outstanding work, and section 7 names no capability for such a route. `cell.request_leadership` is `SUBTREE_EXCL_SELF`, so it resolves against neither the caller nor the church; `cell.approve_leadership` is Admin's alone and is what guards the queue; and section 7's no-capability exemption is narrower than it looks — its examples are "reading their own claims, signing out, ending their own sessions", which is the caller's *session* rather than rows their account created. Three answers look defensible and none is derivable: widen that exemption to an endpoint returning only rows the caller created, add a twenty-eighth capability, or read it under `cell.view_subtree` against an `actor` target — which is the shape `GET /people/duplicate-candidates` already uses for a church-wide read one domain over, so this is a new reading of an existing capability rather than an unbuildable surface. Not blocking, and the Admin queue built in this slice is the half approval actually needs — the requester's view is a dashboard tile and there is no dashboard yet. Settle it with the first screens, which is also when its shape will be visible.
- **Whether Section 7's closed-Cell fallback survives for a capability that resolves as a write.** §7's base bullet gives a Cell target "the Cell's leader as of the period being viewed, falling back to its last leader where the Cell is closed", and gives that fallback a reason tied to §10 and §15: a closed Cell keeps its history and its roster visible to the leader who led it. Its closed-Cell clause, one bullet down, says the opposite about the same case — "a closed Cell has none, so every write against one resolves through nobody… Nothing else does — not a membership, not a leadership, not a configuration change." Both are §7 and they disagree. The code implements the fallback for **every** Cell target: `leaderForScope` carries no `ended_at IS NULL` filter, deliberately and with a docblock saying so, and the writes are refused a layer in instead — `POST /cells/{id}/members` answers `INVARIANT_VIOLATION` on a closed Cell rather than `SCOPE_DENIED`. No Cell-targeted **write** is admitted on a closed Cell, and that was checked rather than assumed: membership, category, schedule and closure each answer `INVARIANT_VIOLATION` from an explicit branch, and removing a member answers `NOT_FOUND` — that last one refused by *data* rather than by a state check, since migration 0009's trigger leaves a closed Cell no open membership to remove. So the two readings differ only on **reads**, and on **two** live routes rather than the one the first version of this bullet named. `GET /cells/{id}/members` is the first: a read guarded by a management capability, which makes it the roster-capability item above reached from the other side, and giving that read its own viewing capability would let the base bullet govern it cleanly. **`GET /cells/{id}/meetings` is the second, and no roster-capability ruling touches it.** It carries `cell.take_attendance` against a `cell` target — deliberately, on §7's own argument that requiring a management capability to reach an attendance surface is what must not happen — so it is a recording capability under decision 0186 and the closed-Cell clause would deny it, while the base bullet admits the Cell's last leader. A green case pins the admission (`cell-meetings-listing.e2e.spec.ts`, the closure-boundary case, which lists as the former leader of a closed Cell). It is also the harder half: `leaderForScope` is undated and consults no submission window, so that admission survives **after the month's window shuts**, where §7 says of the meeting exception that "once the window shuts, that too resolves through nobody". Whether a Cell-targeted *listing* under a recording capability keeps the fallback past the close is the part §7 does not decide at all. Not blocking. Decision 0186's discriminator decides which of the two *resolutions* a capability gets and deliberately does not touch the fallback; the tension predates it. Raised by `architecture-guardian` on the fix batch for that ruling, which had worded the default as though it decided this, and widened by the pass after that, which found the bullet naming one route where there are two — the second being the one its proposed dissolution does not reach.
- **Whether reading a Cell's roster deserves a read capability of its own.** `GET /api/v1/cells/{id}/members` is guarded by `cell.manage_membership`, resolved against the Cell — the same target its write routes declare, chosen because §7 declares its capability list closed and inventing a name for a read is not available. The consequence is client-visible and one-directional: §7 makes `read_only` valid only on a read capability, so a grant of `cell.manage_membership` cannot be issued read-only, and nobody can be given roster visibility without also being given the power to change the roster. That is strictly more restrictive than the alternative rather than a leak, which is why it was safe to ship. What would settle it is the first screen that wants to *show* a Cell's members to somebody who should not move them — a report view, or an upline leader reviewing a branch — and Stage 5's reporting reads will ask the same question about every Cell-scoped read at once. Settle it there rather than for this route alone.
- **What category a closed Cell has, for a report inside the month it closed.** Section 10 requires historical reports to use "the category valid at the time being reported", and the closure ruling of 2026-08-29 makes a closure end the open category row on its effective date. So a Cell closed on 10 March has no category row valid at 31 March, and Section 12 evaluates classification as of the end of the reporting month. Contained today rather than broken: Section 10 says every count of Cells and Cell categories means active Cells unless a report says otherwise, so nothing currently asks the question. Three answers look defensible — read the last category the Cell held, treat a closed Cell as having none and exclude it, or evaluate the category as of the closure date rather than the month end — and choosing between them wants a real report in front of it. Settle it in Stage 5 with the reporting queries, and note that the same question does **not** arise for the schedule row, whose closure is the point: a closed Cell must stop deriving scheduled meetings.
- **Whether the archived-and-merged refusals should be database constraints.** Section 10 gained three refusals on 2026-08-29 — an archived Person, a merged Person, and somebody already in the Cell — and the first two are the same rule `assertLeaderIsAssignable` enforces for a pastoral edge. Both are application-layer checks: contrary to what Section 10 said when the question was first written, `pastoral_assignments` carries **no** constraint for archived-or-merged either, so there is no asymmetry and the question is whether *either* should become one. The Definition of Done says an invariant expressible as a constraint exists as one, and this one is expressible — a membership under an archived Person is the corruption Section 3 refuses when archiving somebody who leads a Cell, reached one relationship over. What argues the other way is that both facts live in `people`'s tables while the constraint would sit on `cells`', so it is a trigger reading across a module boundary rather than an index. Not blocking: the checks refuse today and answer `INVARIANT_VIOLATION`; what a constraint would add is enforcement under a restore, which is the argument the Senior Pastor slot and the root seat both turned on.
- **Whether a path identifier should be validated as strictly as one in a body.** `class-validator`'s `@IsUUID()` pins the version and variant nibbles and is on every DTO; `isUuid` — the repository's own predicate, used by the guard and by `UuidParamPipe` — does not. So `POST /cells/{id}/members` refuses as `person_id` a value the `DELETE` beside it accepts in the path. Every identifier in the database is a v4 and PostgreSQL's `uuid` takes both, so nothing is broken; what is unsettled is which predicate the API means, and Section 3's provision for a client-generated Person UUID is the case that would decide it.
- **Whether the nil UUID should be reserved.** Two call sites now hand `authorize` `00000000-0000-0000-0000-000000000000` — the capability guard, for a Cell it cannot place, and `CellsLeadershipRequestService`, for a handover whose Cell must not be shown to exist; the constant is shared in `common/identifiers.ts` rather than copied. It is handed over as the target of an object the caller cannot be shown to exist, so that an absent Cell refuses exactly as an out-of-scope one does. Nothing today can create a Person with that identifier — no endpoint accepts a client-supplied `id`, and every column defaults to `gen_random_uuid()` — but nothing forbids it either, and a Person holding it inside an actor's subtree would make every unplaceable Cell "covered" for that actor. The sentinel-free equivalent is to let the port's null reach `scopeCovers` the way `personBehind` already does for an absent Account. Settle it if Section 3's client-generated identifier is ever built.
- **What Section 8 permits a refusal to reveal by its existence.** The source-Cell refusal no longer names a Cell or asserts a membership, but its *shape* still carries one bit: with the actor authorized over their own Cell and any `person_id` in the church — and Section 8 publishes every Person's identifier church-wide — a 403 means that person holds a membership somewhere the actor cannot see, and a 201 means they do not. The quiet outcome is the hit and the loud one is the miss, which is the reverse of the arrangement the 2026-08-22 create-probe ruling was willing to accept, and that ruling closed the leak rather than resting on loudness. This one cannot be closed by redacting anything: the refusal is required by the authorization rule itself. The source-Cell reading it used to defer to was settled by the closure pre-flight above, which did not answer this: what a refusal may disclose by *existing* is still open, and is now the last part of that question standing.
- **Whether "Admin" in Sections 2 and 10 is a role requirement or a description of who holds the capabilities.** Section 2 settled this once, for the tree import, in the direction of "the role is required, and the capabilities alone are not enough" — and stated it in that paragraph rather than as a general rule. Direct creation is given to Admin in the same section and again in Section 10, and slice 2 reads it the same way and checks the role. If that reading is right, the two places should say it in the words Section 2 already uses for the import, because the next reader derives it from a neighbouring paragraph or not at all. If it is *not* right, then Section 7's permission to grant `cell.approve_leadership` explicitly makes request-and-approve optional for its holder over their own subtree, and Section 10 needs to say why that is acceptable. Nothing is blocked either way: the conservative reading is what is implemented.
- **Whether a Cell's first leadership row may be corrected to a leader of the other Network, and whether a closed leadership row may be written at all.** Two halves of one question, both raised by the fourth review pass. Migration 0009 refuses a Section 5 correction that closes a Cell's first leadership row and opens one naming a person of the other Network: the zero-length row is selected as the predecessor and the leader-to-leader Network rule fires. That may well be right — a Cell created under a wrong-Network leader had the wrong Network for its whole life, and Section 10 gives `CREATED_IN_ERROR` for a Cell that should not exist — but Section 10 states that rule about a *handover*, and nothing distinguishes a correction from one. The second half is narrower and has no answer at all: `cell_leadership_is_opened_open` now refuses a leadership row written already closed, because no operation Sections 10 or 11 define writes one, and that forecloses correcting a closed historical stint. Neither is reachable today. Settle both with the handover-approval endpoint, which is where Section 10 makes the refusal.
- **What the duplicate-candidate lookup does when its list exceeds `limit`.** `GET /people/duplicate-candidates` computes every candidate, returns `visible.slice(0, limit)`, and answers `next_cursor: null` — which §22's pagination rule reads as "this is the last page" over a set that was truncated, with no cursor to reach the rest. The `slice` is pre-existing; the ordering rule settled on 2026-08-28 (below) is what makes it consequential. In-scope candidates now always precede withheld ones, so the withheld tail is the **first** thing a truncation removes — the cross-branch duplicate §3 says the church-wide lookup exists to catch — and the client chooses `limit`, down to 1. Not *exactly* those: at a `limit` below the in-scope count it drops in-scope candidates too, and the point is which candidates it reaches first. Three answers are defensible and none is derivable: page the list honestly, refuse to truncate it at all, or state in §3 and §22 that the list is truncated and which candidates may be dropped. **The in-scope group's own internal order has to be settled in the same ruling**, because a page boundary over an unordered set is not pageable. `findDuplicates` issues its population query with no `ORDER BY` and `findCandidates` sorts by tier alone, so within one tier the in-scope order is PostgreSQL's physical row order. That is no disclosure — everything in that group is fully visible to the viewer — but it means that below the in-scope count, *which* in-scope candidates survive a truncation can differ between two identical requests. Raised by `architecture-guardian` on `fix/duplicate-candidate-oracle`, twice, and by the ordering rule itself: §3 now asks that any new decision the list is subjected to — it names a narrowing, a sort, a page boundary and a count — be treated as a disclosure until it is shown to be a function of what the viewer may already know. This is the one page boundary that exists, and nothing has shown it. Not blocking while the default limit of 50 exceeds any candidate list this church produces.
- **Whether a pastoral path renders an absorbed Person or the survivor.** Every other `persons` read in the application filters `merged_into_id`; the path's name lookup deliberately does not, because on a lookup a filtered row is simply not found while on a path it is a *hole*, and a path with a hole reads as a shorter chain rather than as an error. Section 3 also says a merge never rewrites pastoral records to point at a different Person, so an absorbed ancestor genuinely stays on the chain and the real question is whether to show them or the survivor who now carries the identity. That is Person Merge's to answer for every surface at once rather than this endpoint's to decide, and merge is Stage 3, so nothing today can reach it. Settle it with the merge.
- **Whether a Person holding an open root row may be absorbed by a Person Merge.** §3 refuses a merge where the absorbed Person leads a Cell and says nothing about a root; §5 leaves succession undefined and forbids reassigning a root. So merging a duplicate root holder into the real person appears permitted — and §3 says a merge "never rewrites historical attendance, pastoral, or audit records to point to a different Person", so the seat row keeps naming the absorbed record. The resolved identity then has two open assignments, which §5 invariant 3 forbids and which no constraint can refuse, because the rows carry different `person_id`s. Raised by the fifth review of the tree import, which is the only thing in the system that creates root rows: the dry-run warning's whole force is that no remedy exists for a mis-seated root, and merge is the one remedy §3 offers for a record created in error. The warning is correct under §3 as written. Settle this before anyone needs it.
- **Whether a decisions file should bind the candidate set it was adjudicated against.** The fingerprint covers the input file and says nothing about the database, and section 2's decisions file has no candidate column — so a `CREATE` acknowledges a candidate set nothing pins. A Tier 1 candidate arriving between the dry run and the commit is caught where it gives a row its *first* one, because the row is then blank or absent, and is not caught where the row already carries a decision: it is created past an acknowledgement made about somebody else. Closing it means a per-row digest of the candidate identifiers, carried in the file and compared at commit — structure section 2 does not describe. Narrow in practice while the import is thirty rows against a near-empty database, and it is the shape that would matter if this were ever pointed at a larger file. Decide it before any second use of the import.
- **Whether closing a person's only open `network_assignments` row, without opening a replacement, is a legal write.** Escalated by `architecture-guardian` on 2026-08-25 and general rather than root-specific. §4 defines a Network change as an atomic close-and-open pair sharing one instant; §5 forbids `DELETE` on the table; nothing addresses a close alone. No constraint refuses it — `network_assignments_one_open` is partial and permits zero, and the same-Network trigger compares at the closed row's own start, so it passes. The consequence is that `network_as_of` becomes null from that instant and every edge beneath the person is silently unresolvable, which is the outcome the no-delete trigger exists to prevent, reached one column over. The root seat made it visible rather than causing it, and the root case is now refused specifically; the general case is not. The same silence covers a close at T1 reopened at T2, which leaves a gap with no Network at all.
- **Who may close a Network root's row, and under what capability.** §5 gives each Network exactly one root and says changing who holds one is "a deliberate Network-level decision, not a pastoral reassignment" — and names no capability, no endpoint and no workflow for it. The seat added on 2026-08-25 is partial over open rows, so a successor becomes possible the moment the previous root's row is closed; both write paths that could close it refuse a root outright, so nothing can. §5 now says plainly that a succession is not an operation this system offers, rather than implying one from the seat being freeable. Not blocking: the import creates two roots and neither changes.
- **Whether §2's closed exemption list gets a gate.** §2 was narrowed on 2026-08-26 to permit exactly one cross-module read and declares the list closed — with nothing able to fail on it. This repository gates the pure-client boundary, the refused UI packages, the palette token names and the module graph, each with a check that goes red; a cross-module table read is greppable in one line and has none. Where such a check would live — an ESLint rule, a test over the source, a lint script beside `check-ui-dependencies.mjs` — is the part that needs deciding.
- **Whether the three cases of §5 invariant 3 should be told apart in the data.** §5 permits zero open pastoral assignments for a Person not yet assigned, an archived Person, and an administrator outside the pastoral structure — and nothing records which. The absence of a row is the same absence in all three; the difference is in why, and the schema holds no `why`. So the first attention list that surfaces unassigned Persons shows an administrator among people genuinely waiting for a leader. §5 names the remedy as that list excluding accounts holding `ADMIN`, which needs no new structure and needs the list to exist. Decide it with the first screens. *(§5 claimed this was “recorded as open” from the moment the third case was written on 2026-08-25, and it was not — the fifth false “written to / recorded as” claim on this project, and the first found by a reviewer grepping the open list for it.)*
- **How a person's title is displayed, and whether it is stored.** §3 keeps first, middle and last names and has no title field, and since 2026-08-25 says plainly that a name field is not where a title goes — a title inside one is compared as though it were part of the name, so `Bishop Oriel` never matches `Oriel` and a duplicate goes unnoticed. What is unsettled is where it *does* go. A column is the obvious answer and is not effective-dated, so it cannot say what somebody was called in a past period — the mistake the 2026-08-20 structures ruling names. Two of them are derivable from `SENIOR_PASTOR_PERSON_IDS` already. It is a display question; decide it with the first screens.
- **Whether a leader sees a "details to collect" list.** Birthday became optional on 2026-08-24, and an optional field with nothing surfacing it is one that never gets collected. §15's attention-list idiom fits — filtered, never ranked, never colour-graded, shown to the leader who can act — but there is no dashboard to put it on until Stage 2's screens exist. Decide it with them.
- **Whether "asked, not given" is a state on the Person.** It follows the item above rather than standing alone. Without it, somebody who declined to give their birthday stays on a collect-list forever, which presses on exactly the privacy the optional ruling protects. With it, the next leader learns she was asked rather than rediscovering it by asking again — but it is a new field on `persons`, so it is a ruling and not a detail.
- **Whether a recorded birthday may ever be removed.** §3 defines adding one and, since 2026-08-24, refuses an explicit null on the edit path so that a nullable column does not become an erase capability nobody decided on. The privacy argument that made the field optional cuts toward permitting removal — somebody may withdraw what they earlier gave. Reproducibility cuts the other way: a Tier 1 acknowledgement recorded against a birthday, and every age derived from it, stop being explicable once it is gone. Left refused until decided.
- **What clock skew account-wide revocation may tolerate, once there is a second API instance.** The instance count itself left this list on 2026-08-31, settled at one and written into §24, which is what makes the revocation comparison exact today: §6 requires a token's issued-at and the account's revocation marker to be stamped by an API process, and on one instance those are one clock. What is still open is the bound a second instance would need, and it is deliberately not guessed in advance — a tolerance chosen with no second host to be skewed against is a number nothing can fail, and any tolerance is a loosening, admitting near-boundary tokens an exact comparison refuses. §24 now states what the change introducing a second instance owes: a stated maximum, NTP holding it, the comparison made tolerant in the fail-safe direction, and every other cross-instance timestamp comparison found and given the same treatment. The row lock added for the uncommitted-revocation window orders the two events in the database and depends on no clock, so this reaches the comparison and not the ordering. Not blocking: nothing can reach it while one instance runs.
- **Whether the isolation level should be pinned the way `DateStyle` now is.** Section 24 records `READ COMMITTED` as a dependency and checks it in a **test** (`invariants.spec.ts`) against the test database — no deployment runs that check, so a deployment that sets `default_transaction_isolation` still silently removes an authorization guarantee, which is what Section 24 says must not happen. The `DateStyle` ruling of 2026-08-30 assumed the two settings differed in kind, on the belief that a client cannot set another session's isolation default; that is false, and `architecture-guardian` refuted it in one connection — `default_transaction_isolation` arrives in the startup packet by exactly the mechanism the pool now uses for `DateStyle`. So the option is available and was never considered. Three answers look defensible: pin it on the pool and assert it at startup, as `DateStyle` now is; assert it at startup without pinning, so a deployment that has chosen a different level is told rather than overridden; or leave it as a test-only check and accept that the guarantee rests on nobody changing the server. Pinning is not obviously right — an operator who sets `SERIALIZABLE` deliberately would find the application quietly overriding them, which is a different thing from a `DateStyle` nobody sets on purpose. Not blocking; it belongs beside the least-privilege role and the liveness probe, since all three are settings a deployment owns.
- **The application's database role.** §24 requires least-privilege credentials and none exist: the API connects as the owner of every table, so it holds `TRUNCATE`, which bypasses the no-delete triggers entirely, and `DROP`. The no-delete rule leans on this role to make its `TRUNCATE` exemption safe. Creating it is deployment work with no ruling attached, but until it happens §5's exemption is unprotected.
- **Whether a revocation may be undone in place.** Nothing addresses setting `revoked_at` back to `NULL`, and the schema permits it on `account_roles` and `capability_grants`. It erases a revocation exactly as a `DELETE` would, one column over — and the Senior Pastor cap depends on `revoked_at` being monotone for the count to mean anything over time.
- **The native client framework.** `SKILL.md` §2 settles the web stack and says nothing about Android and iOS. Deferred since the specification was written; indexed here because two rules now point at it as open.
- **What the native clients owe on accessibility.** `SKILL.md` §23 binds the web application to WCAG 2.2 AA and says the equivalent obligation for a native client is the platform accessibility API rather than WCAG. Which platform guarantees, and what would fail a build, is a ruling to make when the client is.

- **Whether the liveness probe should share the application connection pool.** §24 now records that it does, and that pool exhaustion therefore presents to the platform as a dead process — so the response is a restart that discards the transactions still making progress. A separate connection, or a probe that does not reach the database, are both defensible and mean different things by "healthy". Deployment work with a ruling attached, alongside the database-role item above.
- **Whether `cell_leadership_requests.cell_id` should be frozen while a request is `PENDING`.** Migration 0009's finality trigger freezes what a request asks *about* — its kind, the person it names, who submitted it and when — and deliberately leaves the category, day and time writable so a mistyped time is corrected rather than declined and resubmitted. It says nothing about `cell_id`, which for a `HANDOVER` names the Cell itself. Nothing writes it on a `PENDING` row today, so this is not a live hole; what makes it worth settling is that approval chooses its lock list from that value before the transaction opens, and its under-lock re-check defends the value rather than relying on the trigger. If a revision path is ever added — correcting a handover that named the wrong Cell — the question becomes load-bearing in a place nobody would think to look.
- **Whether `audit_log`'s append-only guarantee tolerates `TRUNCATE`.** §5 records the exemption for history tables and leans it on a least-privilege role that does not exist, which is already open above. §21 says nothing at all, and the test suite truncates `audit_log` before every test. Same answer as the `TRUNCATE` question above, most likely, but it is not written down for the one table whose whole purpose is that nothing removes a row.
