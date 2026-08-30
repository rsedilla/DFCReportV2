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
- A decision that changes or settles a rule is recorded under Decisions below **and** amended into `SKILL.md` in the same change. A decision that lives only in a chat session does not exist.

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

**One exception is in force and will end.** Until this schema is applied to a database anybody depends on, `0001_foundations.sql` may be corrected in place — see the ruling of 2026-08-21 below, which defines when the exception lapses. Rebuild your development database when the checksum refuses.

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

### 2026-08-19 — Who may reassign a person's pastoral leader
Admin; any leader upline of the person, acting within their own authorized pastoral subtree; and both Senior Pastors. Written to `SKILL.md` §5 (Changing a person's pastoral leader) and §7 as `people.manage_pastoral_assignment`.

### 2026-08-19 — Senior Pastors may reassign across both Networks
Bishop Oriel Ballano and Pastora Geraldine Ballano hold `people.manage_pastoral_assignment` at Whole Church scope and may reassign within either Network.

The actor crosses Networks; the edge never does. The resulting leader-to-disciple edge must still be same-Network, which makes that check — rather than the shape of the tree — the only thing preventing a cross-Network edge. Written to `SKILL.md` §5 and §7, and surfaced by name in Network Summary per §16.

### 2026-08-19 — Network roots
**Partly superseded** on 2026-08-23 by "The root is a row" below. "With no pastoral assignment" is the reading that was dropped: a root holds an active assignment row whose `leader_id` is null. Everything else here stands — exactly one root per Network, and no one may reassign them.
Each Network has exactly one root leader with no pastoral assignment, and a root cannot be reassigned by anyone. Written to `SKILL.md` §5 (Network roots).

### 2026-08-19 — Agent roster reduced to two
`architecture-guardian` and `qa-engineer` only. Builder agents for UI, frontend, backend, data, and reporting were cut: a subagent starts cold and must re-read `SKILL.md` before it can apply a single domain rule, which costs more than working sequentially in one session that already holds the context. Security review uses `/security-review`. A GitHub integration agent is deferred until a repository exists. Written to Agent Coordination above.

### 2026-08-19 — Cell meeting status extended to three
`HELD`, `RESCHEDULED`, `NOT_HELD`. This amends `SKILL.md` §1 Principle 8, which previously named Not Held as forbidden.

The original ban grouped Not Held with Bad Leader and Poor Performance. Those are judgements about a person; "the meeting did not take place, weather or calamity" is a fact about an event, declared by the leader themselves. The distinction holds only under three conditions, all written into §13: `NOT_HELD` is declared and never inferred from silence, it carries a reason from a fixed list, and it is excluded from the monthly denominator.

Rationale for the change: a silent leader and a leader honestly reporting that their Cell could not meet are different pastoral situations, and the two-status model collapsed them into one ambiguous gap.

### 2026-08-19 — Cell monthly denominator
The denominator is recorded meetings, `HELD` plus `RESCHEDULED`, per Cell per month. `NOT_HELD` and unreported meetings are both excluded, and buckets vary with the denominator rather than the calendar. Every Cell report shows a coverage line. Written to `SKILL.md` §12 and §13.

### 2026-08-19 — Attendance submission window
A month closes on the 7th of the following month. After close, only Admin may amend, via `records.backdate_effective_date`. Written to `SKILL.md` §13.

### 2026-08-19 — Facilitation is not leadership
`facilitated_by` records who conducted a meeting, separately from the responsible leader and the submitter. It never touches `cell_leaderships` and never counts toward New Cell Leaders. Written to `SKILL.md` §13 and §14.

### 2026-08-19 — Sorting permitted, ranking prohibited
Leaders may sort and filter within their authorized scope, and attention lists are encouraged. Rank positions, composite scores, default leaderboards, and value-laden colour encoding are forbidden.

The reason is practical, not only pastoral: `NOT_HELD` exists to obtain honest reporting. If declaring it puts a leader at the bottom of a visible ranking, leaders will record `HELD` instead and the signal is lost. Ranking the measure destroys the measure. Written to `SKILL.md` §13 and §17.

### 2026-08-19 — Reporting time zone is Asia/Manila
All dates and period boundaries — days, weeks, months, DCC Sundays, and the monthly submission close — are computed in Asia/Manila. Timestamps are stored in UTC and converted for any date derivation. Written to `SKILL.md` §20 (Time zone and period boundaries), with §13 made concrete.

### 2026-08-19 — Development reports DCC VIPs and Cell VIPs separately
Two figures, never a merged `VIPs` number, because the pastoral follow-up differs by domain. A combined `VIPs (DCC or Cell)` may be shown in addition, never instead. Written to `SKILL.md` §16.

### 2026-08-19 — A merge lowers past-period totals
Identity resolution applies to every period, including periods already reported. Re-running a past report after a merge returns a unique-people total one lower.

This is a defect correction, not a history rewrite: the report was counting one person as two, in breach of Principle 10. It is deliberately different from archival, which applies only from its effective date forward. Written to `SKILL.md` §3 (Person Merge).

### 2026-08-19 — Role catalog
Three roles — Senior Pastor, Admin, Leader — with defined default capabilities and scopes. Senior Pastors deliberately do not hold `roles.manage`, `accounts.manage`, `records.backdate_effective_date`, or Person Merge, so that the church's two highest-visibility accounts cannot escalate their own authority. Leaders do not hold `people.manage_lifecycle`. Written to `SKILL.md` §7 (Role catalog).

### 2026-08-20 — Stack pinned: NestJS, PostgreSQL, Next.js as a pure client
Settled in `SKILL.md` §2 (Chosen stack). Two requirements decide it.

Authorization must be enforced structurally: §7 makes the API the sole authority across roughly forty endpoints, and on a team a per-handler convention is only as reliable as the least familiar developer writing the newest route. NestJS guards fail closed.

Mobile clients cannot be force-updated, so the API must deploy independently of the web application. Separate deployables is a requirement, not a preference.

The Next.js application carries no API routes and no server actions. If that boundary proves hard to hold, replace it with a plain React SPA.

### 2026-08-20 — Three client surfaces used concurrently
Desktop web, mobile web, and native Android/iOS, against one API, by the same people at the same time. Consequences written to `SKILL.md` §2, §6, §14, §23, §24:

- token-based authentication from the first release, never cookie-sessions retrofitted later
- several concurrent sessions per account; sign-out is per device, revocation is account-wide
- version checks on updates, with conflicts resolved by a person rather than by last-write-wins
- idempotency keys, client-generated UUIDs, and server-side sync validation required from the first write endpoint

### 2026-08-20 — DCC has no meeting status
The three-status model is Cell-only. DCC is a single church-wide service, so whether it took place is one fact about the whole church, not 140 separate leader reports. A Sunday with no service simply carries no DCC event, removed from the calendar by a deliberate, audited Admin action. Written to `SKILL.md` §9.

### 2026-08-20 — Cell membership workflow
Capability `cell.manage_membership`, held by the Cell's leader, their upline within scope, Admin, and Senior Pastors. At most one active membership, moves are single-transaction, same-Network required, membership need not mirror pastoral assignment, and archival ends membership while preserving the record. Written to `SKILL.md` §10 and §7.

### 2026-08-20 — Duplicate matching rules
Never auto-merge and never block creation; surface candidates and let a person decide. Normalize for comparison only, with whitespace normalization called out because `Dela Cruz` and `DelaCruz` is the common duplicate. Two tiers of candidate strength, sex as a supporting signal only, and surname equality never required because a woman's surname may change. Thresholds calibrated against real data, not fixed in the specification. Written to `SKILL.md` §3.

### 2026-08-20 — Member ID generation
`M-` plus six digits from a database sequence, server-assigned, immutable, never reused, gaps acceptable, encodes nothing. Distinguished from the UUID, which may be client-generated so a Person created offline keeps their identity on sync. Written to `SKILL.md` §3.

### 2026-08-20 — No "on behalf" for pastoral assignment
Declined deliberately. Attendance carries a responsible leader because attendance rolls up to whose meeting it was; an assignment row is itself the fact and nothing aggregates by it. The actor is in the audit log and the movement appears in Network Summary. Written to `SKILL.md` §14.

### 2026-08-20 — DCC submission window
Same close as Cell: the 7th of the following month, 23:59 Asia/Manila, Admin-only afterwards. DCC coverage counts how many responsible leaders have submitted for an event, not how many events exist. Written to `SKILL.md` §9.

### 2026-08-20 — Archiving a Person who leads a Cell
Rejected while an active Cell leadership assignment stands. Reassign or close the Cell first. Allowing it would either leave a Cell led by a non-current Person or silently end its members' memberships. Written to `SKILL.md` §3.

### 2026-08-20 — Migration policy
Additive by default, never DROP historical data, reversible or escalated, backfills of effective dates are backdating, constraints validated against existing data before enforcement, snapshot and reconcile around relationship tables, constraint DDL hand-written. Written to Definition of Done above.

### 2026-08-20 — Cell lifecycle, and closure is declared
A Cell Group is `ACTIVE` or `CLOSED`. No period of inactivity closes a Cell — not three months of `NOT_HELD`, not three months of silence, not any threshold.

Inferring closure would punish the leader who declares `NOT_HELD` honestly, assert a fact on no evidence for the leader who reports nothing, allow the Section 3 archive guard to be waited out instead of satisfied, and could strip a real leader's account qualification under Section 6 while they are dealing with a family emergency.

Prolonged inactivity instead drives an attention list (§15) that prompts a person to confirm or close. Closure carries a reason from a fixed list. Multiplication is deliberately not one of them: when a Cell multiplies, a disciple opens a new Cell and the original continues under the same leader, so multiplication creates Cells rather than closing one. Written to `SKILL.md` §10, §11, §15, §7.

### 2026-08-20 — "Qualifies as a leader" means current Cell Leader
For counting, a leader is a current Cell Leader: an active Cell leadership assignment on an `ACTIVE` Cell. There is no commissioning flag or graduation status. In the author's words, leadership is not an award and not a grant — it is earned by leading a Cell weekly.

Qualification is not filtered by recent activity, because that would drop a leader from the count for honestly declaring `NOT_HELD` and would make development metrics flicker with submission timing. The weekly expectation is enforced through the Cell: a Cell that has stopped meeting is surfaced on the attention list and closed by a person, and the closure ends the leadership assignment.

Authorization never consults this definition; it depends on capability grant and tree position only. Written to `SKILL.md` §11, with cross-references from §5 and §16.

### 2026-08-20 — DCC monthly buckets derive from N
Buckets run to the number of applicable DCC events in the month, not the number of Sundays in the calendar, since a Sunday may carry no service. Matches the Cell rule in §12. Written to `SKILL.md` §9.

### 2026-08-20 — Dashboard rules
The sidebar carries navigation only. Every tile carries scope and period; current-state and period-based tiles are grouped separately; attendance tiles count unique people; outstanding work appears above the counts; dashboards differ by role. Written to `SKILL.md` §19.

### 2026-08-20 — Mobile number is the only contact detail; no email on a Person
A Person carries an optional mobile number and nothing else. Email remains solely a login credential on an Account, and messaging handles are not stored at all — following someone up is the leader's pastoral responsibility.

Keeping email off the Person also closes an escalation path: were it editable under `people.edit_basic`, a leader could repoint a downline leader's email and take over the account through a password reset.

The number is optional because a required contact field gets filled with fictions, and it is prompted at VIP registration because that is when it is most likely to be given. It is hidden from church-wide search outside the viewer's scope, and it is a strong duplicate-matching signal but never sufficient alone, since households share numbers. Written to `SKILL.md` §3, §7, §8, §9.

### 2026-08-20 — Responsible leader for DCC attendance
The person's direct pastoral leader, as of the event date. Every person has exactly one, so each is covered once with no overlap between levels and no gap between them.

Cell leadership is not involved: a leader who disciples people but leads no Cell still owes a submission for their direct children. Responsibility for attendance follows tree position; counting a leader follows Cell leadership (§11). An upline may submit on behalf, and coverage measures whether the record exists rather than who entered it. Written to `SKILL.md` §9.

### 2026-08-20 — Cell ID generation
`CELL-` plus six digits from a database sequence, server-assigned, immutable, never reused, gaps acceptable, encodes nothing. Mirrors the Member ID rule. Encoding category in the ID would break the existing rule that a Cell keeps its ID through a category change. Written to `SKILL.md` §10.

### 2026-08-20 — Cell attendance records members only
No visitor or guest state. A first-time attendee is added as a member by the leader and then recorded present; a person is either a member of the Cell or is not recorded against it. Attendance at another leader's Cell is not recorded at all.

Chosen for simplicity: one list on the leader's screen, and the roster, the membership, and the monthly denominator are the same set of people. The accepted cost is that a one-time attendee stays a member until removed and counts toward that leader's total, which is ordinary tidying rather than a defect. Written to `SKILL.md` §10.

### 2026-08-20 — API conventions
Settled in `SKILL.md` §22: JSON only, ISO 8601 with Asia/Manila date-only fields, cursor pagination with no total counts, one error envelope with stable machine-readable codes, `CAPABILITY_DENIED` distinct from `SCOPE_DENIED`, a `VERSION_CONFLICT` body carrying both values and both actors as §14 requires, an `Idempotency-Key` header on every write, explicit named filters with `sort`/`-sort`, and additive-only changes within `v1`.

Fixed before implementation because three clients consume the API concurrently and mobile builds cannot be force-updated, so a convention invented per-controller becomes permanent the moment a phone depends on it.

### 2026-08-20 — Cell schedule is effective-dated
Day and time carry history exactly as category does, because scheduled meetings for a past month are derived from the schedule in force during that month. Without it, moving a Cell from Saturday to Sunday silently rewrites every earlier coverage figure. Written to `SKILL.md` §10.

### 2026-08-20 — DCC events are generated ahead, not lazily
One event per Sunday on a rolling twelve-month horizon. Lazy creation would make a Sunday nobody submitted for indistinguishable from a cancelled service, reintroducing the ambiguity the Cell statuses exist to remove. Written to `SKILL.md` §9.

### 2026-08-20 — Notifications go to the two Senior Pastors and their direct leaders only
**Superseded the same day** by "Notifications go to the direct leaders and Admin, not the Senior Pastors" below. Retained for the reasoning, which still holds; the recipient list does not.
In-app only. No email, no SMS, no push, so no mail provider, queue, or worker is required.

Every leader still sees their own outstanding records on their own dashboard — that is a task list, not a notification. Accountability runs through pastoral relationship: the Senior Pastors and their direct leaders see where their Networks stand and follow up personally. A leader behind on records hears from their own leader, not from the application. Written to `SKILL.md` §13.

### 2026-08-20 — Attention threshold is one church-wide Admin setting
Three months by default, never per leader. A list that differs by viewer makes two people discussing the same Cell talk past each other. Written to `SKILL.md` §15.

### 2026-08-20 — Network is assigned from sex, not proposed
The mapping is total under the homogeneous-network rule, so a confirmation step approves a tautology and gets clicked unread. The Network is displayed beside sex during encoding instead, and an error is corrected through the audited sex-correction path. Written to `SKILL.md` §4.

### 2026-08-20 — Closed months may be materialized
After the 7th a month's figures are stable, so its reports may be computed once and stored; only the open month needs live computation. An Admin amendment invalidates and recomputes that month. Stored figures are a cache and must always remain derivable from source records. Written to `SKILL.md` §20.

### 2026-08-20 — Backups are daily, not weekly
Daily minimum, 30 days retention, point-in-time recovery where the host supports it, and a restore tested before go-live and annually after.

Weekly was considered and rejected: attendance exists nowhere else, so a week of loss is one DCC Sunday and around a hundred and forty Cell meetings that nobody can reconstruct, and corruption is typically noticed weeks after it happens. The database is small enough that daily costs almost nothing. Written to `SKILL.md` §24.

### 2026-08-20 — Two capabilities were referenced but never named
**Partly superseded.** The closing sentence, that `cell.manage_lifecycle` also covers creating a Cell, was reversed by "Cell creation workflow, hardened" below: creation is reachable only through request-and-approve, and `cell.manage_lifecycle` governs closure alone.
`cell.manage_leadership` (assigning and ending Cell leadership, and referenced by the dual-authorization rule in §6) and `people.merge` (§3, and a row in the §7 role table with no identifier). Both now appear in the §7 capability list and role catalog. `cell.manage_lifecycle` is also stated to cover creating a Cell, not only closing one.

### 2026-08-20 — DCC attendance is face to face only
Online or streamed participation creates no attendance record and affects no total. Recording rests on a leader knowing who was in the room. Recorded as a deliberate exclusion so an online state is not added later as though it were an oversight. Written to `SKILL.md` §9.

### 2026-08-20 — Submission rolls up to the nearest upline with an account
A leader who disciples people but has not opened a Cell cannot sign in, since accounts arrive with Cell leadership (§6). They remain the responsible leader — that definition follows tree position and never depends on account status — and their upline submits for them under §14.

Section 6 was deliberately not widened. An account for someone who has not opened a Cell would detach "leader" from "leads a Cell", which §11 makes non-negotiable. The arrangement self-corrects: the account arrives with the Cell. Written to `SKILL.md` §9.

### 2026-08-20 — Recorded scale and initial data load
The church runs roughly 800 active Cells with 3,000 to 4,000 attending DCC weekly, giving around 50,000 attendance records a month. That is a small PostgreSQL database and changes no technology choice, but it makes materialized closed months and first-migration indexes requirements rather than optimisations.

Initial encoding is a distinct phase: Admin imports the leadership tree centrally, and each Cell Leader encodes their own members. Cell-creation approval and individual attribution are relaxed for that phase only; duplicate matching applies at full force, since a large encoding effort across many hands is the likeliest source of duplicates this system will see. Written to `SKILL.md` §2.

### 2026-08-20 — Cell creation is request then approve
**Amended** by "Cell creation workflow, hardened" below. Two details here are superseded: `cell.request_creation` is scoped subtree-excluding-self rather than own/subtree, and the claim that this is the only action carrying a second party is wrong — archival and Person Merge share the shape.
The prospective leader's own upline requests the Cell, naming the leader, category, day and time (`cell.request_creation`, own/subtree). Admin approves (`cell.approve_creation`, Admin only), and approval creates the Cell, the leadership assignment, and proceeds to the account step in one transaction.

Admin holds approval because approving a new Cell Leader means provisioning their account, and §6 requires one actor to hold both `cell.manage_leadership` and `accounts.manage`. Admin is the only role holding the latter, so the choice falls out of the role catalog rather than being arbitrary.

Two steps because creating a Cell mints a Cell Leader, which moves the requester's own progress toward Leaders with 12+ Direct Leaders. It is the only routine action where the actor benefits from the outcome, and the only one carrying a second party.

Communicating a new Cell Leader to the Senior Pastors' direct leaders happens outside the application, in conversation. The system deliberately does not model it. Written to `SKILL.md` §10 and §7.

### 2026-08-20 — Admin creates the initial Cells
A leader cannot create their own first Cell: an account arrives with Cell leadership (§6), and Cell leadership requires an existing Cell (§11). Admin therefore creates the initial Cells and leadership assignments at Whole Church scope, which is also what allows the accounts to be provisioned. Only the request step is skipped during initial encoding; approval is not bypassed, since Admin is the approver. Written to `SKILL.md` §2.

### 2026-08-20 — Cell creation workflow, hardened
Third architecture review found nine problems with the workflow as first written. The rules now standing:

Creation is reachable only through request-and-approve. `cell.manage_lifecycle` governs closure and confers no power to create — previously it did, at own/subtree, which made the whole workflow optional.

Nobody may name themselves on a request. A leader whose only Cell closed keeps their account and could otherwise restore their own Current Cell Leader status with no upline involved. §5 invariant 4 writes the same prohibition for pastoral assignment.

Approval revalidates the target as of approval, not request: archived, merged, moved out of scope, or Network-changed all reject. Without it, approval would create a leadership assignment for an archived Person and provision their credentials.

The approval transaction opens the category and schedule rows, not only the Cell. A Cell without a schedule row has no coverage figure for its first month. Everything takes effect at approval, so a request made 30 September and approved 2 October belongs to October.

Requests are `PENDING`, `APPROVED`, or `DECLINED`, at most one pending per prospective leader, declines retained. Decline reasons are a fixed list — `LEADER_DEVELOPMENT_CONTINUING`, `TIMING_DEFERRED`, `DUPLICATE_REQUEST`, `SUBMITTED_IN_ERROR`, `OTHER` with a note — because a decline is a durable record about a named person and free text is where a judgmental label would be written.

Pending requests appear on the Admin dashboard. The earlier wording forbade any surface at all, leaving the approver nowhere to see a request that blocks a leader's account.

Written to `SKILL.md` §10, §7, §19, §21.

### 2026-08-20 — Initial encoding ends by an audited Admin action
While open, Admin may create Cells directly. Once closed, that path is gone and every Cell goes through request-and-approve. Three commits had attached relaxations to a phase with no terminating condition; a relaxation tied to a phase that never ends is a permanent relaxation. Written to `SKILL.md` §2 and §10.

### 2026-08-20 — A DCC attendance record requires a pastoral leader
The VIP workflow captures the pastoral leader at creation. In practice the answer is already settled outside the system — someone brings a visitor, and who they sit under is decided by that relationship before anyone opens the app. A Person with no active assignment simply cannot have DCC attendance recorded, since there would be no responsible leader. Written to `SKILL.md` §9.

### 2026-08-20 — A person who changes Cell mid-month reports under the new Cell
**Superseded** by "Cell monthly attendance reports on members" below. The direction held — the new Cell — but the denominator described here was replaced.
Their denominator is the new Cell's recorded meetings, and attendance at the Cell they left stays in that Cell's records without placing them in its monthly buckets. Leader and Network totals are unaffected, since those deduplicate by person. Written to `SKILL.md` §10.

### 2026-08-20 — A rescheduled meeting takes its roster from the actual date
Membership can change between the original and actual dates, and the roster should be the people who could actually have been there. The meeting still belongs to its original reporting month. Written to `SKILL.md` §10.

### 2026-08-20 — Notifications go to the direct leaders and Admin, not the Senior Pastors
The two Senior Pastors keep full visibility but are not interrupted by the application. Following up an outstanding record is the work of the leaders directly under them.

Recipients see church-wide figures, which exceeds the own/subtree scope their position confers. §7 is explicit that being in a Senior Pastor's direct 12 grants no wider scope, so this comes from an explicit Admin-issued grant of `reports.view_subtree` at Whole Church scope, read-only and audited. Notification content never exceeds the recipient's granted scope. Written to `SKILL.md` §13.

### 2026-08-20 — `settings.manage` for church-wide operational settings
Admin-only, Whole Church, audit logged with previous and new values. It governs the Cell attention threshold (§15) and the initial-encoding phase flag (§2) — both alter behaviour for the whole church from one control. A setting is explicitly not a place to record domain rules: anything that changes what a figure means belongs in the specification, not behind a control. Written to `SKILL.md` §7, §15, §2, §21.

### 2026-08-20 — A mid-month schedule change is resolved per week
**Superseded** by "A schedule change takes effect the following month" below. Per-week resolution left a month able to hold three or six scheduled meetings, sometimes two on consecutive days.
The schedule in force on the first day of the week a meeting belongs to determines that meeting's scheduled date. The week is the unit because §13 already makes the weekly meeting the unit of identity. Without the rule a mid-month move can leave a week with two candidate dates or none, producing a month of three or six scheduled meetings and a coverage denominator with no defined value. Written to `SKILL.md` §10.

### 2026-08-20 — A calendar week begins on Monday
**Still standing; its original justification changed.** It no longer rests on mid-month schedule resolution, which was removed, but on §13's one-logical-meeting-per-calendar-week identity.
ISO 8601, consistent with the date format already in use. Not a formatting preference: §13 makes the weekly meeting the unit of a Cell's identity and §10 resolves a mid-month schedule change by the schedule in force on the first day of the meeting's week, so the boundary decides which schedule governs and therefore the coverage denominator. Sunday-start is the common local convention and would otherwise be somebody's default. Written to `SKILL.md` §20.

### 2026-08-20 — Monthly attendance is measured over the membership window
**Superseded** by "Cell monthly attendance reports on members" below. The membership window was found to reintroduce the unbucketed person it was written to remove, and to give members of one Cell different denominators, leaving the Cell's report with no single bucket axis.
A person is reported under the Cell they belonged to most recently during the month, and their denominator is that Cell's recorded meetings that fell within their membership of it.

This replaces the earlier month-end rule, which had no answer for a person who left a Cell and joined none — permitted when a Cell closes — leaving them with a classification but no bucket, so the two views stopped reconciling. Bounding by membership also fixes the mid-month joiner, who was previously measured against meetings held before they joined and whose roster they were absent from, making `Completed` unreachable. Written to `SKILL.md` §10.

### 2026-08-20 — Cell monthly attendance reports on members
**Superseded** by "Cell monthly attendance reverts to attendees" below. A member population filters by lifecycle, because archival ends membership, which breaks the §3 rule that period-based reports are never filtered by current lifecycle state. It also made `None` and `Completed` overlap whenever a Cell had recorded no meetings.
The population of a Cell's monthly report is the Cell's members at month end, not only those who attended. Buckets gain `None`, and the classification view gains `Not yet attended`, so both views cover the same people and reconcile to the member count.

The denominator N is the Cell's recorded meetings for the month and belongs to the Cell, so every member is measured against the same N and `Completed (N/N)` means one thing on the screen. A member's count is their Cell attendance anywhere that month, capped at N, so someone who moved mid-month keeps credit for meetings they attended before moving.

Chosen over the two attendee-only alternatives because a report listing only the people who came cannot show a leader who did not come — and that person is the one most worth seeing. DCC keeps the attendee-only population, because a church-wide service has no roster to report against. Written to `SKILL.md` §12 and §20.

### 2026-08-20 — A schedule change takes effect the following month
A Cell decided in August to move from Saturday to Sunday runs on Sunday from 1 September. A month therefore holds one schedule throughout and always 4 or 5 scheduled meetings.

Mid-month resolution was tried and rejected: it left a month able to hold three or six scheduled meetings, sometimes two on consecutive days, and made the coverage denominator unpredictable from a leader's own calendar. A single meeting moving at short notice is a `RESCHEDULED` meeting, which is what that status is for. Written to `SKILL.md` §10.

### 2026-08-20 — Cell monthly attendance reverts to attendees, with a separate roster view
Three attempts to make one report both reconcile and show non-attenders all failed. Attendee-only could not show who was missing; the membership window left people unbucketed; the member population filtered by lifecycle and so broke reproducibility.

They are two jobs, not one. The **monthly report** is statistical: attendee population, reconciles, reproducible, and classification is evaluated as of month end so a closed month stops moving. The **roster view** is operational: every current member and who came, no buckets, reconciles with nothing, and is explicitly not reproducible for a past period.

Monthly-attendance buckets are now a Cell-scope view only. N belongs to a Cell, so aggregating across Cells with different N makes `Completed` mean "attended everything their own Cell happened to record" — inflated by exactly the Cells that recorded least, which is the Goodhart pattern §13 exists to prevent. DCC aggregates because one event set covers the whole church. Written to `SKILL.md` §12, §9, §15, §16, §20.

### 2026-08-20 — Three reporting questions are deferred to implementation
How a person who moved Cells mid-month appears in monthly reporting; whether a mid-month joiner is measured against a whole month they were not present for; and what an aggregate view offers in place of buckets.

Each was answered twice, and each answer broke reconciliation or reproducibility. They are recorded in `SKILL.md` §12 with the constraints any answer must satisfy, to be settled against real data in Stage 5 and verified by the reconciliation tests. Continuing to specify them in prose was producing rules that read well and did not hold.

### 2026-08-20 — Nine modules, each owning its tables
**Partly superseded** on 2026-08-26 by "A module's tables are never written by another" below. "No other module touches them directly" is the half that was narrowed: no other module *writes* them, and one reads them where the query is rooted in a table it owns. Everything else here stands, and the reason the rule exists is unchanged.
`people`, `networks`, `hierarchy`, `auth`, `cells`, `attendance`, `reporting`, `audit`, `admin`. A module owns its tables and no other module touches them directly; cross-module access goes through the owning service interface.

Named because Principle 13's modular monolith is otherwise just a monolith, and because it is what makes "enforced in the domain layer" real: the five §5 invariants have one home only because `hierarchy` is the only writer of `pastoral_assignments`. Organise by module, never by layer. Written to `SKILL.md` §2.

### 2026-08-20 — Every required structure is named and indexed
Six entities were required by rules and had no shape, of which five would naturally have been built as a column on their parent — losing history the specification guarantees, with nothing failing to warn anyone. `person_lifecycle` is the clearest: a state column plus audit rows satisfies every sentence in §3 and still cannot answer who was `CURRENT` on a given past date.

Shapes now sit in the section owning each rule, and §26 carries an index of all twenty structures to be checked against a migration. Adding to that index is part of the change introducing the rule, never a follow-up. Written to `SKILL.md` §3, §4, §10, §13, §20, §26.

### 2026-08-20 — The guard checks one target; the rest is domain layer
A grant's scope is evaluated against the request's primary target. Where a rule concerns other objects — §5's requirement that both the source and destination leader be in scope, and that the actor act on neither themselves nor an upline — those are checks in the owning module's domain layer, additional to the guard and never expressible as a scope value.

Stated because a capability and a scope cannot express three objects with three different rules, and a developer who implements the guard and believes the rule is implemented has built half of it. `SUBTREE_EXCL_SELF` survives for `cell.request_creation` alone, where the only prohibited object is the target. Written to `SKILL.md` §7.

### 2026-08-20 — `read_only` is valid only on a read capability
Five capabilities are reads: the four `view_subtree` variants and `audit.view`. The other nineteen are writes — *twenty since `people.correct_sex` was added on 2026-08-22; the rule is the split, not the count* — and a grant of one with `read_only` true is rejected at creation rather than stored and silently ineffective — otherwise an Admin who leaves the flag at its default creates a row that grants nothing, with nothing to explain the denial. Written to `SKILL.md` §7.

### 2026-08-20 — Migrations are hand-written SQL, and there is no ORM
Migration files are plain SQL applied in order by a small runner in the repository. Data access is a typed query builder over the PostgreSQL driver.

Both fall out of §5 rather than from taste. The partial unique index, the check constraint, the `DEFERRABLE INITIALLY DEFERRED` constraint trigger and the `CYCLE` clause are not expressible in any ORM's model, and a tool that generates migrations by diffing a model against the database proposes dropping what it cannot see — on every migration, forever. An ORM would therefore have to be fought on exactly the parts of the schema the specification cares most about.

The accepted cost is that table types are hand-written and reviewed rather than generated, kept honest by the schema tests. Written to `SKILL.md` §2 (Chosen stack).

### 2026-08-20 — An endpoint that declares no capability is denied
`SKILL.md` §2 already said a NestJS guard fails closed; §7 now says what that means as a rule, and names the only two exemptions: an endpoint reachable without authentication, and an endpoint that requires authentication and acts solely on the caller's own session. Each names its reason where it is written, so the whole exempt set is one search.

Stated as a rule because the alternative failure is silent. An endpoint missing its declaration looks exactly like an endpoint that needs no declaration, and on a team the difference is invisible in review unless the guard refuses it. Written to `SKILL.md` §7.

### 2026-08-20 — Invariant 4 answers `SCOPE_DENIED`, not `INVARIANT_VIOLATION`
A leader acting on their own assignment, or on an upline's, is refused with `SCOPE_DENIED` even though the check runs in the `hierarchy` domain layer rather than in the guard. It is a statement about the actor's authority over a target, which is what that code means.

`INVARIANT_VIOLATION` stays for a record the rules reject however it was submitted and by whomever: a cycle, a cross-Network edge, a second active assignment. §22 distinguishes the codes so an administrator can tell which half of a grant failed, and that only survives if domain-layer authority checks answer the same way the guard does. Written to `SKILL.md` §22.

### 2026-08-20 — The eleven authorization cases ship failing, in their own CI job
They are written against `PUT /api/v1/people/{id}/pastoral-leader`, which Stage 2 builds, and they fail today because nothing serves it. They are not skipped, not marked pending, and not inverted to pass on failure: a test that passes because it expects failure stops being a test the moment the feature arrives.

They run as a separate job that is reported and not required, so the `api` job stays honestly green on an application with no features. Stage 2 is done when they pass, at which point they move into the main suite and that job is deleted. The endpoint contract they pin, including its error codes, is documented at the top of `api/test/authorization/pastoral-assignment.spec.ts`.

### 2026-08-20 — A Network change validates forward from its effective date
The same-Network trigger, on a Network change, checks every assignment open at the change's effective date **or beginning after it**, comparing each as of the later of the two dates.

Found by `architecture-guardian` on the Stage 1 branch. `records.backdate_effective_date` lets Admin set the effective date in the past, so an assignment can begin after that date and therefore not be open at it. A correction backdated to April, with an assignment opened in June that was legal when made, would commit and leave a permanent cross-Network edge — and nothing revisits it, because no row of `pastoral_assignments` is written and the assignment trigger never fires.

§4's guarantee is absolute, so the check reaches forward rather than stopping at the effective date. Written to `SKILL.md` §5 (Database enforcement), with a regression test in `api/test/database/invariants.spec.ts`.

### 2026-08-20 — Three enforcement gaps closed at the schema, not in prose
Also from the same review, and grouped because each is the same mistake: a rule the specification states, left to an application that does not exist yet.

**`SENIOR_PASTOR` is capped at two active rows by a constraint trigger.** §7 says the two-holder limit is "a constraint the system enforces, not a convention it assumes". The count is enforceable in the database; *which* two Persons hold it is not, because the database has no durable representation of who the Senior Pastors are, and inventing one would put the church's two most consequential accounts behind a row somebody could edit. That half is a domain check in `auth`. Written to `SKILL.md` §7.

**`capability_grants.reason` and `granted_by` are `NOT NULL`.** §7 marks nullability explicitly everywhere else, so their unmarked state means required. An unexplained grant of authority leaves the next administrator nothing to weigh. `account_roles.granted_by` stays nullable for one case, now written down: the first Admin account, granted by a system action, mirroring §21's allowance for `audit_log.actor_id`.

**`migrate:down` refuses to run against populated tables.** The runner made an irreversible migration unexpressible, so the only way to satisfy it was a destructive down — and 0001's down drops `pastoral_assignments`, `network_assignments` and `person_lifecycle`. There is now a `-- migrate:irreversible <why>` marker, and a `-- migrate:down:refuse-if-populated <tables>` directive that stops the down unless the operator passes `--force`. The pattern mattered more than the file: Stage 3 and Stage 4 migrations would have copied it onto `cell_memberships`, `cell_leaderships` and attendance.

### 2026-08-20 — The unauthenticated surface is a closed list, and `read_only` is not a role concept
Two corrections to rulings made earlier the same day, both found by the review reading the new §7 text against the code it was written for.

The exemption sentence claimed the unauthenticated set was sign-in and the password flows; the API also exposes token refresh and a liveness probe. Rather than leave the specification describing something narrower than the code, §7 now carries the closed list — sign-in, token refresh, password reset, activation, and the probe — and says that adding to it is an amendment rather than a decision taken in a controller.

`read_only` is defined by §7 as a column on `capability_grants` and says nothing about role defaults, so deriving one for a role default and publishing it from `/api/v1/auth/me` invented a rule for clients to branch on. Authority carried by a role now reports no value. Written to `SKILL.md` §7.

### 2026-08-21 — Tailwind CSS, chosen while there is one page to convert
Settled in `SKILL.md` §2 (Chosen stack). It affects no architectural boundary: Tailwind is a build-time PostCSS plugin, adds no route, no server action and no data access, and the phones never load the stylesheet.

Chosen now rather than at Stage 5 for the same reason CI was chosen at Stage 1. Converting one placeholder page costs minutes; converting the dashboards, Network Summary and the role-specific screens costs a week, and the framework that arrives after the screens tends to be applied to only half of them.

**The palette carries the §13 and §17 prohibition.** No `success`, no `danger`, no `warning` token exists, and none is to be added. In a utility framework a red-and-green performance palette is one class away, and colouring a leader's row red for declaring `NOT_HELD` destroys the honest reporting that status exists to obtain — ranking the measure destroys the measure. A figure needing attention is surfaced by the attention list (§15), never by being coloured as a failure. The reasoning is written into `web/app/globals.css`, where somebody adding a colour will read it.

### 2026-08-21 — UI direction: headless primitives the repository owns, and no design-system framework
Settled in `SKILL.md` §2 (Chosen stack). The firm half and the expected half are separated below, because only one of them is a ruling.

**Firm — the rule.** In the web application, components are headless primitives, vendored into the repository rather than arriving as a dependency with a look attached, and **no component framework carrying its own design system is used**: MUI, Ant Design, Chakra, Mantine and Bootstrap are refused. It says nothing about the native clients, whose framework is not chosen.

The ordinary objection is that each brings a second styling engine to fight Tailwind. The objection that makes it a rule is that they express state as `error`, `success`, `warning` and `severity` and hand that vocabulary to every developer as the default, which makes the prohibited use the easy one. §13 forbids value-laden encoding of meeting status; §17 forbids leaders being colour-coded by `NOT_HELD`, coverage, or any figure derived from them; §19 forbids a dashboard colour-grading leaders. `NOT_HELD` exists to obtain honest reporting, and a framework whose idiom paints that row red produces a month of `HELD` instead. Colour itself is not forbidden and is not a ranking — the palette uses it for structure and legibility, which is the distinction the rule turns on.

**Firm — the current implementation.** Radix, vendored through `shadcn/ui`. The rule is what is settled and what `SKILL.md` §2 carries; the vendor is how it is met today and may be replaced by anything satisfying it, without amending the specification.

**Checked, not remembered.** `web/scripts/check-ui-dependencies.mjs` fails `npm run lint` if a refused package appears in `web/package.json`, and `web/scripts/check-contrast.mjs` refuses a palette token named `success`, `danger` or `warning` — the rule now written into `SKILL.md` §23, since a gate in CI may not depend on a rule that exists only here. Both sit beside the check that holds the pure-client boundary. The rule's own argument is that a framework's defaults get applied by whoever writes the newest screen, which is an argument that review will not catch it, and the same is true of a colour named for a verdict.

The dependency list is illustrative of the rule, never a definition of it: a package absent from it is not thereby approved. It names no headless package, including headless packages published by the refused projects, because those are what the rule prescribes.

**Expected, and confirmed against a real screen rather than now.** TanStack Query for server state, since cursor pagination, retry and cache invalidation are where `VERSION_CONFLICT` and `Idempotency-Key` retries actually get handled (§14, §22, §23). TanStack Table, headless, for rosters and attendance grids — §22 fixes the sort and filter contract as named query parameters and forbids ordering leaders against one another, so the table's job is column definition and virtualization rather than inventing its own query language. A chart library with no built-in colour semantics. `lucide-react` and `next/font`.

**Nothing is installed yet, deliberately.** Stage 1 has no screens, and generating a component library before there is anything to build with it is scaffolding for nothing. The direction is recorded so it is not re-litigated; the first install happens with the first real screen in Stage 2.

Recorded also because elegance in this application is mostly not a dependency. One typographic scale, consistent spacing, restraint with colour, and real empty and loading states decide how it feels, and the two screens that will decide it — the arbitrary-depth pastoral tree (§5) and the attendance grid (§13) — are not solved by any library.

### 2026-08-21 — WCAG 2.2 Level AA, with something that can fail
`architecture-guardian` found accessibility asserted in `SKILL.md` §2 with no standard, no test and nothing in the Definition of Done — a rule a reviewer could not apply and a developer could not fail. This settles it.

**Level AA.** Level A omits colour contrast, which is the criterion that decides whether a leader can read an attendance figure on a phone in a hall at fifty. Not AAA: 7:1 contrast and its reading-level requirement are not achievable for this material, and a standard nobody meets is one everybody ignores.

**Made checkable in three parts**, recorded under Definition of Done: the palette is checked deterministically on every build, axe-core runs in CI from the first real screen in Stage 2, and a pull request adding a screen states how it meets the four criteria automation cannot see. The phasing has a terminating condition rather than being open-ended.

**§23 names six criteria, in four groups, because this system's rules bear on them.** 1.4.11 splits the palette into a decorative border and a control border, so reaching for the wrong one on a form field is visible. 2.5.8 exists because Cell attendance is recorded by tapping down a roster on a phone, often standing, where a mis-tap is a wrong attendance record. 3.3.8 is why paste in the password field is never blocked, written into §6 as well: a password is itself a cognitive function test, and the criterion permits one only where a mechanism assists in completing it, which is the password manager. Blocking paste removes the thing conformance rests on. 2.4.11 is what makes the keyboard path usable and cannot be seen in a screenshot.

Conformance is about perceiving and operating the interface, and licenses nothing about meaning: §13, §17 and §19 still forbid encoding meeting status, coverage or a leader in colour at any contrast ratio.

The native clients are deliberately out of scope. Their framework is not chosen, and their equivalent obligation is the platform accessibility API rather than WCAG.

### 2026-08-21 — Twelve findings from the Stage 1 verification, and why they existed
`architecture-guardian` reviewed the Stage 1 branch **once, before its fixes**, and the branch was merged without re-running it on the eight fixes that review produced. A later pull request established that a fix batch introduces defects about as often as new writing does; a verification pass over merged `main` found twelve, four of them from that unreviewed batch.

The lesson is procedural and is now written into Branches and pull requests above: **the review runs again on what the review produced.** Arriving at human review with findings addressed is the point; merging the addressing itself unreviewed gives that up.

The four that were live defects:

**A counting trigger is not a constraint.** The `SENIOR_PASTOR` cap counted active rows in a deferred trigger, and under READ COMMITTED neither of two concurrent transactions sees the other's uncommitted row — both count two, both commit, three Senior Pastors. This is the failure authorization case 7 exists to warn about, written while citing it. Fixed first with a transaction-scoped advisory lock, and then replaced by the slot column and its unique index (ruling below), which needs no lock and survives a restore.

The reason first recorded for rejecting a `senior_pastor_slot` column — that §7 gives `account_roles` its shape and that shape has no slot — does not survive scrutiny. `refresh_tokens.replaced_by_id` was the counter-example, a column §6's shape did not list, added because a rule required it; that was drift rather than licence, and §6 now carries it. The point stands without the precedent: a shape is amended when a rule needs a column, deliberately and in the same change. The honest position is that the slot with a partial unique index is the **stronger** design, because a unique index is enforced under `pg_restore --disable-triggers` where a constraint trigger is skipped entirely. The lock closed the race; it did not close the restore path. The slot was adopted the same day — see the ruling below — and the trigger is gone.

**Refresh-token rotation was not atomic.** Issue-then-revoke, in two statements, with the revoke's row count discarded — so two requests presenting one token could both mint a replacement while only one revoke landed, and the reuse signal §6 requires was never raised for the loser. Rotation now claims the presented token conditionally inside a transaction and treats a lost claim as reuse.

**Authorization case 3 asserted a fact the tree no longer contained.** Inserting Ben to give case 4 a non-root upline left case 3 asserting Raymond's leader was Oriel. Masked while every case dies on a 404, and it would have blocked Stage 2's own exit criterion the moment the endpoint returned 403 — with the obvious temptation to weaken the assertion rather than fix it.

**The migration guard had a silent off switch.** A file carrying a plain `-- migrate:down` line above the `refuse-if-populated` directive matched the plain one first and disabled the guard, with no error. The directive is now parsed on its own and its placement is checked. Its table list also named five of the nine tables the down drops, omitting the grant history §7 calls audit material.

Also closed: an `-- migrate:irreversible` marker above the up marker recorded an empty migration as applied; the CI job for the eleven concluded success whatever happened, so "failing for the right reason" was asserted and never checked; and two rules — `granted_by` on a role, and `read_only` null for role authority — had no test holding them.

### 2026-08-21 — Migration 0001 may be corrected in place until first deployment
Twice now a defect in `0001_foundations.sql` has been fixed by editing the file rather than by writing a new migration, and both times the choice was made without being recorded. The Running the project section says an applied migration is checksummed and that editing one is refused, so this is either a ruling or it stops.

**It is allowed, and the allowance ends at first deployment.** No durable database has applied 0001: CI builds the schema from empty on every run, and nothing is deployed anywhere. There is no history for a checksum to disagree with, and the alternative is beginning Stage 2 on a schema whose first migration is known to be wrong, carrying a corrective migration that exists only because of the order we happened to review in.

The cost is real and accepted: a developer who applied 0001 locally sees `migrate:up` refuse the changed checksum and must rebuild their development database. That is a minute of work now and impossible later, which is the whole distinction.

**The phase ends the first time this schema is applied to a database anybody depends on.** From that point 0001 is immutable and every correction is a new migration, as the migration policy says. This mirrors the initial-encoding relaxation in §2: a relaxation attached to a phase with no defined end is a permanent relaxation, so the end is defined here.

### 2026-08-21 — Simultaneous presentation of a refresh token is not reuse
Two requests presenting the same live refresh token at the same instant: one wins the rotation, the other is refused, and nothing else happens. The winner's session survives and no account-wide revocation follows.

§6 defines the reuse signal as a presentation **after** use, and that case is unchanged — a token that already reads as revoked and carries a replacement still revokes every session on the account. Simultaneity is different: two calls hitting 401 together is what an ordinary mobile HTTP interceptor does, and treating it as theft signed a leader out of every device for behaving normally, on clients §2 says cannot be force-updated.

The cost is real and is written into §6 rather than glossed: an attacker racing a stolen token within the same instant is not caught at that moment. They are caught on the next presentation, which is the case the specification actually describes.

Two rules that make the marker work are written to §6 alongside it, because both were found only after they had been got wrong: `issued_at` is stamped by the API process rather than by a database default, so the comparison spans one clock; and rotation is ordered against revocation by a row lock on the account, taken first by both paths, because a marker read outside the rotation's transaction cannot see a revocation still in flight — and two paths taking the same pair of locks in opposite orders deadlock, with the revocation the likely victim. Written to `SKILL.md` §6.

### 2026-08-21 — `account_roles` gains `senior_pastor_slot`
Two slots; a holder occupies one; a partial unique index over the slot permits no second occupant. Revoking a row frees its slot, which is how a succession happens. The number is a seat, not a rank, and it orders nothing.

This replaces a constraint trigger that counted active rows. The count was made race-free with an advisory lock and was still the weaker design, because `pg_restore --disable-triggers` skips a constraint trigger and does not skip a unique index — so a restore could load a third Senior Pastor in silence, at exactly the moment nobody is watching.

The reason first recorded for refusing the column, that §7's shape has no slot, was the wrong test. A shape is amended when a rule needs a column, deliberately and in the same change, which is what this is. Written to `SKILL.md` §7.

### 2026-08-21 — A row of an effective-dated table is never deleted
**Partly superseded** the following day by "Seven Stage 2 rulings" below. The closing sentence, that whether `refresh_tokens` and `account_tokens` may be pruned is open, was settled: they may be, thirty days past expiry, and a trigger now enforces the floor. The exclusion itself stands and so does everything else here.
`person_lifecycle`, `network_assignments`, `pastoral_assignments`, and every table that follows their shape. A row entered in error is corrected by closing it and opening the right one, which is what effective dating is for. Enforced by a `BEFORE DELETE` trigger on each, not by convention.

Principle 12 said history is preserved and §5 said a row is never overwritten in place; neither addressed `DELETE`, and the schema permitted it. That made it the one write passing none of the same-Network checks, since both triggers fire on insert and update: removing a person's current Network row turns every open edge beneath them cross-Network, with nothing raised and nothing to revisit it.

It reaches `account_roles` and `capability_grants` too. §7 says a grant is revoked by setting `revoked_at` and never by deleting the row, because the history of who could do what, and when, is part of the audit record — so the rule was already stated for them and only the enforcement was missing.

`refresh_tokens` and `account_tokens` are excluded: they carry operational state rather than history, and whether they may be pruned is recorded as open rather than assumed either way.

`TRUNCATE` fires no row trigger and stays available, because it is how the test suite resets. What is meant to keep it safe is privilege rather than the trigger — §24's least-privilege credentials — and that role does not exist yet, so the exemption is currently unprotected. Recorded as open rather than claimed. Written to `SKILL.md` §5.

### 2026-08-22 — A sign-in landing inside a revocation's transaction survives it
The marker is the boundary. A refresh token whose `issued_at` is at or before `sessions_revoked_at` is dead whatever its own row says; one issued after it is a new session and is untouched.

Found by `architecture-guardian` reviewing the lock-order fix. Issuing a refresh token takes no lock on the account — the foreign key's `FOR KEY SHARE` does not conflict with the `FOR NO KEY UPDATE` the revocation holds — so a sign-in can commit inside the revocation's transaction, after the marker's timestamp is read and before the transaction commits. The code let it survive, one comment asserted it was killed, and `SKILL.md` did not address it at all, so the behaviour was a consequence of a lock mode rather than a rule anyone had chosen.

`FOR UPDATE` would close the window, by making the insert's foreign-key check wait on the account row too. It is rejected because it achieves nothing: revocation ends the sessions that existed when it ran and was never a bar on signing in again, so somebody holding the password succeeds a moment later regardless. The window is not a security boundary and cannot be made into one by a lock.

It is **not** rejected on the cost first recorded here, that it would put a lock on the sign-in path. Sign-ins already wait on that row — `recordLogin` stamps `last_login_at` on the account before a token is issued — so most of that cost is paid already, and the window is correspondingly narrower than it looks: reaching it needs `recordLogin` to have committed before the revocation took the row, leaving only the insert inside. The first version of this entry had the cost wrong and the conclusion right, which is worth recording, because the reason is the part that gets reused.

Written to `SKILL.md` §6, which now carries three rules for immediate revocation rather than two.

### 2026-08-22 — Seven Stage 2 rulings, settled before any Stage 2 code

Stage 2 opened with four Stop Conditions and three confirmations outstanding.
All seven are settled here, and each is amended into `SKILL.md` in the same
change. Three of them close items this log has been carrying as open since
2026-08-20; two close items opened by the Stage 1 verification.

**Refresh and activation tokens may be pruned, thirty days past expiry.** This
is the one exception to §5's no-deletion rule, and the floor is set by the
reuse signal rather than by the token's validity.

The catch was not previously written down anywhere. A rotated row is revoked
and carries a `replaced_by_id`, and §6 makes that pair the whole difference
between a stolen token and one the system never issued. Prune it and a
presented copy resolves to nothing, so it is refused as unknown and no
account-wide revocation fires — the theft is not merely undetected, it is
indistinguishable from a typo. So any retention rule has to outlive what can
still be presented, and thirty days beyond a thirty-day token is that.

Two costs are accepted in writing rather than discovered: a long-expired
stolen token stops raising the alarm, which today it does because the reuse
check runs before the expiry check; and rows must be deleted oldest first,
because `replaced_by_id` references `refresh_tokens` with no cascade and a
row is still referenced by the one it replaced. Nothing requires a retention
job to exist — the ruling permits one and bounds what it may touch. Written
to `SKILL.md` §6 and §5.

**`CHECK (ended_at > started_at)` is relaxed to `>=`.** §5 prescribes closing
a row entered in error and opening the right one, and the strict form made
that impossible to perform honestly: the only close it permitted recorded a
non-zero period during which a fact that was never true was in force.

Two safety properties were verified against the SQL before the ruling, and
both hold. A zero-length row is invisible to an as-of lookup, because
`network_as_of` asks for `started_at <= t AND ended_at > t` and no `t`
satisfies both. It occupies no one-open-row index, because every one of those
is partial over `ended_at IS NULL` — checked against every effective-dated
table, not only `network_assignments`.

**A third claim was asserted and was false, and is corrected here.** The
ruling as first written said the same-Network check on a Network change
"neither validates a zero-length row nor is broken by one", on the reasoning
that such a row is neither open at the effective date nor beginning after it.
It can be the second. A zero-length row whose shared timestamp falls after the
effective date satisfies `ended_at > v_row.started_at`, so it is selected and
compared at its own timestamp — and being closed, it cannot then be reassigned
to resolve what it reports.

Found by `architecture-guardian` on this branch, which is the point of running
it: the two properties that were checked held, and the one that was reasoned
about did not. `SKILL.md` §5 now says a zero-length row is inert as an
*answer* and is not thereby excluded from being *examined*, and §4's backdate
floor counts its timestamp like any other.

The cost is that an inert row is also an invisible one, so a defect closing a
live row at its own start date removes it from every query silently. That is
domain-layer discipline, not a schema property, and is written as such.

Landed by editing `0001_foundations.sql` in place, under the exception of the
2026-08-21 ruling, alongside migration 0002 — not as a corrective migration
afterwards. Nothing is deployed, so there is no history for a checksum to
disagree with, and beginning Stage 2 on a first migration known to make a
prescribed correction impossible is the alternative. Written to `SKILL.md` §5.

**A backdated Network correction reaches only to the person's most recent
pastoral event, in either direction of the tree.** *(**Amended** later the same
day by "A Network change is refused while the person leads anyone" below. Two
changes: the floor lost its leader-side `started_at` term, because open downline
edges can no longer exist at correction time and closed ones are dominated by
the `ended_at` term; and the bound became **strictly later than** the floor
rather than at-or-after, since both remaining terms fail at exact equality. The
two-term, exclusive form in `SKILL.md` §4 is the current rule. The reasoning
below stands, and the arithmetic does not.)* That is the latest of: the
start of their current assignment, the start of every assignment on which they
are the leader, and the end of every already-closed assignment touching them
either way. Further back there is no legal write that resolves it: the
reassignment §4 demands cannot be made for a period that has already ended,
and rewriting a closed row is forbidden by Principle 12 and §5. Permitting the
attempt would mean permitting a failure with no remedy.

**The first version of this ruling bounded only the person's own assignment,
and that was wrong.** The same-Network trigger selects edges where the person
is the `person_id` *or* the `leader_id`, so a floor covering one side leaves
the other unbounded — and two downline cases have no remedy at all: an edge on
which they are the leader that closed after the effective date, and an open
one that began after it, which can be closed neither at the effective date
(that precedes its own start) nor at its own start (it is then still selected).
A correction backdated inside a leader's own assignment could therefore still
fail with nothing the administrator could do, which is the exact failure this
ruling exists to prevent.

Found by `architecture-guardian`, and worth recording as a pattern rather than
a one-off: the rule was written by reasoning about the trigger's *purpose* and
not by reading its `WHERE` clause. Both defects corrected on this branch came
from that same shortcut.

The system rejects with the earliest date the correction can legally take,
answering `INVARIANT_VIOLATION` — it is a rule about what can be recorded,
not about the actor's authority over a target, which is the distinction §22
draws between that code and `SCOPE_DENIED`.

Two alternatives were rejected. Permitting it and flagging the stranded edge
would make §4's same-Network guarantee no longer absolute, which is a larger
change than the problem warrants and would have to be said in §4 rather than
here. Escalating each case as a Stop Condition is honest and leaves the Stage
2 endpoint with no behaviour to implement.

The accepted cost is that closed periods keep the Network recorded for them,
including where it is now known to be wrong. §3's reproducibility guarantee
already argues for that: those months have been reported, and a leader may be
holding one on paper. Where the true history matters it belongs in the audit
entry the correction already writes, not in a rewritten relationship row.
Written to `SKILL.md` §4.

**A Network change and the reassignment it forces share one exact effective
instant.** The schema already required it and nothing said so. The old edge
escapes validation only at exact equality, because the check considers edges
open at the effective date or beginning after it; closed a microsecond later
it is open at the date, is compared with the corrected Network in force on
one end and the old one on the other, and is rejected — correctly, because
for that microsecond it was genuinely a cross-Network edge.

So this writes down what the schema enforces rather than changing anything.
It is worth a ruling because the failure of leaving it implicit is specific:
an implementer meets a constraint violation, reads it as two timestamps being
too close together, and separates them — which does not fix the write, and
which would open the gap if the check were ever loosened to admit it.
Enforcing the equality with a second constraint was considered and rejected:
it spans two tables on one logical operation and would need its own deferred
constraint trigger, which is more machinery than the rule earns. Written to
`SKILL.md` §4.

**A form field failing validation carries `field-invalid`.** One token, and
the only one of its kind, closing the question §23 explicitly left open and
which an earlier version of the contrast check had quietly decided by
refusing `error` and `critical`.

The name is the ruling. `field-invalid` describes the state of an input, and
`field-` is a prefix that does not travel — a Cell is not a field, and a
leader is not a field. `error` and `danger` were refused on §23's own
argument, that a token is used by whoever writes the next screen on whatever
it seems to fit, and a token called `error` eventually colours a Cell that
reported `NOT_HELD`. It carries 1.4.11's 3:1 against its surface, since the
invalid state of a control is exactly the component state that criterion
names, and it is never the sole indicator, which 1.4.1 requires and which
matters for a leader reading a phone in a hall. Written to `SKILL.md` §23.

**The client libraries are confirmed.** TanStack Query, TanStack Table,
`lucide-react` and `next/font`, installed with the first real screen rather
than now. A chart library is deferred to Stage 5, where the first chart is.
This stays in this log and out of `SKILL.md`: §2 carries the rule — headless
primitives, no framework with its own design system — and a vendor meeting
that rule is not a rule.

**`settings` is in Stage 2 scope.** §2 puts the initial-encoding phase flag
under `settings.manage`, and Stage 2 runs the import inside that phase.
Without the table the relaxation has no terminating condition, which is the
exact failure the 2026-08-20 ruling on closing the phase was written to
prevent. It lands in migration 0002 beside `audit_log` and `idempotency_keys`.
`docs/ROADMAP.md` named only those two and is corrected in the same change.

### 2026-08-22 — Four enforcement gaps found reviewing the Stage 2 rulings

Grouped because each is the same shape as the two ruling defects above: a rule
stated in prose with nothing able to fail on it.

**The §6 retention floor is a trigger, not a convention.** `refresh_tokens` and
`account_tokens` gain a `BEFORE DELETE` trigger refusing any row whose
`expires_at` is not yet thirty days past. The ruling permitting the prune is a
security control — the obvious retention query, `DELETE ... WHERE expires_at <
now()`, deletes exactly the rows still carrying the reuse signal — and the
Definition of Done requires an invariant expressible as a constraint to exist as
one. It lands in 0002 as additive DDL on 0001's tables.

**`audit_log.target_id` is `text NOT NULL`, not `uuid`.** §21 lists "System
setting changed" as auditable and §7 keys `settings` by `key`, so a `uuid`
column left the one auditable action migration 0002 introduces unable to name
its target, and §7's rule that an audit entry resolves scope through its target
with nothing to resolve. No foreign key: an append-only entry outlives the row
it describes. §21's shape is amended in the same change.

**`settings.updated_by` is nullable, and §7 now says so.** It is null for the
system action that seeds the defaults, mirroring `account_roles.granted_by`.
The 2026-08-21 slot ruling settled that a shape is amended when a rule needs a
column, deliberately and in the same change; leaving the migration more
permissive than the shape is the same drift by the other route.

**The idempotency key is unique per account, and that is in §22 rather than in
a migration comment.** Two accounts may present the same key. It is
client-generated and therefore not a secret, so global uniqueness would let a
client that reused an observed key receive another account's stored response,
or deny that person their own retry. `IDEMPOTENCY_KEY_REUSED` means "already
used by this account for a different request".

Also corrected: `error` was added to the web palette's forbidden token names,
which §23 rejects by name but the check could not fail on; the 2026-08-21
no-delete ruling is annotated as partly superseded by the pruning ruling; and
`migrate:down --all` no longer claims a guard "stops the whole descent", since
each migration's down commits in its own transaction and a guard firing at N
does not undo the drops already made for N+1.

### 2026-08-22 — A Network change is refused while the person leads anyone

The last Stage 2 Stop Condition. A Network correction must reassign every edge
it would strand, and the same-Network trigger validates edges in both
directions, so correcting a leader with twelve disciples means twelve
reassignments at one identical instant. Nothing said who chose those
destinations.

**Nobody does, inside the correction.** The change is refused while the person
holds any open assignment as leader, naming the disciples to move first. Each is
moved by an ordinary reassignment, separately authorized and separately audited,
and the correction is retried once none remains. §3 already does exactly this
for archiving a Person who leads a Cell, and §4 already says it in general:
reject and require the conflict resolved rather than resolving it silently.

Two alternatives were rejected. An administrator supplying twelve destinations
inside one correction payload makes the most complex endpoint in Stage 2 out of
a data-correction form, and puts twelve pastoral decisions in it. Moving each
disciple automatically to the corrected person's own former leader is
deterministic and pastorally plausible — the grandparent is by construction in
the disciples' unchanged Network — but it decides a pastoral question in code
and has no answer when the corrected person is a Network root.

The refusal also simplifies what remains. With no open downline edge, the only
edge the correction must resolve is the person's own, which is the single atomic
pair §4 already describes. It removed a term from the backdate floor too: open
downline edges no longer need one, because the change is refused while any
exists, and a floor carrying a term that can never bind reads as though it were
doing work.

**The two directions would have taken opposite destinations**, which is the
other reason to keep them apart. The person being corrected moves to a leader in
their **new** Network; a disciple moves within their **own, unchanged** one. A
first draft of §4 applied the disciple rule to both and so described the one
write the trigger rejects.

The accepted cost is stated in §4 rather than left to be met: moving a disciple
closes their edge today, that `ended_at` becomes the floor immediately, and a
correction for someone whose disciples have just been moved therefore cannot be
backdated at all. Clearing the blockage does not unblock backdating; it fixes
the effective date to today. Written to `SKILL.md` §4.

### 2026-08-22 — `people.correct_sex`, the twenty-fifth capability, Admin-only

Found by the third `architecture-guardian` pass, and it predates this branch:
§7 declares its capability list closed, §7 says sex "is governed by its own
capability", and no such capability existed. §7 also rules that an endpoint
declaring no capability is denied — so the Stage 2 sex-correction endpoint,
whose behaviour this branch had just specified in detail, could not have
declared a guard at all.

**Admin alone, Whole Church.** Not Senior Pastors, not Leaders. Correcting a
person's sex moves them between Networks and can change totals for periods
already reported, which is the property that keeps `people.merge` and
`records.backdate_effective_date` with the role whose job is data correction. It
also forces the pastoral reassignment §4 requires, so a leader holding it would
have a route to moving people between Networks without ever invoking
`people.manage_pastoral_assignment` — the same escalation §7 closes by keeping
sex out of `people.edit_basic`.

Folding it into `people.manage_lifecycle` was rejected. It adds no name to a
closed list, which is the only thing in its favour, and it would hand Senior
Pastors the power to move people between Networks while bundling two unrelated
rules under one grant.

Landed in one change across the five places a closed enumeration lives: the §7
list, the role catalog, the §4 text that now names it, the `capability` enum in
0001, and `capabilities.ts`. The enum order is asserted against
`ALL_CAPABILITIES`, so the two cannot drift. `read_only` on it is rejected at
creation, since it is a write.

### 2026-08-22 — Idempotency covers the authenticated write surface, and applies by default

§22 says "every state-changing request" carries an `Idempotency-Key`, and the
`idempotency_keys` shape §22 itself gives is keyed by account. Those two cannot
both be unconditional: an unauthenticated request has no account, so the store
cannot hold a row for it.

**The rule reaches every authenticated state-changing request.** The exempt set
is exactly §7's closed unauthenticated list — sign-in, token refresh, password
reset, activation, the probe — so the exemption is closed rather than a
judgement anyone extends. Derived from §22's own shape rather than invented, but
recorded because it is client-visible.

**It applies by default, not per endpoint**, for the reason §2 gives for the
capability guard: a convention remembered inside each handler is only as
reliable as the least familiar developer writing the newest route. A new write
endpoint is covered the moment it exists.

That reaches `logout` and `logout-all`, which are authenticated and
state-changing. Exempting them was considered and refused: §7 carves out
session endpoints from the *capability* guard, and borrowing that carve-out for
idempotency would be applying a rule to something it was not written about —
the mistake two review passes have already caught on this project. §22's
sentence is unconditional, and a retried sign-out returning the first answer is
better behaviour than a second revocation attempt.

**Nest applies a handler's status *before* the interceptor chain runs**, so
`res.statusCode` inside the interceptor is already the handler's — 201 for a
POST, whatever `@HttpCode` declares where one is present. That is what the
stored status is read from, and it is also what makes the replay path work: the
interceptor's own `.status()` call comes later and therefore wins.

*The first version of this entry said the opposite, and was wrong.* It claimed
the status was applied after the chain and had to be re-derived from
`@HttpCode` or the method. That reading came from `responseController.apply(result,
res, httpStatusCode)` late in `router-execution-context.js` — but `setStatus`
runs earlier: after the guards and before the interceptor chain. `apply`'s third
argument is `undefined` there, because `createHandleResponseFn` is invoked with
three arguments and declared with four. The re-derivation computed the same
numbers, so nothing broke; the recorded *reason* was false, and it asserted the
framework behaved in the way that would break the replay path in the same file.

*The first correction got the mechanism wrong too*, saying `setStatus` runs
"before the guards' own call site" when it runs after them. Both errors are the
same one: describing an ordering from a partial read. It is only worth recording
because the entry it appears in exists to warn against exactly that.

The replay path depends on `apply`'s third argument being `undefined`, which is
an arity accident rather than a documented guarantee. It is pinned by the case
asserting a replayed 409 on a route whose declared status is 201, which fails if
Nest ever starts passing it.

Worth keeping as a pattern rather than a footnote: this is the third time on
this project that a rule was written by reading part of a mechanism and
reasoning about the rest. The other two were the backdate floor and the
zero-length row.

**A 4xx is stored and a 5xx releases the key.** A domain refusal is this
request's outcome, decided by the rules, and a repeat of the same body is
entitled to the same answer. An unexpected failure carries no decision and rolls
back, so nothing was recorded and a retry cannot double-apply; storing it would
pin a transient failure to the key for a day with no way past it.

**The fingerprint is taken over a canonicalized body.** Nothing forbids a client
reordering object keys on a retry and several JSON libraries do, and treating
that as a different body answers `IDEMPOTENCY_KEY_REUSED` — which §22 makes
permanent and says must never be retried, turning an ordinary retry into a dead
end. Arrays keep their order, because order is meaning in an array.

Written to `SKILL.md` §22 — **except that these last two were not, and reached §22
only on 2026-08-23**: the 4xx/5xx split and the canonicalized fingerprint were
implemented, recorded here, and claimed as specified. The gap surfaced when a later
ruling cited §22 for the store/release rule four times over and
`architecture-guardian` went looking for it. "A decision that lives only in a chat
session does not exist" applies equally to one that lives only in this log and in
the code, and nothing checks a "Written to §22" claim.

### 2026-08-22 — A claim and a response are bounded separately

`expires_at` was doing two jobs of different lengths: retaining the response for
§22's "at least 24 hours", and bounding how long a claim may sit unfinished. A
request whose process died left its row `IN_FLIGHT` for the full day, and every
retry was answered `REQUEST_IN_FLIGHT` — which §22 defines as "retry after a
short delay". A day is not a short delay, and the caller never learned the
outcome.

`claimed_at` bounds the attempt; `expires_at` keeps the answer. A claim older
than a one-minute lease may be taken over. Migration 0003 adds the column and
§22's shape is amended in the same change, per the rule that a shape is amended
when a rule needs a column.

Two smaller items settled with it, both client-visible and neither derivable:
a request **missing** the header is `VALIDATION_FAILED` — a required header that
is absent is malformed input; and a replay reproduces **the status and the body
and nothing else**, which is written into §22 as a constraint on endpoints rather
than a limitation of the store: no state-changing endpoint may put meaning in a
response header, because a `Location` or an `ETag` would not survive a retry.

**What the lease does not close, and is recorded as open below.** It bounds an
abandoned attempt, and it cannot distinguish one abandoned *before* the write
committed from one abandoned *after*. For the second, taking the claim over
means executing a committed write again — sooner than before, not never. That
window is narrow and real, and closing it needs the completion to share the
write's transaction rather than follow it.

### 2026-08-22 — A write endpoint records its idempotency completion in its own transaction

The gap the claim lease narrowed and could not close. The claim is taken before
the handler and, left to the interceptor, recorded after it — so a failure in
between (a dropped connection, a killed process, a statement timeout) leaves a
committed write with an unfinished claim. The lease then lets a retry perform
that write again, sooner rather than never.

**The completion joins the write's transaction.** The effect and the record of it
commit together or not at all, which is the only arrangement that closes the
window rather than shrinking it.

The two paths compose without coordinating, which is what makes this cheap.
`complete` carries `state = 'IN_FLIGHT'` in its predicate, so once a handler has
set the row to `COMPLETED` inside its transaction, the interceptor's call
afterwards matches nothing and leaves it alone. Nothing has to tell the
interceptor that the handler already recorded itself, and an endpoint that writes
nothing keeps the old path unchanged — there is nothing to perform twice.

Two alternatives were rejected. Requiring every write endpoint to be safe to run
twice puts the burden on each one forever, and §5's reassignment is not naturally
re-runnable: a second run closes and reopens rows that were already correct.
Accepting the window and documenting it is honest but wrong for this system —
attendance exists nowhere else (§24), and a duplicated submission is exactly what
§22 says the header exists to prevent.

`completeWithin` takes the caller's transaction and is the mechanism. Its
parameter is typed `Transaction<Database>` rather than the pooled connection, so
the one mistake a write endpoint can make — recording outside the transaction it
just wrote in, which reopens the whole window and reads as compliant at the call
site — is a compile error rather than an invisible one. That is the standard §2
sets for the capability guard and §22 sets for the interceptor.

**The trade is recorded rather than glossed.** The record now commits *ahead of*
the outcome: the handler names its own status and body inside the transaction,
before the framework has produced a response. Anything that changes the response
afterwards leaves the stored answer disagreeing with the sent one, and the
interceptor cannot correct it, because its own call carries `state = 'IN_FLIGHT'`
and the row is already `COMPLETED`. §22 therefore requires what is recorded to be
the response the endpoint returns, and requires the recording to be the last
statement in the transaction — it holds the key's row lock, and a concurrent
retry waits on that lock instead of being answered `REQUEST_IN_FLIGHT`.

**A claim gained an identity in the same change, closing a defect that was
already on `main`.** The lease lets a request take a key over, and a takeover sets
`state = 'IN_FLIGHT'` again — which was the only thing completion and release
matched on. So a slow request whose lease expired could complete or release the
claim that replaced it: storing its response against another request's work,
discarding that request's completion silently, and, since a takeover also
rewrites the fingerprint, leaving one request's response stored under another's.
Migration 0004 adds `claim_id`, minted per claim including on takeover, and every
write against the row carries the identity it was given.

That defect shipped with the lease and was found only because this branch added a
comment claiming it was handled. The comment was wrong, and being wrong in
writing is what made it visible — which is an argument for stating a mechanism's
guarantees explicitly even when nothing yet depends on them.

*An earlier version of this entry claimed the composition depends on READ
COMMITTED, and that under REPEATABLE READ the interceptor's statement would raise
a serialization failure. That is wrong.* The interceptor's `complete` runs on the
pooled connection with no explicit transaction, after the handler's has already
committed, so it takes a fresh snapshot at statement start under any isolation
level and simply matches nothing. There is no earlier snapshot to conflict with
and no blocked statement. The composition does not depend on the isolation level
at all.

Recorded rather than deleted because it is the same fault the entry above
describes — a guarantee asserted about a mechanism from a partial reading of it —
committed in the entry written to warn against it.

Written to `SKILL.md` §22.

### 2026-08-22 — `people.create`, and how a Tier 1 duplicate is refused

Two rulings the `people` module could not be written without, both the same shape
as `people.correct_sex`: §7 declares its capability list closed, and had nothing
for either.

**`people.create`, the twenty-sixth capability.** Leader at own/subtree, Admin and
Senior Pastors at Whole Church — the scopes `people.edit_basic` carries, because
§9 has ordinary leaders registering VIPs and that workflow creates most Person
records. Routing them through Admin would stall it.

Scope resolves against **the pastoral leader the new Person is placed under**,
which §9 step 3 already requires the request to carry. That is what stops a leader
placing someone into a branch they do not oversee, and it settles the case a
subtree-scoped actor cannot reach: creating a Person under nobody. §5 permits an
unassigned Person, but only the import creates one, and the import runs as Admin
through the service rather than through this endpoint.

Folding creation into `people.edit_basic` was rejected: §7 defines that capability
as covering "corrections to a person's own descriptive fields", and the name would
stop describing what it grants.

**`DUPLICATE_ACKNOWLEDGEMENT_REQUIRED`, 409, carrying the candidates.** §3 requires
a Tier 1 candidate to be acknowledged before a Person is created, and also says
the system never blocks creation — so this is not a refusal, it is the request for
that acknowledgement. The client shows the candidates and resubmits with them
acknowledged.

Deliberately not `VALIDATION_FAILED`. The input is well-formed and the answer is a
human decision; a client branching on a validation code would render a duplicate
as a field error. That is the argument §22 already makes for
`IDEMPOTENCY_KEY_REUSED` not being one.

Written to `SKILL.md` §7 and §22.

### 2026-08-22 — Three rulings the `people` module needed, all found by review

**A sex mismatch annotates a duplicate candidate; it does not demote it.** §3's
Tier 1 conditions carry no sex term, and §3 separately calls sex "a frequently
mis-keyed field". The first implementation demoted a Tier 1 candidate to Tier 2 on
a mismatch — which quietly removed the acknowledgement requirement from precisely
the candidates most likely to be one person recorded twice: same name, same
birthday, sex entered wrong. The discrepancy is carried in the candidate's reasons
instead, where the person deciding sees it. A differing suffix follows the same
rule.

**An archived Person may not be the destination leader of a new assignment.** §5
refuses to *reassign* an archived Person and says nothing about them acquiring a
disciple, so the first implementation allowed it. A live pastoral edge under a
Person who is not `CURRENT` corrupts every subtree total walking through them —
the corruption §3 refuses when archiving a Person who leads a Cell. Written to §5
beside the merged-Person prohibition, answering `INVARIANT_VIOLATION`.

**Tier 2 candidates surface through a pre-flight lookup, not through creation.**
§3 says a Tier 2 candidate is "presented in a candidate list" and §22 sketched no
route for one, so they were computed and discarded: creation can only ever refuse
on Tier 1. `GET /api/v1/people/duplicate-candidates` is that list, and §9 already
asks for it as the first step of registering a VIP.

Returning them on the create response was rejected: it puts a duplicate-review
payload on every successful creation, and acts after the record exists rather than
before. Deferring was rejected because §3 says the matcher earns its keep during
the initial encoding effort, which is this stage's own step 11.

**The ruling had a consequence worth closing in the same change.** Match reasons
name the field that matched, so "same birthday" asserts that an out-of-scope
person's birthday equals a value the caller submitted — a disclosure §8 forbids.
Reasons are therefore withheld for a candidate outside the viewer's scope; the
tier still travels, because the encoder needs to know how strong the match is.

*The first version of this entry said the same leak on **creation** was tolerable
"because a probe there creates a record every time, which is loud", and the
second version called that false. Both were wrong, in opposite directions.*

A probe that **hits** throws before the transaction opens and writes nothing. A
probe that **misses** falls through and creates a Person — a Member ID off the
sequence, a Network row, a lifecycle row, an assignment, an audit entry. So
enumerating a birthday through creation writes tens of thousands of records,
which is what "loud" meant and is very nearly right; a single confirmatory probe
against a value already suspected is quiet, which is what the correction was
reaching for. Scoping the refusal identically is the right remedy either way, and
it stands.

Recorded rather than tidied, because this entry has now carried a wrong reason
twice — in the entry written to warn that a wrong reason here is worse than
none.

### 2026-08-22 — A duplicate candidate outside the viewer's scope carries no tier

§3 as first amended let the duplicate lookup return a candidate's tier
church-wide, and §8 forbids disclosing an out-of-scope person's birthday or
mobile number. Both could not stand, and the contradiction was introduced by the
amendment rather than found in the specification.

**The tier is withheld out of scope, along with the reasons.** What travels is
that the person is a possible match — which is what §3 needs the encoder to know:
somebody may already be recorded, so stop and ask the leader who holds them.

The tier had to go because it *is* the disclosure. It is derived from which rule
fired, so with an equal first and last name Tier 1 means the submitted birthday
matched and Tier 2 means it did not. Returning it church-wide is a yes/no
birthday oracle over a name §8 already makes visible — enumerable over a few
thousand values, answered 200 every time, writing nothing. Withholding the
reasons while keeping the tier hid the wording and kept the information, which is
the shape of the two corrections above it in this log.

Two alternatives were rejected. Amending §8 to permit the tier, with a rate limit
and an audit entry per lookup, is honest but widens the section that exists to
stop exactly this, for a convenience the encoder does not need — knowing someone
is a possible match is enough to make them ask. Scoping the rows to the viewer's
subtree closes it completely and defeats the endpoint: a cross-branch duplicate
is the one §3 says the matcher exists to catch, and §8 makes the directory
church-wide for that reason.

Written to `SKILL.md` §3, which now states the redaction rather than sanctioning
the leak, and applies it to the Tier 1 refusal as well.

### 2026-08-22 — Membership of a candidate list is itself a disclosure

Three attempts at one redaction, and the first two failed the same way: each
removed a field from the returned object while the answer stayed in the response
by construction.

First the reasons were withheld out of scope, because they name the field that
matched. Then the tier, because a tier is derived from which rule fired and so
carries the same fact one step removed. Neither touched **which candidates were
returned** — and with a first name matching nobody, the only rule that can fire
is the one comparing birthdays, so presence in the list *is* the predicate "this
person's birthday equals the value I submitted". One bit per request, 200 either
way, nothing written. Substituting a mobile number confirms a suspected number in
a single request.

**An out-of-scope candidate is surfaced only where the rule that matched rests on
what §8 already publishes** — the names and sex. Membership is then a function of
nothing §8 protects, which is the property the first two attempts were reaching
for and neither expressed.

**The test is whether a publishable rule *would* have matched, not which rule
actually won**, and getting that backwards cost a CI round. The matcher runs
twice: once on the subject as given, and once on a subject stripped of everything
§8 protects. The second run decides membership out of scope.

Keying it on the winning rule instead — a flag the rule sets when it reads a
protected field — hid anyone matching on *both* their names and their birthday,
because the stronger rule wins and the stronger rule reads the birthday. Their
presence was already explained by the names, so hiding them protected nothing and
lost a real candidate. The failing test said so before the reasoning did.

Both runs happen inside one service method used by every surface, so a third one
cannot be added that runs the matcher once and leaks.

**Two consequences, both accepted in writing.**

Only a candidate the viewer can be shown in full may gate creation. Refusing on
an invisible one would answer "acknowledge this" with nothing to acknowledge —
and, less obviously, **the refusal is itself a channel**: every Tier 1 rule reads
a protected field, so gating on an out-of-scope candidate would make the response
vary, refused against created, with a value §8 protects. That is the same
disclosure one field further out, and it is why the gate is in-scope-only rather
than merely why the message would be unhelpful.

And a cross-branch duplicate resting on a birthday is no longer caught for a
leader outside that branch; it is still caught by the leader who holds them, and
by Admin, which is where §3 authorizes a merge from anyway.

Two alternatives were rejected. Amending §8 to permit the channel, with a rate
limit and an audit entry per lookup, trades prevention for detection on the
section that exists to prevent exactly this. Scoping the rows to the viewer's
subtree closes it and defeats the endpoint, since a cross-branch duplicate is
what §3 says the matcher is for.

*Recorded at length because the failure repeated.* Both earlier attempts were
reasoned about in terms of what the response contained rather than what the
response was a function of, and both were written into `SKILL.md` as settled
before they were. That is the same fault as the backdate floor, the zero-length
row and the Nest status ordering — a mechanism described from the part of it that
was being looked at.

### 2026-08-23 — Six rulings the sex-correction route needed, settled before the code

Section 4 describes the correction in detail and left six things undefined that an
endpoint cannot avoid answering. Each is amended into `SKILL.md` in the same change.

**An effective date is a day; the backdate floor is an instant; the refusal names
the day after the floor's day.** Section 22 makes an effective date a date-only
`YYYY-MM-DD` Asia/Manila field and section 4 states the floor at timestamp
precision, and nothing said how one becomes the other. A date-only field resolving
to an instant takes 00:00:00 of that day in the named zone — written to section 20,
which is the single authority for period boundaries, rather than to the one section
that happened to need it first.

The consequence is arithmetic and holds unconditionally, which is why the refusal
can name a date rather than echoing a timestamp: the start of the floor's own day is
never strictly later than the floor, and the start of the next day always is. An
administrator handed the raw floor would have to work out which day to submit, and
the day containing it is the one day guaranteed to be refused again.

**A correction always carries a reason.** `network_assignments.reason` is nullable
because an initial assignment has nothing to explain. A correction is what the
column exists for, and every one of them is a correction.

**A correction that changes nothing is `VALIDATION_FAILED`.** With two sexes and a
total mapping this is reachable only by submitting the recorded value. Refused
rather than accepted silently: the operation demands a reason and writes an audit
trail, and an audited correction that corrected nothing misleads whoever reads it.
The retry case it might otherwise have served is already served by
`Idempotency-Key`.

**An archived Person's sex may be corrected only where no reassignment is forced.**
Section 5 forbids reassigning an archived Person and the atomic pair is a
reassignment, so the correction is refused while they hold an open pastoral edge —
restore first. Where they hold none, which is the ordinary state after archival,
nothing is stranded and the Network change stands alone. Refusing outright was
rejected: a data correction on an archived record is legitimate, and it is
re-parenting one that section 5 objects to.

**`people.correct_sex` covers nothing at a scope narrower than Whole Church.**
Section 7 gives it one scope and the guard alone cannot hold that, because the guard
asks whether a grant covers the target — so a grant issued at `OWN_SUBTREE` would
pass for everyone inside that subtree. Held there it is precisely the escalation the
capability is Admin-only to close: moving a person between Networks, re-parenting
them on the way, without ever holding `people.manage_pastoral_assignment`. The
operation refuses with `SCOPE_DENIED`, on the same reasoning as the `read_only`
rejection — a row that cannot mean what it appears to mean is refused rather than
honoured in part.

**One operation writes one audit entry per action it performed**, and `action` is
`<noun>.<past-tense verb>`. This closes the vocabulary item this log has carried as
open. Section 21's list is open — it opens with "including" — so what is settled is
the convention, not an enumeration; without it `pastoral_assignment.transferred` and
`pastoral.transfer` are equally defensible and the log cannot be queried.

A correction therefore writes up to four entries in its own transaction:
`sex.corrected`, `network.changed`, `pastoral_assignment.transferred` where one was
forced, and `effective_date.backdated` where the date was set in the past. Section 21
lists each separately and section 5 independently requires the transfer entry to
carry its previous and new leader. One entry describing everything was rejected
because a reader searching for transfers must find that entry whether it arose from
a reassignment or from a correction. They are related by sharing an actor, a target
and an `occurred_at`; `batch_id` is not borrowed for it, because it means one bulk
import and overloading it would make an import indistinguishable from a compound
correction.

### 2026-08-23 — Reading the Network-change trigger fired twice, which is what the section 4 floor is about

Recorded as a mechanism rather than as a decision, because the floor in section 4 is
stated as a rule and is impossible to check against the schema without it — and
because on this project every rule written about this trigger by reasoning from its
purpose rather than its `WHERE` clause has been wrong.

`assert_network_change_keeps_edges` fires **twice** in one correction, and the two
firings select different edges:

- **On the `UPDATE` closing the old Network row**, the bound is the *old row's*
  `started_at`, not the effective date. That selects nearly every edge the person
  has ever held, each compared at `GREATEST(edge.started_at, old_row.started_at)`,
  and it passes only while that instant is still covered by the old Network row —
  that is, while the edge began strictly before `eff`.
- **On the `INSERT` of the new Network row**, the bound is the effective date. Edges
  with `ended_at > eff` are selected, and the old edge closed at exactly `eff` is
  not — which is what makes the one-instant rule in section 4 work at all.

They are listed in that order because that is the order they fire in. The partial
unique index `network_assignments_one_open` forces the close to precede the open, a
deferred constraint trigger's events fire at commit in the order they were queued,
so the `UPDATE` firing is the **first**.

**An earlier version of this entry said the `UPDATE` firing was the second, and
said both strictness rules were properties of it. Both halves were wrong**, and the
second contradicted this entry's own bullets four lines further down. Corrected in
place rather than deleted, because this is the entry written to warn against
describing a mechanism from the part of it being looked at, and it did exactly
that. Found by `architecture-guardian` reading the SQL.

The terms divide between the firings rather than coming from one:

- **Term (a)** comes from the `UPDATE` firing. `eff` equal to the current
  assignment's `started_at` closes it at its own start; the resulting zero-length
  row is selected there and compared at `eff`, where the person already resolves to
  the corrected Network. Hence strictly later.
- **Term (b) at exact equality with a zero-length closed edge** comes from the same
  firing, for the same reason.
- **Term (b) in its ordinary case** — an effective date below a closed edge's
  `ended_at` — comes from the `INSERT` firing, which selects anything with
  `ended_at > eff`. This is the half the earlier wording denied while its own
  bullet asserted it.

**Section 4's uniform strict form is conservative by one instant on term (b), and
that is followed rather than optimised.** For an ordinary closed edge with
`started_at < ended_at`, `eff` equal to its `ended_at` in fact passes both firings.
The strict form refuses it. Narrowing the rule to zero-length rows alone would make
the implementation disagree with the specification to gain one instant, on the part
of this system where reasoning from purpose has already been wrong four times.

**A second bound, on the Network row rather than on the edges.** An effective date
at or before the moment the open Network row began is refused, separately from the
floor.

**The first version of this entry got this wrong in two ways, and both are
corrected here rather than deleted.** It bounded only dates strictly *below* the
row's `started_at`, treating the case as a translation of `CHECK (ended_at >=
started_at)` into a readable message. Equality is the case that matters: it closes
the live Network row at its own start, and section 5 makes such a row inert, so the
person's former Network silently disappears from every as-of query and every
past-period report for them moves. And it claimed the branch was "reachable only
for a null-`leader_id` root row written by an import". That is false. It is reached
by any Person with no pastoral assignment at all — both floor subqueries are empty,
section 4 says such a correction may be backdated freely, and an effective date
before their Network row's start lands there with no root row in the picture.

Both found by `architecture-guardian`. The ruling built on the false claim — that
no further bound was needed because the corner was unreachable — does not survive
it, so the bound is now stated in `SKILL.md` section 4 as a rule rather than
excused as a corner.

### 2026-08-23 — Three rulings the review of the sex correction forced, and one gap it found

`architecture-guardian` returned six findings on the first pass. Two were live
defects, three were false statements in the files written to record the mechanism,
and one was a test that survived deleting half the rule it was checking. The three
that needed rulings are below; the two false statements are corrected in place in
the entries above, which is where they were made.

**Section 5 invariant 4 binds every operation that reassigns, not only the
reassignment endpoint.** The sex correction performs a reassignment and checked no
part of it. The Whole Church rule settled earlier the same day does not cover it and
cannot: that one asks how far a grant reaches, this one asks who the actor is
relative to the target, and a holder of an explicit Whole Church grant passes the
first while needing to fail the second.

The gap was reachable and this branch's own test built the precondition for it: a
`LEADER` account granted `people.correct_sex` at Whole Church, correcting its own
record and naming any leader in the other Network, detaches itself from its own
upline. That is the escalation section 7 gives as the *reason* the capability is
Admin-only — reached without ever holding `people.manage_pastoral_assignment` — and
section 5 calls it privilege escalation through the org chart.

It now lives in `hierarchy`, because `PUT /people/{id}/pastoral-leader` owes it too
and would otherwise reinvent it. It is the one authorization rule in the system
decided by **role** rather than by capability, which is how section 5 states it: the
point is that Admin and the Senior Pastors sit outside the pastoral incentive, not
that they were granted something extra.

**Recorded because the reasoning failed the same way twice in one day.** The
position this replaces was "the capability is Admin-only, so the role catalog
satisfies invariant 4" — a rule enforced by a table nothing checks, which is the
argument this project rejects everywhere else and which was accepted here without
being written down.

**A correction may not be dated at or before the moment the Network it corrects took
effect.** Separate from the floor and not a term of it: it bounds the Network row
rather than the pastoral edges. At exact equality the live row is closed at its own
`started_at`, and section 5 makes such a row inert — so the period the person spent
in their former Network vanishes from every as-of query and every past-period report
for them moves, with nothing raised. Section 5 reserves a zero-length close for a row
entered in error; a correction is effective-dated, and section 4 already accepts in
writing that closed periods keep the Network recorded for them. Erasing the period is
the opposite of that bargain rather than a stronger form of it.

Reachable wherever the floor is empty, which is most ordinarily a Person with no
pastoral assignment — the case section 4 says may be backdated "freely". Freely means
as far back as the record goes, not before the record begins.

**Where no date can clear the floor, the refusal names none.** The floor falls on the
current day whenever a disciple has just been moved aside, which section 4 calls the
*ordinary* outcome — and the day after today is tomorrow, which no correction may
take. The refusal was therefore naming the one answer guaranteed to be refused again,
which is precisely what section 4 requires the system not to do. It now says the
correction cannot be backdated and will take effect now if submitted without an
effective date, which always succeeds: every bound is read from a row already
written, so it lies in the past.

**A Network root is not moved between Networks by a data correction.** Derived rather
than invented: section 5 gives each Network exactly one root and says changing who
holds a root position is a Network-level decision, so moving one here would leave one
Network rootless and the other with two. Refused before the disciple refusal, so a
root — who by construction leads people — is refused for the reason that applies.

The guard detects the representation the schema carries, an open row with a null
`leader_id`. Section 5 also describes a root as having no active assignment at all,
and under that reading this does not fire. That ambiguity is the root-representation
item this log has carried as open since 2026-08-22; this is a fail-closed guard on
the representation in use, not an answer to "is this person a root", and it is the
first code that would benefit from settling it.

**The sixth finding needed no ruling and is worth recording as a test lesson.**
Term (b)'s `person_id` disjunct could be deleted from the floor query with the whole
suite still green: every floor case bound on term (a) or on the leader side, and the
subordinate side was covered only against the *trigger*, never against the code that
computes the floor. The failure it would have allowed is the one the floor exists to
prevent — a raw `check_violation` at `COMMIT`, a 500 instead of a date the
administrator can act on. "What mutation would this fail against" is the question
that finds these, and it has to be asked per rule rather than per test.

### 2026-08-23 — The root is a row, and a person lock serializes the same-Network rule

Two Stop Conditions escalated by the second `architecture-guardian` pass, both
ruled on rather than guarded around.

**A Network root is an active pastoral assignment whose `leader_id` is null.**
Section 5 asserted both that a root has "no active pastoral assignment" and that
"A root leader has a null `leader_id`", which are different claims about whether a
row exists. The row-based reading is settled, and the contradictory sentence is
gone.

Two things decide it. It is the only reading under which "is this person a root"
is a question the database can answer, and section 4's refusal to move a root
between Networks needs exactly that — a root must be refused where somebody merely
unassigned must not be. And the alternative needs a durable record of who the
roots are, which section 7 declined to create because it would put the church's two
most consequential positions behind a row somebody could edit.

Invariant 3's "zero is legitimate in exactly three situations" becomes two: a
Person not yet assigned, and an archived Person. A root is no longer one of them.

The evidence that this was the reading already in use is a test whose name and body
disagreed. `permits zero open assignments, which is legitimate for a Network root`
asserted a row with a null `leader_id` in its body. The schema, the fixtures and
every existing test already did it this way; only the prose was undecided.

**An advisory lock on the person serializes a Network change against a concurrent
edge write.** The deferred triggers each see only their own transaction's
commit-time state, which leaves a window neither closes: an edge opened under the
person, dated just before the change's effective instant and committing just after
it, is invisible to the change's comparison and legal by its own. The result is a
permanent cross-Network edge, against a rule section 5 calls hard on every write.

Reachable today through `POST /api/v1/people`, which is why this was not deferred to
the reassignment endpoint. The first version of the open item claimed the other path
did not exist yet; it does.

An advisory lock rather than `SELECT ... FOR UPDATE` on `persons`, because the two
paths live in different modules and `persons` belongs to `people` — a row lock would
mean `networks` reading a table it does not own in order to coordinate rather than to
read. Advisory locks are coordination primitives belonging to no table, and being
transaction-scoped they cannot be leaked by a failing path.

**The ordering rule is the part that will be got wrong**, so the helper sorts rather
than trusting its callers: two corrections moving people under each other, each
locking its own person first, deadlock, and PostgreSQL rather than we choose the
victim. Locks are issued one statement per key, because `FOR UPDATE` with `ORDER BY`
does not guarantee rows are locked in sorted order and the same caution applies to
batching.

The test holds the lock and asserts the correction does **not** proceed, then
releases it and asserts it does. Firing two requests concurrently and hoping to
observe the race would pass against no lock at all nearly every run, which is the
test-that-passes-for-the-wrong-reason this log keeps recording.

### 2026-08-23 — `RESOURCE_BUSY`, and why its status carries the rule

The person lock introduced the first unbounded intra-request wait in the system.
`pg_advisory_xact_lock` waits forever, §24 bounds the pool at ten with no
acquisition timeout, and nothing sets a statement or lock timeout anywhere. One
client left idle in a transaction blocks every request touching that person, each
blocked request holds a connection, and at ten of them the liveness probe cannot
obtain one either — it runs `SELECT 1` on the same pool, so a healthy process is
read as dead and restarted, losing the transactions that were making progress.

**A three-second `lock_timeout`, and a new §22 code answered on the way out.**
`RESOURCE_BUSY`. Three seconds is longer than any transaction that legitimately
takes this lock — each is a handful of statements — and short enough that the
queue drains rather than accumulating.

**The status is 503, and choosing it was the whole of the decision.** §22 stores a
4xx against the idempotency key and releases the key on a 5xx, and the reason is
that the first is a decision the rules reached and the second carries none.
Contention reaches no decision. A 409 — which is where every other conflict-shaped
code in §22 sits, and the obvious choice — would have been *stored*, so every later
retry of that key would replay the transient failure for the full retention. That
is precisely the dead end §22's release rule exists to prevent, and it would have
been introduced by the change that was fixing a different unbounded-wait problem.

Recorded because the alternative was worse in an instructive way: keeping 409 and
teaching the interceptor to release this one code. That works and is one more thing
somebody must remember for every code added afterwards. Putting the code on the
correct side of a split that already exists makes the behaviour structural, which is
the same argument §2 makes for the capability guard and §22 for `completeWithin`'s
transaction parameter.

The test asserts the retry, not the refusal. A case checking only that a blocked
write answers 503 would pass equally against the stored-forever version.

### 2026-08-23 — Three corrections to the lock, and two rules that were never written down

Fourth `architecture-guardian` pass. Two behavioural defects, and two rules this
log had recorded as specified while `SKILL.md` did not contain them.

**The lock key is computed from the identity, not from its spelling.**
`hashtextextended` is case-sensitive; a `uuid` column comparison is not, and
`@IsUUID()` accepts either case. So the same leader named in uppercase and in
lowercase compared equal everywhere in the system except in the lock, where they
took two different keys and serialized against nothing — reopening the window the
lock had just been built to close. `UUID().uuidString` on iOS is uppercase by
default and §2 names iOS as a client, so this was not hypothetical. The key is now
taken over `id::uuid::text`.

**`SET LOCAL lock_timeout` bounds the whole transaction, not the acquisition.** The
comment said it reverts for the pooled connection's next occupant, which is true,
and stopped there — so nothing said it also stays in force for the row locks the
caller takes afterwards, including the idempotency key's in `completeWithin`. Those
raise `55P03` at call sites that know nothing about locks, where it was neither
caught nor recognised: an unhandled 500, logged as a defect, for ordinary
contention.

Kept rather than narrowed, because those waits are unbounded otherwise and an
unbounded wait inside a transaction holding a pooled connection is the same hazard
the timeout was added for. What it required was classifying an elapsed wait as
`RESOURCE_BUSY` **wherever it is raised**, which `ApiExceptionFilter` now does. §5
says both halves.

*This is the fifth time on this project that a mechanism was described from the
part of it being looked at.* The others are the backdate floor, the zero-length
row, the Nest status ordering, and the §8 redaction.

**The sort key changed and `SKILL.md` did not.** Ordering by lock key rather than by
person id was right — a collision can otherwise give two callers opposite
acquisition orders, which is a cycle rather than mere over-serialization — but §5
was left stating the old rule in two places, in a commit that edited the paragraph
directly beneath it. Both now say ascending lock key.

**Two rules were cited to §22 and were not in §22.** The 4xx-stored / 5xx-released
split, and the canonicalized fingerprint. The 2026-08-22 ruling says both were
written there; neither was, and the first had by then become the entire
justification for `RESOURCE_BUSY` being a 503. §22 now carries both, and that entry
is annotated.

**§24 gained the pool and the probe**, for the same reason: §5 cited §24 for a
bounded pool and a liveness probe sharing it, and §24 contained neither. Whether the
probe should keep sharing the pool is an operational decision, recorded as open
rather than settled.

**Two tests were named for more than they pinned.** The `POST /people` case claimed
to pin lock-before-check and would have passed under either order; it now names an
**archived** leader, so a request that validated first would refuse without ever
waiting. And nothing pinned §5's ordering rule at all — the property whose absence
is a deadlock with a PostgreSQL-chosen victim. It is pinned now by holding the
*higher* of two keys and asserting the caller is **holding** the lower one while it
waits, which is true only if the helper sorted.

### 2026-08-23 — An identifier is compared canonically, and the class was wider than the instance

Fifth `architecture-guardian` pass, and the only finding was the one that mattered
most on the branch: **§5 invariant 4 was bypassable by spelling the target's
identifier in uppercase.**

Both halves of the check are JavaScript string comparisons — the target against the
actor, and the target against the actor's ancestors — between a client-supplied path
parameter and identifiers that came out of `uuid` columns. Everything else on that
path normalizes for free, because everything else ends in a SQL comparison: the
capability guard, the reads, and (since the previous batch) the lock key. Invariant 4
does not, and it is the only check on the path that fails **open**. Admin and Senior
Pastor return early, so those two comparisons are the entire protection against the
one actor class the rule exists for, and a mis-spelled identifier removed it.

`UUID().uuidString` on iOS is uppercase by default and §2 names iOS as a client, so
this is reachable input rather than a contrivance.

**The batch before this one fixed exactly this defect in the lock key and did not
look for the rest of the class.** That is the lesson worth keeping. The recorded
rationale for the lock fix — a `uuid` column compares case-insensitively and
TypeScript does not — applies verbatim to every identifier comparison in the
application, and there were four more — *the entry as first written said three and
listed three, having itself missed one, which is the same fault one layer in*:

- **Invariant 4**, above. Fails open; a security defect.
- **The duplicate-acknowledgement gate** (§3), where a client echoing candidate ids
  back in uppercase never satisfies it — so the refusal is permanent and that Person
  can never be created. That is the block §3 says must never happen, and it is worse
  than the duplicate it guards against. Introduced before this branch and fixed here
  because one change closes both and because leaving it would recreate the defect the
  moment somebody read the lock fix as complete.
- **`isWithinSubtree`**, in *both* halves. Its self-check fails closed and merely
  denies. Its ancestors comparison is the `OWN_SUBTREE` scope decision — and one of
  its two callers is not a guard at all but the `canSeeReasons` predicate, where a
  false answer *skips* the §3 acknowledgement gate rather than denying. So the two
  halves of one function failed in opposite directions. The self-check was fixed in
  the first attempt and the ancestors comparison was not, which the sixth review
  found.
- **The self-leader check in the correction**, which compares two *client-supplied*
  values — the body's `pastoral_leader_id` against the path's `{id}`. Mis-cased, it
  fell through to the `no_self` check constraint: a raw constraint violation
  rendered `INTERNAL_ERROR`, which is the 500-instead-of-an-answer failure that
  module exists to prevent.

**Fixed in two places deliberately.** A pipe normalizes path parameters and a
transform normalizes the identifier fields of every DTO, so nothing downstream has to
remember; and the authority check normalizes again, because a check that fails open
must not depend on a caller having wired a pipe. Written to `SKILL.md` §7, beside
invariant 4's own rule, because the consequence is an authorization one.

**`audit_log.target_id` is canonicalized too, and only where it is a UUID.** It is
the one place a client-supplied identifier is *stored* as free text rather than
compared, the comparison it will eventually face is case-sensitive `text`, and
migration 0002 makes the row unrepairable — so a mis-cased target would be an entry
permanently invisible to the lookup §7 resolves scope through. Narrowed to
UUID-shaped values because §21 makes the column `text` precisely so a setting can be
keyed by its `key`, and lowercasing every target would canonicalize the identifiers
and corrupt anything else.

**The two layers are pinned separately.** Every end-to-end case passes if *either*
the boundary or the defensive comparison is present, so together they pin the
disjunction and neither half. §7 requires both, and a rule with nothing that can
fail on it is the thing this repository keeps refusing to ship — so the authority
check and the acknowledgement gate are each called directly, with an uppercase
identifier, bypassing the pipe and the DTO.

**Also in this batch, found without the review:** the lock-timeout predicate had been
put in `database/person-lock.ts` and imported by the exception filter, which points
`common` at a module. It moved to `common/errors/postgres-errors.ts`, so both arrows
point the same way. Behaviourally identical; it is about which direction the
dependency runs.

### 2026-08-23 — A backdated reassignment is bounded by §4's floor and one rule of its own

Stage 2 step 6's only Stop Condition. §5 permits Admin to backdate a reassignment
and states no bound at all, and two failures follow from that silence.

At an effective date equal to the current assignment's `started_at`, the close is
zero-length, which §5 makes **inert** — so the leader the person actually had for
that whole period vanishes from every as-of query, with nothing raised. Below it the
row cannot be closed at all. And because the same-Network trigger compares
`network_as_of` on both ends at the assignment's `started_at`, a reassignment
backdated into a period when either person belonged to a different Network is
rejected at commit as a raw `check_violation` — a 500 rather than a date the
administrator can act on.

**The bounds are §4's floor, plus one rule of its own**: strictly later than the
floor `hierarchy.backdateFloorFor` already computes, and the edge validated as of
the effective date rather than as of now. The refusal names the earliest legal date,
or names none where the bound falls on the current day.

*The first version of this entry said "the same two bounds" and "same code" — in
its heading as well as its body — and both were false.* The heading outlived the
first correction by two commits, which is its own small lesson: a heading is what
gets skimmed and quoted, so a stale one travels further than a stale paragraph. §4's second bound is on the Network row, which a reassignment does
not write, so the pair is not the same pair; and the first implementation compared
against the current assignment's `started_at` inline rather than calling the floor,
so the code was parallel rather than shared. Found by `architecture-guardian`, and it
is the sixth instance on this project of a rule written by describing part of a
mechanism — committed, this time, in the entry created to settle that mechanism.

Both are now true: the floor is the shared call, which also settles the Stop
Condition below.

**A person with no open assignment is bounded by a term (b) of its own.** Nothing else
bounds them — the one-active index is partial over `ended_at IS NULL`, so an
effective date inside an already-closed period is permitted by the schema and leaves
two rows valid at one instant, with "who led this person on date D" having two
answers. Not reachable in Stage 2, because nothing yet closes an assignment without
opening one; ruled now because the rule reads as complete without it and the term
already exists.

**It reaches only the subordinate side, and the first attempt reached both.** I
recommended "the same term §4's floor already carries, for the same reason", and
the reason does not carry: §4 needs both directions because
`assert_network_change_keeps_edges` selects edges either way, while a reassignment
fires `assert_assignment_same_network`, which reads only the row being written. Both
directions therefore refused a legitimate Admin correction for every leader who had
ever had a disciple moved — which §4 makes the *ordinary* precondition of a Network
correction. The shared method now takes which disjuncts apply, and §5 states its own
reason instead of borrowing one.

Recorded because the fault is a specific one and this is the second time in two
batches it has appeared here: a rule adopted from a neighbouring section by its
*shape* rather than by re-deriving why it has that shape.

**A reassignment to the leader the person already has is refused**, matching what §4
does for a sex correction that changes nothing, on the same reasoning: the operation
is audited, and a transfer whose before and after name the same leader misleads
whoever reads the log — and it puts a boundary in the assignment history where
nothing happened, so "how long under this leader" answers wrongly ever after.

The two alternatives were rejected for the reasons this project has already
recorded once. Refusing anything before the person's current Network period is
simpler and refuses legitimate corrections inside periods where nothing changed,
which is most of them. Permitting anything and letting the constraint reject it is
honest about where enforcement lives and hands the administrator the constraint
message, which is precisely the failure §4's floor exists to prevent.

Also settled without needing a ruling, because §5 states it: the reason is required
whenever an effective date is given and not otherwise. An ordinary reassignment is
audited without one — it records a decision taken today, and the entry already
carries who took it.

### 2026-08-23 — The application runs at READ COMMITTED, and that is now load-bearing

Escalated by the third `architecture-guardian` pass on the reassignment endpoint.

Section 5 has a write take an advisory lock on the person and *then* decide — scope,
invariant 4, invariant 1's two endpoints, the backdate floor. That design is correct
only under `READ COMMITTED`, where each statement after the lock takes a fresh
snapshot and therefore sees whichever transaction held the lock first.

Under `REPEATABLE READ` the snapshot is taken by the transaction's **first**
statement, which is the key-hashing `SELECT` inside `lockPersonsWithin` and runs
before the lock is held. Every check after it would then be decided on the state the
request arrived with — precisely the staleness the lock exists to remove.

*An earlier version of this entry said "nothing would raise, because the reads all
succeed", and that is true of the reads and not of the request.* Where the loser's
own assignment row moved, its own update would meet a version committed after its
snapshot and raise a serialization failure. The silent case is narrower and is the
one that matters: a concurrent move of an **intermediate ancestor** changes the
actor's scope while leaving every row this request writes untouched, so it commits a
write the actor was no longer authorized to make. A deployment changing
`default_transaction_isolation` would remove an authorization guarantee, and that
case would remove it quietly.

It is PostgreSQL's default and nothing in this repository sets it, so this records a
dependency rather than changing behaviour. Written to `SKILL.md` §24 beside the pool
and the probe, and asserted by reading `SHOW transaction_isolation` **inside a
transaction** — from the server rather than from configuration this repository
controls, because the thing that can change it is not a file here.

Recorded rather than left implicit because the failure is invisible: no test goes
red, no constraint fires, and the endpoint keeps answering 200. `SET LOCAL` is a
utility command and takes no snapshot, which is why the lock helper's first
*snapshot-taking* statement is the one that matters — a detail worth writing down,
since it is the kind of mechanism this log has recorded getting wrong seven times.
### 2026-08-23 — Reusing a shape requires re-deriving why it has that shape

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

### 2026-08-23 — Identifier normalization is global, and a pastoral leader has one field name

Two changes to the API boundary, settled together because both are about an
identifier arriving from a client and neither is worth a review cycle alone.

**The boundary normalizes every route, and every argument a client sends it.**
`CanonicalIdentifierPipe` is registered globally and canonicalizes a string in a
path parameter, a query parameter or a body wherever the field's **name** says it
is an identifier and the value is UUID-shaped — both halves, always; the rule is
stated in full below. A route added later is inside §7's canonical-comparison rule
without its author knowing the rule exists. The first attempt was a pipe wired onto
each `@Param('id')`, which is verbatim the failure §2 gives as the reason the
capability guard is declarative — a convention held per call site is only as
reliable as the least familiar developer writing the newest one. That closes the
open item this log has carried since the identifier work began.

*This sentence first said "canonicalizes every UUID-shaped string", which is the
shape-only rule the entry goes on to describe as the defect that had to be fixed.*
A reader who stopped at the summary — which is what a summary invites — read back
the version that lowercased a password. Corrected in place rather than deleted,
because a false reason here is worse than none, and because an entry contradicting
itself two paragraphs apart is the exact failure this log keeps recording.

**The first version took path parameters alone, and the reason it gave was false.**
It said a query parameter must be protected because the search cursor is
case-sensitive base64url — but the pipe only touches UUID-shaped strings, and a
cursor is not one, so the hazard it named could not be produced by the code naming
it. What the narrow version actually left out was every identifier arriving as a
query filter (§22 documents one on `/cells`) and every body field, each of which
needed a transform somebody had to remember — the same per-site opt-in the change
existed to remove, one layer over.

Found by `architecture-guardian`, and it is the same fault as the five before it: a
mechanism described from the part of it being looked at.

**The second version was wrong in a worse way, and the rule is now name-based
because of it.** Widening the pipe to every argument meant it walked the body of
`POST /auth/login`, and it decided what to touch by *shape* — so a password that
happened to be UUID-shaped was silently lowercased and that account could never
sign in again, with nothing to diagnose. `uuidgen` output is an ordinary ad-hoc
password. A boundary cannot tell an identifier from a credential by looking at the
value, and it does not have to: it can look at the field's name, which this system
chooses.

A value is canonicalized only where **both** hold — the key names an identifier,
and the value is UUID-shaped. Name alone would rewrite a Member ID, which is `M-`
and six digits; shape alone rewrites credentials. §22's naming convention now
carries the other half, and what exactly it says is settled in the ruling below —
the version written here first was narrower than the code it claimed to describe.

**A prototype check silently skipped every object-bound query and path parameter.**
Express 5 builds `req.query` and `req.params` with `Object.create(null)`, so testing
against `Object.prototype` alone excluded exactly the bindings §22's documented
`/cells` leader filter would use — named `leader_id` when this was written, and
`cell_leader_id` since the ruling below. No end-to-end case could see it, because the
*named* bindings receive a bare string and work either way.

**The walk was also unbounded**, which the widening made reachable before
authentication: a nested body well inside the 100 KB limit overflowed the stack and
answered `INTERNAL_ERROR` — a 500 logged as a defect, for input, on the sign-in
route.

*This bounded one of the two walks over a client's body and said so as though it
had bounded the hazard.* The idempotency fingerprint's own walk was left
unbounded, on every authenticated write endpoint, and is closed by the ruling
below — which also replaces the bound's behaviour, because stopping the descent
and returning the container was itself a defect. Left standing as written, because
the claim was true of what it named and the fault was in what it did not look
for.

**The idempotency fingerprint canonicalizes separately**, because interceptors run
before pipes: it would otherwise be taken over the spelling the client used, and one
retry differing only in case would fingerprint differently and be answered
`IDEMPOTENCY_KEY_REUSED` — which §22 makes permanent, turning an ordinary retry into
a dead end. The path is canonicalized **segment by segment**, because a path is
never itself UUID-shaped and handing the whole string to the helper does nothing at
all, quietly. That was caught before it shipped and is recorded because it is the
same mistake in miniature: reusing a helper without checking its shape fits.

It canonicalizes and does not validate. Whether a value is a UUID is decided by the
capability guard for the one target it resolves scope against, and by the DTOs for
what they declare. The previous pipe's throwing branch was unreachable for that
reason — it looked like a second line of defence and was dead code. **A path
parameter the guard does not resolve against is validated by neither**, which §22
already sketches with a second identifier in a route path; §7 now says such a route
must validate it itself, because reaching a `uuid` comparison with a non-UUID
produces a database error rather than an answer.

**`leader_id` becomes `pastoral_leader_id`** on the reassignment endpoint, matching
`POST /people` and the sex correction. The rule is written to §22's Conventions
rather than to §7: a field-naming convention has no authorization consequence, and
§22 is where three client codebases look. §11 makes Cell leadership a first-class
concept, so a bare `leader_id` does not say which kind of leader it means. The
database column keeps its name: `pastoral_assignments.leader_id` is disambiguated
by its table.

**It is a rename inside §22's window rather than a break §22 absorbed.** §22 binds
`/api/v1` to stay behaviourally unchanged "for as long as any client calls it", and
nothing calls it — `web/` is a placeholder and no mobile build exists. The window
closes at the first real client, which is the argument for doing it now rather than
recording it as debt. The eleven authorization cases pinned the old name and their
own header always provided for this: "Stage 2 implements this shape, or changes
these tests deliberately and says why."

**What pins the global boundary is a route that opts into nothing.** Every other
identifier case passes if either the boundary or the defensive comparison is
present, so none of them notices the boundary regressing to per-site opt-in. The
probe route is written the way any new route would be — bare path, query and body
bindings, no pipe, no transform, nobody having remembered anything — and asserts all
three arrive canonical, with the body's identifier nested inside an array inside an
object because that is where a real one turns up. It also asserts that a
**UUID-shaped password** comes back untouched, which is the property that makes
running over a whole request safe and the one a shape-based rule fails.

**The walk itself is pinned by unit tests rather than only by that probe**, because
its three dangerous properties are invisible end to end: a prototype check that
skips `req.query`, a credential quietly rewritten, and a stack overflow on a legal
payload all look identical to a green suite. Two of the three defects above would
have been caught by the tests that now exist and did not.

### 2026-08-23 — What an identifier's field name is, and the second walk over a body

`architecture-guardian` on the identifier branch, escalating a Stop Condition: §22
said an identifier's field name "ends in `_id` or `_ids`" **and** said that is what
the boundary keys on. Both could not be true. The boundary also accepts a bare `id`,
a bare `ids`, and the `camelCase` forms, and §22's own example routes used
`{meetingId}` and `/cells?leader_id=`. Four things are settled here, and each is
amended into `SKILL.md` in the same change.

**A bare `id` is an identifier field name, and §22 moves rather than the code.** This
is the half that had to go the way it went: a path parameter binds under the name its
route declared, so `@Param('id')` hands the boundary the key `id`. A convention
admitting only the suffixed forms would put **every path parameter in the API**
outside the rule — which is the case the boundary was built for, and the case §7
names as the one where the comparison fails *open*. Narrowing the regex to match the
sentence would have been following the specification off a cliff.

The plural is admitted at both positions with it, so `ids` and
`acknowledged_duplicate_ids` are one rule rather than two.

**`camelCase` leaves the boundary, and §22 says the surface is `snake_case`.** The
regex accepted `Id`/`Ids` as defence in depth, and no route, DTO or fixture in the
repository names an identifier that way — so it was a shape kept without its reason
holding, which is §25 rule 19, merged the same morning, applied to the branch that was
open when it merged.

`forbidNonWhitelisted` was first cited here as a complete backstop and is a partial
one: `ValidationPipe` validates class metatypes only, so a binding typed as a plain
object is skipped, and the idempotency fingerprint walks the raw body before any pipe
runs. The narrowing rests on the argument below rather than on that.

The narrowing is the safer direction and not only the tidier one. A `meetingId`
arriving from a client is a naming defect, and it shows up as an authorization
comparison quietly answering on a spelling; a boundary that silently absorbs it is
what would hide the defect rather than surface it. §22's example route becomes
`{meeting_id}`.

**A Cell's leader is `cell_leader_id`, including in the filter §22 already
documents.** §22 forbade naming a Cell's leader `leader_id` and then, three
subsections later, documented `GET /api/v1/cells?leader_id=...`. Corrected now rather
than when Stage 3 builds it, on §22's own argument: the only moment to fix a field
name is before a client depends on one, and an example a specification documents is
what the implementer copies. Nothing calls `/cells` — it does not exist.

**The bound on a client's nesting refuses, and covers both walks**, and it is now in
§22 beside the other refusal shapes — the depth, the code, and refusing rather than
truncating are all client-visible on every route, and three clients branch on them.
*The first version of this entry claimed that amendment and did not make it*, which is
the failure the preamble of this log names in one line: a decision here but not in the
specification is unfinished work. It is the third time on this project that a
"written to §x" claim has been false, because nothing checks one.

This is the one that was a live defect rather than a disagreement, and it was
**pre-existing on `main`** — fixed here because it is the identical class this branch is about, and
because the branch carried a test comment claiming protection against it.

There are two recursive walks over a request body: the identifier walk, and the
idempotency fingerprint's `canonicalize`. The branch bounded the first and left the
second untouched, one line apart. `JSON.parse` is iterative in V8 and accepts any
depth — measured past two hundred thousand levels — while both walks are recursive
and do not. **A few thousand levels** overflows the stack, so an unhandled
`RangeError` rendered as `INTERNAL_ERROR` on **every authenticated write endpoint**,
for any signed-in leader. The earlier entry's claim that the walk was bounded was
true of the walk it named and false of the hazard.

*This paragraph first asserted "around three thousand levels, eighteen kilobytes" as
a measured pair, then replaced it with a second pair that did not reproduce either.*
Both are now withdrawn and **no threshold is quoted here at all**, which is what
`identifiers.ts` already says and what this paragraph's own next sentence requires:
the number moves with the payload's shape and with stack headroom at the call site,
so any bare figure is a measurement of one harness presented as a property of the
code. Three numeric claims in this entry could not be stood behind, which is enough
to stop making them.

What survives, because it is structural rather than measured: `JSON.parse` accepts
depths these walks cannot, and the cheapest payload is a nested **array** at two
bytes per level, one for each bracket — which is why a body-size limit does not cover
this and a depth bound is needed.

Worth recording against the original: its depth was wrong and its arithmetic was
not. Three thousand levels of `{"a":…}` really is 18,001 bytes; that shape simply
does not overflow at three thousand.

Two decisions inside it, and the first is not the obvious one.

**Exceeding the bound is refused, not truncated.** The first version stopped
descending and returned the container unchanged, which reads as graceful and is
worse: a request nested past the bound kept its identifiers in whatever case the
client sent, silently, and every comparison below became a comparison on a spelling
— which is the defect the boundary exists to remove, reintroduced by its own safety
valve. It answers `VALIDATION_FAILED`: a body no DTO in this system describes is
malformed input, which is what that code means.

*The reason first given here was §22's store-a-4xx rule, and that describes a path
this code does not take.* On the path that fires — an authenticated write — the
refusal is thrown inside the interceptor **before** the key is claimed, so no row
exists and the store/release split is never consulted. What actually makes the 4xx
right is that the refusal is deterministic: the same body gets the same answer
whether or not anything was stored, so nothing depends on which it is.

**One constant, shared by both walks — and applied at the same point, which is the
half that was got wrong.** Two bounds over one body is a disagreement waiting to be
found. The fingerprint's walk keeps its own check even though the interceptor reaches
the identifier walk first, because `fingerprint` is a public method and the ordering
of its callers is not a property it can rely on — exactly what the unbounded version
was resting on without saying so.

*The first version of this said sharing the constant "means one answer for one body",
and shipped a disagreement in the same commit.* The identifier walk asserted before
dispatching on type, so a primitive leaf occupied a level; the fingerprint walk
returned for a primitive before asserting, so it did not. A body at the bound was
therefore refused or accepted according to whether its innermost value happened to be
a string — client-visible arbitrariness, produced by the sentence denying it.

Both now assert immediately before descending into a container and never on a leaf,
which makes them agree for everything either walk sees: parsed JSON. A `Date` or a
class instance would still be counted by one and not the other, and neither can occur
in a parsed body.

Recorded at length because it is §25 rule 19 — merged that morning, and cited three
paragraphs earlier in this entry — failing inside the batch written to apply it. The
reason the fingerprint's walk had that shape was that its early return served
serialization, not depth; reusing the shape without re-deriving that is the whole of
the mistake.

**Also corrected, all of them statements rather than behaviour**, and grouped because
each is the fault §25 rule 19 and its predecessors name — a mechanism described from
the part being looked at:

- §7 said arguments this application constructed are skipped "by the framework's own
  bucket", and implied naming a binding there would bring it in. True of an uploaded
  file or a raw body, which are pipeable and *are* client input. **False of a header,
  a session, a host or a caller's address**, which Nest never offers to any pipe at
  all — so the remedy the sentence prescribed does not work for half the set it
  implied. The `Idempotency-Key` is the header that exists, and it reaches a `uuid`
  cast in SQL rather than a comparison in TypeScript.
- The fingerprint canonicalizes path segments by **shape**, and the comment justified
  it with "no credential is ever a path segment" — an assertion nothing enforces, in
  the batch whose own conclusion is that a boundary cannot tell an identifier from a
  credential by looking at the value. What actually makes it safe is reachability:
  the credentials that travel in a URL-shaped position are the activation and reset
  tokens, those routes are on §7's unauthenticated list, and the interceptor returns
  before a path is canonicalized for any of them. So what would break it is a
  credential added to a path on an *authenticated* route — which is worth knowing and
  is not what was written.
- The identifier walk's docblock said "nothing is mutated — a fresh value is built",
  and this entry first "corrected" it to say the result **aliases** the input wherever
  nothing changed. *That correction was the false half.* Every array and every plain
  object is rebuilt unconditionally; the reason offered for it — that the guard reads
  the raw body first — is a property of non-mutation, which is what the original
  sentence already said. The original stands and the addition is withdrawn.

  *And the withdrawal, as first written, said "nothing aliases but primitives", which
  is also wrong.* A non-plain object — a `Date`, a `Buffer`, a class instance — is
  returned by reference. Nothing pins that: the file's case asserting a live `Date`
  survives checks `instanceof` and `getTime()`, both of which a *cloning*
  implementation would satisfy too, so it pins survival-as-a-`Date` and not identity.
  The docblock scopes the claim correctly ("for any array or plain object"); only this
  log did not. Three statements in sequence on one small fact — four counting the
  overclaim in this sentence's own first draft — which is why it is left visible
  rather than tidied: the code was right throughout and the prose about it was not.
- `api/test/unit/identifiers.spec.ts` justified its own existence with "these are
  pure functions and need no database". The shared harness throws without
  `DATABASE_URL` before any suite loads. They need no database *server*; a dummy URL
  is enough, and the file now says that.

**Three tests were added for rules that had nothing that could fail on them**, which
is the recurring finding rather than a new one.

The fingerprint's canonicalization — justified in three places by one specific,
testable failure — had no case sending one key twice in two spellings, so both the
path and the body canonicalization could be deleted with the suite green. And
removing the old `CanonicalUuidPipe` removed a validation on the argument that the
capability guard already refuses a non-UUID target; the argument is correct and
nothing asserted it, which left the whole API's target validation resting on a branch
no test entered. The guard probe gained an `actor`-target route with a path parameter
so that §7's new obligation — a route the guard does not resolve against must
validate its own — is pinned as a real gap rather than left as a caution.

### 2026-08-24 — "Never by layer" is about modules, not about files inside one

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

### 2026-08-24 — Three rulings the accounts work needed, settled before the code

§6 describes account provisioning, activation and password reset in enough detail
to build, and leaves three things undefined that an endpoint cannot avoid
answering. Each is amended into `SKILL.md` in the same change.

**A password is twelve characters minimum, 128 maximum, with no composition rule.**
§6 requires the holder to set their own password and §23 requires password managers
unobstructed, and neither states a length. Nothing in the system could refuse a
one-character password.

Length rather than complexity, because the accessibility conformance rests on the
managers. §23's criterion 3.3.8 permits a password only where a mechanism assists
in completing it, and support for managers is that mechanism — so a rule forcing a
symbol works against the thing conformance depends on, by pushing people toward
something short enough to retype. The maximum exists only to bound a hash, and
**the password is never truncated to fit**: hashing a prefix silently makes a long
password no stronger than its first *n* characters, and the holder cannot tell.

Refused with `VALIDATION_FAILED` on the request that sets it, never at sign-in,
where the stored password is whatever it was when it was set.

**An account is provisioned together with the role that qualifies it, and until
`cells` exists that means `ADMIN` or `SENIOR_PASTOR` only.** §6 ties a Leader
account to Cell leadership, which is Stage 3, so a provisioning endpoint built now
has nothing to check a Leader against.

Deferring the check was rejected. It is the shape this project keeps correcting —
a guard written as a comment — and the 2026-08-20 ruling on submission rolling up
to the nearest upline already refused to widen §6 for exactly this, on the grounds
that an account for someone who has not opened a Cell detaches "leader" from
"leads a Cell", which §11 makes non-negotiable. A `LEADER` provisioning request is
therefore refused with `INVARIANT_VIOLATION` rather than accepted: it is a rule
about what may be recorded, whoever submits it, which is the distinction §22 draws
against `SCOPE_DENIED`.

No new error code. §22's table is a minimum and adding to it is client-visible, and
`INVARIANT_VIOLATION` already means what this refusal means.

The two exceptions §6 names — Senior Pastor and Administrator — are exceptions to
the *qualification* and never to the workflow: each still gets an account created,
an activation email sent, and a password the holder sets. The first Admin account
remains the one exception to all of it, created by a system action because there is
no account above it (§7, `granted_by`).

**Provisioning is `POST /api/v1/accounts`, a new area in §22, and deliberately not
under `/auth`.** Everything under `/auth` is either on §7's closed unauthenticated
list or acts solely on the caller's own session, which is what makes that prefix's
exemption from the capability guard readable in one place. Provisioning is neither —
it is an administrative action on somebody else's Account, carrying
`accounts.manage` — and putting it there would mean the prefix no longer describes
one thing.

`POST /api/v1/auth/activate` joins the two reset routes §22 already documented,
because those three *are* on the unauthenticated list.

### 2026-08-24 — Four rulings the accounts review forced, and the escalation that prompted them

`architecture-guardian` on the accounts branch returned nine violations, of which
one was a live privilege escalation. Each ruling is amended into `SKILL.md` in the
same change.

**A capability §7's catalog gives only at Whole Church covers nothing when granted
narrower.** The 2026-08-23 ruling closed this for `people.correct_sex` and named the
escalation it prevented. The same hole was open on eight other capabilities, because
the guard asks whether a grant covers the *target* — so a grant issued at
`OWN_SUBTREE` passes for everyone inside that subtree.

`accounts.manage` was the worst of them, and it was reachable: a Leader holding one
such grant could `POST /api/v1/accounts` naming anybody in their own subtree, an
address they control, and `role: ADMIN`; then read the activation mail, set a
password, and sign in as Admin at Whole Church. That is the escalation the entire
role catalog is arranged to prevent, reached through the endpoint this branch added.

Generalised rather than named per capability, because the hole is general and naming
them one at a time is as many chances to miss the next — same argument as §2 gives
for the guard being declarative: an operation that forgets the check looks exactly
like one that does not need it.

**Two things about it were wrong when first written, and both were caught rather
than reasoned out.**

It was enforced where an account's effective authority is assembled, beside the
`read_only` rejection, which is where an earlier version of this entry said it
belonged. That made the account look as though it held no such capability at all,
so the refusal became `CAPABILITY_DENIED` — and CI caught it, because the
sex-correction suite has pinned `SCOPE_DENIED` since the 2026-08-23 ruling. It is
right there: an administrator diagnosing this issued a grant naming the correct
capability with the wrong **scope**, and `CAPABILITY_DENIED` would send them to
grant something they had already granted. The check sits in the scope half of
`authorize` and `coversWith`, and `/auth/me` filters the same grants out of what it
advertises, so a client is not shown an action that is refused every time.

And the set was **derived** from the role catalog rather than stated — "every role
that holds this holds it at Whole Church" — which looked self-maintaining and had
the wrong predicate. Admin and Senior Pastor hold every capability at Whole Church,
so it reduced to "a Leader does not hold it by default", which is a statement about
who gets something automatically rather than about the scope it may be held at.

That produced a false positive on `audit.view`, and §7 refutes it twice in
consecutive lines: "an audit entry resolves through its target" is machinery with no
purpose unless the capability can be held narrower, and the line after it — "a
setting is Whole Church only, and is never in scope at any narrower value" — is this
specification's own way of saying what the rule says, written for settings and
deliberately not for audit. A narrower `audit.view` grants strictly *less* than the
default, so there is no escalation to close and the rule was removing authority §7
offers.

The set is now stated, with eight members and §7's argument for each, and
`single-scope.spec.ts` asserts its membership — which is what makes a stated list
safe, since the objection to one is that it goes stale silently.

**An archived Person is not provisioned an account.** §6 covers the access decision
at archive and reactivation after it, and was silent on creating one for somebody
already archived. Every neighbouring rule points one way — §5 refuses an archived
Person as a pastoral destination, §3 refuses archiving somebody who leads a Cell —
so an archived Person does not acquire new live relationships, and an account is
one. Worth recording that `leader-assignability.ts` reads `person_lifecycle` for the
analogous decision twenty lines from its merged-Person check, and provisioning
carried the second across and not the first.

**The server chooses the Senior Pastor seat.** §7 caps the role at two and the
2026-08-21 ruling calls a slot a seat rather than a rank, so naming one chooses
nothing meaningful and a caller naming an occupied seat would meet a constraint
violation for a decision it should never have been making. Both held is refused with
`INVARIANT_VIOLATION`. The partial unique index remains the enforcement; the read
exists so the ordinary case is an answer rather than a raw violation rendered 500.

Found because the insert omitted `senior_pastor_slot` entirely, which the check
constraint requires — so `SENIOR_PASTOR`, one of the two roles this branch's own new
§6 text says are provisionable, answered 500 on every attempt. No test named it.

**A delivery failure never fails provisioning, and an activation email may be
re-sent.** The completion is recorded inside the transaction, so by the time the send
runs the store already holds a `COMPLETED` 201. Raising there gave the client a 500
while every retry on that key replayed the 201 — and `release` could not help, since
its predicate is `IN_FLIGHT` and the row was `COMPLETED`. An account was left
stranded with a live token nobody held. That is the write-endpoint obligation this
repository states in one line: an endpoint must not commit its completion and then
fail.

The account genuinely was created, so 201 is the honest answer, and
`POST /accounts/{id}/activation-email` is the second path §6 step 3 lacked. Before
it, the only recovery was the holder using the forgotten-password flow, which works
on a `PENDING_ACTIVATION` account by accident and records itself as a password reset.

**Also corrected, and each is the recurring fault rather than a new one:**

- Setting a password reactivated a `DISABLED` account, because it set `ACTIVE`
  unconditionally and never read the current status. An activation token outlives a
  disablement by a week, so an unauthenticated endpoint undid an `accounts.manage`
  decision.
- Account-wide revocation was re-implemented in the credentials service and
  **inverted**: the marker stamped before the tokens were revoked, with its
  timestamp computed before the statement that waits on the lock. §6 states both
  halves and `TokensService` already had them right; it now exposes a
  transaction-taking variant rather than being copied.
- A duplicate email address raised an unrecognised 23505 and rendered
  `INTERNAL_ERROR`, permanently — the 500-instead-of-an-answer failure recorded on
  2026-08-23 for the self-leader check.
- The DTO declared the password bounds alongside the service's own check, under a
  comment saying they shared constants and so could not drift. They shared the
  constants and not the *counting rule*: `class-validator` counts UTF-16 units and
  §6 counts characters, so a 128-code-point passphrase was refused by the pipe while
  the unit tests asserted the service accepts it. One rule, in one place.
- `account.password_reset` did not fit §21's `<noun>.<past-tense verb>` convention;
  it is `password.reset`.

**Three false statements, all written by this branch about itself.** The
provisioning docblock described an operator re-send path that did not exist; the
email port's docblock promised a guarantee its only caller did not provide; and the
single-use test claimed to fail against a read-then-write redemption while being
strictly sequential — which is CLAUDE.md's own authorization-case-7 lesson restated
in a comment asserting the opposite. The concurrent case exists now.

The password-reset docblock claimed the miss branch does "comparable work" as the
hit branch. It does not: the miss branch is a bare early return, so the two are
distinguishable by timing. §6 requires only that the *response* be identical, and it
is — so the code is compliant and the comment was false. It now records the gap
rather than denying it, because a decoy that does not actually match a database
write and a network call would be a second false claim.

### 2026-08-24 — The authorization seam is its own module, and a cycle was the reason a rule was being broken

Escalated by `architecture-guardian`: `auth` was reading `persons` directly, which
§2 forbids. The obvious fix — ask `people` through its service — closed a module
cycle, because `PeopleModule` imported `AuthModule`.

**`src/auth/authorization/` becomes `AuthorizationModule`.** `people` imports that
rather than the whole of `auth`, and `auth` may then import `people`. The graph runs
`people → authorization`, `auth → people`, `authorization → {hierarchy, networks}`,
with nothing pointing back.

The point is not that it dodges a `forwardRef`. It is that **`people` never needed
`auth`** — it needed `AuthorizationService`, and importing a module of accounts,
tokens, controllers and provisioning to ask an authorization question was the defect
that made everything downstream awkward. `AccessTokenGuard` stays in `AuthModule`
because it needs `TokensService` and `AccountsRepository`: it authenticates, which is
a different question from what an authenticated actor may do.

**No §2 amendment is needed.** `AuthorizationModule` owns no tables; it reads
`account_roles` and `capability_grants`, which §2 gives to `auth`, and the ruling
above on intra-module seams puts an arrangement of files inside one module outside
§2's reach.

Two things are worth recording beyond the fix.

**The cycle was causing the violation, not merely blocking its repair.** Three
direct `persons` reads had accumulated in `auth`, each individually the path of least
resistance. `PeopleReadService.forDecisionWithin` replaces them, returning identity
and two lifecycle facts rather than a `PersonRecord` — a cross-module reader that
cannot receive a birthday or a mobile number cannot leak one.

**The split compiled, type-checked, linted, passed 117 unit tests, and broke every
authenticated request.** Nest resolves a provider's dependencies in the context of
the module that *registers* it, not the one its class lives in, and `CapabilityGuard`
is registered globally in `AppModule` — which imported `AuthModule`, which imports
`AuthorizationModule` without re-exporting it. `AppModule` imports it directly now;
re-exporting from `AuthModule` was rejected, because it would put the authorization
providers back into the surface the split had just removed them from and let the
cycle return unnoticed.

`test/unit/module-graph.spec.ts` closes the gap that let this reach CI at all.
Nothing running without a database built the application: `tsc` checks imports and
says nothing about the injector, and the unit suite never constructed `AppModule`.
`Test.createTestingModule(...).compile()` builds the injector without opening a
connection, so the whole class of wiring failure now fails on a developer's machine
in seconds. It is verified against the real mutation rather than assumed — removing
the import reproduces CI's exact message.

Stage 3 will ask this question again when `cells` needs authorization, and the
answer is that it imports `AuthorizationModule`.

### 2026-08-24 — Who the two Senior Pastors are is read from configuration, and checked twice

The domain half of the `SENIOR_PASTOR` rule, which had no owning stage until Stage
2 and no source of truth at all. §7 caps the count in the database, says **which
two Persons** hold it is checked in `auth`, and rules out the obvious answers by
name — a flag on the Person, a reserved identifier — because either "would make
the two most consequential accounts in the church depend on a row somebody could
edit". It did not say what the check reads instead, so nothing could be built.

**It reads deployment configuration**, naming the two by Person identifier.

The test is not "is this outside the database" but **whether editing the source
would be an escalation for whoever can edit it**, and that disposes of the
alternatives without appeal to taste. A flag on the Person is editable under
`people.edit_basic`, which an ordinary Leader holds over their own subtree. A
`settings` row is editable under `settings.manage`, which is Admin's — and Admin
deliberately holds neither seat, so a setting is a route by which Admin names
themselves into one, collapsing the separation §7 builds by keeping
`accounts.manage` and `roles.manage` away from the Senior Pastors. Hard-coding the
two **names** from §4 and matching them against `persons` is the same defect one
indirection out, and additionally fights §3, which says a name is not an identity
and that a woman's surname may change.

The environment is editable by whoever deploys the API, and that person already
holds `JWT_SECRET` and can therefore mint a session for any account that exists.
Configuration is the only candidate whose editor gains nothing from it.

**Enforced at grant time and again at authority assembly.** Provisioning refuses a
`SENIOR_PASTOR` request for an unnamed Person with `INVARIANT_VIOLATION`, and
`AuthorizationService` drops a `SENIOR_PASTOR` row whose account belongs to anyone
else — so it yields no role default and no §5 invariant-4 exemption.

The second point exists for the reason the 2026-08-21 slot ruling gives for
preferring an index to a counting trigger: `pg_restore --disable-triggers` skips a
check that runs. A check made only where the row is written is skipped by a restore
in exactly the same way, so the identity half needs an enforcement point on the
path every request takes.

**A refused row therefore answers `CAPABILITY_DENIED` — where the capability it
would have carried is what the request needed.** *That qualifier was missing for two
review passes, and it was copied unqualified into `SKILL.md` §7 by the batch written
to close the false "written to §x" claim below.* A refused row has two consequences,
and the sentence covered one: it also withholds the §5 invariant-4 exemption, and an
actor holding the capability by any other route — a second role's defaults, or an
explicit grant at any scope that capability permits — reaches that check and
is refused `SCOPE_DENIED` — which §22 already settles for a domain-layer statement
about an actor's authority over a target, and which this branch's own test asserted
the whole time. §7 now states both, and the principle they share: the code names the
half that failed. Recorded because the rule was moved into the specification by
copying a sentence rather than re-deriving it against the two paths it governs, which
is §25 rule 19 inside the batch citing §25 rule 19.

*The first version of this
entry cited `single-scope.ts` as the precedent for the shape — "a row that cannot
mean what it appears to mean is honoured as nothing rather than in part" — and that
is the one thing `single-scope.ts` does not do.* `grantCoversNothing` is applied in
the **scope** half of `authorize`, and the 2026-08-24 ruling above records dropping
it at assembly as a live defect precisely because the account then looked as though
it held no such capability, turning a `SCOPE_DENIED` into a `CAPABILITY_DENIED`.
Citing that file while doing the thing it had removed is §25 rule 19 failing inside
the sentence claiming to apply it — the eighth time on this project, and the second
inside a batch written to observe it. Found by `architecture-guardian`.

The code is nonetheless right, for a reason of its own. The two cases differ on
whether the capability is held at all, which is the distinction §22's two codes
exist to draw. A narrow grant of a Whole Church capability **names** it, so the
account holds it and only the scope is unusable. A refused `SENIOR_PASTOR` row names
nothing, so it contributes none of the role's capabilities at any scope, and where
the account has no other source for the one being asked about, `SCOPE_DENIED` would
send an administrator to widen a scope that does not exist. An account holding a
second role keeps whatever that names.

*That qualifier was missing here from the day this paragraph was written, and the
paragraph then stood unrevised through both later correction batches — each of which
edited the text immediately above or below it.* A first attempt to record that said
it had been "dropped by three successive versions of this paragraph, including the
two written to correct it", which is false twice over: the paragraph had exactly one
earlier version, and neither correction batch touched it. Getting the history of a
wrong claim wrong is the same fault one layer out, and the true version is the worse
one — two passes read around this paragraph without reading it.
The cost is that on the accepted failure mode, configuration lost, a real Senior
Pastor is told they hold nothing while `account_roles` says otherwise; what resolves
that is the error logged at the refusal, which names both causes, and the code is
pinned by a test rather than left to be inferred.

*This rule reached `SKILL.md` §7 on the following review pass, not in the batch that
settled it — which is the **fourth** false "written to §x" claim on this project, and
the second in this entry's own vicinity.* It matters more than the others did: an
error code is client-visible and §7 states the contrasting `SCOPE_DENIED` rule
explicitly, so the specification carried one half of a distinction and not the other.
Nothing checks such a claim, which is why they keep happening; what would is a
reviewer grepping §7 for the rule rather than reading the sentence asserting it is
there.

**Absent configuration fails closed and the process still starts; malformed
configuration stops it.** A fresh installation must boot and run the import (§2)
before either Person exists to be named, so this cannot be a required value.
Absent, no `SENIOR_PASTOR` can be provisioned and an existing row confers nothing,
which is logged at startup. The availability cost is real and is accepted in
writing: a deployment that loses the variable strips both Senior Pastors of their
authority until it is restored. Fail-open was rejected — it would mean the check
protects nothing in exactly the circumstance where nobody has noticed it is gone.
A malformed value stops the process, because a typo produces the same silent
stripping and would be noticed last.

**The free-seat read stays unfiltered**, because the partial unique index it has to
agree with is. A row this rule refuses to honour still occupies its slot, and
offering that seat to a provisioning request would hand it a seat the insert then
rejects — replacing an answer with a constraint violation, which is the failure
§4's backdate floor and §22's error codes exist to prevent.

Written to `SKILL.md` §7 in the same change.

**One question is raised and deliberately not answered here.** Whether the mapping
is exclusive the other way — whether Bishop Oriel or Pastora Geraldine may hold an
`ADMIN` role on the same account — is not stated by §7, and an `ADMIN` row beside a
`SENIOR_PASTOR` one would defeat the separation §7 builds. It is a separate ruling
and is listed as unsettled below rather than decided in passing.

### 2026-08-24 — Naming a Senior Pastor takes effect on the next restart

Confirmed rather than discovered. `SENIOR_PASTOR_PERSON_IDS` is read once, by the
`AppConfigModule` factory, and nothing reloads it — so setting it after the initial
import, and any later succession, requires a restart.

Kept deliberately, and it is worth saying why the alternative was refused. A
hot-reload would make the answer to "who are the two Senior Pastors" change under a
running process, with no deployment event marking it and nothing in the audit log —
which is most of what makes configuration a safe home for this in the first place.
A restart is an operational act somebody performs and can see. The ruling that put
the identity in configuration rests on its editor already holding `JWT_SECRET`; it
does not follow that the value should be quietly re-readable.

The cost is a short window: between the import finishing and the restart, no
`SENIOR_PASTOR` account can be provisioned and any such row grants nothing. That is
the fail-closed default and is correct for every moment before the two Persons
exist — but it is not obvious from either document alone, so `docs/ROADMAP.md` now
records the ordering (import, read the ids, set the variable, restart) beside the
two Stage 2 items it spans, and `.env.example` says it where the operator reads.

Written to `SKILL.md` §7 with the identity ruling, which is where the mechanism was
already described; this entry is what makes it a decision rather than a description.

### 2026-08-24 — An account holds at most one of `ADMIN` and `SENIOR_PASTOR`

The question the configuration ruling raised and deliberately left open. §7 says an
account holds at most one active row **per role**, which permits two rows of
different roles, and the schema agreed: `UNIQUE (account_id, role) WHERE revoked_at
IS NULL`.

**Refused.** An account's effective authority is the union of its roles' defaults
and Admin's set is a superset of a Senior Pastor's, so the pair does not produce a
Senior Pastor who also helps with administration. It produces an account holding
every capability in the system, for which every capability §7 withholds from the
role is void — `roles.manage`, `accounts.manage`, `records.backdate_effective_date`,
`people.merge`, `people.correct_sex`, `settings.manage` and `cell.approve_creation`.

*A first version of this entry said "§7's five deliberate exclusions" and listed
five. Both halves were wrong: the §7 table withholds **seven** capabilities from the
role, and §7's own "five" counts bullets, one of which is about Leaders rather than
Senior Pastors. Quoting a count out of a neighbouring sentence is the cheapest form
of the fault this log keeps recording.*

It is self-perpetuating, which is what moved it from a caution to a constraint:
such an account holds `roles.manage`, so it can retain the pair and revoke anybody
else's roles. §7's own justification for the exclusions is that "every permission
change has a second party involved", and one row makes that false *of that
account's own permissions* — another Admin may still exist and revoke the row,
which is the narrower and true claim.

*"Grant itself anything further" was in the first version and is vacuous: Admin
already holds all twenty-seven capabilities, so there is nothing further to grant.*

**It would also have masked the identity check merged the same day.** Where the
configuration is lost, that check refuses the `SENIOR_PASTOR` row and the account
falls to nothing — the deliberate fail-closed behaviour. An `ADMIN` row beside it
keeps the account at full authority, so the control never bites for exactly the two
accounts it exists for.

**This closes one route to that authority and not the only one, and the first
version of this entry did not say so.** §7 permits Admin to grant any capability
explicitly, and nothing forbids granting a withheld one to a Senior Pastor's
account — same destination, no `ADMIN` row, no constraint violated, and invisible
to the identity check, which filters role rows and not grants. Found by
`architecture-guardian`, which is the point of running it: the ruling was argued
from the route being looked at. That question is escalated rather than inferred
from this one, and is listed as open below. **Settled the same day** by the ruling
below it: the grant-making pair is refused, the other five may be granted. Migration
`0005`'s own header still says the question is open and is deliberately left alone —
it is merged, and only `0001` may be corrected in place (ruling of 2026-08-21).

**The cost is accepted and is the mechanism, not a side effect.** §6 gives one
Person one Account, so Bishop Oriel and Pastora Geraldine cannot perform an
administrative action at all — provisioning, a merge, a backdated record and a sex
correction are each somebody else's to do. In a small church whose Admin is
sometimes unavailable that is real friction, and it is what "a second party" means.

**Enforced by a partial unique index over `(account_id)` where the role is one of
the two**, not by a check in `auth`. The distinction from the identity half is the
whole reason: that one must live in the application because the database holds no
durable representation of who the two Persons are, while role combination is
entirely inside `account_roles` — so an index decides it where the state lives
rather than where a request happens to pass, and is still enforced under
`pg_restore --disable-triggers`, which is the argument the 2026-08-21 slot ruling
already made on this same table. Not quite *unrepresentable*, which two of the
three copies of this reasoning claimed until a review pointed at the third: a full
restore builds indexes after loading data, so a dump already holding the pair loads
and then fails index creation.

**No domain check was written, deliberately.** `roles.manage` has no endpoint, and
provisioning cannot produce the state — it creates exactly one role on a new
account and refuses a Person who already has one, and it is the only writer of
`account_roles`. Code with no caller is what `58925c8` removed from
`AuthorizationService` on the previous branch, and the same reasoning applies here
before the fact rather than after it. §7 instead states the contract the endpoint
owes when Stage 3 or later builds it: `INVARIANT_VIOLATION` rather than a raw
constraint violation rendered 500.

*The first version of this paragraph called what `58925c8` removed "a check", "two
commits earlier". It was `rolesFor`, an accessor, and it was five commits before
this branch's base. The decision stands; the precedent was misdescribed.*

`LEADER` is outside the limit, and a test pins that rather than leaving it implied:
it confers strictly less than either governing role and carries none of the
excluded capabilities, so an index over *every* role would forbid a legitimate row
and pass every other case. Written to `SKILL.md` §7 and migration `0005`.

### 2026-08-24 — The grant-making pair is never held by a Senior Pastor

The Stop Condition the role-combination ruling escalated. §7's role catalog says
"Anything beyond a role's defaults requires an explicit, Admin-issued grant" and
names no exception, so the index added in migration 0005 closed the role-combination
route and left the explicit-grant route wide open: a Whole Church grant of
`roles.manage` reaches the same authority with no `ADMIN` row, nothing violated, and
invisibly to the identity check, which filters role rows and not grants.

**`roles.manage` and `accounts.manage` may never be held by an account holding
`SENIOR_PASTOR`, by role or by grant. The other five §7 withholds may be granted.**

Three options were weighed and the middle one is not the compromise it looks like —
it is the only one that matches §7's own argument.

**Refusing all seven** is wider than §7. It would refuse `people.merge` and
`people.correct_sex` to the people most likely to *know* a correction is needed,
and it buys nothing: neither is self-perpetuating, each use is one audited
operation, and an Admin can revoke the authority afterwards.

**Permitting all seven** is what the specification said by omission, and it is how
a small church's authorization model actually dies. Granting "the admin bundle" in
a hurry on a Saturday hands over `roles.manage`, after which the holder can grant
themselves the rest and revoke the Admin who granted it. Every step is a legal use
of a legally issued grant. The Monday revocation never happens, because the person
who would perform it no longer can.

**The pair is the line because the pair is what removes the second party
permanently.** §7 justifies withholding `roles.manage` and `accounts.manage` on
exactly that ground — "every permission change has a second party involved" — and
justifies `records.backdate_effective_date` and `people.merge` on a different one,
that they move totals for periods already reported. `people.correct_sex` it argues on that same
second ground, explicitly. `settings.manage` and `cell.approve_creation` it
withholds in the table and argues nowhere. Treating the seven alike was a
simplification of mine, not §7's position, and the review that found the hole is
what made the difference visible.

*The first version of this entry, and three other files with it, put
`people.correct_sex` in the "argued nowhere" group. §7 argues it 87 lines above the
sentence denying it, on the same ground as `people.merge`. Migration 0005 is not the
counter-example this entry first cited: its header says §7 "argues four of them and
is silent on" two, which accounts for six of the seven. Its list of silent ones is
right and its count is one short, because §7 argues five. **Which** capability 0005
left out cannot be read off it — it never enumerates its four — so nothing more is
claimed than that the count is wrong. Asserting it was `people.correct_sex` would be
a guess about that file inside a paragraph correcting a previous guess about it. The
ruling is unaffected, since self-perpetuation is what
decides the line and `people.correct_sex` is not; what was wrong was the taxonomy
offered as its justification, asserted without grepping §7 for the third member.*

**Two triggers, not one, and not an index.** The rule spans `account_roles` and
`capability_grants`, so no index reaches it. Enforcing on grants alone is walkable
from the other side — grant first, add the role second — so whichever row arrives
second is refused.

**Each path locks the account before it looks, and that is the half worth
recording.** A deferred trigger sees only its own transaction's commit-time state,
so two concurrent transactions writing the role and the grant would each find
nothing and both commit — the exact defect the 2026-08-21 ruling records in the
`SENIOR_PASTOR` counting trigger, whose remedy there was a unique index. No index is
available here, so both paths take `FOR NO KEY UPDATE` on the account instead.
`FOR NO KEY UPDATE` rather than `FOR UPDATE` because it conflicts with itself, which
is all that is needed, and not with the `FOR KEY SHARE` a foreign key takes — the
same reasoning §6 records for the revocation lock.

**Deferred, but not for §4's reason, and the difference is why it is written down.**
There, neither order works and an immediate trigger makes a mandated operation
unperformable. Here every conflict has a legal order — revoke the grant, then add
the role — so an immediate trigger would be satisfiable. It is deferred so the order
is not a trap, and so a row written and revoked inside one transaction has nothing
left to validate.

**The cost is the rule rather than a side effect.** The two Senior Pastors cannot be
handed grant-making authority even temporarily, so an unreachable Admin is answered
by a second Admin account and not by widening theirs. A capability joins the pair
only by amending §7, which is where the argument for refusing rather than auditing
has to be made.

**Two things the review added, recorded here because this log's own record on "written
to §x" claims is bad.** The triggers were the whole of the enforcement at first, and a
constraint trigger is what `pg_restore --disable-triggers` skips — which §7 argues
twice in that same section, for the 0005 index and for the identity check. So a
grant-making capability is refused a second time where authority is assembled, reading
the role **row** rather than an honoured role so the two points refuse the same states.
And that refusal answers `CAPABILITY_DENIED` where nothing else the account holds
carries the capability, which is client-visible and therefore §7's to state.

The qualifier on that is load-bearing and §7 now says what it leaves open: the other
route to these two capabilities is an `ADMIN` role row, which this point does not
touch. That pairing is refused by 0005's index, and 0005's index is the one §7 already
concedes is "not quite unrepresentable" — a full restore fails at index creation rather
than at the write. So the role half rests on the index and on that failure being acted
upon; only the grant half is refused twice.

Written to `SKILL.md` §7, §24 and migration `0006`.

### 2026-08-24 — How the leadership tree import runs

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

### 2026-08-24 — Birthday is optional on a Person

Found by building the tree import: §2 has Admin import "names, sex, and each
person's direct leader", §3 required a birthday and a civil status, and
`persons.birth_date` is `NOT NULL` — so the import as specified could not create a
single Person. The tree turned out to hold birthdays, which unblocked the import;
the question it exposed was the ordinary one, at consolidation.

**Birthday becomes optional.** The argument is §3's own, made two sections earlier
about email: "a mandatory field that people cannot fill is filled with fictions,
which corrupts both the data and duplicate matching."

**For a birthday the corruption is worse than the general case**, which is what
makes this more than consistency. Two of the three Tier 1 rules read the birthday,
and Tier 1 *blocks* creation. So two unrelated people carrying the same invented date match each
other at Tier 1, and the system refuses to record one of them on the strength of a
value nobody meant. Requiring the field does not protect the matcher; it poisons it,
and then acts on the poison.

*My first recommendation was the opposite — that making it optional "guts the
matcher" — and it was wrong because it reasoned about wholesale absence rather than
about the population that actually lacks one.* Absence drops a candidate to Tier 2,
which is honest: less is known, so less is claimed. Fabrication produces false
confidence. The owner's question about consolidation is what surfaced the
distinction.

*The first version of this entry said "both Tier 1 rules", in §3 twice, in the Decisions entry,
in migration 0007, in a test comment, in that test's title, and in the commit
message — **seven**, of which six could be corrected and the commit message could
not. *Two earlier versions of this sentence were wrong in two different ways, and a
third version collapsed them into one.* The first enumerated five places and gave no
total at all, omitting the Decisions entry and the test's own title — an incomplete
list. The second enumerated seven and called them six — bad arithmetic over a
complete list. Saying they "said five and then six" describes neither: the first
said no number. Two failures, not one repeated, and treating them as one repeated is
§25 rule 19 applied to the paragraph's own history, exactly as the 2026-08-24 entry
had to correct "three successive versions" to one.

*One miscount is now itself immutable.* `65a9835`'s commit message carries "it was
six places and not five, of which five could be corrected", which is wrong on both
counts and cannot be edited. This paragraph accounted for the immutable false claim
in `6a6d5a8` and not for that one; it does now.* §3 makes a matching mobile number
with equal first and last names a Tier 1 as well, and states the generalisation three
subsections along: "Every Tier 1 rule reads a birthday or a mobile number." The
argument survives — a fabricated date still produces a false Tier 1 that blocks a
real person — but "no birthday means no Tier 1" is false, and the case is pastoral
rather than theoretical: names compare with `Jr` and `Sr` stripped and households
share numbers, so a father and son with no birthdays on one number are a Tier 1
refusal today.*

*Two live defects came with the ruling and are recorded here rather than only in the
fix. The null guard in `duplicate-matching.ts` became load-bearing the moment a
candidate could carry null, and nothing held it — removing it passed all 436 tests
while refusing two birthday-less people at Tier 1 on a claim their birthdays matched.
And `@IsOptional()` skips null as well as undefined, so `PATCH {"birth_date": null}`
erased a recorded date, answering 200; before the column was nullable the database
refused it. Relaxing a constraint turned into a capability nobody decided on, which
is worth remembering as a class rather than an incident.*

**An explicit null on `birth_date` is refused, and that is a rule rather than a
patch.** `@ValidateIf` replaces `@IsOptional()` so the edit answers
`VALIDATION_FAILED`. §3 defines adding a birthday and does not define removing one,
and a relaxation must not become a capability by omission — so the conservative
reading is taken and the question is left open rather than answered by a side
effect. It refuses any explicit null, whether or not one is recorded, because the
check reads the request and not the stored row; omitting the field is unaffected.

**Two situations produce a Person with no birthday**, and the second decided it. A
leader may not have asked. Or somebody may **decline** — a first conversation is not
the moment to press for personal information, and a church that insists serves least
the people most guarded about their details. That is a privacy position, not a data
gap, and no later gate may coerce it: a milestone that refuses attendance or Cell
membership until a birthday appears would press hardest on exactly the person who
withheld it.

**The matcher needed no change.** `Subject.birthDate` and `Candidate.birthDate` were
already `string | null`, and §3 already carried a Tier 2 rule naming an absent
birthday. The edit endpoint needed none either: `PATCH /api/v1/people/{id}` under
`people.edit_basic` already accepts `birth_date`, so "the leader adds it later" was
built before the rule required it.

**The import still requires it** (§2), because it loads from a central record that
holds them — a gap there is an omission rather than a person's decision.

**Reversibility has a deadline, and the migration says so.** Re-adding `NOT NULL`
works only while no row lacks a birthday, which is true today and false after the
first person is recorded without one.

Three things are deliberately **not** settled here, and are listed as open below: a
"details to collect" attention list so an optional field is not an invisible one,
whether "asked, not given" is a state on the Person distinguishing a decision from a
gap, and whether a recorded birthday may ever be removed. The first two wait for the first real screens, since an attention list with
no dashboard to live on is a list nobody sees; the third is a specification question
with no dashboard dependency at all.

Written to `SKILL.md` §3 in the same change.

### 2026-08-25 — The decisions file is a CSV, and the fingerprint is over trimmed fields in order

The two things §2's *How the tree import runs* describes and does not fix. Both are
reachable the moment somebody writes the import, and neither has a defensible
default, so they are settled here rather than invented at a keyboard.

**A CSV, not JSON, and the reason is §2's own reason for choosing a file.** The
file exists to be sorted, emailed to the leader who actually knows whether those
two records are one person, and returned. That leader opens a CSV in a
spreadsheet. They open JSON in a text editor and edit it wrongly — a lost brace
in a file whose whole purpose is deciding which people exist.

**The fingerprint is a column on every row rather than a header.** Three
alternatives were weighed. A comment line is not CSV and every parser disagrees
about it. A companion file can be separated from the file it describes, which is
the failure mode of a fingerprint. A single first row is a second record shape in
one file. A repeated column survives a spreadsheet round-trip, and requiring every
row to agree catches the case none of the others do: two decisions files spliced
together.

**Only rows with a candidate appear, and blankness means different things by
tier.** A row matching nobody has nothing to decide. Listing all three thousand
to say so produces a file completed without being read, which is the argument §4
already makes for refusing to ask anyone to confirm a tautology — and here the
unread rows are the ones that matter.

A Tier 1 row left blank is refused, because §3 requires acknowledgement before
creation and silence is not acknowledgement. A Tier 2 row left blank means create,
because §3 asks nothing of the person reading a Tier 2 list. That asymmetry is the
tier rules restated rather than a convenience: the two tiers differ precisely in
whether a person must answer.

**`USE_EXISTING` names a Member ID, not a UUID.** The adjudicator reads it off the
dry-run report and may retype it. `M-000000` survives retyping; a UUID does not,
and a mistyped one either matches nothing or — far worse — matches somebody.

**An existing Person who already holds an active pastoral assignment refuses the
commit, naming the row.** §5 permits exactly one, so proceeding means closing the
one they have, which is a reassignment carrying its own authorization and its own
audit entry. The import must not perform one as a side effect: the person who
decided these two records are one person was never asked whether to move anybody,
and a pastoral move nobody requested is the kind of silent change §5 exists to
prevent. Refusing hands it back as an ordinary reassignment, decided by whoever
should decide it.

**The fingerprint is SHA-256 over the seven trimmed fields of each row, JSON-encoded
per row, rows joined by a newline, in file order.**

JSON encoding rather than a delimiter, because §3 requires names to support any
character and there is therefore no delimiter that cannot occur in a field.
Trimmed rather than raw, because surrounding whitespace is exactly what a
spreadsheet adds and removes unbidden — the class of change §2 says this must not
refuse. The header contributes nothing: it is fixed, and a file whose header
differs is refused before a fingerprint is taken.

**Row order is included, and the cost is stated rather than discovered.** Sorting
the input invalidates a decisions file although every decision would still apply
correctly, since decisions key on `row_id` and not on position. An
order-independent digest was considered on exactly that ground and rejected: the
dry-run report the adjudicator was reading names **line numbers**, so in a
re-sorted file those numbers point at other people and the file they answered is
no longer the file in front of them. Refusing forces a fresh report, and the dry
run writes nothing and may be re-run as often as needed.

Written to `SKILL.md` §2 (*The decisions file*, *The fingerprint*) in the same
change — and, this repository having now recorded four false "written to §x"
claims, that was checked by grepping §2 for both subsections rather than by
asserting it here.

### 2026-08-25 — A root has a seat, and a nullable leader could not say what it meant

Found building toward the tree import, which creates the two Network roots as its
first act and could not. Three things, and the middle one is a defect that was on
`main`.

**§5's "exactly one root leader" per Network was enforced nowhere.** Not by a
constraint, not by application code, not by a test. `pastoral_assignments` carried
no constraint on null-leader rows at all, and the only writer of the table took
`leaderId: string | null` and inserted whatever it was handed. A third root was a
plain `INSERT` away, and every subtree total walking the tree would then have had
two answers with nothing raised. The Definition of Done requires an invariant
expressible as a constraint to exist as one; this one was expressible and did not.

**`pastoral_assignments.root_network`, with a partial unique index**, which is
`account_roles.senior_pastor_slot` again — and adopted by re-deriving its two
reasons rather than by resemblance, since reusing a shape without that is §25 rule
19. A trigger counting open roots is not a constraint: under READ COMMITTED
neither of two concurrent transactions sees the other's uncommitted row, both
count zero, both commit. And `pg_restore --disable-triggers` skips a constraint
trigger while never skipping a unique index.

**Where the analogy does not hold is the interesting part, and the first version
of this entry got it wrong.** The slot works partly because the state it
constrains lives entirely in `account_roles`. A root's Network does not — it lives
in `network_assignments`, effective-dated — so this denormalizes, and a
denormalized value can drift.

I argued it could not drift here, from §5 refusing to reassign a root and §4
refusing a Network change for a root and for anyone leading disciples. **Both are
true of the application and neither was true of the database.**
`assert_network_change_keeps_edges` filters `pa.leader_id IS NOT NULL`, so a root's
own row is by design never examined on a Network write; and
`assert_root_network_matches` compares against `network_as_of(person_id,
started_at)`, frozen history that cannot see a later change however often it fires.
`architecture-guardian` probed it and a Network change on an open root committed,
leaving the seat naming the Network the person had left — one Network effectively
rootless, the other free to take a second root, reached with no pastoral
reassignment. I reproduced the probe before acting on it.

**That is the ninth instance on this project of a rule written by reasoning from a
mechanism's purpose instead of reading its `WHERE` clause** — committed, this time,
in a migration whose own header says "**Re-derived rather than copied**" and cites
§25 rule 19 for it. The claim was three-times-stated: in the migration header, in
§5, and in this entry. Nothing checked any of them, because the thing they asserted
was about a trigger none of them had read.

So both directions are now constrained. `assert_network_not_changed_for_root`
refuses a write to `network_assignments` that would leave an open root seat
disagreeing with its holder — §4's existing refusal expressed as a constraint
rather than as a TypeScript check, in a change whose entire thesis is that a
TypeScript check is the weaker thing.

**The first predicate for it was too narrow, and the second review pass found
that too.** It compared the Network in force at the *written row's* `started_at`
rather than at the *root row's*, and never checked that the person still held an
open Network row at all. Two shapes passed: closing the open Network row and
opening nothing — the UPDATE's own start is still covered by the row it closes, so
the comparison returned the old Network — and moving an open row's `started_at`
forward. The first is the worse one: the person then belongs to no Network while
the index still reads their seat as taken, so that Network has no root and cannot
be given one.

That is the same fault as the finding it was fixing: three places again claimed a
guarantee wider than the check delivered. It was widened rather than the sentences
narrowed, because the wider rule is the one §5 wants. Both shapes are now probed
in `invariants.spec.ts`.

Zero roots in a Network stays legal, because that is what a fresh database holds
before the import runs. "Exactly one" is not expressible without forbidding an
empty database, so the index forbids the second and §2 makes the import refuse a
file that does not carry both.

**The nullable identifier was a booby-trap aimed squarely at the import.**
`CreatePersonInput.pastoralLeaderId` was `string | null`, its comment said null was
"only for the import path", and what null actually did was open **no assignment row
at all** — producing an unassigned Person, which the 2026-08-23 ruling says is
"never a root". So the one caller that field was written for would have passed null
for its two roots, got two unassigned Persons, and built a tree with no roots.
Nothing would have failed: no constraint, no test, no error, and the defect
surfaces only when somebody asks why a subtree total is wrong.

It is now a discriminated union — `{ kind: 'UNDER'; pastoralLeaderId }` or
`{ kind: 'ROOT' }` — at both `CreatePersonInput` and `HierarchyService.openAssignmentWithin`,
so the wrong outcome is a compile error. That is the standard §2 sets for the
capability guard and §22 for `completeWithin`'s transaction parameter: the one
mistake a caller can make is refused by the compiler rather than left invisible at
the call site.

**No `UNASSIGNED` variant, deliberately.** §5 permits zero open assignments for a
Person not yet assigned or an archived one, but nothing *creates* a Person into
that state — archival reaches it by closing a row. The nullable field had silently
offered it, which is a capability nobody decided on; a variant no caller can
justify is the same thing spelled differently. The earlier ruling that "only the
import creates one" was written before the root-is-a-row ruling superseded it, and
nobody updated it — this does.

**A root is created only by the import**, and no endpoint can ask for one:
`POST /people` requires a pastoral leader, and §5 makes who holds a root a
Network-level decision rather than an encoding one. Written to `SKILL.md` §5 in the
same change, and checked by grep rather than asserted.

**Four smaller findings from the same review, each the recurring shape.**

The migration justified `DEFERRABLE INITIALLY DEFERRED` on the honesty trigger by
saying the root row and the `network_assignments` row it checks "are written in one
transaction, and an immediate trigger would reject whichever landed first". Reading
the only caller, the network row is always written first, so there was nothing to
reject. That reason belongs to `pastoral_assignments_same_network`, which is
deferred for §4's atomic pair. The trigger is now immediate, which is also better:
deferred, a violation arrives at `COMMIT` as a raw `check_violation`, the
500-instead-of-an-answer failure recorded here repeatedly.

`SET CONSTRAINTS ALL IMMEDIATE` was justified as flushing pending events for an
`ALTER TABLE`. It is load-bearing for the `CREATE INDEX` too — both are refused
while events are pending — and `ALL` does not merely flush, it switches the mode
for the rest of the transaction, silently including the trigger created further
down the same file. Narrowed to the one constraint it means.

The migration pre-validated one data condition and left its neighbour to abort raw,
though the policy names that neighbour by name. It now checks for pre-existing
duplicate roots as well.

**And the root path had no caller and no test at all.** `kind: 'ROOT'` appeared
nowhere outside its own definition, so the seat could have been written wrong or
omitted with the suite green — a §5 rule stated in the specification with nothing
able to fail on it, which is the pattern this repository keeps refusing to ship.
Four service-level cases now exercise it.

**The concurrency test proved nothing, twice over.** It was first written with two
pooled `db.transaction()` calls awaited together, which may simply run in sequence.
Rewritten to two raw connections with explicit `BEGIN` — copied from the
one-active-assignment case beside it — it was *still* only pinned by dropping the
index, which the sequential case above it already pins: nothing awaited the second
INSERT before the first committed, so it may arrive after the commit and fail
against a committed index with the assertion passing regardless. It now polls
`pg_stat_activity` until a backend is genuinely blocked and asserts the write has
not settled, which is what `person-lock.e2e.spec.ts` does and what pinning
concurrency actually looks like.

**And that rewrite was itself only nearly right.** The helper filtered on a
hardcoded `query LIKE '%pastoral_assignments%'` and took an index name it used
only in the error message, so any backend blocked on any lock touching that table
satisfied it. Not vacuous — `--runInBand` leaves one candidate — but resting on the
harness rather than on what it claimed to check. It now watches the waiter's own
`pg_backend_pid()`.

**Three more from the second pass, all the same shape.** A comment claimed the
Network trigger "never touches the ordinary case" because a Person's first Network
row is written before their assignment row — an argument about an *immediate*
trigger applied to a deferred one, which runs at COMMIT and plainly sees the root
row. The `IMMEDIATE` justification reasoned from one caller of
`openAssignmentWithin` rather than from every writer of the table the trigger is on,
which is the level the question is asked at; re-derived across all four, it holds.
The service-level second-root case asserted only that *something* threw. And the
succession language was corrected in §5 but left standing in the migration and in a
test name, so two files still described an operation §5 had just said the system
does not offer.

### 2026-08-25 — The tree is known centrally only to its first level, and no birthday is required

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

### 2026-08-25 — A generational suffix lives in `last_name`, and a title lives nowhere

Found preparing the spine file, where two of the thirty rows carried `II` and `III`
and four carried `Bishop` or `Pastor` inside `first_name`.

**Suffixes were not forgotten; where they are *stored* was never said.** §3's
matching rules already name `Jr`, `Sr`, `II`, `III` and say to ignore them when
comparing and compare them separately as a weak signal, and `duplicate-matching.ts`
implements exactly that — `normalizeName` strips them, `suffixOf` reads them back.
What no section stated is which field they go in, and the silence has a live failure
mode rather than being merely untidy.

`suffixOf` reads `first_name` and `last_name` and nothing else, and `middle_name` is
never compared at all. So a suffix written into `middle_name` is **invisible**: not
stripped, which is harmless, and never surfaced as a distinguishing signal, which is
not — a father and son recorded that way lose the one signal §3 provides for telling
them apart, silently. That is reachable today, because encoders are about to type
names into a form and nothing tells them where `Jr` goes.

**`last_name`, and no column.** A `suffix` column was rejected: the matcher already
reaches the right answer from the name fields, and §3's rule is *written* on that
assumption — "ignore the suffixes when comparing" presupposes they are inside the
compared string — so a column would mean amending the rule, the `persons` shape and
the matcher in order to arrive at behaviour that is already correct. The list is also
deliberately closed, and `duplicate-matching.ts` records that `IV` was in the set and
was removed because "a closed list in the specification is not a starting point to
extend". A column invites exactly that extension; a suffix inside a name is just part
of the name, and only the four get special treatment.

`last_name` rather than `first_name` is a choice between two that both work, since
both fields are stripped and both are read. The surname is what a generational suffix
qualifies, sorting by last name keeps a father and son adjacent, and one stated place
beats two working ones.

**A title is a different question and is left open.** `Bishop`, `Pastor` and `Pastora`
are not suffixes and §3 now says plainly that a name field is not where they go —
because anything put there is compared as though it were part of the name, which is
how `Bishop Oriel` fails to match `Oriel` and a second record for the same person goes
unnoticed. Where a title *does* live is listed below rather than decided here: a
stored title is not effective-dated and so cannot answer what somebody was called in a
past period, which is the mistake the 2026-08-20 structures ruling names, and two of
them are derivable from `SENIOR_PASTOR_PERSON_IDS` in any case. It is a display
question, and there are no screens yet to decide it against.

Written to `SKILL.md` §3 (*Name handling*), and verified by grep rather than asserted.

### 2026-08-25 — The first Admin account is a one-time command, and an administrator need not be in the tree

Every account is provisioned by somebody holding `accounts.manage`, which only
Admin holds (§7). So the first Admin cannot be provisioned by anybody, and nothing
in the system could create it. §7 and §21 both left a nullable column justified by
this exact moment — `account_roles.granted_by` "for the first Admin account,
granted by a system action", and `audit_log.actor_id` "only for a system action" —
and no code had ever used either.

**A command, not an endpoint.** §7 keeps a closed list of routes reachable without
authentication, and an unauthenticated route that mints the most powerful account
in the system is the wrong thing to add to it: if its emptiness check is ever wrong,
or two requests race it, whoever reaches the server first holds the church's
records. That is a well-known way to lose an application, and the convenience it
buys is used once in the lifetime of an installation.

A command has no such surface, and rests on the argument §2 already accepts for the
import script: whoever can run it can reach the database directly, so it is not
authentication. What it buys is that the one write nobody can be named for happens
deliberately, once, and is recorded as what it was.

**It writes rows rather than calling the domain services**, which both require an
actor and an idempotency claim that do not exist yet. §2's rule that imports run
through the services exists because a script "bypasses every service-layer check" —
but this repository has since moved the §5 invariants into constraint triggers and
partial unique indexes, so a direct write meets every one of them. What is reused is
everything a second implementation would drift from: token minting and hashing, the
audit row shape, and the sex-to-Network mapping.

The alternative was a "system actor" value passed to the services, and it was
rejected rather than merely not chosen. It means introducing an actor that *passes
authorization checks* into services whose whole job is enforcing them — a permanent
concept, readable by everyone, added for a need that arises once. The first person
to reuse it "just for this script" has a back door.

**It refuses while any account exists, and takes the lock before it looks.** The
refusal is what makes it one-time rather than a standing privilege. The lock is
because two runs would otherwise both find an empty table and both create an Admin,
which is the failure the refusal exists to prevent — the same shape as the
`SENIOR_PASTOR` counting trigger recorded on 2026-08-21, and avoided here rather
than after a review found it. The check is "any account", not "any Admin": a system
already in use is not a fresh installation whatever roles it holds.

**It prints the activation token rather than emailing it**, which is a deliberate
departure. §6 keeps activation tokens out of API responses because an administrator
must not learn another person's — and here the operator *is* the holder, standing
at the machine. The reason is recovery: if delivery failed for this one account
there would be no Admin to re-send from and no way back, since the command refuses
to run twice. The cost is a token in terminal scrollback, accepted for one that is
single-use, short-lived, and read by the person who just typed the command.

**§5 invariant 3 gains a third legitimate case.** It said zero open assignments is
legitimate in "exactly two situations" — not yet assigned, and archived. Both are
transient: a Person in either is one something will eventually happen to. An
administrator who is not discipled by anyone is in the correct *permanent* state,
and calling that "not yet assigned" invites somebody to go looking for the missing
leader and attach one — putting a person in the pastoral tree who does not belong
to it, counted in a subtree that does not contain them, with no report ever saying
so.

Neither placement is preferred. An administrator who *is* part of the church is an
ordinary Person under their own leader, and the command takes a leader for that.
What is forbidden is inventing one so that a record looks complete.

**The writing lives in `src/admin/bootstrap/first-admin.ts` rather than in the
script**, split the same way and at the same seam as the tree-CSV validator,
because a script cannot be tested and §6 now states four rules that would otherwise
have nothing able to fail on them. Nine cases pin them.

**One implementation lesson, recorded because it cost three blind runs.**
`NestFactory.createApplicationContext(AppModule, { logger: false })` reports a
failure to build the context *through the logger it was just told to silence*, and
then exits — so a missing `JWT_SECRET` produced exit code 1 and no output at all,
before any `catch` in the file could run. It is `['error', 'warn']` now, and the
comment says why rather than leaving the next person to rediscover it.

**And the writes go through the modules that own the tables**, which the first
version did not. It inserted into `persons`, `person_lifecycle`,
`network_assignments`, `accounts` and `account_roles` directly, justified against
§2's *imports* rule — a different sentence from "a module owns its tables. No other
module reads or writes them directly", which carries no exemption and which this
repository defended once already at the cost of restructuring the module graph
(2026-08-24). `people` and `auth` each gained one narrow method with one caller;
`admin/bootstrap` now writes no table at all, which is greppable rather than
asserted.

**That change surfaced a second thing, and it is the more useful lesson.** The
script ran under `tsx`, whose esbuild backend does not implement
`emitDecoratorMetadata` — so Nest cannot read the constructor parameter types it
resolves providers by, and every dependency injected without an explicit
`@Inject(...)` arrives `undefined`. It runs under `ts-node` now.

The first version appeared to work only because the three services it happened to
use inject everything explicitly. Routing through `PeopleService`, which does not,
is what exposed it — a whole class of silent failure that no test could see,
because `ts-jest` compiles the tests properly and only the *script* was affected.
`migrate.ts` and `validate-tree-csv.ts` stay on `tsx`: neither builds a Nest
context.

Written to `SKILL.md` §5 (invariant 3) and §6 (*The first Admin account*), and
verified by grep rather than asserted.

### 2026-08-26 — A module's tables are never written by another, and read by one only where the query is rooted elsewhere

§2 said "**A module owns its tables.** No other module reads or writes them
directly", and the code never matched it. `hierarchy` joins `persons` in two
queries, and when `people` was split into five services somebody — me —
narrowed the rule *in `people.module.ts`'s comment*, on the reasoning that a rule
stated more strongly than the code keeps stops being checkable.

That is right about the danger and was the wrong remedy. Narrowing a rule in one
module's comment leaves every other module to find that comment or not, and a
reviewer to discover that the specification and the code disagree with nothing
saying which governs. Stage 3 builds `cells`, whose author would have found the
comment before the section.

**So the rule is narrowed where it is the rule.** No other module *writes*, ever,
and none reaches a table for anything a service interface can answer. One exemption,
named: a read joined onto a query rooted in a table the reading module owns.
`hierarchy`'s two joins qualify because both start from `pastoral_assignments`,
which `people` cannot query — so the join cannot move to the owning module, and
returning identifiers for the caller to resolve moves it rather than removing it.

**The asymmetry is the point.** A write is what an invariant guards, which is why
§2 gives the five §5 rules one home only while `hierarchy` is the sole
writer of `pastoral_assignments`. A join reads rows the owning module would have
returned anyway.

*The first version of the amendment described the exemption from what it was for
rather than from the queries, and both halves were false: it placed the joins in
`hierarchy`'s recursive walks, which select identifiers and join nothing, and
justified them by "one query into hundreds", which is impossible for
`directLeaderNameOf` because it returns at most one row. Found by
`architecture-guardian` on the third pass — in the paragraph added to stop
exactly that, which is the tenth instance on this project.*

**The exemption list is declared closed with nothing able to fail on it**, and that
is recorded as open below rather than claimed as settled. This repository gates the
pure-client boundary, the refused UI packages, the palette token names and the
module graph; a cross-module table read is greppable in one line and has no gate.

### 2026-08-26 — The bootstrap's two service methods guard themselves, and `ts-node` ships

Three Stop Conditions from the second review of the first-Admin work, decided
together because they are one failure in three places: a rule holding by convention
rather than by construction.

**Both new service methods refuse on their own account.**
`AccountProvisioningService.createFirstAdminWithin` was creating an `ADMIN` with a
null `granted_by`, no audit entry and no `accounts.manage` check, guarded by a
docblock asking callers not to — on a service the API already uses.
`PeopleService.createSystemAdministratorWithin` was creating a Person with zero
pastoral assignments, which is the capability the 2026-08-25 ruling removed from
`CreatePersonInput` for being one nobody could justify. Offering it again as an
unguarded method is that capability once more, with a docblock instead of a type.

Each asks **its own module's table**, which is what keeps them independent.
`people` cannot ask `auth` whether an account exists: `auth` imports `people` (the
2026-08-24 seam) and the reverse restores the cycle that ruling removed. It asks
whether any Person exists. The two are not equivalent — a foreign key makes a
non-empty `accounts` imply a non-empty `persons` and not the reverse — so
§6 states both conditions and says a database holding Persons and no account
is refused deliberately, being a partly-built installation rather than a fresh one.

**The refusal is an `INVARIANT_VIOLATION`, not a bare `Error`.** The whole argument
for the guards is that these are public on services the API uses, so the caller
they anticipate is an endpoint — and a bare `Error` reaches
`ApiExceptionFilter` unrecognised and renders `INTERNAL_ERROR`, the
500-instead-of-an-answer failure recorded for the self-leader check and the
duplicate-email `23505`. It carries `details.refused_by` so the three sites are
distinguishable by something other than a message string.

**`ts-node` moves to `dependencies`.** §6 makes the command the sole path to a
first Admin, and a host built with `npm ci --omit=dev` had none — so a fresh
production installation had a migrated database, an importable tree, and nobody who
could sign in. Two unit cases pin the loader and the dependency against
`package.json`, which is a weak instrument and the only one that reaches a fact no
runtime test can: the behaviour lives on a host installed without dev
dependencies, and the suite runs from a full checkout under `ts-jest`.

**Three layers pinned a disjunction and no member of it.** Every case reached the
guards through `bootstrapFirstAdmin`, so deleting any one left the suite green
— the same finding CLAUDE.md records for the identifier work on 2026-08-23,
with the same remedy: each guard is now called directly, and each was verified red
on its own.

### 2026-08-26 — The tree import, and the one thing the fingerprint cannot bind

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

### 2026-08-26 — The import's actor must hold ADMIN, and four other findings from the review

`architecture-guardian` on the import branch returned five violations, four false
statements and two Stop Conditions. One was a live privilege escalation.

**The capability check did not imply the role, and §2 now says both.** §2 said "the
script is given an **Admin** account" and then stated the refusal in capabilities —
`people.create` and `people.manage_pastoral_assignment` at Whole Church. Those are
not the same requirement, and §7 lets Admin grant authority beyond a role's
defaults, so a Whole Church grant of both to a `LEADER` account is an ordinary
grant. The first version accepted one.

*The reason first recorded here was that neither capability is in
`WHOLE_CHURCH_ONLY`. That is true and explains nothing: `grantCoversNothing` fires
only when a capability is **in** the set **and** the scope is narrower than Whole
Church, and `single-scope.ts` says in terms that "a wider grant is untouched".
Membership never blocks a Whole Church grant of anything. The conclusion held and
the reason did not — recorded because a false reason here is worse than none, and
this is the twelfth instance on this project.*

What the gap opened is the escalation §5 invariant 4 exists to close. Invariant 4
is the one authorization rule in this system decided by **role** rather than by
capability (2026-08-23), precisely so a Whole Church grant does not satisfy it —
and **the import never reaches it**, because every row of the tree is a *first*
assignment rather than a change.

*The harm was overstated in three places and is corrected here.* The entry said
such an account "could name their own Person on a `USE_EXISTING` row and place
themselves anywhere in either tree, root included". That path needs the Leader's
own Person to hold **no** open assignment, because `attachExistingWithin` refuses
one who does — and that state is unreachable through the API: `POST /people`
requires a pastoral leader, and `POST /accounts` refuses `LEADER` outright until
`cells` exists. The test builds it with a direct write. The **reachable** harm is a
Leader writing the entire spine, which is exactly the outcome §2 gives as its
reason for naming an actor at all: "an operator cannot attribute several thousand
records to a Leader." The fix is right; the story told about it was not.

`SENIOR_PASTOR` is deliberately **not** accepted: §2 says an Admin account, and §7
keeps the two Senior Pastors away from administrative operations on purpose.
Widening to them would be a decision about the role catalog taken inside an import.

**The check is made twice, and the first version made it once.** It was put at the
orchestration door in `admin/tree-import` and then described, in three places, as
closing the escalation "for the whole run". `PeopleImportService` is *exported* from
`PeopleModule`, so any module importing it can inject Person creation with no
duplicate gate, no idempotency claim and — as written — no actor check at all. That
is verbatim the shape the 2026-08-26 bootstrap ruling closed, in a file whose own
docblock cites that ruling for the phase check and stopped there. Both checks now
live in the service, which is what the specification requires; the script's copy
survives so an operator is told before adjudicating thirty rows.

The actor reaches the service as an `ActorAuthority` rather than an account
identifier, which is the shape `coversWith` already uses for a decision taken inside
a transaction: it carries the account it was read for, so it cannot decide for
another, and reading it is the caller's job so nothing touches the pool while
holding a transaction (§24).

*This was the Stop Condition the review raised — whether invariant 4 binds an import
opening a first assignment — and it did not need a ruling: §2's own sentence names an
Admin account. §2 is amended in the same change, which the first version did not do
and which is at least this project's **sixth** "written to §x" failure — the fifth is
already claimed at the end of this file, by the §5 invariant-3 item, and the counter
here was written without grepping for the others. A miscount inside the entry
correcting a miscount, which is why the number is now hedged rather than asserted.*

**An existing Person may be seated as a Network root, and refusing it was wrong.**
The second Stop Condition. The first version refused, citing §5's "a root is created
only by the initial import" — a rule about creating the root **row**, which is
exactly what the import does, not about whether the Person existed beforehand. §2
states the opposite directly: a row resolving to an existing Person "receives the
pastoral assignment the tree gives them", with no exception for a root row. Read
together the specification requires the behaviour, and the refusal was a rule
invented in a service.

The reason offered for it does not survive either. It was the administrator, who
correctly holds no assignment forever (§5 invariant 3, third case) and would
therefore be the ideal Person for a root row to absorb — but reaching that needs an
Admin to write their Member ID against a root row in the decisions file,
deliberately. That is a mistake an Admin can make, like many others available in
that file, and not an escalation.

The root branch now reads `network_assignments` for the Network, exactly as the
`UNDER` branch does — which is the same correction as the one below, and the reason
the refusal survived a review pass at all: refusing made the root branch dead code,
so nothing exercised the derived-Network defect inside it. §2 is amended.

**Section 3's acknowledgement was leaving no record in the system.** The import's
`person.created` entry omitted the acknowledged candidates, so for a row decided
`CREATE` past a Tier 1 candidate, the acknowledgement — the entire reason §2 built
a two-phase import — existed only in an operator's spreadsheet, outside
`audit_log`. It is now `acknowledged_duplicate_member_ids`, deliberately a
different key from `PeopleService.create`'s `acknowledged_duplicate_ids`: the
import's acknowledgement is taken in Member IDs, and recording a UUID would be
recording something the adjudicator never saw.

The docblock had claimed "the same values `PeopleService.create` records ... a
reader searching the log should not have to know which path wrote the entry",
directly above the omission. The eleventh instance on this project.

**Three defects of the ordinary kind, each a rule this repository already states.**

`attachExistingWithin` read `pastoral_assignments` directly. §2 permits one
cross-module read and it is a *join* onto a query rooted in a table the reading
module owns; this was a standalone read rooted in `hierarchy`'s table, with
`HierarchyService.openAssignmentOf` already answering it and already called with a
transaction by a sibling service. It also falsified `people.module.ts`'s "it
touches no table it does not own", which the branch had not updated.

It took two person locks in **two calls**. The ordering guarantee is per call —
`lockPersonsWithin` sorts what it is given — so subject-then-leader is exactly the
cycle §5 names: a concurrent reassignment naming the same pair takes them sorted,
and where the leader's key is lower the two run in opposite orders. That is a
deadlock rather than a wait, so the three-second `lock_timeout` does not bound it;
PostgreSQL picks the victim and raises `40P01`, which nothing classifies.

And it derived the existing Person's Network from their sex. `resolveExistingWithin`
checks the recorded sex against the file, which makes deriving *look* safe — but
this method writes no Network row, so what governs is the row already in
`network_assignments`. Wherever the two disagree, or where the Person carries no
open Network row at all, the pre-check passes on a value the database does not hold
and the deferred trigger raises a raw `check_violation` at COMMIT. That is the
500-instead-of-an-answer failure `assertLeaderIsAssignable` exists to prevent, and
`PeopleReassignmentService` reads the row for exactly this reason.

**Also corrected, all statements rather than behaviour.** The CLI printed "Section
5 invariants were enforced on every assignment", which is an overclaim independent
of the escalation — invariant 2 is enforced by the *file* validator over the CSV
graph rather than by the domain layer over the resulting database graph, and
invariant 1 only by the Whole Church precondition. It now names which invariant was
enforced where. `settings.service.ts` called itself the "only reader and only
writer" of a table it never writes, in a paragraph whose next sentence says so.
`settings.module.ts` named a method on the wrong class. And a bare `catch {}` around
`authorize` reported *any* failure as a missing capability, so a database fault sent
an operator to fix a grant that was not the problem — it now distinguishes them.

**`PRECONDITION_CODES` declared a member nothing emitted**, which is how it survived
being written: `FINDING_CODES` and `DECISION_FINDING_CODES` are each walked by a test
and this list was not. It is walked now.

### 2026-08-26 — A check that reads what its caller handed it is not a check

Third review pass on the import. Five findings, and the first is the one worth
keeping: **the service's `ADMIN` check was theatre**, and three docblocks plus a
`SKILL.md` paragraph said it was a guard.

`ImportActor` carried the actor's `ActorAuthority` and the check read
`authority.roles`. Both are plain data interfaces, so the module the check exists
to defend against — anything that can inject the exported `PeopleImportService` —
could hand over `{ roles: ['ADMIN'] }` and satisfy it. On the only real call path
it was worse than weak: `checkPreconditions` reads the authority, tests the role,
passes the same object down, and the service tests the identical array. The two
points could not disagree, so nothing was checked twice.

**The precedent cited for it was the tell.** `createSystemAdministratorWithin` and
`createFirstAdminWithin` each read *their own module's table* for a fact no caller
supplies, and that property is the whole of why they are guards. The
authority-carrying version reused their shape and not their reason — §25 rule 19,
in the batch written to apply §25 rule 19. The stated justification (a pooled read
inside a transaction is the §24 hazard) was true and did not force that design: the
same file's other precondition reads `settings` through the caller's transaction.

`AuthorizationService.honouredRolesWithin(executor, accountId)` is the remedy, and
`activeRoles` gained an executor parameter to provide it. `ImportActor` collapses
to an account identifier, because there is now nothing to pass that could be wrong.
Honoured rather than held: a `SENIOR_PASTOR` row this system refuses to honour must
not satisfy a role check (§7).

**It answers `CAPABILITY_DENIED`, which no section settles.** §22 splits its two
codes over grants and says nothing about a role requirement. `SCOPE_DENIED` is the
worse fit: the 2026-08-20 ruling gives it to a statement about an actor's authority
over a **target**, and this refusal names none. The 2026-08-24 ruling points the
same way, giving `CAPABILITY_DENIED` where a role row names nothing. It has no
client consequence today, because no endpoint reaches this service; it acquires one
the moment another module injects it, which is the stated reason the check exists.

**Seating a root is irreversible, and the argument that dismissed the cost was
false.** The previous entry called seating the wrong Person "a mistake an Admin can
make, like many others they can make with this file". Every *other* `USE_EXISTING`
mistake produces an ordinary edge that `PUT /people/{id}/pastoral-leader` corrects.
This one is correctable by nothing: §5 says plainly that a succession is not an
operation this system offers, reassignment refuses a root, the sex correction
refuses a root, `DELETE` is refused, and migration 0008 freezes that person's
Network. "Like many others" was the sentence carrying the whole decision.

The decision stands — §2 requires the behaviour — but the cost is now stated in §2
and warned on every root row of the dry-run report, because decisions are not read
during a dry run and an adjudicator would otherwise have no way to know.

**Two more false statements, both introduced by the previous batch.** §2 said "both
checks are made again by the module that performs the writes" and the service made
one: it re-checks the role and never inspects the grants, so the capabilities have
no enforcement on a path that does not go through the script. §2 now says which is
which. And inserting `assertActorMayImport` between a docblock and its method left
every sentence of that block false of the method beneath it — the encoding-phase
block, describing a synchronous role check that reads nothing.

**And a miscount inside the entry correcting a miscount.** The previous batch called
its §2 omission "the fifth written to §x failure"; the fifth is already claimed at
the end of this file. It is at least the sixth, and the number is now hedged rather
than asserted, because counting them by memory is what produced both errors.

### 2026-08-26 — Advice printed at the moment of a decision, and a fix claimed but not made

Fourth review pass. The authorization mechanism from the previous batch is
confirmed correct; every finding is in what the batch said about itself, and one is
a fix it claimed and did not make.

**"CREATE is the reversible choice" was false, and it was advice.** The warning
added on root rows listed four mechanisms that make seating irreversible and then
told the adjudicator that `CREATE` avoids them. All four apply to a Person the
import *creates* into that seat exactly as they apply to an existing one —
reassignment refuses a root, the sex correction refuses a root, `DELETE` is
refused, migration 0008 freezes the Network — and none of them asks which decision
produced the row. So the sentence steered toward minting a duplicate into a seat the
real person could then never occupy, which is the outcome §3's whole duplicate
apparatus exists to prevent, printed at the moment of the decision.

Neither `SKILL.md` nor the type's docblock made that claim. The CLI added it alone,
which is its own lesson: the surface furthest from review is the one that talks
directly to the person deciding.

**The warning did not fire where it was most needed.** It was printed inside the
candidate list, and a root row matching nobody never enters that list — so the case
where an operator hand-types a Member ID onto an unwarned root row was silent.
`readDecisionsCsv` accepts `USE_EXISTING` for any `row_id` in the file with any
well-shaped Member ID, candidate or not, so that case is reachable and is the
sharper one. `DryRunReport.rootRows` now carries every root row and the warning is
printed from it, before the candidate list.

**A fix was claimed and not made.** The previous entry named the orphaned docblock —
`assertEncodingPhaseOpen`'s block left sitting above a role check inserted beneath
it — as corrected. It was not: the new block was added *below* the misplaced one, so
one method carried two docblocks, the first describing a different method, and
`assertEncodingPhaseOpen` had none. Fifth consecutive batch carrying a false
statement about itself, and the first where the false statement is that a named
defect was fixed.

**`CAPABILITY_DENIED` was wrong, on a citation that dropped §7's load-bearing
qualifier.** §7 gives that code "where nothing else the account holds carries the
capability" and says twice that the qualifier is load-bearing — and the actor this
check exists to stop is exactly one who *does* hold both capabilities at Whole
Church by explicit grant. §22's gloss, "the actor lacks the capability", is false of
the reachable case, and an administrator reading it is sent to grant what they
already granted.

It answers `SCOPE_DENIED` instead, and **§7 states that rule rather than this being
inferred from it** — a correction to this paragraph's first version, which called it
"the nearest rule rather than a stated one" and listed it as open. §7: where an actor
holds the capability by another route "and it is the withheld **exemption** that
refuses, that is a statement about the actor's authority over a target rather than
about what they hold, and it answers `SCOPE_DENIED`, exactly as Section 5 invariant 4
does for every other actor." That is exactly this refusal — invariant 4's exemption
withheld because the account holds no exempting role — written for the Senior Pastor
identity check and general in its terms. `HierarchyService.assertMayReparent` throws
the same.

*The open item this briefly carried also claimed the first-Admin bootstrap guards
were a competing precedent answering `INVARIANT_VIOLATION`. They are comparable in
placement and opposite in kind: those refuse on whether an account already exists,
which is a rule about what may be recorded whoever submits it — §22's
`INVARIANT_VIOLATION` side, correctly. §22 splits the codes by kind, not by where the
check sits, so the two precedents never disagreed. The item is withdrawn.*

**"Every other `USE_EXISTING` mistake produces an ordinary edge that a reassignment
corrects" is half true**, and all four passes missed it until the paragraph stated it
flatly enough to be wrong. `reassignWithin` is the only writer that closes an
assignment row and it closes-and-opens in one operation, so nothing in this system
removes a subject from the tree. A wrong Member ID on an *ordinary* row also cannot
be undone — that Person is permanently placed, counted in a subtree that does not
contain them, with only their leader correctable. The root case differs in degree,
not in kind. §2 now says so.

Also: `isRoot` had no test, so it could have been inverted with 642 tests green;
`checkPreconditions` still returned an `authority` neither caller read; the
`activeRoles` docblock still described roles leaving the service by one route in the
batch that added a second; and a test comment quoted `account_roles_period_ordered`
as `>` when it is `>=`.

### 2026-08-27 — What the web client does with a refresh token, pending three rulings

Stage 2's screens are the first code to hold a refresh token, and section 6 does not
reach three of the situations one is actually held in. Two `architecture-guardian`
passes found the same thing from opposite directions: the first that the client
discarded a live credential on any failure, the second that the fix re-presented one
up to three times a page load. Both are section 6 questions the specification does
not answer, so what is recorded here is the **interim client behaviour**, and the
questions are listed as open below rather than settled in a component.

`SKILL.md` is deliberately **not** amended. These are not rules yet, and writing them
into the specification would settle by implementation what the log says must be
settled by decision — the failure this file's own preamble names in one line.

**All three questions this entry raised are now settled**, and each is recorded
under its own heading below: tabs are one session (§6), `field-invalid` follows the
field rather than the error code (§23), and — last, because it needed the API
change this entry could only scope — a re-presentation whose replacement was never
used is a retry rather than reuse (§6). All three are in `SKILL.md`.

The interim client behaviour described here therefore stops being interim. The client
still halts on a presentation whose outcome is unknown, and *Try again* is now safe
rather than a risk somebody is asked to weigh: inside the window, the server
recognises the replay as the retry it is.

**A presentation whose outcome is unknown halts the client.** `fetch` rejects
identically whether a request never arrived or arrived, rotated the row, and lost the
response. The second makes the stored token spent, so presenting it again is section
6's reuse signal and revokes every session on the account. The client therefore
neither discards the token — section 23 makes an unreliable connection the expected
case, and a tunnel is not a revoked session — nor presents it again on its own
initiative. It stops and says so, and only a person pressing *Try again* presents it
a second time. That makes the risk theirs to take knowingly, which is the most a
client can honestly do while the question is open.

**Refresh is serialized per origin, by a Web Lock.** `localStorage` is shared across
tabs while an in-flight guard is per JavaScript context, so two tabs opening together
each read one token and the later POST lands after the earlier has rotated —
sequential, so the 2026-08-21 simultaneous exemption does not cover it. Whether two
tabs *should* be one session is open; the lock does not decide it, because tabs
already share the credential. It stops the sharing being unsafe.

**A refusal discards; a failure does not.** A 401 means the credential is spent,
revoked or expired. A `VALIDATION_FAILED` means the stored value is not a token at
all, and is discarded too — otherwise `hasStoredSession()` keeps reporting a session
that can never be renewed and nothing redirects to sign-in. A rate limit or a 5xx
refused the attempt without spending the token, so it is kept.

**Section 23's `field-invalid` is decided from the error code, in one place.** Three
codes reach a screen without being a refusal of anything typed: `UNAUTHENTICATED` on
any request that is not a credential form, a `VALIDATION_FAILED` naming a field the
form does not render — `field: 'token'` for a spent link — and
`DUPLICATE_ACKNOWLEDGEMENT_REQUIRED`, which `api-error.ts` says in terms is not a
validation code precisely so that a client does not render it as a field error. All
three had acquired the colour by being rendered through the same component, which is
the drift section 23 predicts: a token is used by whoever writes the next screen, on
whatever it seems to fit.

### 2026-08-27 — Every tab of one browser profile is one session

Ruled the day it was raised. `SKILL.md` §6 tracked a refresh token "per device or per
session" and §2 requires several concurrent sessions per account, and neither said
which a second browser tab is.

**One.** Tabs share the credential because `localStorage` is scoped to the origin
rather than to the tab, and signing out in one tab ends the session in all of them,
which is what "this device" means to the person holding it.

The consequence is the part worth writing down: a browser client **must** serialize
refresh across tabs, as a requirement and not an optimisation. Rotation makes the
previous token spent, so two tabs each reading the stored token and presenting it
independently produces a presentation landing *after* another has committed —
sequential, so the 2026-08-21 exemption does not reach it, and §6 revokes every
session on the account because somebody had two tabs open. An in-process guard cannot
close it, being per JavaScript context while the credential is shared across them.
The web client uses a Web Lock; anything giving the same guarantee is equivalent.

Per-tab credentials were rejected rather than merely not chosen. They remove the race
by giving each tab its own chain, and they make opening the application from a
bookmark in a new tab demand a password every time — while duplicating a tab copies
session-scoped storage anyway, reintroducing the race with none of the protection.

**The residual gap is where `navigator.locks` is absent**, and it closes for free if
the transit-failure item below is answered as proposed: with a server-side grace
window, a cross-tab race produces exactly the lost-response signature — the previous
token replayed, its replacement never used — and stops being a revocation event at
all. Two questions, one answer.

Written to `SKILL.md` §6, and pinned by a two-tab case in
`web/e2e/session.spec.ts` verified against a client with the lock removed.

### 2026-08-27 — `field-invalid` follows the field, not the error code

The question §23 left open once a real form existed. §22's envelope carries
`details.field`, and a client keying the colour on that alone paints messages red
that point at nothing the reader can fix.

**Where the form does not render the field the failure names, the message is
form-level and carries no colour.** A reset link that expired answers
`VALIDATION_FAILED` with `field: 'token'` on a screen whose only input is a new
password, and the password is fine.

`details.field` is a hint for binding a message to an input. Where there is no such
input the hint does not apply, and the failure is not a statement that anything was
mistyped. The test is what the message is to the person reading it — which is the
test the token's name was settled on in the first place — so it reaches a server
error, a dropped connection, an expired link, and a session that ended while the page
was open, whatever code each arrived under.

Chosen partly because it is the cheapest to reverse: one predicate in
`web/lib/messages.ts`, no schema and no API change, so if it reads wrong on a real
screen it flips in a line. Written to `SKILL.md` §23.

### 2026-08-27 — An idempotency key belongs to a body, not to an attempt

Escalated by the second review of the people screens, and it is a rule §22
implied and never stated — which is how the first fix for it inverted into a
permanent block on creating a Person.

**A client holds one key for as long as what it will send is unchanged. A changed
body is a different logical write and takes a new key. Only a bare retry of an
unchanged body reuses one.**

The reasoning is entirely inside §22 already: a 4xx is stored against the key,
and the same key with a different body is `IDEMPOTENCY_KEY_REUSED`, which §22
makes permanent and never to be retried. Put together, a client that holds one
key across a change to its own request locks itself out with nothing it can do
next.

**The duplicate-acknowledgement flow is where it bites first, and it looks like
one write when it is two.** The refusal asking for acknowledgement is a 409, so
it is stored; the resubmission adds `acknowledged_duplicate_ids`, so the
fingerprint differs and the second request is refused for ever. The Person can
never be created — which is exactly the block §3 says must never happen, and
which the 2026-08-23 ruling calls worse than the duplicate it guards against.

Every refusal that leaves something to correct behaves the same way: a
`SCOPE_DENIED` on the pastoral leader, a cross-Network refusal, a validation
failure on one field. The client mints a new key on each of them.

**Recorded as a rule rather than a fix because it is not discoverable from a
green test suite.** The defect was invisible to 79 browser tests: the mock
answers 409 to every POST and models no idempotency store, so the second request
never reaches the outcome that fails. Three client surfaces consume this API and
the native ones cannot be force-updated, so each would have rebuilt it.

Written to `SKILL.md` §22, checked by grep rather than asserted.

### 2026-08-27 — A re-presentation whose replacement was never used is a retry

Raised by the first web screens, which are the first code to hold a refresh token.
§6 defined rotation, the reuse signal, and the 2026-08-21 exemption for simultaneous
presentation, and said nothing about the case a client actually meets most often on a
phone: a refresh whose **response** was lost.

The client cannot tell that apart from a request that never arrived — `fetch` reports
both identically — and it is then holding a token the server has already spent. Its
only two options were to discard a credential that may still be live, or to present it
again and be treated as a thief. The second signs a leader out of every device for a
dropped connection, which is the cost the simultaneous-presentation rule already
refused to accept, one step further out.

**The server can tell them apart, because theft forks the chain and a lost response
does not.** An attacker presents the old token while the real client has moved on to
the replacement, so two chains advance and the replacement is used. A client that
never received the replacement cannot ever have used it. So *rotated token presented,
replacement exists, replacement never used* is the signature of a lost response, and a
used replacement is the signature of a copy in circulation. That is a statement about
what the rows show rather than about intent, which is what makes it checkable.

**A window bounds it, and the bound is the part that keeps the signal.** A retry
follows its failed request by seconds. With none, a token stolen from a device long
afterwards — whose owner never returned, so the replacement sits unused — would find
that replacement waiting. Sixty seconds, measured from the rotation.

*The window was not in the proposal this was approved from, and is an addition rather
than a detail.* Without it the rule is strictly weaker than §6 was, because it hands
an attacker every abandoned chain in the system. It is recorded here rather than left
in a constant so that raising it later is visibly a security decision.

**Two costs, accepted in writing.** An attacker who presents a stolen token *before*
the real client retries is served, and is detected one step later when the client's own
retry finds the chain advanced — the same shape the simultaneous case already accepts.
And nothing is served twice: the retry advances the chain and revokes what it advanced
from, so only one party ever holds the newest token.

**The existing reuse test was changed deliberately, and that is the part to check.**
It presented the first token again with its replacement untouched — which is exactly
the lost-response shape, so under this rule it is served rather than revoked. Weakening
its assertion would have been the obvious wrong move. It now establishes the fork by
rotating the replacement onward first, which is the genuine theft signature, and two
cases were added either side: the retry is served, and the same shape outside the window
revokes as before.

Written to `SKILL.md` §6, checked by grep rather than asserted.

### 2026-08-28 — Membership and order disclose as loudly as fields did

The fourth door into one oracle, and the first three were each closed by a ruling
of their own: the reasons were withheld (2026-08-22), then the tier (2026-08-22),
then membership was scoped to what a publishable rule would have matched
(2026-08-23). This settles the two channels those left, and states the rule at a
level that covers the next one.

**A filter that narrows the candidate list is a membership decision, and is taken
on the match the viewer is entitled to** — the full match in scope, the publishable
one otherwise. The creation refusal narrows to the candidates it is refusing on,
which is a filter on the tier; it was applied to the match scored against the
*full* subject, so an out-of-scope candidate appeared in the refusal payload
exactly when their birthday equalled the one submitted. Every Tier 1 rule reads a
birthday or a mobile number, which is what makes that filter a protected field
wearing a different name.

It follows that no publishable match is ever Tier 1, so an out-of-scope candidate
never appears in a refusal at all. **That is a new rule and not the 2026-08-23 one
restated**, and getting this wrong twice in writing is what made it worth saying:
the *gate* has always been in-scope-only, because the creation path pairs its tier
test with `canSeeReasons`, and the 2026-08-23 ruling is argued entirely on the
status varying between 409 and 201. What leaked was the payload of a refusal that
had already fired correctly.

**The predicate is handed the tier and the identifier and nothing else.** A `Match`
carries the whole candidate — the publishable run strips the protected fields from
the *subject*, never from the candidate — so a predicate taking one could read a
birthday directly, with nothing to fail on it. The narrowed parameter makes the
one mistake available at that call site a compile error, which is the standard §2
sets for the capability guard and §22 for `completeWithin`'s transaction argument.

**Withheld candidates are ordered by full name, then Member ID.** Position is the
same disclosure as the tier: the matcher returns strongest first, so a withheld
candidate sitting above one whose tier *is* shown reads its withheld tier back,
and with an equal name a tier is the birthday.

**The tie-break is the rule, not a detail of it**, and the first implementation did
not have one — which reopened the channel exactly where it is most reachable. A
withheld candidate is one a publishable rule matched, and that needs an equal
first *and* last name, so withheld candidates already share a name by
construction; two with no middle name share all of it, and a comparator returning
zero there leaves sort stability to restore tier order. Suffix stripping is a
second generator nobody would guess at: `Pedro Cruz Jr` and `Pedro Cruz Sr` are
distinct published names that collide on the key. Member ID is total, encodes
nothing (§3), and is already among the five fields §8 publishes out of scope, so
it costs no disclosure to break a tie with.

The name is compared in §3's normalized form rather than by the host's collation,
because `localeCompare` with no locale resolves against the runtime's default and
§22 makes this ordering client-visible on an API that is additive-only. And the
sort key is composed by the same function that composes the `full_name` the viewer
is shown, because the argument for ordering on the name rests on their being the
same string.

**What is worth carrying forward is the pattern rather than the rule.** Each of the
four was found only after the one before it was closed, and every time by
reasoning about what the response *contained* rather than what the response was a
*function of*. §3 now says so in terms, and asks that any new decision the list is
subjected to — a narrowing, a sort, a page boundary, a count — be treated as a
disclosure until it is shown to be a function of what the viewer may already know.
The one page boundary that exists is `limit`, and nothing has shown it; it is
listed as open below rather than settled here.

Three `architecture-guardian` passes, and the shape of what they found is itself
the argument for the last paragraph: the first found the mechanism sound and the
ordering half still open at a tie; the second and third found nothing further
wrong with the mechanism and eleven other things, of which nine were statements
false of the code or of the specification, one was a miscount, and one was this
ruling's own absence. Written to `SKILL.md`
§3, and verified by grep rather than asserted.

### 2026-08-28 — Two engines, and the width argument gets something that can fail

The accessibility suite scanned five widths in **one** engine, and both halves of
that were weaker than they read.

**Blink and WebKit; not Gecko.** iOS permits no engine but WebKit, so Chrome on an
iPhone is WebKit and a Chromium-only suite says nothing about any iPhone — which
is roughly half the device list this application is sized for. Edge needs no
project of its own, being Chromium. Firefox is refused rather than forgotten: no
phone or tablet in use here runs Gecko, so it would buy a desktop-only check at
the price of the one that covers every iPhone.

**WebKit runs two widths rather than five.** The narrowest, where overflow is
hardest, and the widest at which anything changes. A second engine over all five
roughly doubles a job whose own comment says it must stay fast enough that nobody
is tempted to skip it; as built, both engines together finish in under a minute.
The accepted cost is an engine difference appearing at neither end, which is
possible and is stated here rather than discovered later.

The tag lives on the viewport list rather than as a title match in the config,
because a `grep` against describe titles runs **nothing** when somebody rewords
one, and a browser project that quietly scans zero pages reports the same green as
one that scanned everything. A test carrying the tag asserts that the tagged set
holds the narrowest and the widest width, so that state is red rather than silent.

**And the five-width argument was a comment.** §23's coverage rests on one
sentence — that 1024 is the last width at which anything can break, so every
laptop, desktop and 4K panel is covered by that scan rather than by one of its
own. It is true only while no breakpoint above `sm` exists. One `lg:grid-cols-3`
turns the widest scanned width into the *narrowest* width of a layout nothing
scans, and every desktop leaves coverage with no test going red.
`web/scripts/check-breakpoints.mjs` now fails `npm run lint` on any `md:`, `lg:`,
`xl:`, `2xl:` or container-query prefix. Adding one stays permitted; adding one
*silently* does not.

**Turning WebKit on failed sixteen scans immediately, and the defect was in the
harness rather than the UI.** `NEXT_PUBLIC_API_URL` pointed at port 9 — the
discard protocol, on the browsers' blocked-port list. WebKit enforces that
*before* route interception can see the request, so the mock never fired and every
scan needing a signed-in session rendered the signed-out page; Chromium intercepts
earlier and the same configuration worked there. The comment above it said "never
reached: every request is intercepted before it leaves the page", which was true
of the engine it was written against.

That is this project's recurring fault in its cheapest form, and it is the
argument for the second engine restated: a claim about a mechanism, verified
against the part of it being looked at. Nothing about the screens was wrong.

### 2026-08-28 — A pastoral path says which end is a root

`GET /api/v1/people/{id}/pastoral-path` is the last Stage 2 endpoint, and building it
turned one sentence of Section 5 into a question no section answered.

Section 5 settled on 2026-08-23 that a root **is a row** — an open assignment carrying
a null `leader_id` — precisely so "is this person a root" is answerable in the
database, and it closes with: a Person with no row at all "is therefore never a root;
they are unassigned — surface them as such rather than silently rendering them as a
second root of the tree."

Both produce a path of exactly one node. The first implementation returned the same
payload for each, which is the rendering that sentence forbids, and no section said
what shape carries the distinction.

**Each node carries `network_root`.** True only on the first, since only the first can
hold a null-leader row. Written to Section 8 with the rest of the path's shape.

The alternatives were a top-level discriminator, which puts a fact about one node
outside the node, and refusing an unassigned subject, which turns a legitimate state
— Section 5 invariant 3 names three of them — into an error on a read.

**What is deliberately not claimed is which of invariant 3's three cases an
unassigned Person is in.** Section 5 says the schema holds no `why` and that the
remedy is for a list to exclude accounts holding `ADMIN` rather than for the
specification to claim a distinction it cannot make. `network_root: false` says the
person is not the top of a tree, and nothing more.

**The review of this endpoint corrected two things worth keeping.** The first draft
resolved names by reading `persons` from `hierarchy`, and Section 2 permits exactly
one cross-module read shape — a join rooted in a table the reading module owns —
naming the two queries that qualify and closing the list. A bare id lookup is a third,
and it was avoidable: the walk returns identifiers and `people` puts the names on
them. The docblock had meanwhile asserted it was a join, was rooted correctly, and
could not be moved, none of which was true.

And the docblock misquoted invariant 3, listing a Network root as one of its three
zero-assignment cases when Section 5 names a root as explicitly **not** one — the
three are a Person not yet assigned, an archived Person, and an administrator outside
the pastoral structure. Two test comments repeated it, and one asserted that a root
and an unassigned Person were indistinguishable in the data and that this was
correct, which is the opposite of the rule this ruling exists to satisfy.

**One review finding was rejected rather than fixed.** It reported that nothing
exercises the recursive walk's cycle rejection, making the endpoint's claim to inherit
it unfalsifiable. `api/test/database/cycle-safety.spec.ts` writes a two-person cycle
directly and asserts both `subtreeOf` and `ancestorsOf` reject it, and
`pastoralPathOf` calls `ancestorsOf`. The rejection rests on that file existing and
nothing else: how the finding was arrived at is not something this log can observe,
and an entry asserting it would be the fault the entry above it records.

### 2026-08-28 — Three rulings before Stage 3, and a fourth withdrawn

Stage 3 builds `cells`: five effective-dated tables, a workflow with a second party,
and the first migration nobody may edit afterwards. Reading Sections 10, 11, 7 and 26
whole, before writing any of it, found four things an implementer cannot avoid
answering and the specification does not settle. Three are settled here. The fourth is
withdrawn and escalated, and why is the most useful part of this entry.

**An `ACTIVE` Cell has exactly one leader, and a `CLOSED` Cell has none.** Section 5's
constraint list gives `cell_leaderships` one open row per Cell, which is a partial
unique index and permits *zero*; nothing anywhere forbade it, and Section 13 casually
contemplates a genuine handover as "a separate, deliberate change to
`cell_leaderships`" without saying what happens in between.

Three rules lose their subject at once if zero is legal. `cell.manage_membership` is
held first of all by the Cell's current leader. A Cell takes its Network from its
leader, which is what the same-Network rule on membership compares against and what
approval revalidates. And Cell attendance is recorded by a leader against their own
Cell. None of the three has a fallback written for it, which is itself the evidence
that the specification never imagined a leaderless Cell.

A **deferred** constraint trigger on both tables, which is what lets a Cell change
hands at all: the outgoing row closes and the incoming one opens inside one
transaction, and a check firing at COMMIT sees only the state it ends in. The index
keeps *at most one*; the trigger adds *at least one*.

A trigger is the weaker mechanism and is chosen knowing it. This system has twice
replaced one with a denormalized column under a partial unique index — the Senior
Pastor slot, the Network root seat — because `pg_restore --disable-triggers` skips a
trigger and never skips an index. Both of those enforce *at most one*, which is what a
unique index expresses; "at least one" constrains a row that is **absent**, and no
index constrains an absence. The restore weakness is accepted in writing rather than
denied, and what makes it tolerable is that a leaderless Cell is visible on every
screen that names a Cell.

*The first version of this said the trigger was needed because the rule spans two
tables and no index can express it. Spanning two tables is not the reason* — *the
root seat spans two and was solved with an index and a denormalized column. The reason
is the direction of the constraint, and it had to be re-derived rather than asserted.*

**`cell.manage_configuration`, the twenty-seventh capability.** Section 10 makes a
Cell's category and schedule editable, effective-dated and audited, and named no
capability for either; Section 7 declares its list closed and separately rules that an
endpoint declaring no capability is denied. Both endpoints were therefore unbuildable.
That is the gap `people.correct_sex` was found in, and it is closed the same way, in
one change across the specification, the role catalog, the enum, `capabilities.ts` and
the role defaults.

One capability rather than two, because both are effective-dated edits to how a Cell
is configured, both audited identically, and an administrator granting one while
withholding the other would be drawing a distinction no rule makes.

**The enum value went into `0001` rather than into a new migration**, under the
2026-08-21 exception, which is what `people.correct_sex` did and which still stands
because nothing is deployed. The first attempt wrote migration `0009` and marked it
irreversible, since PostgreSQL cannot remove a value from an enum type — and that
would have **broken CI on the branch that added it**: the workflow runs
`migrate:down --all` after applying, `revertLast` throws unconditionally on an
irreversible migration, and it would have been the newest one forever, so nothing
could be reverted again. The migration's own header cited `people.correct_sex` as its
precedent while taking the opposite route from it, which is Section 25 rule 19 in its
plainest form.

The cost is the one the exception names, and it is larger here than that ruling
assumed: `assertUnchanged` runs before anything is applied, so a development database
that has already applied `0001` can accept no further migration until it is dropped
and rebuilt. `dfc_dev` holds the imported spine, so that is a re-import rather than a
minute.

**The schedule trigger is strict, and needs no exception for backdating.** Section 10
required a schedule row to start on the first day of a month, by "a trigger, not a
check constraint, because the rule admits an exception a row-level check cannot see",
and then named `records.backdate_effective_date` as that exception. A trigger cannot
see who is writing or what they hold, so the rule as written was not enforceable as
specified.

*My first recommendation was to weaken the trigger to advisory, and it was wrong.*
Every legitimate row starts on a first of month, a correction included, and the one
exception is a Cell created part-way through a month.
`records.backdate_effective_date` governs how far back a date may be set, which is
about the actor and belongs in the domain layer; it does not govern what kind of date
is legal.

Two things the review then corrected in that rule, both of which would have shipped.
The test is the Cell's **`created_at`**, not whether the row is the Cell's first,
because a Section 5 correction to the first row produces a *second* row at the same
instant and a first-row test refuses it. And the calendar half is **Asia/Manila**: a
legitimate row starts at Manila midnight on the 1st, stored as 16:00 UTC on the last
day of the previous month, so a trigger evaluating in UTC refuses every schedule
change there is, while a Cell created during a working day on the 1st passes by
accident — the defect hiding in exactly the rows the rule is not about.

**The fourth ruling is withdrawn.** It routed handing a Cell to a new leader through
request-and-approve, on Section 10's own argument: the two-step workflow exists so
that no leader decides alone that one of their own disciples should lead, and that is
as true of a handover as of a creation.

The reasoning still looks right. What made it unlandable is that settling it requires
three further rulings, and the first draft answered none of them while writing the
workflow into the source of truth: which capability guards a handover request and its
approval, which of the two leaders the guard resolves against, and whether one pending
request per prospective leader is still the right constraint once two kinds share a
table. The draft also widened that index on a reason that does not carry to a
handover, and left absent the constraint the reason does support — two pending
handovers of the same Cell to different people, both approvable, the second silently
closing what the first opened.

**Writing an under-specified workflow into `SKILL.md` while `CLAUDE.md` records its
questions as open is the one failure this file's preamble names.** The two documents
then disagree, Source of Truth says the specification wins, and an implementer builds
what the log says is wrong. Better to leave the gap recorded than to fill it with
something that has to be re-argued in three places.

So Section 11 states the rule a change of leader must satisfy — one transaction,
because of the trigger — and says no section defines the workflow; and Section 7 says
plainly that `cell.manage_leadership` sits in the closed list with nothing defining
what it may do. That is the honest state, and it is strictly better than before this
pass, when neither was written down anywhere.

***Superseded the following day** by the ruling below, which lands the withdrawn
workflow with its three questions answered. Both clauses of that last paragraph are
now false: Section 10 defines the workflow, and Section 7 defines what
`cell.manage_leadership` governs. The reasoning stands — what it records is why an
under-specified ruling was held back for a day rather than written into the source of
truth, which is the part worth keeping.*

### 2026-08-28 — A Cell changes hands by request and approval, and a closure is never reversed

The two Stop Conditions the Stage 3 pre-flight opened, settled together because both
are about what happens to a Cell whose leader is leaving it.

**Handing a Cell to a new leader goes through request-and-approve**, the same two
steps as creating one. This is the ruling withdrawn from the pre-flight, landed now
that the three questions it could not answer are answered.

The reason is Section 10's own. What the workflow controls is not the Cell, it is the
decision that a person is ready to lead one: no leader decides alone that one of their
own disciples should lead. An earlier draft argued it from the counters a handover
moves — New Cell Leaders, the requester's own progress toward 12+ — and that is
false where the incoming leader already leads a Cell, which Section 10 explicitly
permits. The narrower ground holds in both cases and is what Section 10 now says.

**The capability pair is renamed rather than duplicated.** `cell.request_creation`
becomes `cell.request_leadership` and `cell.approve_creation` becomes
`cell.approve_leadership`. One workflow, one pair, and the names then describe what
they guard. A second pair would put two more names on a list Section 7 declares
closed, to express a distinction the workflow does not make.

The precedent is this project's own: `leader_id` became `pastoral_leader_id` on the
reasoning that the only moment to fix a name is before a client depends on one.
Nothing depends on these — they guard no endpoint, and the only grants are role
defaults — so the rename is free today and impossible later. The enum values are
edited in `0001` under the 2026-08-21 exception, as the twenty-seventh capability was.
Migrations `0005` and `0006` name `cell.approve_creation` in **comments** and are
merged, so those comments now name something that does not exist; they stand, because
only `0001` may be corrected in place.

The same is true of this log. Five earlier entries name the old capabilities, and none
is rewritten: an entry records what was decided at the time, and rewriting one would
make the log agree with the present at the cost of no longer recording the past. A
reader meeting `cell.request_creation` in an entry dated before today is reading
history, not a live identifier.

**The guard resolves against the incoming leader; the Cell is a domain check.** A
creation has one object and a handover has two, and they need not share a branch,
since Cell membership does not mirror pastoral assignment. The prospective leader is
what the scope is about, because that is the decision being made, so the guard resolves
against them exactly as for a creation. The Cell carries its own rule — the actor
must have it within their authorized scope, on the same terms that govern closing it
— without which an unrelated upline could give away a Cell in a branch they have
nothing to do with. Section 7 already settles the shape: the guard checks one target,
and a rule about a second object is a check in the owning module.

**Two uniqueness rules, one per kind.** At most one `PENDING` `NEW_CELL` per
prospective leader, because two of those are indistinguishable downstream — the
original reason, which is about a leader legitimately leading many Cells. And at most
one `PENDING` `HANDOVER` per **Cell**, because two of those are contradictory rather
than indistinguishable: both may be approved, and the second silently ends the
leadership the first opened.

The withdrawn draft widened the first rule across both kinds, on a reason that does
not carry to a handover — which names its Cell and is therefore distinguishable —
and left the second absent altogether. Widening it also blocks a legitimate case: a
pending new Cell for a person and a pending handover of a different Cell to the same
person are different questions, and `DUPLICATE_REQUEST` exists in the decline list
precisely so a person adjudicates a case like that rather than an index refusing it.

**A closure is never reversed, including one recorded in error.** Section 10 offered
the reversal as "an Admin correction" and said nothing about the three rows a closure
ends. It is withdrawn: a Cell closed by mistake is corrected the way a ministry that
restarts is served, by creating a new Cell.

This is the only one of three answers needing no exception to a rule stated elsewhere.
**Reopening the ended rows** conflicts with Section 5, which never overwrites a row in
place, and moves months already reported — a Cell closed through March and April had
no meetings and no members, and un-ending its schedule and membership rows gives those
months a denominator, against Section 3's reproducibility guarantee. **Opening new rows
at the reversal date** is honest about the closed period and forces a third case into
a schedule rule settled two days ago to keep a month holding exactly one schedule.

The cost is real and is written into Section 10 rather than discovered: a Cell closed
by mistake keeps its closed record, and its history splits across two Cell IDs. That
is tolerable because Section 10 already accepts that a Cell ID is never reused, that
gaps are expected, and that the ID encodes nothing — and because closure is not an
easy accident, needing a capability, a reason from a fixed list, and an explicit
recorded decision about every member.

Recorded also because the alternative was tempting for the wrong reason. Reopening is
what a person expects of an undo, and the merge ruling of 2026-08-19 is a genuine
precedent for a correction that lowers past-period totals. What separates them is that
a merge corrects a count that was *always wrong* — one person recorded twice —
while a reopened Cell would rewrite months that were correctly reported as closed at
the time. The first is a defect correction; the second is a history rewrite.

**With both settled, Section 11's rule has no third path.** An `ACTIVE` Cell holds
exactly one leadership assignment, and the only writes to `cell_leaderships` are a
creation's approval, a handover's approval, a closure, and the direct creation of the
initial-encoding phase. `cell.manage_leadership` is what each of them exercises, which
is what Section 7 now says it governs — it had sat in the closed list since Stage 1
with nothing defining it.

### 2026-08-28 — The Cell schema, and a test that agreed with itself on one machine only

Migration 0009 creates the six tables `cells` owns. Most of it is Sections 10 and 11
followed rather than decided — the five rulings settled earlier the same day did the
deciding. Four things were not settled by them, and one lesson came out of checking
the work rather than out of writing it.

**`cell_schedules` gains `id` and `actor_id`; `cell_memberships` gains neither.** The
first is an amendment made in the same change, per the 2026-08-21 slot ruling: every
other effective-dated table in this specification has a primary key and that one had
no natural one, and Section 10 says a schedule change "is audited as a category change
is" while giving `cell_categories` an `actor_id` in its own shape.

The second is the more useful half, because the first version of the migration added
`actor_id` to `cell_memberships` too, on symmetry with its neighbours in the same
file. Section 10's shape does not give one, and Section 10 says instead that every
membership change is audit logged **with actor** — which is an `audit_log` entry.
`pastoral_assignments` settles it: the closest analogue in the schema, the most
heavily authorized and audited relationship in the system, and it carries no actor
column. Adding one would have been amending a shape no rule needed amended, which is
the drift that ruling exists to forbid. Both halves are written into Section 10.

**An ACTIVE Cell must carry an open category row and an open schedule row, enforced.**
Section 10 says the two rows open in the approval transaction and that they "are not
optional extras", and `docs/ROADMAP.md` names their omission as the single risk of
this stage. A named risk with a constraint available is a constraint.

**Only the ACTIVE side is constrained, and the silence is deliberate.** Section 11
says what a CLOSED Cell's leadership is — none — so that trigger states both halves.
For these two, Section 10's "What closing does" lists three writes and neither of
these is among them, while a parenthetical about coverage says a Cell closed part-way
through a month has fewer scheduled meetings "because its schedule row ... ends at
closure". Those do not plainly agree. Asserting the closed half in a trigger would
settle a rule a migration has no authority to settle, so it is listed as open below.

**`cells` and `cell_leadership_requests` are never deleted, with a message of their
own.** Neither is effective-dated, so 0001's function does not describe their rule.
Section 10 says a Cell ID is never reused and that a mistaken closure stands in the
record, and gives `CREATED_IN_ERROR` as the reason for a Cell that should not exist —
so a DELETE is the one operation that undoes both. And declined requests "are
retained: they are part of the record of how a leader was developed".

**The at-least-one leadership trigger counts rows, and the 2026-08-21 ruling says a
counting trigger is not a constraint. That ruling is about the other direction**, and
the difference was re-derived rather than assumed. The failure it records is two
concurrent transactions each counting *below* a cap, neither seeing the other's
uncommitted row, both committing, and the cap exceeded. The cap here — at most one
open row per Cell — is a unique index, which is the remedy that ruling reached for.
What the trigger adds is the floor, and the floor cannot be undershot concurrently:
reaching zero means closing the single open row, and the index permits only one such
row, so only one transaction can close it.

**The lesson is in the verification, not the writing.** Section 10 warns at length
that the schedule-start rule has two halves in different frames, and that a trigger
evaluating the month boundary in UTC "would refuse every schedule change there is,
while a Cell created during a working day on the 1st passes by accident". Two cases
were written against exactly that, and both passed. Mutating the trigger to the
defect Section 10 describes left the suite **green**.

The reason is that this development machine's PostgreSQL runs `Asia/Kuala_Lumpur`.
`date_trunc` on a `timestamptz` resolves in the *session's* zone, and Kuala Lumpur is
UTC+8 with no daylight saving — so on this box the defective implementation and the
correct one agree on every date, and the two cases certified a rule they could not
see. CI's PostgreSQL runs UTC, where the same two cases would have caught it. A pair
of cases that reports "correct" on one machine and "correct" on another for opposite
reasons is worse than a weak pair, because nothing about it looks wrong.

What pins it now is a case that sets `SET LOCAL TIME ZONE 'UTC'` inside its own
transaction and asserts both verdicts there, so the two implementations disagree
wherever the suite runs. It was verified red against the mutation and green against
the real trigger, as were the leadership floor, the configuration check, the
membership same-Network trigger and the closure-is-final trigger — each mutated in
turn, each turning exactly its own cases red.

Recorded because the general form is the one this log keeps recording under a
different heading: **a test can agree with the code for a reason belonging to
neither.** "What mutation would this fail against" is the question that finds it, and
it has to be asked against a machine configured like the one that will run it.

**Two `architecture-guardian` passes followed, and between them they found thirteen
things.** The first pass's seven are above the line in what the migration now
enforces; the second pass reviewed the fixes and found six more, two of them live
defects it reproduced by execution. Both are worth recording, because both are this
project's recurring fault rather than new ones.

**The handover trigger did not implement the rule it cited.** Section 10 refuses a
handover "where the incoming leader and the Cell's current leader do not share a
Network" — leader to leader, unconditional. What was written compared the incoming
leader against the Cell's **members**, so a Cell with no members changed Networks
freely, and a Cell whose members were all closed out in the same transaction did too.
Three statements asserted the opposite of the code, and the third is the one that
matters: **a test was written asserting that a cross-Network handover succeeds once
the members are moved out** — pinning an operation the specification forbids, in a
file that becomes immutable at first deployment. The trigger now compares the two
leaders and keeps the member check as the separate rule Section 10 states about
membership.

**The CLOSED-membership rule was a counting trigger with no index behind it.** The
migration re-derives, correctly and at length, why the *leadership* floor is safe
despite counting: the cap is `cell_leaderships_one_open_per_cell`, so closing a Cell
and opening a replacement contend on one row and serialize. That argument was then
reused for memberships, where `cell_memberships_one_open` is over `person_id` and the
two writes touch no row in common — so closing a Cell and adding a member to it both
committed, leaving a member open in a closed Cell, unable to join any other. That is
the exact outcome the rule was written to prevent, and it was reproduced against the
schema. The read now takes `FOR SHARE` on the `cells` row, which orders it against
the closure's own `UPDATE` without blocking two concurrent joiners.

**That one is section 25 rule 19 failing inside the paragraph that cites section 25
rule 19** — the re-derivation was performed for one rule and the *result* carried to a
second without being redone.

*An earlier version of this paragraph called it "the first instance on this project of
that particular shape". It is not, and this file records at least three others: the
2026-08-25 root-seat migration, whose header says "**Re-derived rather than copied**"
and cites rule 19 while asserting a drift guarantee that did not hold; the 2026-08-26
module-ownership entry, "§25 rule 19, in the batch written to apply §25 rule 19"; and
the 2026-08-23 identifier batch, "merged that morning, and cited three paragraphs
earlier in this entry — failing inside the batch written to apply it". A claim of
primacy asserted without grepping the file it appears in is the cheapest form of the
fault this log exists to record.*

What is true is narrower, and is why the rule is written as "does X hold here?" rather
than "is this the same kind of thing?": here the re-derivation was performed correctly
and its *conclusion* was then carried to a second rule, which is a step further out
than reusing a shape.

**Four smaller findings from the same pass**, each the familiar class: the "two
uncovered paths" comment named two of three, missing the widest — a Network change on
the Cell's *leader*, which strands every member of every Cell they lead; the narrowed
approver constraint had nothing that could fail against reverting it to the terminal
form, and is now pinned by a shape assertion in `schema.spec.ts` rather than by a
behavioural case that would answer an open question; the `cells`-side trigger was
still named for leadership after it began enforcing memberships too, and is now
`cells_relationships_match_state`; and the finality trigger's message claimed "what a
request asked" while freezing four columns that do not include the category, day and
time a `NEW_CELL` request actually asks for.

**The two mutation-testing findings during the fix batch are the useful part.** The
first concurrency case did not assert the wait — it fired the second statement without
awaiting and committed the first, so whether the second blocked depended on how long
the first happened to take. Mutating an *unrelated* trigger turned it red, which is
how it was found: the real trigger had been slowing the winner just enough to hide the
race. And the case written to pin the Network comparison instant dated its Network
change one second in the **future**, so the member had not moved when the trigger ran;
mutating the comparison to `now()` left it green. Both now do what their titles say,
and both were verified red against the defect they describe.

Every rule-bearing trigger function this migration adds has been mutated in turn —
nine of them — and each reddened exactly its own cases.

*An earlier version of this sentence said "every constraint", which the migration
outnumbers about five to one: it carries twenty-two named `CHECK` constraints, six
unique indexes and seventeen triggers, and nine is the count of trigger functions. The
checks and the indexes are covered by cases of their own rather than by mutation.
Recorded because a universal claim over a set five times its stated size is exactly
what a reader would rely on and not re-count.*

**A third pass followed and found six more, two of them live defects it reproduced.**
The worst was in the mechanism the second batch had just added to close the previous
one: the leader-to-leader comparison selected the outgoing assignment with
`ended_at IS NULL OR ended_at >= started_at`, so one microsecond of gap between the two
rows selected nothing and **the whole rule was skipped** — failing open, and silently.
Section 10 records that exact trap two subsections away, about the Cell and its
schedule row: an application-computed timestamp beside a `DEFAULT now()` differs by
microseconds. The predicate no longer reads `ended_at` at all, and its ordering gained
a tie-break, because two rows can share a `started_at` after a Section 5 correction.

That gap existed to be walked through because **nothing enforced contiguity**. Section
10 says a handover ends the outgoing assignment and opens the incoming one "at the same
instant" and Section 11 says a Cell with no leader "must be impossible rather than
merely unusual", and the schema carried neither: the leadership trigger counts open
rows at COMMIT, so a Cell that was leaderless for a microsecond passed while
`assert_membership_same_network` was already treating a leaderless instant as an error
from the other side. The two halves of one schema disagreed. Contiguity is now a
constraint, and it is the structural fix — the predicate above was the symptom.

The pass also found that the `FOR SHARE` added in the second batch **deadlocks on
Section 10's own closure operation**, since closure disperses members in bulk and two
leaders doing that into each other's Cells take the two `cells` rows in opposite
orders; that it is an unbounded intra-transaction wait Section 5 requires bounding; and
four statements this log or the migration made that the code did not support, two of
which are corrected above.

**A fourth pass, scoped to the contiguity mechanism, found four things and no live
defect.** That is the convergence the three before it did not show, and the scoping is
part of why: each earlier batch had *expanded* the migration, and each expansion
produced the next pass's findings.

**The contiguity check reaches only a row written open, and two writes go round it.**
It runs on the row as it finally stands and returns early where that row is closed —
right for the writes Section 10 defines, and silent on an INSERT of an already-closed
row, or an UPDATE moving a closed row's `ended_at`. Both were reproduced: a closed row
overlapping the open one committed, and `assert_membership_same_network` then read it
as the Cell's leader and **refused a legitimate member of the Cell's own Network**.

**The remedy was to refuse the undefined write, not to validate it**, and the
distinction is the whole of the decision. No operation Sections 10 or 11 define writes
a leadership row already closed, and a row already closed is what Section 5 says is
never overwritten in place. Widening the contiguity check to cover these would have
meant deciding what a correction to a closed historical stint looks like — which
Section 10 does not define, and which would be a rule invented in a migration.
`cell_leadership_is_opened_open` refuses both shapes in nine lines; whether such a
correction should exist at all is escalated below.

**One legitimate-looking operation is refused and is left refused**: correcting a
Cell's *first* leadership row to a person of the other Network. The zero-length row is
selected as the predecessor and compared, which follows the 2026-08-22 ruling that a
zero-length row is inert as an answer and not excluded from being examined. It is
arguably the right refusal — a Cell created under a wrong-Network leader had the wrong
Network throughout, and Section 10 gives `CREATED_IN_ERROR` for a Cell that should not
exist — but Section 10 states that rule about a *handover*, and distinguishing a
correction from a handover is a mechanism this migration does not have. Escalated
rather than built. The message was reworded for succession rather than for a handover,
because an administrator meeting it on a correction would otherwise go looking for a
conflict between two leaders that is not there.

**The tie-break was load-bearing and unpinned**, which is the finding worth keeping.
`ORDER BY started_at DESC, ended_at DESC NULLS FIRST, id DESC` exists because a Section
5 correction leaves two rows sharing a `started_at`; dropping `ended_at DESC` left all
eighty-one cases green, and run against that shape it refused a legitimate handover on
some runs and not others, decided by which UUID sorted higher. The case that pins it
now fixes the corrected row's id to the lowest possible value, so the fallback loses
deterministically — without which the case itself caught the mutant about two runs in
three, which is not a pin. `NULLS FIRST` decides nothing, since a null there is a
second open row the unique index already refuses; the comment claiming otherwise is
withdrawn.

Across four passes: nineteen findings, then four. Every rule-bearing trigger function
has been mutated in turn, and the two mutations that were nondeterministic were made
deterministic rather than accepted.

### 2026-08-29 — Direct creation, and a subtree check where Section 2 asks for Whole Church

Stage 3 slice 2: the `cells` module, the one Cell-creation path the initial-encoding
phase relaxes, and the `LEADER` account provisioning that path exists to enable.
Mostly Sections 2, 6, 10 and 11 followed rather than decided. What is recorded here is
the authorization, which took a review pass to get right.

**Three checks, and Section 2 names all three.** The guard declares
`cell.approve_leadership` — the decision being made, Admin's alone, and in
`WHOLE_CHURCH_ONLY` so a narrower grant covers nothing. The domain layer checks
`cell.manage_leadership` **against a `church` target**, because Section 7 settles that
a guard resolves one capability against one target and Section 2 asks for both "at
Whole Church scope". And the actor must hold the `ADMIN` role, read from
`account_roles` through the transaction.

**The first version resolved the second capability against the prospective leader, and
that was a live authorization gap.** `cell.manage_leadership` is not
Whole-Church-only; every role default carries it, and `LEADER` carries it at
`OWN_SUBTREE` with the actor themselves included. So a Leader holding an Admin-issued
Whole Church grant of `cell.approve_leadership` — which Section 7 permits explicitly —
passed the guard and then satisfied a subtree check against their own disciple, or
against themselves. That is Section 10's own sentence verbatim: "`cell.manage_leadership`
at own/subtree scope would let a leader hand a Cell to their own disciple with nobody
else involved — the outcome the creation workflow exists to prevent, reached by the one
route it did not cover." Naming themselves is what Section 10 forbids outright.

The test that was supposed to pin that check pointed such an actor at somebody
**outside** their subtree, which is the half that was already refused. The half that
was not had no case at all.

**The `ADMIN` role is required, and the capabilities alone are not it.** Section 2
settles the identical ambiguity one paragraph away, for the tree import: "The role is
required, and the capabilities alone are not enough… an implementer following the
stated condition accepts a `LEADER` account holding both at Whole Church, which
Section 7 lets Admin grant." Sections 2 and 10 both give direct creation to Admin, and
the escalation the capabilities-only reading admits is larger here, because a Cell
created outside request-and-approve mints a Cell Leader. Whether Sections 2 and 10
should say so in the same words Section 2 uses for the import is listed as open below.

**Authorization is read before the transaction opens.** `authorize` reads
`account_roles`, `capability_grants` and, for a subtree scope, the tree — all on the
pool. The first version called it *inside* `db.transaction()`, which is the liveness
hazard Section 24 names: the pool is bounded at ten with no acquisition timeout, so
ten concurrent creations would hold ten connections and each wait for ever on an
eleventh, with the liveness probe sharing that pool. `PeopleReassignmentService` is the
established shape and this follows it. The role check stays inside, because it reads
through the transaction's own executor rather than the pool.

**The account step is not in the same transaction.** Section 10 has approval proceed
to it, and Section 7 provides in terms for "an actor holding only the first, who
records the assignment and leaves the account step pending" — so the two are separately
authorized actions. Folding it in was rejected on Section 6's own shape: the activation
email is sent after the transaction commits, and a delivery failure would then be a
fact about a Cell. Section 6's dual-authorization rule is therefore not owed here, and
becomes owed with the approval workflow, where Section 10 puts the account step inside
the same transaction.

**What that costs is an audit entry, and Section 21 already names it**: "Cell
leadership assignment left with account provisioning pending". Every Cell this path
creates is in that state, and nothing else in the system would record it. Written
unconditionally rather than only where the actor lacks `accounts.manage`, because
Section 21's item names a state rather than an actor.

**`LEADER` provisioning arrives with the check that qualifies it**, which is what
`account-provisioning.service.ts` said Stage 3 would do in one change. Section 11
defines a current Cell Leader as a conjunction — an active leadership assignment **on
an `ACTIVE` Cell** — and `CellsReadService` asks both halves.

**Only one of those halves can be shown to matter, and that is recorded rather than
left for somebody to delete.** Migration 0009 refuses a CLOSED Cell holding an open
assignment, so the state where the two disagree is unreachable through any operation.
A first attempt at a case for it closed the Cell — which also ends the leadership — so
each condition sufficed alone and mutating *either* left the suite green: a disjunction
pinned, with neither member. A handover separates them, because the Cell stays `ACTIVE`
while the outgoing assignment closes. The `cells.state` half is kept anyway, for the
reason this repository has already accepted twice: the rule making the two agree is a
constraint trigger, and `pg_restore --disable-triggers` skips one.

**Three test faults, all the same class, and all found by mutation rather than by
reading.** The scope case pinned the wrong half, above. The Senior Pastor case never
called `nameSeniorPastors`, so the role row was not honoured and the account held no
capabilities at all — it was refused for a reason having nothing to do with this
endpoint, while its comment claimed it pinned which capability the guard declares. It
does not, and with the role check in place it cannot: a Senior Pastor is refused by
role whichever capability the guard names. That is pinned by the Leader case instead,
and the comment now says so. And `actor_id` was written null on the category and
schedule rows while an authenticated actor was in hand, with no case looking — Section
10 gives both shapes an actor, and migration 0009's header says null there is for a
system action.

Six mutations verified: the phase gate, the qualification query's two halves
separately, the second capability's target, the role check, and the guard's declared
capability — each reddening exactly its own cases.

### 2026-08-29 — A Cell is placed in the tree by its leader, and a move is two changes

Stage 3 slice 3: Cell membership. Section 10 specifies it closely enough to build,
and three things it does not settle had to be decided.

**`Target` gains a Cell, resolved through a port.** Section 7 already states the
rule — "a Cell, a Cell meeting, a membership or a leadership resolves through the
Cell's leader as of the period being viewed, falling back to its last leader where
the Cell is closed" — and `scopes.ts` already anticipated it: a Cell target "arrives
with the module that owns it". This is that module.

**A port rather than a direct call, because the alternative is a cycle.** `cells`
owns `cell_leaderships`, so only `cells` may answer; and `cells` imports
`AuthorizationModule` to ask its own authorization questions, so a dependency the
other way would close a loop. The interface lives with the guard, the implementation
with the table, and `AppModule` binds them — the inversion `EMAIL_PORT` already uses
here. Absent, the guard denies, which is what `scopes.ts` says of a target the
resolver has no rule for.

**What that buys is that section 10's list of holders is never restated.** "The
Cell's current leader, over their own Cells; any leader upline of that Cell's leader,
acting within their own authorized pastoral subtree; Admin; Senior Pastors" is
exactly what `OWN_SUBTREE`, `NETWORK` and `WHOLE_CHURCH` already mean once the target
is the Cell's leader. Nothing in the service enumerates roles.

**The guard resolves the Cell, deliberately not the person being added.** Section 10
says membership need not mirror pastoral assignment — "a person may be pastorally
under one leader and a member of another leader's Cell" — so resolving scope against
the member would refuse exactly what that sentence permits. Pinned by a case that
adds somebody from outside the actor's own subtree.

**A move is an add, and it is two membership changes rather than one.** A person
holds at most one active membership, so adding somebody who already belongs
elsewhere *is* section 10's move. One operation rather than two, because two would
let a client perform half of it.

**The source Cell is checked in the domain layer, and section 10 does not spell this
case out.** The guard resolves the destination, which is the request's primary
target; section 7 settles that a rule about a second object is a check in the owning
module. Without it a leader could pull anybody in the church into their own Cell —
ending a membership in a Cell they have nothing to do with, and moving that person
out of another leader's denominator, with no involvement from the leader who holds
them. That is the shape section 5 forbids for pastoral assignment (authorization case
1, pulling from a sibling branch), reached through the relationship section 1 keeps
separate from it.

This is a reading rather than a quotation: it is what "over their own Cells" means
when an operation touches two. Admin and the Senior Pastors are unaffected, an upline
leader is unaffected, and only a peer taking from a peer is refused — which is a
pastoral conversation rather than a system action. Listed as open below, because
section 10 could as easily be read the other way and the difference is visible to a
leader.

**The same-Network rule needed a domain check as well as the trigger, and a test is
what found that.** Migration 0009 carries `cell_memberships_same_network` as a
*deferred* constraint trigger, so it raises at COMMIT as a raw `check_violation` —
which `ApiExceptionFilter` does not recognise and renders `INTERNAL_ERROR`. Adding a
member of the other Network was a 500 until a case asked for the error code rather
than only for a failure. The constraint remains the enforcement, because it holds
under a concurrent Network change that this check would be stale for; what the check
adds is an answer.

Three mutations verified: the source-Cell check, the same-Network check, and the
guard resolving the Cell rather than the member — each reddening exactly its own
cases.

**One `architecture-guardian` pass, nine findings, and the four that were live are
worth keeping.**

**A second path parameter reached a `uuid` column unvalidated.** §7 says a route with
a path parameter the guard does not resolve against must validate it itself, and this
is the first route in the API with two: the guard resolves the Cell, `ValidationPipe`
skips a `String` metatype, and `CanonicalIdentifierPipe` canonicalizes without
throwing — so `DELETE .../members/not-a-uuid` raised `22P02` and rendered
`INTERNAL_ERROR`. `ParseUUIDPipe` fixes it, with an exception factory, because the
pipe's own `BadRequestException` is a 400 carrying a body no client of this API is
written against.

**The source-Cell refusal disclosed a Cell membership and a Cell ID.** §8's closed
list forbids both for a person outside the searching leader's pastoral scope — and
this refusal is reached exactly for such a person, because the guard resolves against
the destination Cell rather than the member. Names are church-wide, so any Leader
could take a UUID out of a search, submit it against their own Cell, and read back
both facts, writing nothing. It now names no Cell and does not say the person belongs
to one. The Network refusal beside it may name Networks: Network is one of the five
fields §8 publishes.

**A Cell the guard could not place answered `CAPABILITY_DENIED`.** False about the
actor's grants — §7 makes the code name the half that failed — and it made the
refusal *distinguishable* from the one an existing out-of-scope Cell gets, which is an
existence oracle over Cell identifiers, the thing refusing rather than answering 404
was supposed to prevent. Both are `SCOPE_DENIED` now, which is what the guard already
does for an Account target resolving to no Person.

**No person lock.** Every writer of a person-scoped edge in `people`, `hierarchy` and
`networks` takes one, and a membership is such an edge — `cell_memberships_one_open`
is over the person. Without it, two concurrent adds of the same person both insert and
the second raises `23505`, and a Network change committing between the same-Network
check and COMMIT raises `check_violation` at COMMIT. Neither code is classified, so
both were 500s.

**Three smaller ones.** §21 names "Cell membership added, moved, **or ended**" and the
first version had two actions and no `moved`, so a move was searchable only by
inspecting a payload — a move is one action and is now one entry carrying both Cells.
`cell_id` carried three different values across two endpoints, against §22's "one
concept carries one field name": it is the `CELL-000000` handle everywhere now, with
the UUID as `id` or `*_uuid`, which is what slice 2 established. And the three refusals
this service makes about a Person — archived, merged, already a member — were enforced
in code and stated in no section; §10 now carries them, as §5 already does for the
archived pastoral leader.

**Two test lessons, and the second is one I repeated.** The DELETE route's
`current.cell_uuid !== cellId` clause is its entire cross-Cell authorization —
without it a leader scoped to their own Cell could end a membership held anywhere in
the church — and the case for it gave the person no membership at all, so it entered
the other branch and left the clause unfalsifiable. That is the disjunction-with-one-
member shape slices 1 and 2 each shipped once.

And the ordering in `leaderForScope`: I wrote that `ended_at DESC NULLS FIRST` was
"the key that does the work", **twice**, once after the review corrected me — and
neither version was right. What implements §7's fallback is the *absence* of an
`ended_at IS NULL` filter; `started_at DESC` picks the right row in every ordinary
history, because leadership is contiguous; the `ended_at` key decides only the pair a
§5 correction leaves sharing a `started_at`. Each is now pinned by the mutation that
reaches it, and the tie-break case fixes the corrected row's id to the lowest possible
value so the `id DESC` fallback loses deterministically — the same construction slice
1 needed, for the same reason.

Six mutations verified in the fix batch: the DELETE clause, the closed-Cell fallback,
the closed-Cell refusal, the tie-break key, the `person_id` validation, and the
source-Cell scope check.

**A second pass on the fixes found nine more, two of them live defects the first fix
batch introduced — one in each of its two structural changes.**

**The guard's refusal ran before the capability check.** Answering `SCOPE_DENIED`
from `resolveTarget` put it ahead of `authorize`, which checks the capability first
and the scope second — so an actor holding no `cell.manage_membership` at all was
told a scope refusal for a request whose capability half was never evaluated, and §7
makes the code name the half that failed. It also left the two refusals
distinguishable — by code for that actor, by message and `details` for every other —
which is the existence oracle over Cell identifiers the change was made to close. The
precedent cited for it was misdescribed too: the Account path returns null *inside*
`scopeCovers`, after the capability check, and produces the identical message and
details for an absent and an out-of-scope target. A Cell that cannot be placed is now
handed a target that resolves to nobody, so both refusals come out of `authorize` in
one shape.

**The person lock made the write instant wrong.** `now()` is transaction start, which
is *before* the lock is waited for — so a request that queued behind another writer
stamped its rows with the instant it arrived. Interleaved: T2 begins at 99 and blocks;
T1 begins at 100, opens a membership, commits; T2 wakes, reads T1's row as current,
and closes it at 99. `cell_memberships_period_ordered` then raises at the statement,
so the lock turned a `23505` into a `23514` — one 500 into another. The docblock
argued the reverse of the truth, rejecting a JavaScript instant because it "can land
before a row it must not precede": it is `now()` that can, because the row to be
superseded committed before this transaction was allowed to proceed.
`clock_timestamp()` is the value taken after the wait, on the clock the columns are
compared against.

**A comparison that fails open used `===`.** The already-belongs check compares a
client-supplied path value against one out of a `uuid` column, and a mis-cased
identifier would skip the refusal and close and reopen the membership *in the same
Cell* — the spurious history boundary §10 forbids, with a `moved` entry naming one
Cell twice. §7's 2026-08-23 rule is that a check failing open normalizes again rather
than relying on the boundary pipe; `remove`'s equivalent fails closed and was left.

**Two more statements that were false, both in the batch written to fix false
statements.** The no-leader refusal stopped naming a Cell and went on asserting the
person belongs to one, which is the §8 fact — half a fix, described as a whole one.
And the lock comment claimed it ordered a Network change against the same-Network
check, when that check reads two Networks and the lock is taken on one of the two
people: the Cell leader's side is uncovered, which migration 0009 already names as
the widest of its three uncovered paths.

**`leaderForScope`'s ordering was described backwards for the third time.** The query
read `ended_at DESC NULLS FIRST` first while the paragraph called `started_at`
primary — the reverse — and the closing claim that migration 0009 "carries the same
three for the same reasons" was false, because 0009 orders them the other way. The
query is reordered to match 0009 rather than the prose reworded again, so the code,
the comment and the migration now agree. Three versions of one paragraph, two of them
written after a review corrected it, is the strongest case this log has for describing
a mechanism from the mechanism rather than from the last thing said about it.

***Superseded** by the fourth pass below: `ParseUUIDPipe` with no `version` option is
as loose as `isUuid`, so the 422 described here never happened and the decision stands
on section 22's single error envelope instead. Left in place rather than deleted, per
this log's convention.* **`ParseUUIDPipe` was a fourth UUID predicate.** It carries
`validator`'s own, which
refuses values this API accepts everywhere else — `01234567-89ab-cdef-0123-456789abcdef`
among them — so one parameter of one route answered 422 for identifiers the `{id}` in
the same path takes, and §3 permits a client-generated Person UUID. `UuidParamPipe`
uses `isUuid`, which `identifiers.ts` exists to be the single copy of.

**And the vacuous test was in the case written to pin field naming.** It matched both
handles by shape, so swapping `cell_id` and `moved_from_cell_id` passed — against the
exact defect it existed for. Two weaker ones with it: the §8 assertion excluded the
source Cell's UUID and not its `CELL-000000` handle, which is what §8 calls a Cell ID;
and the audit case justified its tie-break by an intra-transaction tie that case does
not have.

**Three fixes needed a test that did not exist, and two of those took a second
attempt.** The lock-instant case first held an undispatched supertest object, so
nothing ever blocked and it passed against the defect — the lazy-supertest fault
CLAUDE.md already records once, at `19dfe3c`. It now dispatches and polls until a
backend is genuinely blocked. And the failing-open comparison is unreachable through
the API at all, because the identifier pipe is global — so it is called directly with
an uppercase identifier, which is what the 2026-08-23 ruling prescribes for exactly
this and which no end-to-end case can substitute for.

Nine mutations verified across the two fix batches.

**A third pass, scoped to the second fix batch, found four things and no behavioural
defect.** That is the convergence the two before it did not show, and the scoping is
part of why — the same shape slice 1 needed on its fourth pass. Both structural
mechanisms this batch introduced were traced and confirmed: the `NIL_UUID` target
makes an absent Cell and an out-of-scope one indistinguishable at every scope value
that refuses — `OWN_SUBTREE`, `SUBTREE_EXCL_SELF` and `NETWORK`, each producing one
`ScopeDeniedError` message and one details payload — but **not** at `WHOLE_CHURCH`,
where `scopeCovers` returns true before the target is read and the two answers are a
`NOT_FOUND` and a 201. The unqualified claim is false and this same entry says so forty
lines below it, which is the fault it exists to record,
and `clock_timestamp()` is read after the lock in both methods with the two writes of
a move still sharing one instant. The `ORDER BY` reorder is equivalent in every state
migration 0009 permits — which also means nothing can fail against reverting it, and
that is declared rather than left to be discovered.

**`UuidParamPipe`'s stated reason was false, and both this log and the file asserted
it without checking.** The claim was that Nest's `ParseUUIDPipe` "carries `validator`'s
own predicate", pins the version and variant nibbles, and would refuse
`01234567-89ab-cdef-0123-456789abcdef`. Executed against the installed package it does
not: with no `version` option it uses a table of its own whose `all` entry is the same
loose pattern as `isUuid`. The 422 this entry said had happened never happened. The
decision stands on the reason given second — section 22 fixes one error envelope and
`BadRequestException` is not it — and `isUuid` is still right, because
`identifiers.ts` exists to be the single copy of that question.

**What the check surfaced instead is a real split, now escalated.** The predicate that
*does* pin the nibbles is `class-validator`'s `@IsUUID()`, which every DTO uses. So an
identifier in a **body** is validated strictly and one in a **path** loosely, and
`POST /cells/{id}/members` would refuse as `person_id` a value the `DELETE` beside it
accepts. Every identifier in the database is a v4, so it is a consistency question
rather than a defect.

**The concurrency poll was keyed on nothing, and justified by the wrong fact.** It
looked for any active backend blocked on any lock and cited `--runInBand` — which
bounds the jest suite and not the PostgreSQL instance. `pg_stat_activity` is
cluster-wide, this machine also carries `dfc_dev`, and in CI the test role is a
superuser, so there the predicate matched every blocked backend in the cluster. What
was keeping it honest locally is a property of the *role* — a non-superuser reads
other roles' backends as null — which stops holding the moment a second process
connects as the same role. The waiter's PID is genuinely unknown, being a pooled
connection inside the application; the **lock key is not**, and `pg_locks` keyed on it
in this database names exactly the wait being waited for.

**Section 22 names the mirror image of what the guard now does.** It says: "where
revealing that a record exists would itself disclose something, return `NOT_FOUND`
rather than a denial". This change makes an absence look like a *denial*. Both close
the oracle; only one is the remedy written down, and the comment credited section 22
for the direction not taken. It also leaves the API answering both codes for one fact
— `CellsMembershipService` answers `NOT_FOUND` for an absent Cell to a Whole Church
actor, because `scopeCovers` returns true before the target is read. Whether a Cell's
existence is a case that rule covers is escalated: section 22 settles it for a Person
("Section 8 already discloses minimal identity church-wide by design") and for nothing
else.

**And the no-leader refusal took two attempts and still asserted the protected fact.**
The first stopped naming the Cell and went on saying the person belongs to one; the
second said "that membership", which presupposes the same fact one word further in.
The branch is unreachable — a Cell with no leadership row can hold no membership — and
that is precisely why a wrong sentence survived two corrections in it.

Across three passes on this slice: nine findings, nine, then four, the last with no
behavioural defect. Twelve mutations verified in total.




### 2026-08-29 — Six rulings the closure endpoint needed, and two the review raised

Stage 3 slice 4 is closure, and the open list deferred six questions to it — more than
any other unbuilt endpoint in the project. Settled together, before a line of code, on
the pattern that opened this stage: read Sections 10, 11, 7 and 22 whole rather than
meet them at a keyboard. Three turned out to be readings the specification had already
decided; three were genuine choices. Two of the eight did not survive review and are
withdrawn at the end of this entry.

**A CLOSED Cell keeps no open category row and no open schedule row.** Migration 0009
recorded this as unsettled and constrained only the ACTIVE side, because "What closing
does" lists three writes and neither of these is among them. The specification decides
it twice elsewhere, both times in load-bearing arguments: the coverage paragraph under
Section 10's own *Schedule changes* says a Cell closed part-way through a month has
fewer scheduled meetings "because its schedule row ... ends at closure", and the
Reopening ruling argues against reversal partly on what "un-ending its schedule and
membership rows" would do. *An earlier version of this paragraph, and the commit message
with it, attributed the first to Section 12. Section 12's equivalent sentence does not
contain the clause — and misnaming it weakened the very citation the argument rests on,
which is that two other passages already assumed the write.* The list was
incomplete; it now carries five writes.

The schedule half is forced independently of that reading. A schedule row left open on a
closed Cell derives one scheduled meeting a week for ever, so Section 12 hands a Cell
that no longer meets a coverage denominator that worsens every month. The category half
has no such consequence and is closed for consistency — the two rows open together at
approval and an ACTIVE Cell must hold one of each, so ending one of a pair needs a
reason that does not exist.

**The closure effective date floor was ruled on three times, refuted three times, and
is withdrawn.** What is settled is that a floor is *needed*: a closure ends every open
row at the effective date, `period_ordered` refuses a period ending before it starts, so
some dates are satisfiable by no write and an operator meets a constraint violation
rather than an answer. What the floor **is** is not settled.

The first version named two tables and the same commit made a closure end four. The
second widened it to four and thereby made a Cell with a pending schedule change
**unclosable by anybody** — a schedule change takes effect at the start of the following
month, so its rows carry future timestamps, the floor sat in the future, and a
forward-dated closure is not an operation this system defines. The third excluded rows
that had not started yet and missed that the *outgoing* row has started and ends in the
future too, so the Cell stayed unclosable by the same mechanism.

It also cannot be settled independently: it turns on whether the rule that no row of a
closed Cell may end after the Cell did reaches category and schedule rows, or only the
two the database constrains today — which is itself an open item. Section 10 now records
the gap, names the schedule-change difficulty, and leaves the floor to the closure
endpoint, which settles it against the schema.

**A deadlock is answered as `RESOURCE_BUSY`.** *The second half of this ruling as first
written — that the locks are ordered so a deadlock should not arise — is the ordering
withdrawn below. What survives is the error code, which stands on its own.* The `FOR
SHARE` migration 0009 takes on the `cells` row makes `40P01` reachable
from ordinary practice: two leaders closing Cells and dispersing into each other's take
the two rows in opposite orders, each holding an exclusive lock and waiting on the
other's. `isLockTimeout` matches `55P03` only, so today the loser gets `INTERNAL_ERROR`
— a 500 for two people doing routine work at the same moment, with no indication that
retrying would work.

The classification is needed whatever the ordering turns out to be, which is what lets it
survive the withdrawal: ordering cannot reach the locks a deferred trigger takes at
COMMIT, so `40P01` stays reachable however carefully an operation sorts its own.

The comment this overrules argued that a deadlock is not ordinary contention. That is
right about the cause, and it is a statement about the logs rather than about the
client: the caller's correct action is identical, and 503 releases the idempotency key,
which is correct because nothing was recorded. Section 22's existing rule already
requires an elapsed wait to answer `RESOURCE_BUSY` **wherever it is raised**; this is
the same argument applied to the other way a wait can end. The ordering defect still
surfaces, in the log rather than in a leader's face.

**A Cell's existence is not a case Section 22's `NOT_FOUND` rule covers, and this
recommendation reversed on writing the scenario down.** Section 8 protects a person's
Cell membership and Cell IDs, so a Cell reads as exactly such a case, and Section 22's
own prescription is `NOT_FOUND`. Slice 3 had closed the oracle the other way, making an
absence look like a denial — the mirror image — which is what raised the question.

What decides it is that **a Cell identifier cannot be enumerated**. Section 22's rule
exists for the probe shape, where an attacker sweeps a space; a Cell is addressed by an
unguessable identifier, so an actor holding one obtained it legitimately, and confirming
that it exists tells them nothing they did not already have. The protection is not the
code but the indistinguishability slice 3 already built: an actor whose scope does not
cover a Cell gets one `SCOPE_DENIED`, one message, one details payload, whether or not
the Cell is there.

`NOT_FOUND` for everyone was rejected on what it costs the ordinary case, which is where
the reversal came from. A leader whose Cell was handed over yesterday would be told
there is no such Cell — false, and it sends them looking for a deleted record instead of
telling them a handover moved it out of their scope. The "two codes for one fact"
objection does not survive either: each actor gets one consistent answer, decided by
their own scope rather than by the record, and `NOT_FOUND` is reached only by an actor
whose scope would have covered the Cell, for whom absence is absence.

Written to Section 22 as a second worked case beside People, so the next Cell-targeted
route inherits it rather than deciding again. The generalisation is stated with it:
where an identifier cannot be enumerated, indistinguishability is what protects the
record, and a denial is the more truthful of the two indistinguishable answers.

**A dispersal destination must be in the actor's scope, on the same rule as an ordinary
move.** A leader closing their Cell places members into Cells they hold scope over and
leaves the rest unassigned.

One rule rather than two, and the asymmetry it passes over is named in Section 10 so the
choice is knowing rather than careless. Slice 3's rule was written about a leader
**taking** somebody out of a peer's Cell; a dispersal is **giving**, which is the milder
act, so a different answer here would have been defensible rather than inconsistent.
What tips it is that giving is not free: Section 10 makes membership the leader's to
manage, and members arriving unrequested move that leader's coverage denominator and
every Section 16 figure derived from it, with nothing recorded about the person who now
carries them.

The restriction is bearable only because Section 10 had already built the escape —
closure is never blocked on placing anyone, members may be left unassigned by explicit
choice, and Section 15's attention list exists so they are surfaced rather than lost. So
nobody is stranded, and the cross-branch handoff becomes a conversation between two
leaders, which is what it is. The cost is written into Section 10 rather than
discovered: a leader whose members mostly belong in other branches does part of the work
and leaves a queue for somebody else, which is the friction Section 5 already imposes on
a cross-branch pastoral move.

**Scope is checked again inside the transaction, after the locks.** The guard decides on
the pool before the transaction opens, so a handover landing in between leaves its
answer describing authority the actor no longer holds — the staleness Section 24 records
for an intermediate ancestor, reached through the Cell rather than through the tree. The
guard keeps the early, cheap refusal; the write rests on the check after the lock. It
reaches an ordinary membership move too, whose destination is decided the same way.

**Migration 0009's own notes are left standing and are superseded here.** It records the
CLOSED-side question as open — in a comment above the check rather than in its header,
which an earlier version of this paragraph got wrong — and deliberately constrains only
the ACTIVE side, which was the right call when it was written. Two further notes in that
file are settled by this entry as well: the `40P01` decision and the unbounded wait, both
of which it describes as open in `CLAUDE.md` and both of which left the list here. It
sits in an approved pull request, and editing it
would dismiss that approval to change a comment — so the constraint arrives in a
migration of its own with the closure endpoint, and this entry is where the two are
reconciled. The same shape as migration 0005's stale header, for the same reason.

**A third review pass found that the floor fix had made a Cell unclosable, and that is
recorded rather than quietly repaired.** Widening the floor to all four tables was right
and was stated without qualification, and a schedule row is written *before it starts*:
a change decided on 12 August carries `started_at` of 1 September, and closes the
outgoing row at the same future instant. A floor reading those sits in September, so
every date below it is refused by `cell_schedules_period_ordered` — and no actor can
clear it, because a closure dated 1 September is forward-dated and Section 10 provides
for no such thing. Neither the leader nor Admin could close a Cell whose leader had
merely rescheduled it.

*The fix this paragraph describes is the second of the three formulations, and it did not
hold either — the account of how the third failed is in the withdrawal below. What is kept
here is the record of the second.*

**The two Stop Conditions the review raised are answered here as well, and both were
right to be raised: each belongs to a section other than the one I had written it in.**
One is settled below and the other is withdrawn with the floor.

**Backdating a closure requires `records.backdate_effective_date`, and Section 7's list
gains a Cell closure by name.** The floor said how far back a closure may be dated and
nothing said who may date it back at all — while Section 7 declares its list closed and
forbids deriving the next item from it, so answering by implication inside Section 10
was the shape this project keeps correcting.

The reason is not consistency with Sections 4 and 5, and that matters because the
obvious alternative is attractive on exactly those grounds. **Backdating a closure
erases the scheduled-meeting count a coverage line is read against**: Section 12 gives a
Cell closed part-way through a month fewer scheduled meetings, so a leader who has
submitted nothing all month and then closes effective the first of it turns `0 of 4
meetings recorded` into `0 of 0`, and the record of their silence goes with it. *Not the
denominator, which Section 12 defines as the meetings actually recorded — that is
already zero for this leader, which is exactly why the coverage line is the only
artifact left. Two earlier versions of this paragraph said "denominator", a term the
2026-08-19 ruling fixes, in the sentence carrying the whole justification for a new
authorization rule.* That is Section 13's own failure mode reached
through a date field rather than a status. A Section 13-style window, letting the closer
reach back inside the open reporting month, was considered for its consistency with how
attendance already works and rejected for handing that vector to every leader in the
period where it does most damage. The closer may always date a closure today, so nothing
is blocked; what they give up is a few days of scheduled-meeting accuracy in the coverage line.

**The lock ordering was rewritten three times and is withdrawn.** A closure needs both
lock classes — advisory locks on people, row locks on Cells — and nothing orders them
against each other. Three orderings were written. The first prescribed Cell locks alone
and removed only the closure-versus-closure cycle. The second put people first and
claimed only closure changed, which was false: a move writes two membership rows in two
Cells, so its deferred trigger takes two Cell locks in write order. The third permitted
a closure to re-read its member list under its row locks and take person locks for what
appeared — and `architecture-guardian` **reproduced a deadlock against PostgreSQL 16**
for it, in the exact shape the rule four lines above forbids.

The lesson is about the instrument rather than the answer. Each version read as sound;
one of them deadlocked. Two properties defeat reasoning on paper — a deferred trigger
takes row locks at commit in write order, which no rule reaches after the fact, and an
operation cannot know which people to lock until it has read a list that another
transaction can invalidate. Section 5 now records the gap and requires an operation
needing both classes to demonstrate its ordering against concurrent writers rather than
assert it.

The six rulings that stand are written to `SKILL.md` Sections 5, 7, 10 and 22, and were
verified by grep rather than asserted. The two withdrawn above are written nowhere as
rules: Sections 5 and 10 record them as gaps, and both are back on the open list.

**Five review passes, and the two withdrawals are the honest outcome rather than a
retreat.** They returned 8, 7, 5, 5 and 11 findings, and from the second onward the
majority were defects the previous batch's *fixes* had introduced — a floor broken by
its own neighbouring ruling, then a Cell nobody could close, then a reproducible
deadlock, and finally a withdrawal that reinstated a claim an earlier pass had already
corrected. Nearly every one came from the same two rulings.

Six rulings are kept and two are withdrawn, and the split does not fall where the
heading's two halves do: of the six questions deferred to this endpoint, **five are
settled and the floor is withdrawn**; of the two Stop Conditions the review raised,
**backdating is settled and the lock ordering is withdrawn**. The two withdrawn are
recorded as gaps for the endpoint that can test them. `CLAUDE.md`'s preamble names
writing an under-specified rule into the source of truth as the failure it exists to
prevent, and the 2026-08-28 handover ruling is the precedent: drafted, withdrawn, and
landed once its questions were answerable.


### 2026-08-29 — A second schedule change corrects the pending one

Stage 3's configuration slice refused a second schedule change made before the first
took effect, and the reason it gave was wrong. It claimed the Cell's current schedule
would vanish. Traced properly it does not: both changes resolve to the same instant, so
the second closes the **pending** row at its own `started_at` — the zero-length row
Section 5 makes inert — and the row actually governing today is untouched.

What it is instead is exactly the correction Section 5 prescribes, "a row entered in
error is corrected by closing it and opening the right one", and the reason
`cell_schedules_period_ordered` is `>=`. The 2026-08-22 ruling settled that shape for
effective-dated tables generally; migration 0009 created this constraint on 2026-08-28
already carrying it, so nothing was relaxed here — an earlier version of this sentence
said it was.

**The refusal stranded the leader it was meant to protect.** Queue the wrong day on 5
August and it cannot be fixed until 1 September; a change made then lands on 1 October.
One mistake costs a whole month meeting on a day nobody agreed to, with Section 12
computing that month's coverage against it, and nobody can shorten it — Admin included
— because a forward-dated correction is not an operation this specification defines.
The refusal's own message told the leader to "correct it", and no correction path
existed.

Equality was the only case the check could ever have caught. `effectiveFrom` is always
the next Manila month boundary and an open row's `started_at` is either in the past or
that same boundary, so there was no third case it was protecting.

**The cost is accepted in writing rather than discovered.** A leader who queues Sunday
and then reverts to Saturday leaves three rows — Saturday, an inert Sunday, Saturday —
so the history carries a boundary across which the schedule did not change. Every as-of
query still answers correctly at every instant; what reads oddly is "how long has this
Cell met on Saturday".

**Section 5 permits no other shape, which is what makes the cost forced rather than
chosen.** Withdrawing the pending change means reopening the row it closed, which is the
in-place rewrite Principle 12 forbids. Closing it without a replacement leaves an
`ACTIVE` Cell with no open schedule row, which `cell_schedules_keep_cell_configured`
refuses — not `cells_are_configured`, which fires on writes to `cells`. Both call the
same function, so the argument held and the mechanism named was wrong. Comparing
the no-op refusal against the row *in force* rather than the open one refuses the revert
altogether, which is the stranding this ruling exists to end.

It follows — and Section 10 now says — that the no-op refusal is a check against the row
currently open, which after a first change is the pending one. It is not a guarantee
that the history holds no boundary without a change across it, and an earlier comment
claimed it was.

**Recorded because it was very nearly not.** The reversal shipped in code with its
reasoning in a comment, and the test asserting it said "Ruled on 2026-08-29" when no
ruling existed. `architecture-guardian` raised it as a Stop Condition and was right to:
this log's preamble says a decision that lives only in a chat session does not exist, and
this file already counts at least six false "written to section x" claims, each found by
grepping for the rule rather than reading the sentence asserting it was there. This would
have been the seventh, made knowingly.


### 2026-08-29 — The closure ordering and the closure floor, settled by running the database

The two rulings withdrawn from the closure pre-flight (#42), and the reason they are
recorded here rather than re-argued: each had been written three times in prose and
refuted three times, the last by `architecture-guardian` reproducing a deadlock. The
standing instruction was to build the mechanism first and let `SKILL.md` record what
survived, so the branch opened with a harness and no endpoint.

**The harness measured the unfixed world first, and that is what made it useful.** Two
of its four cases asserted that a deadlock *occurs*. Applying the candidate ordering
turned both red — the second closure waits at the bound instead of cycling — and only
then were they rewritten as the cases the ordering must keep green. A harness written
against the fixed world could not have shown the fix worked.

**The ordering has three clauses and each is held by a case that fails without it.**

*Advisory locks on people first, then the `cells` rows.* A membership write already
takes that pair in that order, so it was fixed by an existing writer rather than free
to choose. The reverse was staged and PostgreSQL answered `40P01`.

*Every `cells` row up front, in one order.* Ascending canonical identifier, because a
`uuid` comparison is case-insensitive and two callers naming one Cell in different
cases would otherwise sort it to different positions — the third place on this project
that defect has been reachable.

*Each row taken once, at the final strength.* **This is the clause every prose version
missed.** Both parties taking every row shared and then upgrading their own to
exclusive deadlock exactly as if nothing had been sorted, because the upgrade is not
sorted. So the closing Cell is taken `FOR NO KEY UPDATE` — what its own `UPDATE`
takes — and a destination `FOR SHARE`, which is all the closure needs and which
`FOR UPDATE` would have made expensive: that conflicts with the `FOR KEY SHARE` a
`cell_memberships` insert takes through its foreign key, so closing one Cell would
block every concurrent add into every Cell it disperses into.

**What unblocked it was not a better ordering but a different reading of the
operation.** Every earlier attempt assumed a closure must read its member list before
knowing whom to lock, which is a read another transaction can invalidate. It does not:
Section 10 already requires an explicit decision about every member, so the client
sends the list and the people are an input. What the operation then owes is a check
that the list is the Cell's actual membership, made after the locks — Section 14's
version check reached through a membership list. A member added or removed since the
client read the roster refuses the closure and asks for it to be re-read.

**The floor was blocked behind a question, and the question had to be answered by
narrowing a rule rather than reusing it.** Section 10 says no row of a closed Cell may
end after the Cell did, and whether that reached category and schedule rows was open.
It does — expressed as **in force at or after the closure** rather than **ends after
it**, which differ on exactly one case: a zero-length row, in force at no instant.

Admitting that case is what makes a Cell closable at all. A schedule change takes
effect at the start of the following month, so a Cell with one queued holds two rows
carrying next month's timestamps, and neither can be ended at an earlier closure
because `period_ordered` refuses a period ending before it starts. Under the literal
wording such a Cell is closable by nobody. The closure instead ends each row at the
later of the closure and the row's own start, so a change that will never take effect
goes inert.

That is also what makes the floor statable: category and schedule rows contribute **no
term**, because that write is satisfiable for any date. A floor including them sat in
the future for every rescheduled Cell, which is how two of the three withdrawn
formulations died. What remains is two terms over two tables — the start of every open
leadership and membership row, and the end of every closed one — and the bound is
**inclusive**, unlike Section 4's, because a closure at exactly an open row's start
closes a relationship that genuinely had no duration.

Reusing Section 10's own neighbouring wording verbatim is what produced the unclosable
Cell, which is Section 25 rule 19 met in the one place the pre-flight had been warned
about it. The reason that rule has its shape — a leadership or membership row can
always be ended at the closure instant — is exactly the reason it does not carry.

**Two rules were unpinned when first written, and both are recorded rather than
quietly fixed.** Term (b) of the floor could be deleted with the whole suite green,
because every floor case bound on an *open* row — the identical gap Section 5's own
backdate floor had on 2026-08-23. And the in-transaction scope re-check Section 10
requires could be deleted with everything green, because every case was decided the
same way by the guard; separating the two layers needs the guard's answer made stale
on purpose, which is a concurrent handover. The harness's own sort had the same
problem: removing it left all five cases passing, because nothing interleaved the two
acquisitions.

**And one thing Section 10 had promised was still owed.** It said the destination of an
ordinary membership move would be re-checked inside its transaction "with the closure
endpoint, which builds the mechanism". The mechanism is built, so that half is built
too — the membership endpoint had been re-checking only the source Cell, which the
guard never resolved, and leaving the destination on an answer taken before the request
queued.

Written to `SKILL.md` Sections 5, 10 and 22, and to migration `0010`. Verified by
grepping for each rule rather than by asserting it here, this log having recorded at
least six false "written to Section x" claims.

### 2026-08-29 — Twelve findings on the closure, and the three the review escalated

`architecture-guardian` on the closure branch. **It could not construct a cycle**, and
said so having traced every pair — two closures crossing, closure against a move in
either direction, closure against an add into the closing Cell and into a destination,
closure against a configuration change, and the row locks the deferred triggers in 0009
and 0010 take at COMMIT. The property carrying it is that no `cells` row is ever held
while an advisory lock is waited for, and that every lock a commit-time trigger takes is
already held at equal or greater strength. That half of the work stood.

Everything it found was elsewhere, and two were live 500s.

**A backdated dispersal into a Cell created later was a raw `check_violation`.** The
destination check resolved the Cell's leader with `leaderForScopeWithin`, which is
section 7's rule for a *scope* — current, falling back to last, ignoring dates —
while `assert_membership_same_network` resolves the row *covering* the membership's
`started_at`. `CellsMembershipService` already records that the two "coincide in every
state migration 0009 permits" and that keeping them agreeing is something to watch
rather than something the code guarantees. A backdated closure is the state where they
stop: a membership dated February in a Cell created in August has no leader to compare
against, the scope rule answers with the current one, and the deferred trigger raises at
COMMIT. `leaderAsOfWithin` is the second question asked properly.

**A closure reasoned `OTHER` with no note was a 500**, because the DTO's docblock
described conditional validation the decorators did not carry — a rule stated in a
comment and enforced nowhere, which is the shape this log keeps recording. The same
block also claimed a note was "refused otherwise", which was false in the other
direction.

**Three statements were false of the code**, and one was a promise a file made about
itself. `postgres-errors.ts` said its narrowness "lands with the closure endpoint,
which is the first operation that can produce `40P01` in ordinary practice"; the
endpoint landed and the predicate was not widened, so a deadlock still rendered
`INTERNAL_ERROR` against section 5's own rule. `cell-lock.ts` then asserted the
opposite of that. And the closure service cited a test file that does not exist —
`api/test/cells/closure-floor.e2e.spec.ts`, for cases living in
`api/test/api/cell-closure.e2e.spec.ts`.

**Section 21 requires an audit entry for the leadership ending and the closure wrote
none**, on the reasoning that it "is not a separate decision, and its date is the
closure's". That is the reasoning the same commit *rejects* twelve lines earlier for
memberships — a dispersal is a move and must be findable as one whichever operation
performed it — and section 21 makes no exception for leadership.

**Section 5's own new lock-strength rule was broken by an existing writer.**
`CellsConfigurationService` took `FOR UPDATE` on a `cells` row it does not write, which
the rule this branch added refuses: `FOR NO KEY UPDATE` conflicts with itself, which is
all that service needs, and does not conflict with the `FOR KEY SHARE` a membership
insert takes through its foreign key. Writing a rule and leaving the neighbouring caller
non-compliant is how a rule becomes advisory.

**And the `ResourceBusyError` branch of the floor refusal is unreachable**, with a
comment claiming a reachability the strict comparison above it excludes. It was copied
from `PeopleReassignmentService`, where the identical shape **is** reachable because
section 5 lets Admin backdate a pastoral row; Cell leadership and membership rows cannot
be backdated, so the reason does not carry. Section 25 rule 19, in the branch whose own
entry is about rule 19. Kept as a fail-safe with an honest comment rather than deleted,
because the floor is read from rows rather than guaranteed by a constraint.

**Three Stop Conditions, all three settled here.**

*What reason a backdated closure requires.* The note, not the closure reason. Every
closure carries a reason from the fixed list, so reading section 7's "always requires a
reason" as satisfied by it makes the requirement vacuous. What is owed is an explanation
of the backdating, which is what section 5 requires of a backdated reassignment and for
the reason section 10 gives: a backdated closure erases the scheduled-meeting count a
coverage line is read against.

*Whether a closure may rewrite an already-closed configuration row's `ended_at`.* It
may, and section 10 now says so rather than leaving the code to do it silently. This is
the one write in the system that shortens a closed effective-dated period in place. It
is confined — the value replaced always reaches beyond the closure, so what is removed
is a period the Cell no longer existed for — and the alternatives are all worse: leaving
the row is the forbidden state, refusing makes a rescheduled Cell unclosable, opening a
replacement records a schedule for a Cell that has none.

*Whether an explicit effective date of today is backdating.* It is not. Section 10 says
"earlier than the current day", and the code asked for the capability on any supplied
date — stricter than the specification, with the difference unrecorded, and refusing a
leader `SCOPE_DENIED` for a request section 10 permits. The floor is what actually
refuses such a date, which is the more useful answer.

**One thing the review found that needed building rather than fixing.** Making the
member list mandatory turned `GET /api/v1/cells/{id}/members` from a documented-but-
unbuilt route into a blocker: the closure refuses any list that is not exactly the
current membership, so no client could construct a valid request. It is built, guarded
by `cell.manage_membership` against the Cell — the same target the write routes declare,
and a derivation rather than a new rule, since section 7's capability list is closed.
The cost is escalated rather than hidden and is listed as open below.

### 2026-08-29 — Ten more on the fixes, and the one the fixes introduced

Second `architecture-guardian` pass, scoped to the fix batch. The lock ordering was
confirmed again and every defect was in what the batch had done to everything else —
which is this repository's recorded rate for a fix batch rather than a surprise.

**The relaxation broke the rule it was relaxing.** Deciding "earlier than the current
day" moved the test onto `manilaDayOf(new Date())` at handler entry — a different clock
and a different moment from the `clock_timestamp()` the write is stamped with, read
after up to three seconds of lock waiting. A request arriving at 23:59:59.7 and waiting
past Manila midnight ends its rows at *yesterday's* midnight with no capability asked,
no note required and no `effective_date.backdated` entry. It fails open, on the endpoint
section 7 says backdating must not be reachable from without the grant.

That is section 5's own rule about the effective instant, applied one field over: an
operation reads what it will rely on **after** the lock. Issue #16 was the same fault on
the instant itself. The decision and the capability check both moved inside the
transaction; `coversWith` takes the executor, and the two error codes are chosen at the
call site because it collapses them.

**And the comment arguing for the strict version was left in place**, ten lines below
the code that now does what it forbids — two contradictory comments on one branch, with
the stale one surviving. Its stated reason was the live hazard above, discarded without
being answered.

**Section 7 was misquoted, and the misquote was load-bearing.** §7 resolves a Cell
"as of the period being viewed"; the batch paraphrased that as "ignoring dates
entirely", which is what licensed resolving a dispersal destination's scope through its
current leader. Corrected, and the question it papered over is settled below.

**The note fix was half-closed.** `@MinLength(1)` accepts two spaces and
`cells_other_requires_note` compares `btrim(...) <> ''`, so the same `INTERNAL_ERROR`
was still reachable — and a whitespace note satisfied the new backdating requirement,
so a backdated closure could carry a blank explanation.

**The new roster route ignored two things §22 settles.** It returned a bare `members`
array rather than the collection envelope, on an API §22 makes additive-only — the
moment before the first client is the only moment to fix that. And it answered 200 with
an empty list for a Cell that does not exist, while `POST /cells/{id}/closure` answers
`NOT_FOUND` in the same state, with a docblock justifying it by inverting §22's Cell
ruling: that ruling closes the oracle through the guard's uniform `SCOPE_DENIED` and
then *provides* `NOT_FOUND` for an in-scope actor.

**Three more statements were false of the code**: the DTO's `effective_date` docblock
still described the rule the same commit replaced, migration 0010 named a lock strength
the same commit changed ten lines above the sentence, and two configuration test
comments named `FOR UPDATE` after the service stopped taking it.

**Three fixes had nothing that could fail on them**, and the `40P01` widening had now
been promised twice in a docblock and delivered once. `test/unit/lost-lock-wait.spec.ts`
holds it. `isLockTimeout` also kept a name that no longer said what it matched, which is
the ground this repository renamed `cells_relationships_match_state` on one slice ago.

**And one thing the fixes introduced that the review did not find.** The case written to
pin `leaderAsOfWithin`'s row selection does not pin it: mutating the method to ignore
dates leaves it green, because `cell_leaderships_stay_in_network` makes every leader a
Cell ever has one Network, so which row is selected cannot change a Network comparison.
Only the *null* answer is observable, which is what the defect actually was. The test's
own comment claimed otherwise. Corrected in the test and stated in the read service,
rather than left as a green case asserting more than it holds — the fault this log
records more than any other, committed inside the batch correcting six instances of it.

**Two Stop Conditions, both settled.**

*What "the period being viewed" is for a write carrying a past effective date.* **Now.**
Authority resolves through the Cell's current leader whatever date the write is applied
at; the relationship being recorded resolves as of its own effective date. The direction
is forced: resolving authority as of the effective date would let a leader whose Cell
was handed away yesterday reclaim it by dating the action back far enough — privilege
recovered through a date field, which is §5 invariant 4's shape reached another way.
Nothing is lost the other way, since the leader who did hold it then is not thereby
entitled to act on it now. Written to §7.

*Whether a Cell roster may disclose the Cell membership of a person outside the reader's
pastoral scope.* **It may, and §8 now says why rather than being silently excepted.**
§8's forbidden list bounds the church-wide *directory* — it is written about searching,
and reading it as a general rule would forbid a Cell Leader their own roster. The
distinction is direction: a search starts from a person and would let any leader
assemble a profile of anyone; a roster starts from the Cell and is shown only to those
§10 authorizes to *change* that membership. §10 independently requires the members to be
presented at closure, so the disclosure is required rather than tolerated. The rest of
§8's list — birthday, contact details, attendance, classification — is no more visible on
a roster than in a search.

The route's own justification had been wrong in the half that mattered: it argued that
names and Member IDs are published church-wide, which is true, while the thing §8
protects is the **association** between them and the Cell.

### 2026-08-29 — Ten on the second fix batch, and the rule written with nothing that could fail on it

Third `architecture-guardian` pass, scoped to the fixes. The mechanism the batch was
mostly about — the backdating check moved inside the transaction — was confirmed
correct: `coversWith` plus `grantCoversNothing` reproduces `authorize`'s split for every
actor the role catalog admits, and a `church` target short-circuits before the executor
is used. Everything found was again in what the batch said, and in what it left unpinned.

**The rule the batch wrote into section 7 had nothing that could fail on it.** Section 7
gained "a closure backdated across a destination's handover is scoped against the leader
who holds that Cell today", and mutating the code to resolve as of the effective date
left the whole suite green — every destination case either closed as Admin, whose Whole
Church grant returns true before the target is read, or named a Cell that never changed
hands. That is this branch's own headline fault, committed on the rule it added to the
source of truth.

**And the case written for it took two attempts.** The first used an undated closure, so
both readings resolved to the same leader; the second dated it *after* the destination's
handover, which does the same. It discriminates only with a Leader holding an explicit
Whole Church grant of `records.backdate_effective_date` — because an undated closure
takes effect now and only Admin can otherwise backdate — closing at a date *before* the
handover. Three versions, two of which passed against the mutation they named.

**Section 8's new paragraph forbade what section 12 requires.** It said a member's
attendance is "no more visible on a roster than in a search", and section 12's *roster
view* is defined as listing every member **with their attendance for the month**, to the
identical reader set. The amendment was written about `GET /cells/{id}/members` and used
the word section 12 had already bound. Corrected by saying what each surface carries
rather than what "a roster" does.

**The day question moved in one place and not the other.** `closureTooEarly` still chose
between "the earliest legal date is X" and "this cannot be backdated" on `Date.now()`,
one method below the block moved for exactly that reason — and the commit message
asserted "both halves of that comparison moved". One had.

**Section 7's new paragraphs were inserted inside a bullet list**, terminating the closed
enumeration of what a scope resolves against and leaving five target kinds in a second
list, with three paragraphs about one member of it reading as though they governed all
seven. Moved to a subsection of their own.

**Three more statements false of the code**: `capability.guard.ts` said whether a Cell's
existence is a `NOT_FOUND` case "is escalated in CLAUDE.md — section 22 settles it for a
Person and for nothing else", which section 22 had settled for a Cell by name and which
the same batch cited one file away; the new `ORDER BY started_at DESC` was called "the
tie-break the trigger has", when neither it nor the trigger has one and the restore state
its own reason invokes is exactly where two rows share a `started_at`; and the roster's
docblock claimed section 22 compliance while binding no `limit`, which is the
truncation-without-a-cursor shape this log already carries as open for
`/people/duplicate-candidates`, arrived at deliberately.

**Two Stop Conditions, both settled.**

*A write carrying a **forward** effective date.* Section 7's paragraph settled only past
dates, and `CellsConfigurationService.changeSchedule` is the one write in the system
whose effective date is in the future. The rule generalises rather than needing a second:
authority is decided when the write is made, whichever direction the date points, so a
schedule change is authorized by who holds the Cell now and not by whoever may hold it
next month. Written to section 7.

*What a backdated closure with `reason: OTHER` owes.* One note, carrying both. That
reason already requires a note, so for it alone the backdating rule adds no field — which
is a weaker outcome than for the other four and is accepted in writing rather than taken
silently, as the code had been taking it. The alternative is a second free-text field,
which is structure nothing else in this specification has and section 26 would have to
index, to obtain a distinction nothing can enforce. Written to section 10.

### 2026-08-29 — Seven on the third fix batch, and a 500 on a documented parameter

Fourth `architecture-guardian` pass, scoped to the third fix batch alone. The mechanism
that batch was about — the backdating check moved inside the transaction — was confirmed
correct for a second time, and `closureTooEarly`'s day decision was confirmed to have
moved with it. Everything found was elsewhere, and two were live.

**The pagination this branch added to satisfy section 22 could not run.** The cursor
carried the Member ID alone and the comparison looked the other two ordering keys up in
a scalar subquery, which compiles to a row constructor against a single-column subquery:
`subquery has too few columns`. It is an analysis error, so it fires before a row is
read, on every Cell and every cursor value — and `42601` is not a code
`postgres-errors.ts` classifies, so it rendered `INTERNAL_ERROR`. A 500 on `limit`, which
section 22 documents. I reproduced it against `dfc_ci` before acting on it.

It was not confined to a read. `POST /cells/{id}/closure` refuses any member list that is
not exactly the current membership, and this route is the only way to obtain one — so a
Cell with more members than the page was **closable by nobody**, which is the failure the
pagination was added to prevent, reached at 200 members instead of 500.

Nothing could fail against it, for a reason worth keeping: the `$if` guard meant the
broken SQL was never *built* unless a cursor was present, and no case supplied one.
`tsc` was clean throughout. A green suite and a clean typecheck over a query that cannot
be planned is the sharpest form of this branch's recurring fault.

**The fix is section 25 rule 19 applied where the batch had skipped it.**
`people.read.service.ts` already pages this shape and carries its whole key in the
cursor, and the reason is not incidental: a lexicographic keyset needs every key it
orders by. Carrying one key forces the lookup, and it also makes the boundary unstable —
a member renamed between two pages moves the key the lookup would have found, so rows are
skipped or repeated. The batch reused the `limit + 1` half and the envelope half and
re-derived neither of the other two.

The cursor is now base64url of all three keys, which also closes the second half: what it
emitted was a bare Member ID, six digits off a sequence (section 3) and published
church-wide (section 8), so a client could construct one — precisely what section 22 says
a cursor must never be.

**The rule this branch wrote into section 7 was written into section 8.** The three
paragraphs were correctly lifted out of section 7's target-resolution bullet list, where
they were terminating a closed enumeration, and reinserted eighty lines further down —
past the section boundary. Section 7 line 1475 was left saying a Cell resolves through its
leader "as of the period being viewed" with nothing in section 7 qualifying it, which is
the exact ambiguity the rule exists to close, while four citations in two services and in
this log all pointed at section 7. This is the seventh false "written to section x" claim
recorded here and the first where the section is off by one — the failure mode the others
share is that nobody greps, and a heading in the wrong section survives a grep for the
*rule*.

**Three unpinned rules and two false statements**, all the classes this branch has been
recording:

The `SCOPE_DENIED` case added by the previous batch pins one of the two things its comment
claims. It does pin the error split — deleting it and throwing `CAPABILITY_DENIED`
unconditionally reddens it, verified. It does not pin the `{ kind: 'church' }` target, and
**nothing can**: `coversWith` discards a grant `grantCoversNothing` voids before reaching
`scopeCovers`, so a narrower grant of a `WHOLE_CHURCH_ONLY` capability is skipped whatever
target it is given, and a Whole Church grant returns true on `scopeCovers`'s first line
before the target is read. Only `ADMIN` holds `records.backdate_effective_date`, at Whole
Church, so both routes bypass the argument. The mutation was run and the case stayed green.
The choice is right on section 7's terms and unfalsifiable, which is now said in both
places rather than implied by a green case. `people.sex-correction.service.ts` already
recorded this fact about the same capability, one module over, in a comment correcting an
earlier version of itself.

Section 10's new backdated-`OTHER` rule — one note carries both — had nothing that could
fail on it: all fourteen backdated cases paired a date with one of the other four
reasons, and all four `OTHER` cases were undated, so a service demanding a second
explanation passed the whole suite. *This entry first said seventeen, which is the number
of `effective_date` occurrences in that file — three of them are the two dated today and
the one dated 2099, none of which is a backdate. Counting the grep rather than the thing
the grep was standing in for, in the paragraph about a rule nothing could fail against.* Section 7's forward-dated clause is unfalsifiable by
construction, `changeSchedule` being its only subject and no leadership row existing at a
future instant; that one is now said in the docblock, as its two neighbours already do.

And a comment the batch inserted into a *pre-existing* case described the case below it:
Rosalio's placement under the root is what makes the Leader-actor case discriminate, and
the case it was written into closes as Admin, whose Whole Church grant returns true before
any target is read.

**What this pass did not find is worth recording too**, because three passes running had
found a live defect in the previous batch's own mechanism and this one did not: nothing
reads a host clock or an authority outside the transaction that relies on it, in either
service.

**The Stop Condition is listed as open rather than answered.** Section 22 does not define
what a collection endpoint does with a forged, stale or unparseable cursor. The roster
now matches `GET /api/v1/people` — treated as absent — because two endpoints on one API
answering differently is the thing worth avoiding until the rule exists, and because it
discloses nothing: the worst a tampered value does is start the page elsewhere in a roster
the reader may already see in full. That is consistency with the only implementation this
repository has, not a ruling.

### 2026-08-29 — Five on the fourth fix batch, and a bound that moved underneath its payload

Fifth `architecture-guardian` pass, scoped to the fourth batch alone. The mechanism that
batch was about — the three-key cursor and the keyset consuming it — was traced and
executed and is correct: the comparison is total, since all three keys are `NOT NULL`
with not-blank checks on the names, it uses the same operators and collation as the
`ORDER BY` so it cannot disagree with the ordering, and `limit + 1` emits a cursor iff a
further row exists. One live defect, one unpinned rule, three statements broader than the
code.

**A bound on a cursor is a bound on its payload, and this one changed underneath its
bound.** `@MaxLength(200)` was written when the cursor was a bare Member ID of eight
characters. The batch that made it carry two names rewrote the docblock directly above
the decorator and left the number — so the server can emit a cursor its own DTO refuses,
answering `VALIDATION_FAILED` on a value the client was handed. On this route that is the
defect the batch had just fixed, one status code milder: the closure needs a member list
that is exactly the current membership, this route is the only way to build one, so a
Cell over the page size is closable by nobody.

**The precedent cited for the fix was carrying the same defect**, which is the part worth
keeping. `people.dto.ts` bounds its cursor at 500 and was named — by the review and by
`roster-cursor.ts` — as comfortably fitting the payload. It does not: measured, the
roster's worst case is 870 and `/people`'s is 899, because its third key is a UUID rather
than a Member ID. Copying 500 would have been section 25 rule 19 for the third time on
this branch, in the fix for a finding whose own heading is rule 19.

So the bound is **measured rather than borrowed**, and the arithmetic is the interesting
half: `class-validator` counts UTF-16 units, so the costliest 100 units is 100
three-byte characters — a four-byte character costs two units and buys 200 bytes rather
than 300, which makes the intuitive worst case not the worst case. It lives in
`common/cursor.ts` because both modules use it and a bound copied into two DTOs drifts,
and `roster-cursor.spec.ts` computes the worst payload and asserts it fits with real
headroom, so lowering it reddens rather than waiting for a name long enough to find it.

***It was first written as a derivation, and that word was wrong.*** The measurement
covers the paths that validate a name, and `persons` stores names as bare `text` while
the tree import writes through the services rather than a DTO and bounds nothing — so a
300-character name is representable today and produces a 2,470-character cursor. No
finite constant is provably sufficient while no rule states a maximum name length, and
section 3 states none. The constant is therefore a request-size guard set about four
times clear of any validated path, its docblock says so, and the missing rule is listed
as open below. Found by checking my own premise rather than by the review — the premise
being one this batch had just written into three files. `/people` is fixed in
the same change, on the precedent this repository set on 2026-08-23: a pre-existing defect
of the identical class is closed with it, because leaving it means a reader checking the
citation finds the defect still in it.

**The paging case pinned that a filter existed, not that it was lexicographic** — and the
fixture is why. Two members with distinct last names page correctly under
`last_name >` alone, and under `member_id >` alone. The property every one of the four
places that justify this change names — a lexicographic keyset needs every key it orders
by — had nothing that could fail on it, and section 3 says plainly that a congregation of
several thousand holds two people who share a name.

**The corrected fixture took two attempts, and the second is the lesson.** Three members,
two sharing a full name, so each disjunct decides a boundary. Created in name order, the
Member IDs come off the sequence in that same order — so the tie-break agrees with the
ordering by accident and a `member_id`-only comparison still pages perfectly. That
mutation was run and passed. They are now created in reverse, so the member sorting last
by name holds the lowest Member ID, and all three mutations redden.

**Three statements broader than the code**, all of one kind: a consistency claim that
held for one step of three. "Matches `GET /api/v1/people`" was true of the decoder and
false of the validation in front of it — different length bounds, and `/people` refusing
an empty `cursor=` while the roster answered page one. Both now bind the same
`@Length(1, …)`, which is the cheaper fix than narrowing a sentence that is the whole
justification for the behaviour. And the open list's two count sentences disagreed,
because the instruction to recount lives in the italic and the batch updated only that;
the bolded twin, which is what a reader meets first, said thirty-one. Both now say it and
both say they move together.

The fourth finding — "seventeen backdated cases" — was already corrected in `d6833aa`
before this pass reported, by the same method the entry recommends: counting the set
rather than the grep that stood in for it. Fourteen.

**What five passes cost, and what they bought.** 12, 10, 10, 7, 5. Every pass but the
last found a live defect in the batch before it, and three of the five found one in the
mechanism the previous batch had just built. The two the fourth and fifth passes found
were both invisible to a green suite and a clean typecheck — a query that cannot be
planned, and a bound nothing reaches until a name is long enough.

### 2026-08-29 — Four on the fifth fix batch, and a disjunction pinned with a member missing

Sixth `architecture-guardian` pass, scoped to the fifth batch. First pass on this branch
where **no finding is a defect the previous batch introduced into a mechanism it had just
built** — the keyset itself was traced and executed and confirmed again, as were the
arithmetic, the empty-cursor alignment, the collation-safety of the fixture and the
cross-module change. The yield across six passes is 12, 10, 10, 7, 5, 4.

**The middle keyset disjunct had nothing that could fail on it**, and the batch before
had claimed the opposite in a commit message, a test comment and this log. Three
mutations were run and reddened; the fourth — deleting only
`last_name = key AND first_name > key` — was not run, and it leaves the whole suite
green. The fixture could not reach it: `alpha` and `twin` share *both* names, so that
disjunct selects nobody at either cursor, and the other two decide every boundary.

**Three members were not enough**, and a fourth — `Santos, Berta` — gives a boundary that
crosses on the first name within an equal last name, which is the only boundary the
middle disjunct decides.

***The rest of what this paragraph said was false and is corrected below.*** It claimed a
second inversion was needed: that a member created after the two Anas holds a higher
Member ID, so the tie-break would reach her and leave the middle disjunct dead unless she
were created second. The tie-break requires `first_name = key.firstName`, and hers is
`Berta` against a key of `Ana` — so it excludes her on the name before a Member ID is
compared, and her creation position cannot affect any mutation. One inversion is
load-bearing, `omega`'s, and it kills exactly one of the four mutations: `member_id >`
alone. The other three redden on the names whatever the Member IDs are.

The claim was made in four places at once — two test comments, an assertion whose stated
purpose was to pin it, this entry, and the commit message — and the assertion pinned
nothing, which is how a false reason gets four witnesses and no test. Found by the
seventh pass, which reproduced it both ways round.

That is the third consecutive batch on this branch to ship a disjunction pinned with a
member missing. The other two are recorded above; what they share is that the mutation
actually run was the one the author had in mind rather than the one the code permits.

**Every sentence saying which assertion catches which mutation was wrong**, in the batch
whose own heading is about statements broader than the code. `Zamora` was said to sort
before `Santos`; the `last_name >` mutation was attributed to the page it does not fail
at. The comments now name the boundary each disjunct decides, and each was checked
against the fixture rather than against the intention.

**`NAME_FIELD_MAX_LENGTH` was not what any DTO enforced.** The constant existed, was read
only by the unit case, and the eight name fields carried the literal `100` — so the drift
the file argues against was live one field over, and widening `first_name` would have left
the case green at 100 characters while the emitted cursor doubled. The DTOs import it now,
which is what makes the bound's premise falsifiable: the mutation is a name field
widening, and it reddens.

**And a re-export nothing imported**, displacing the module's docblock onto itself.
Removed on the 2026-08-24 ground that removed `rolesFor`: code with no caller.

**The premise defect the pass ranked fifth had already been found and fixed**, by checking
my own claim rather than by review — that `1024` was called a *derivation* from a
100-character name limit which only two DTOs enforce, while the column is bare `text` and
the tree import bounds nothing. It is a request-size guard now, says so, and the missing
rule is on the open list.

**One local incident, recorded because it cost the most time in this batch and was not a
defect.** Twenty tests failed, including tests untouched for weeks. Stashing to the
committed state reproduced thirteen failures on a commit CI had already passed, which is
what showed it was environmental: an orphaned `npm test` was still running against the
scratch database, because stopping a background task kills the shell and not the node
processes beneath it, and two jest runs truncating the same database interleave into
duplicate-root violations. The lesson is the diagnostic order — a local failure on a
commit CI passed is an environment claim until proven otherwise, and the cheapest proof
is to run the committed state.

### 2026-08-29 — Five on the sixth fix batch, all of them what the batch said about itself

Seventh `architecture-guardian` pass, scoped to the sixth batch. **The mechanism is sound
and was confirmed by execution**: every disjunct is reachable, none is dead, and all four
claimed mutations redden. Every finding is a statement — in the batch whose own heading is
*"Every sentence saying which assertion catches which mutation was wrong."*

**A fixture inversion was called load-bearing in four places and is load-bearing in none.**
The correction is written into the sixth-pass entry above, where the claim was made. What
is worth carrying separately is the shape: the reason `omega`'s inversion has its shape —
Member IDs come off a sequence — was carried to a second member without re-deriving
whether it does any work there, which is section 25 rule 19 applied to a *test fixture*
rather than to code. The fixture was simplified rather than re-explained: an inversion
that pins nothing is removed, not annotated.

**Two more claims about which mutation lands where.** `last_name >` alone was said to land
on the same member as the dropped tie-break; it selects only `Zamora`, so the two land on
different people and only one of them could ever have been right. And "every mutation
below is caught by one of these inversions rather than by the names alone" was false for
three of the four.

**A fix that half-closed on one word.** The batch replaced *derived* with *measured* in
four files and left two occurrences in a fifth — `roster-cursor.spec.ts`, four lines above
the paragraph it was adding — so two files edited in one commit contradicted each other on
the single word the commit existed to correct.

**And the bound's new thesis had nothing that could fail on it.** `common/cursor.ts` argues
the constant "still refuses a query string built to be enormous", and every assertion that
moved with it was a payload-fits check — reddening when it was *lowered*, never when it
was raised. It could have been four million with the suite green. One character over the
bound is now sent and refused, verified by raising the DTO's bound above the constant.

Two smaller ones: the docblock said "the create and edit DTOs" where three import the
constant, so an audit from the docblock stops one DTO short; and `SearchPeopleDto.q` kept a
bare literal `100`, the ninth site of the number the batch had just removed from eight —
now the name bound, since the term is matched against names and a bound below it would
leave a full-length name searchable only by prefix.

**Seven passes: 12, 10, 10, 7, 5, 4, 5.** The last two found nothing wrong with the
mechanism. What they found is that this branch's residual defect rate is entirely in prose
about itself, and that the prose gets a review pass of its own or it is wrong.

### 2026-08-30 — A requester may decline their own request, and a decision is final

The two questions migration 0009 escalated in its own comments rather than answering,
settled together before the leadership-request endpoints are written — which is the
pattern that made the rest of Stage 3 go well: five rulings before a line of Cells code.

**A requester may decline their own request.** Section 10 forbids *approving* one you
submitted and is silent on declining, and the silence had to be resolved in one direction
or the other before the decline endpoint could exist.

The reason for the approval prohibition does not carry. The requester benefits from an
approval — it moves Current Cell Leaders, New Cell Leaders for the period, and their own
progress toward Leaders with 12+ Direct Leaders — which is exactly why section 10 requires
a second party for it. A decline benefits them not at all, so there is no incentive for the
rule to guard against, and `SUBMITTED_IN_ERROR` sits in the fixed list for precisely this
case.

**The strict reading was rejected because it is terminal rather than merely stricter.**
`cell.approve_leadership` is Admin's alone, so on a single-Admin deployment a request that
Admin submitted could be approved by nobody — correctly — and declined by nobody either.
It stays `PENDING` for ever, and `cell_leadership_requests_one_pending_new_cell` then
blocks every future `NEW_CELL` request for that prospective leader, permanently. The fixed
list contains the remedy for that situation and the strict reading made it unreachable for
the actor most likely to need it.

A third option was weighed and refused: permitting self-decline only with
`SUBMITTED_IN_ERROR`, so that withdrawing a request is distinguished from adjudicating one.
It is more precise and it adds a rule section 10 does not have, to guard an incentive that
does not exist — and section 10 already says a decline "never records an assessment of the
person", which is the ground the distinction would have rested on.

Declining still carries `cell.approve_leadership`, so this reaches an Admin who submitted a
request and nobody else. It changes nothing about who may approve, and migration 0009's
`..._approver_is_not_requester` constraint — which deliberately enforces section 10's
stated rule and nothing more — is already correct and unchanged.

**A decision is final.** A `DECLINED` request is never later approved, an `APPROVED` one is
never reversed, and neither returns to `PENDING`. This confirms the conservative direction
migration 0009's finality trigger already took, on the 2026-08-24 reasoning about an
explicit null birthday: a relaxation must not become a capability by omission. What changes
is that it is now a decision rather than a gap nobody had ruled on.

The way forward from a decline is a new request. That keeps the declined row as what
section 10 already requires — the record of how a leader was developed — and keeps
`decided_by` and `decided_at` answering who decided and when, which a re-decision would
overwrite. A `TIMING_DEFERRED` decline followed by a fresh request is the honest record:
two requests, two dates, one outcome each.

**Reversing an approval is a different operation, and naming it as such is the half worth
recording.** A Cell created in error is closed with `CREATED_IN_ERROR`, and a handover
completed in error is corrected by handing the Cell back — each an ordinary authorized
action carrying its own audit entry, rather than a decision rewritten in place. That is the
same shape as the 2026-08-28 ruling that a closure is never reversed, and for the same
reason: the correction is a new fact, not an erased one.

Both written to `SKILL.md` section 10 (*Declining*) in the same change, and verified by
grep rather than asserted.

### 2026-08-30 — Three small settlements from building step one of the request workflow

None of these needed a Stop Condition, and each was a place where the specification said
something in prose that had to become a capability, a check or an identifier — the
conversion this project keeps finding is where rules quietly change shape.

**The Cell check on a handover resolves `cell.manage_lifecycle`, and section 10 now says
so.** Section 10 required the actor to hold the Cell "within their authorized scope, on
the same terms that govern closing it", and named the resulting set of actors in prose
rather than naming a capability. Converting that sentence is not free: the obvious reading
is to reuse the capability the guard just used, and that one is `SUBTREE_EXCL_SELF`.

The commonest handover there is has the actor **as** the Cell's current leader — a leader
stepping down and naming their own disciple — so a self-excluding scope resolved against
the Cell's leader refuses precisely the case the workflow exists for. `cell.manage_lifecycle`
is `OWN_SUBTREE` and includes the actor, which is what makes section 10's own list fall out
of the scope rather than being restated in code.

The narrow cost is written into section 10 rather than left in a docblock: an actor granted
`cell.request_leadership` and not `cell.manage_lifecycle` cannot request a handover. No role
is in that position by default, and the outcome reads correctly anyway — somebody who could
not close a Cell also cannot give it away.

**Nothing about the prospective leader is revalidated at request, and the cost of that is a
slot.** Section 10 puts revalidation at approval — "the state at approval governs, never the
state at request" — so a request naming somebody since archived is refused there, creating
nothing. Adding a request-time refusal would be a rule section 10 does not state, and it
would be the wrong one: a `PENDING` request is not a live relationship, so section 3's bar on
an archived Person acquiring one is not engaged.

What that costs is real and is now recorded where somebody will meet it. A `PENDING`
`NEW_CELL` request occupies its prospective leader's slot under the per-leader unique index,
so one that can never be approved blocks every later request for that person until it is
declined. Declining is cheap and is the remedy; what it needs is for somebody to *see* the
stale row. That is the argument for section 19's queue being part of this slice rather than
deferred with approval — a stale request nobody can see is a slot nobody frees.

**Section 21's first request action was reworded rather than transliterated.** It read "Cell
leadership requested, with the kind", beside "Cell leadership request approved" and "Cell
leadership request declined" — one workflow's three actions under two nouns. Read literally
it gives `cell_leadership.requested`, and a reader asking how a leader was developed, which
is exactly what section 10 calls the retained decline record, would need to know both nouns
to find the whole story.

The convention is `<noun>.<past-tense verb>` and the noun is the thing the action happened
to: a request is submitted, approved and declined, whereas no leadership exists yet to be
"requested" and none at all is touched by a decline. Section 21's list opens with
"including", so this is a wording amendment rather than a rule change.

**The amendment is the point rather than the naming.** The alternative was to keep the
literal wording in the specification and explain the deviation in a code comment — which is
the shape this log records going wrong repeatedly: the specification and the code disagree,
and only the code says why. `cell_leadership_request.submitted` and `..._declined` exist;
`approved` is deliberately absent until the endpoint that emits it does, because a member of
a closed union that nothing writes is what was already removed once from
`PRECONDITION_CODES`.

Written to `SKILL.md` sections 10 and 21, and verified by grepping each section for the rule
rather than by asserting it here.

### 2026-08-30 — Section 10's "at any scope" was resting on a scope value

First review pass on the leadership-request slice. Eleven findings, of which four were
live and one was an authorization gap the specification states in terms and the code did
not deliver.

**A wider grant of `cell.request_leadership` defeated the self-naming prohibition.**
Section 10: "No holder of the capability, at any scope, may name themselves." The
implementation rested that entirely on `SUBTREE_EXCL_SELF` — and `scopeCovers` returns
true on its first line for a `WHOLE_CHURCH` grant, before the target is read at all,
while a `NETWORK` grant compares the target's Network, which for the actor is their own.
Section 7 permits Admin to grant beyond a role's defaults and has no mechanism refusing a
*wider* grant, so either is an ordinary row. Reproduced: a Leader with one such grant
named themselves and got 201, the row landing `PENDING` and approvable.

It needed no ruling, which is worth recording because the review offered it as a Stop
Condition. Section 10 says "at any scope" and cites section 5 invariant 4 as "the same
prohibition ... for the same reason" — and that one is a domain check rather than a scope
value, which is also the shape section 7 prescribes wherever a rule forbids acting on
oneself. So the check is section 10 implemented rather than a rule invented. Whether
section 7 should *additionally* refuse a grant of this capability wider than
`SUBTREE_EXCL_SELF` is a second question, and that one is a new section 7 mechanism —
`WHOLE_CHURCH_ONLY` runs the other way — so it is listed as open.

**Three docblocks asserted the prohibition was enforced by the scope value**, which was
true only of the default grant. That is the recurring class rather than a new one: a
mechanism described from the configuration in front of it.

**An absent Cell was distinguishable from one out of scope.** Section 22 requires both to
answer `SCOPE_DENIED` in one message with one details payload, with `NOT_FOUND` reached
only by an actor whose scope would have covered it. Every other Cell route inherits that
from the guard, which resolves a Cell target; this one resolves the prospective leader, so
the domain layer owes it and did not pay. The fix reproduces the guard's own mechanism — a
target resolving to nobody — rather than restating it.

**A decline note was unbounded for four of the five reasons.** `class-validator` skips
*every* decorator on a property whose `@ValidateIf` is false, so with the condition on the
reason alone, the trim, the minimum and the 500-character maximum were inert unless the
reason was `OTHER`: a 5,000-character note stored untrimmed against `TIMING_DEFERRED`. The
DTO was `CloseCellDto.note`'s stack minus its `|| note !== undefined` disjunct — dropped
without re-deriving what it was for, in a docblock citing that same DTO's other
half-closed fix and saying "it is not repeated here". Section 25 rule 19, again.

Its docblock also stated a rule section 10 does not have — that a note is "refused
otherwise" — while migration 0009 permits a note beside any reason and nothing refused it.
Three things wrong in one field: a rule invented, a sentence false of the code, and a
bound unreachable.

**A client-supplied cursor still reached PostgreSQL as a cast error.** The guard used
`Date.parse`, which is a far wider predicate than PostgreSQL's `timestamptz` parser:
`new Date().toString()` — V8's own rendering — passes it and arrives as a "time zone not
recognized" error, a reproduced 500. It matches the format this code emits now, which is
a cast to text and therefore fixed.

**Three rules had nothing that could fail on them**, all three mutations confirmed green
before the fix. The keyset's tie-break and its `ORDER BY id` are justified by "two
requests can share a `requested_at`" — and nothing in the suite produced two, because
`now()` is transaction start and every case submits in its own. They are pinned now by
rows written directly at one instant, which no endpoint can produce. And both `sameId`
comparisons on this path fail *open*, so with the identifier pipe registered globally no
end-to-end case could reach either; they are called directly with a mis-cased identifier,
which is what section 7's 2026-08-23 rule prescribes and what this repository has had to
add twice before.

**Four statements were false of a mechanism rather than of the code.** Two `@ValidateIf`s
on one property are ANDed rather than replaced — the conclusion drawn from it was right
and the reason was not, in two files and a commit message. The finality trigger is
`BEFORE UPDATE FOR EACH ROW` rather than deferred, so it fires at the statement and not at
COMMIT. A commit message said nine mutations each reddened "exactly its own case" when the
first reddened seven. And section 10's own new sentence claimed `OWN_SUBTREE`, `NETWORK`
and `WHOLE_CHURCH` "resolve to exactly that set" — `NETWORK` does not, being wider than
"any leader upline of them acting within their own subtree", and that sentence was the
stated reason for not restating the list in code.

**One claim was too strong in the other direction.** The Stop Condition recorded for
section 19's requester-facing list said no capability *can* guard it. Section 7 names
none, which is the finding; but `cell.view_subtree` against an actor target is the shape
the duplicate-candidates route already uses one domain over. The item stays open — which
of three answers is right is not derivable — but it is a reading to be chosen rather than
a surface that cannot be built.

**Two comments in migration 0009 now point at open items that no longer exist**, both
escalations this branch's own rulings closed. The migration is merged and only the first
may be corrected in place, so they stand and are corrected here — which is the third time
this log has had to record exactly that, after migrations 0005 and 0007.

### 2026-08-30 — Ten on the request fix batch, and a fix claimed in the past tense that was never made

Second pass, scoped to the first batch's fixes. Both live mechanisms it introduced — the
self-naming domain check and the nil-target answer for an absent Cell — were traced at
every scope value and confirmed correct, and the Stop Condition the first pass offered is
confirmed not to be one. Every finding is a statement, a rule left unamended, or a test
that does not pin what it names.

**Three docblocks still said the prohibition was enforced by the scope value, and the
entry recording that said it in the past tense.** The previous entry listed "three
docblocks asserted the prohibition was enforced by the scope value" among the things the
batch addressed; the commit touches none of them, and one of the three sits thirty-three
lines above the check that replaced it, in the same method. That is worse than the class
it belongs to: not a wrong reason, but a fix claimed and not made — the same shape as the
orphaned docblock recorded on 2026-08-29, and the reason this log's "written to §x" habit
keeps costing passes.

**Section 7 still stated the mechanism the fix stopped relying on, and was not amended in
the same change.** It said `SUBTREE_EXCL_SELF` "exists for the one case where a scope
value genuinely does the work", which tells the next implementer the domain check is
unnecessary — while section 10 carries the rule requiring it. Section 10 *was* amended in
that commit for a smaller point, so the amendment was in scope and was simply not made.
Section 7 now says the scope value is chosen to match the prohibition and does not enforce
it, and why: a wider grant is an ordinary row, and the rule refusing a grant for being too
narrow has no counterpart refusing one for being too wide.

**The reason given for the note defect was false, and it travelled into four places.**
The claim was that `@ValidateIf` false makes "every decorator" inert, so the note was
"stored untrimmed". `@Transform` is a `class-transformer` decorator and `ValidationPipe`
runs `plainToInstance` before `validate`, so the trim ran regardless — reproduced, the
5,000-character note was stored **trimmed**. The defect was the missing bound and not the
missing trim. The same file says the true version twenty lines below, in `CloseCellDto`,
which is where the shape was copied from. Corrected in the DTO and the test comment; the
commit message is immutable and stands wrong.

**A correction introduced a new false statement, one sentence over.** Replacing the
`NETWORK` overstatement, section 10 gained "`OWN_SUBTREE` is the scope every role holds it
at by default" — false: `cell.manage_lifecycle` is Whole Church for Admin and the Senior
Pastors and `OWN_SUBTREE` for Leader alone, and read literally the sentence makes two of
section 10's own four named holders unreachable. And the service docblock grafted the
`NETWORK` correction onto the superseded sentence instead of replacing it, so it asserted
and denied the same claim four lines apart.

**The tie-break mutation was a coin flip presented as a pin.** With `gen_random_uuid()`,
which row sorts first is chance: measured over forty runs, dropping `ORDER BY id` still
returned the lowest-id row first in twenty-four. The ids are written now and inverted
against insertion order, so a plan returning insertion order disagrees every time —
verified ten times out of ten. This repository has recorded twice before that a mutation
caught two runs in three is not a pin, and shipped a third.

**The cursor's format guard depended on a deployment setting nothing pins.**
`cast(requested_at as text)` renders according to the session's `DateStyle`, which this
repository never sets and which the deployment controls — this machine's server already
runs `ISO, DMY` rather than the default `ISO, MDY`. Under `SQL`, `Postgres` or `German` the
server emits a cursor its own decoder rejects, so the client is served page one for ever,
silently. Measured across all four styles. The key is now `to_char` with an explicit
format, which is `DateStyle`-independent, and ISO 8601 parses back the same way under any
of them because it is unambiguous. A case pins it by paging under `German, DMY`.

*The time-zone half is right and the reason first given for it was the superseded one.
Those three offsets — `+00`, `+05:45`, `-02:30` — were properties of the pattern that was
deleted. The one that shipped accepts no offset at all, because `at time zone 'UTC'` in the
`to_char` makes the key zone-independent and it always ends `Z`. Right answer, wrong reason,
in the entry recording wrong reasons.*

**Two smaller ones.** The new constant was inserted between the module docblock and the
interface it documented, leaving the block dangling above a regex — the orphaned-docblock
shape again, one batch after it was recorded. And `NIL_PERSON` was a second copy of the
guard's `NIL_UUID`: two sentinels with a rule attached, free to drift. It lives in
`common/identifiers.ts` now and both call sites import it, which is what
`CURSOR_MAX_LENGTH` already did for the same reason.

### 2026-08-30 — Four on the second fix batch, and a pin that pinned nothing

Third pass, scoped to the second batch's fixes. The `to_char` key was executed against the
database across five `DateStyle`s, four zones and seven instants and is correct; the shared
sentinel, the deterministic tie-break fixture and the section 10 and `@Transform`
corrections were all verified true. Every finding is again a statement or a test, which is
the convergence signal — but one of them is the batch's own headline fix arriving with a
case that pins nothing, and one is a fix that created two new instances of the defect it
was fixing.

**The `German, DMY` case pinned nothing, and three places said it did.** `createTestDb`
opens its own pool and the application opens another, and `SET DateStyle` is per
connection — so a case that sets it on the test pool and then makes an HTTP request has
changed nothing about the session the query runs in. Reverting the fix left the case green.
It reddened under the mutation only because the cast's shape fails the new pattern under
*every* style, which is an unrelated reason.

*Found independently while the pass was running, and the pass confirmed it with two hazards
I had not seen.* A `SET` without `LOCAL` changes the one pooled connection that ran it, so
the restore may be handed a different one and leave the first dirty. And a dirty one is
worse than untidy: **under a non-ISO `DateStyle` the driver's own `timestamptz` parser
returns `null`**, so every later timestamp read on that connection comes back empty and
reads as a defect in whatever case drew it. Reproduced.

The property is pinned now where it can be — `test/database/cursor-rendering.spec.ts`, on
one dedicated `Client` rather than a pool, across all five styles. The format string is
shared with the query rather than copied, because a test carrying its own copy keeps
passing after the query's has changed.

**The orphaned-docblock fix created two more orphans, in the two files it touched — and
then a third, in the file the fix was originally about.** Sharing the format string
between the query and its test put `CURSOR_INSTANT_FORMAT`'s docblock between
`CURSOR_INSTANT`'s and `CURSOR_INSTANT`, so the long block describing the rendering
documented nothing and the regex it describes had none. Caught by reading the file after
the pass reported, not by the pass. Four instances on this branch, three of them created
by a fix for one of the others, which is enough to say the fix is the hazard: inserting a
documented declaration next to a documented declaration is where this happens, and the
check is to read the two lines above every `export` a batch adds.** Moving
`NIL_UUID` out of the guard left its docblock behind, floating between two import blocks
and describing nothing; inserting it into `common/identifiers.ts` put it between
`canonicalId`'s docblock and `canonicalId`, so the twenty-six-line rationale for the whole
identifier-canonicalization rule documented a constant and `canonicalId` had none. That is
the previous pass's headline shape — a fix undone in the act of making it — and it is the
second batch running in which this defect has appeared.

**Section 7 stated the removed mechanism in a second place and only one was amended.** The
entry said "Section 7 now says the scope value is chosen to match the prohibition and does
not enforce it"; line 1632 was amended and line 1471, a hundred and sixty lines earlier and
what a reader meets first, still scoped the domain-check rule to "where the grant must
still reach oneself as a *source*" — which is exactly the implicature that a domain check is
unnecessary here. It also made the service's citation wider than its source. Both now say
the same thing.

**And a correction carried the superseded reason.** The entry defended the time-zone half by
saying the pattern accepts `+00`, `+05:45` and `-02:30` — properties of the pattern that had
just been deleted. The one that shipped accepts no offset at all, because `at time zone
'UTC'` makes the key zone-independent and it always ends `Z`. Right answer, wrong reason, in
the entry recording wrong reasons.

Also: a sentence asserting that a `NETWORK` grant "compares a Network that for the actor is
their own" was true of one of the two grants that can be issued, and is narrowed to say the
grant covers the actor wherever it names their own Network.

### Open — awaiting a ruling

**One item awaits a ruling, and it blocks Stage 5. Thirty-four other things are
unsettled, none of them blocking. They are listed at the end, so this section is the
whole of what is open.**

*Both numbers here are the same number and have to move together — this bolded sentence
and the italic below it. The batch that added the thirty-second bullet updated the italic
alone, because the instruction to recount lives only in the italic, and the bolded twin
is what a reader meets first. Anyone adding a bullet updates both.*

*Thirty-four distinct items across thirty-four bullets. Three arrived with the leadership
request slice — the third being whether the application should pin the database session's
`DateStyle`, raised by the third review pass. The first two are: how a requester sees the outcome of a request they submitted, which
section 19 requires and section 7 names no capability for, and whether section 7 should
refuse a grant of `cell.request_leadership` wider than `SUBTREE_EXCL_SELF`. Both are
named here because the sentence whose job is the count named one of them and left the
other to be found by counting. Three arrived with the closure
endpoint's reviews — whether a Cell roster read deserves a capability of its own, what a
collection endpoint does with a cursor it cannot resolve, and whether a name has a
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

- **What a collection endpoint does with a cursor it cannot resolve.** Section 22 fixes the cursor as opaque and requires pagination on every collection, and says nothing about a forged, stale or unparseable one — three lines mention `cursor` and none addresses it. Two endpoints exist and both now choose "treated as absent": `GET /api/v1/people`, which argues for it in a docblock, and `GET /api/v1/cells/{id}/members`, which was changed to match it on the fourth closure review rather than by decision. The consistency is deliberate and is not the ruling; what is unsettled is whether absent is right at all. Refusing is defensible — a client holding a cursor the server cannot read is in a state it should probably learn about rather than silently restart from the top — and the argument against it is that a stale cursor then strands a client with no way back, over a value that discloses nothing either way, since the worst a tampered one does is start a page elsewhere in a collection the reader may already see in full. Settle it before a third paginated collection is built, because a third one copying whichever it happened to read is how the two would diverge. Not blocking: both endpoints agree today, and `roster-cursor.ts` and `people.controller.ts` each say the question is open.
- **Whether a name has a maximum length.** Section 3 says a name may hold any character and is silent on how many. `persons.first_name`, `middle_name` and `last_name` are bare `text` with only not-blank checks; the create and edit DTOs bound each at 100 UTF-16 units, and the tree import — which writes through the services rather than through a DTO — bounds nothing. So 100 is an implementation choice on two paths rather than a property of the data. It surfaced because a pagination cursor carries two names, so its length is unbounded exactly where the name's is: no finite bound on `CURSOR_MAX_LENGTH` is provable, and the constant is a request-size guard rather than a derivation, which its docblock now says. Not blocking — the guard sits about four times clear of anything a validated path produces, and far beyond what the spine import carries. What would settle it is a stated maximum in section 3, enforced as a `CHECK` constraint (the Definition of Done: an invariant expressible as a constraint exists as one) and applied to the import; that is a domain rule with a migration attached, which is why it is not decided in a pagination file. Whoever settles it should also say whether the limit counts characters or UTF-16 units, since section 6 already had to make that distinction for a password and got it wrong once.
- **Whether section 7 should refuse a grant of `cell.request_leadership` wider than `SUBTREE_EXCL_SELF`.** Section 10's "no holder of the capability, at any scope, may name themselves" is now a domain check, so the rule holds however the grant is issued. What is unsettled is whether a wider grant should be refusable at all: section 7 permits Admin to grant beyond a role's defaults, `WHOLE_CHURCH_ONLY` refuses only grants that are too *narrow*, and neither section has a mechanism for a capability whose scope value carries a prohibition. A Whole Church grant of this capability is legal today and means strictly less than it appears to — the holder may name anyone in the church except themselves — which is defensible and is not what an administrator issuing it would necessarily expect. Not blocking, because the prohibition is enforced in the domain layer. Settle it if a second capability ever takes a scope value that carries meaning; one instance does not justify a general mechanism.
- **How a requester sees the outcome of a request they submitted.** Section 19 puts "the outcome of a Cell leadership request the user submitted, of either kind" in every user's own outstanding work, and section 7 names no capability for such a route. `cell.request_leadership` is `SUBTREE_EXCL_SELF`, so it resolves against neither the caller nor the church; `cell.approve_leadership` is Admin's alone and is what guards the queue; and section 7's no-capability exemption is narrower than it looks — its examples are "reading their own claims, signing out, ending their own sessions", which is the caller's *session* rather than rows their account created. Three answers look defensible and none is derivable: widen that exemption to an endpoint returning only rows the caller created, add a twenty-eighth capability, or read it under `cell.view_subtree` against an `actor` target — which is the shape `GET /people/duplicate-candidates` already uses for a church-wide read one domain over, so this is a new reading of an existing capability rather than an unbuildable surface. Not blocking, and the Admin queue built in this slice is the half approval actually needs — the requester's view is a dashboard tile and there is no dashboard yet. Settle it with the first screens, which is also when its shape will be visible.
- **Whether reading a Cell's roster deserves a read capability of its own.** `GET /api/v1/cells/{id}/members` is guarded by `cell.manage_membership`, resolved against the Cell — the same target its write routes declare, chosen because §7 declares its capability list closed and inventing a name for a read is not available. The consequence is client-visible and one-directional: §7 makes `read_only` valid only on a read capability, so a grant of `cell.manage_membership` cannot be issued read-only, and nobody can be given roster visibility without also being given the power to change the roster. That is strictly more restrictive than the alternative rather than a leak, which is why it was safe to ship. What would settle it is the first screen that wants to *show* a Cell's members to somebody who should not move them — a report view, or an upline leader reviewing a branch — and Stage 5's reporting reads will ask the same question about every Cell-scoped read at once. Settle it there rather than for this route alone.
- **What category a closed Cell has, for a report inside the month it closed.** Section 10 requires historical reports to use "the category valid at the time being reported", and the closure ruling of 2026-08-29 makes a closure end the open category row on its effective date. So a Cell closed on 10 March has no category row valid at 31 March, and Section 12 evaluates classification as of the end of the reporting month. Contained today rather than broken: Section 10 says every count of Cells and Cell categories means active Cells unless a report says otherwise, so nothing currently asks the question. Three answers look defensible — read the last category the Cell held, treat a closed Cell as having none and exclude it, or evaluate the category as of the closure date rather than the month end — and choosing between them wants a real report in front of it. Settle it in Stage 5 with the reporting queries, and note that the same question does **not** arise for the schedule row, whose closure is the point: a closed Cell must stop deriving scheduled meetings.
- **Whether a floor breached with no effective date supplied answers `RESOURCE_BUSY` rather than `INVARIANT_VIOLATION`.** `NetworksService.floorBreach` returns a 409 whose message says "Retry in a moment" — the status and the advice on opposite sides of Section 22's store/release split, since a 4xx is stored against the idempotency key and replayed for the whole retention. `PeopleReassignmentService.reassignmentTooEarly` has answered `RESOURCE_BUSY` for the same case on the sibling path since `216be37` (2026-08-23), and Section 5 still describes that path as answering `INVARIANT_VIOLATION`, so the specification has been wrong about it since. Changing it is a ruling rather than a fix, and needs **two** amendments neither of which is derivable: Section 4 says an undated correction "always succeeds" and has no floor to clear, which the branch contradicts — reachable because the comparison is `<=` and `new Date()` is millisecond-resolution, so a Person encoded and corrected inside one millisecond collides; and Section 22 defines `RESOURCE_BUSY` as a wait that timed out or a deadlock victim, which this is neither, the lock having been acquired cleanly. Deliberately split out of the issue #16 fix rather than settled inside it. It is pinned by nothing on either path today, and it is deterministically stageable — but by a raw `network_assignments` row starting in the **future**, not at `now()`. Now that the instant is read after the lock, a row starting at `now()` leaves `effectiveAt >= bound.at` and the branch fires only on exact millisecond equality, which is a coin flip rather than a test. Nothing bounds `started_at`: the table carries `period_ordered` and no more.
- **Whether the archived-and-merged refusals should be database constraints.** Section 10 gained three refusals on 2026-08-29 — an archived Person, a merged Person, and somebody already in the Cell — and the first two are the same rule `assertLeaderIsAssignable` enforces for a pastoral edge. Both are application-layer checks: contrary to what Section 10 said when the question was first written, `pastoral_assignments` carries **no** constraint for archived-or-merged either, so there is no asymmetry and the question is whether *either* should become one. The Definition of Done says an invariant expressible as a constraint exists as one, and this one is expressible — a membership under an archived Person is the corruption Section 3 refuses when archiving somebody who leads a Cell, reached one relationship over. What argues the other way is that both facts live in `people`'s tables while the constraint would sit on `cells`', so it is a trigger reading across a module boundary rather than an index. Not blocking: the checks refuse today and answer `INVARIANT_VIOLATION`; what a constraint would add is enforcement under a restore, which is the argument the Senior Pastor slot and the root seat both turned on.
- **Whether a path identifier should be validated as strictly as one in a body.** `class-validator`'s `@IsUUID()` pins the version and variant nibbles and is on every DTO; `isUuid` — the repository's own predicate, used by the guard and by `UuidParamPipe` — does not. So `POST /cells/{id}/members` refuses as `person_id` a value the `DELETE` beside it accepts in the path. Every identifier in the database is a v4 and PostgreSQL's `uuid` takes both, so nothing is broken; what is unsettled is which predicate the API means, and Section 3's provision for a client-generated Person UUID is the case that would decide it.
- **Whether the nil UUID should be reserved.** Two call sites now hand `authorize` `00000000-0000-0000-0000-000000000000` — the capability guard, for a Cell it cannot place, and `CellsLeadershipRequestService`, for a handover whose Cell must not be shown to exist; the constant is shared in `common/identifiers.ts` rather than copied. It is handed over as the target of an object the caller cannot be shown to exist, so that an absent Cell refuses exactly as an out-of-scope one does. Nothing today can create a Person with that identifier — no endpoint accepts a client-supplied `id`, and every column defaults to `gen_random_uuid()` — but nothing forbids it either, and a Person holding it inside an actor's subtree would make every unplaceable Cell "covered" for that actor. The sentinel-free equivalent is to let the port's null reach `scopeCovers` the way `personBehind` already does for an absent Account. Settle it if Section 3's client-generated identifier is ever built.
- **What Section 8 permits a refusal to reveal by its existence.** The source-Cell refusal no longer names a Cell or asserts a membership, but its *shape* still carries one bit: with the actor authorized over their own Cell and any `person_id` in the church — and Section 8 publishes every Person's identifier church-wide — a 403 means that person holds a membership somewhere the actor cannot see, and a 201 means they do not. The quiet outcome is the hit and the loud one is the miss, which is the reverse of the arrangement the 2026-08-22 create-probe ruling was willing to accept, and that ruling closed the leak rather than resting on loudness. This one cannot be closed by redacting anything: the refusal is required by the authorization rule itself. The source-Cell reading it used to defer to was settled by the closure pre-flight above, which did not answer this: what a refusal may disclose by *existing* is still open, and is now the last part of that question standing.
- **Whether "Admin" in Sections 2 and 10 is a role requirement or a description of who holds the capabilities.** Section 2 settled this once, for the tree import, in the direction of "the role is required, and the capabilities alone are not enough" — and stated it in that paragraph rather than as a general rule. Direct creation is given to Admin in the same section and again in Section 10, and slice 2 reads it the same way and checks the role. If that reading is right, the two places should say it in the words Section 2 already uses for the import, because the next reader derives it from a neighbouring paragraph or not at all. If it is *not* right, then Section 7's permission to grant `cell.approve_leadership` explicitly makes request-and-approve optional for its holder over their own subtree, and Section 10 needs to say why that is acceptable. Nothing is blocked either way: the conservative reading is what is implemented.
- **Whether a Cell's first leadership row may be corrected to a leader of the other Network, and whether a closed leadership row may be written at all.** Two halves of one question, both raised by the fourth review pass. Migration 0009 refuses a Section 5 correction that closes a Cell's first leadership row and opens one naming a person of the other Network: the zero-length row is selected as the predecessor and the leader-to-leader Network rule fires. That may well be right — a Cell created under a wrong-Network leader had the wrong Network for its whole life, and Section 10 gives `CREATED_IN_ERROR` for a Cell that should not exist — but Section 10 states that rule about a *handover*, and nothing distinguishes a correction from one. The second half is narrower and has no answer at all: `cell_leadership_is_opened_open` now refuses a leadership row written already closed, because no operation Sections 10 or 11 define writes one, and that forecloses correcting a closed historical stint. Neither is reachable today. Settle both with the handover-approval endpoint, which is where Section 10 makes the refusal.
- **Which side moves when a Cell leader's Network changes.** Section 4's last paragraph says a Network change must not leave the person holding relationships the homogeneous-network rule no longer permits, and that where a choice arises it is flagged for authorized human resolution rather than guessed. For pastoral relationships Section 4 is concrete: the change is refused while the person leads anyone, and each disciple is moved by an ordinary reassignment first. For Cell **leadership** it says nothing concrete, and leading a Cell is a different relationship from discipling someone (Section 1, principle 3), so Section 4's refusal does not reach it. A Network change on a Cell's leader therefore moves the Cell's own Network and strands every member of every Cell they lead, and nothing raises. Refusing the change while they lead a Cell would be the Section 3 archival shape and would be consistent; requiring the Cell to be handed over first is a different pastoral decision. `docs/ROADMAP.md` books the work as Stage 3's last item without settling the rule. Settle it before the `networks` precondition grows its Cell half.
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
- **Whether the API runs as more than one instance, and what clock skew revocation may assume.** §6 says any instance can serve any request, and account-wide revocation compares two timestamps both stamped by an API process. On one instance that is one clock; on several it is not, and §24 now requires synchronised clocks without bounding the skew this comparison tolerates. The row lock added for the uncommitted-revocation window orders the two events in the database and does not depend on clocks, so this affects the comparison rather than the ordering. Settle it before the first multi-instance deployment.
- **Whether the application should pin the database session's `DateStyle`.** Nothing in this repository sets it, and it is deployment-controlled — this machine's server already runs `ISO, DMY` rather than the default `ISO, MDY`, so the value is demonstrably not fixed. Under `SQL`, `Postgres` or `German` the consequence is not a formatting nuisance: `node-postgres`'s own `timestamptz` parser returns **`null`**, reproduced, so every timestamp the API reads comes back empty — `started_at`, `ended_at`, `requested_at`, every effective-dated period and every audit entry — while nothing raises. The leadership-request cursor no longer depends on the setting (its key is rendered by `to_char` with an explicit format), but that fix addresses one symptom of a fault whose first symptom would be far louder and far stranger. Three answers look defensible: set `options: '-c DateStyle=ISO,MDY'` on the pool so the application does not care what the server is configured for; assert the setting at startup the way section 24's isolation level is asserted, and refuse to boot otherwise; or document it as a deployment requirement and leave it unchecked. Not blocking, and it belongs beside the open items on the least-privilege database role and the liveness probe, since all three are settings a deployment owns rather than rules the specification states.
- **The application's database role.** §24 requires least-privilege credentials and none exist: the API connects as the owner of every table, so it holds `TRUNCATE`, which bypasses the no-delete triggers entirely, and `DROP`. The no-delete rule leans on this role to make its `TRUNCATE` exemption safe. Creating it is deployment work with no ruling attached, but until it happens §5's exemption is unprotected.
- **Whether a revocation may be undone in place.** Nothing addresses setting `revoked_at` back to `NULL`, and the schema permits it on `account_roles` and `capability_grants`. It erases a revocation exactly as a `DELETE` would, one column over — and the Senior Pastor cap depends on `revoked_at` being monotone for the count to mean anything over time.
- **The native client framework.** `SKILL.md` §2 settles the web stack and says nothing about Android and iOS. Deferred since the specification was written; indexed here because two rules now point at it as open.
- **What the native clients owe on accessibility.** `SKILL.md` §23 binds the web application to WCAG 2.2 AA and says the equivalent obligation for a native client is the platform accessibility API rather than WCAG. Which platform guarantees, and what would fail a build, is a ruling to make when the client is.

- **Whether the liveness probe should share the application connection pool.** §24 now records that it does, and that pool exhaustion therefore presents to the platform as a dead process — so the response is a restart that discards the transactions still making progress. A separate connection, or a probe that does not reach the database, are both defensible and mean different things by "healthy". Deployment work with a ruling attached, alongside the database-role item above.
- **Whether `audit_log`'s append-only guarantee tolerates `TRUNCATE`.** §5 records the exemption for history tables and leans it on a least-privilege role that does not exist, which is already open above. §21 says nothing at all, and the test suite truncates `audit_log` before every test. Same answer as the `TRUNCATE` question above, most likely, but it is not written down for the one table whose whole purpose is that nothing removes a row.
