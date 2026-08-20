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

A pull request needs one approval. Changes to `SKILL.md`, `CLAUDE.md`, and `.claude/` additionally require a code owner (`.github/CODEOWNERS`).

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

cd ../web && npm ci && cp .env.example .env.local
npm run dev                          # http://localhost:3000
```

`api/.env` and `web/.env.local` are not committed. `JWT_SECRET` must be at least 32 characters, and the application refuses to start without it rather than falling back to a default that would be wrong in production.

| Command | In | What it does |
| --- | --- | --- |
| `npm run lint` | `api`, `web` | ESLint. In `web` it also fails on an API route or a server action |
| `npm run typecheck` | `api`, `web` | `tsc --noEmit` |
| `npm run format:check` | `api` | Prettier |
| `npm test` | `api` | The suite that must stay green. Needs a migrated database |
| `npm run test:authorization` | `api` | The eleven authorization cases. **Fails until Stage 2** |
| `npm run migrate:up` / `:down` / `:status` | `api` | Applies, reverts one, or lists migrations |
| `npm run build` | `api`, `web` | Production build |

There is no seed command. Section 2 of `SKILL.md` loads real data through the import flow rather than through fixtures, and test fixtures are built by the tests that need them.

Migrations are plain `.sql` files in `api/migrations/`, applied in filename order by `api/scripts/migrate.ts`. Each holds a `-- migrate:up` and a `-- migrate:down` section, and an applied migration is checksummed: editing one that has already run is refused, because the file and the database would otherwise disagree with nothing to say so. Write a new migration instead.

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
`people`, `networks`, `hierarchy`, `auth`, `cells`, `attendance`, `reporting`, `audit`, `admin`. A module owns its tables and no other module touches them directly; cross-module access goes through the owning service interface.

Named because Principle 13's modular monolith is otherwise just a monolith, and because it is what makes "enforced in the domain layer" real: the five §5 invariants have one home only because `hierarchy` is the only writer of `pastoral_assignments`. Organise by module, never by layer. Written to `SKILL.md` §2.

### 2026-08-20 — Every required structure is named and indexed
Six entities were required by rules and had no shape, of which five would naturally have been built as a column on their parent — losing history the specification guarantees, with nothing failing to warn anyone. `person_lifecycle` is the clearest: a state column plus audit rows satisfies every sentence in §3 and still cannot answer who was `CURRENT` on a given past date.

Shapes now sit in the section owning each rule, and §26 carries an index of all twenty structures to be checked against a migration. Adding to that index is part of the change introducing the rule, never a follow-up. Written to `SKILL.md` §3, §4, §10, §13, §20, §26.

### 2026-08-20 — The guard checks one target; the rest is domain layer
A grant's scope is evaluated against the request's primary target. Where a rule concerns other objects — §5's requirement that both the source and destination leader be in scope, and that the actor act on neither themselves nor an upline — those are checks in the owning module's domain layer, additional to the guard and never expressible as a scope value.

Stated because a capability and a scope cannot express three objects with three different rules, and a developer who implements the guard and believes the rule is implemented has built half of it. `SUBTREE_EXCL_SELF` survives for `cell.request_creation` alone, where the only prohibited object is the target. Written to `SKILL.md` §7.

### 2026-08-20 — `read_only` is valid only on a read capability
Five capabilities are reads: the four `view_subtree` variants and `audit.view`. The other nineteen are writes, and a grant of one with `read_only` true is rejected at creation rather than stored and silently ineffective — otherwise an Admin who leaves the flag at its default creates a row that grants nothing, with nothing to explain the denial. Written to `SKILL.md` §7.

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

### 2026-08-20 — Tailwind CSS, chosen while there is one page to convert
Settled in `SKILL.md` §2 (Chosen stack). It affects no architectural boundary: Tailwind is a build-time PostCSS plugin, adds no route, no server action and no data access, and the phones never load the stylesheet.

Chosen now rather than at Stage 5 for the same reason CI was chosen at Stage 1. Converting one placeholder page costs minutes; converting the dashboards, Network Summary and the role-specific screens costs a week, and the framework that arrives after the screens tends to be applied to only half of them.

**The palette carries the §13 and §17 prohibition.** No `success`, no `danger`, no `warning` token exists, and none is to be added. In a utility framework a red-and-green performance palette is one class away, and colouring a leader's row red for declaring `NOT_HELD` destroys the honest reporting that status exists to obtain — ranking the measure destroys the measure. A figure needing attention is surfaced by the attention list (§15), never by being coloured as a failure. The reasoning is written into `web/app/globals.css`, where somebody adding a colour will read it.

### Open — awaiting a ruling

**One item awaits a ruling.**

**What an aggregate Cell attendance view offers in place of buckets.** Monthly-attendance buckets are a Cell-scope view only, because N belongs to a Cell and aggregating across different N inflates `Completed` for the Cells that recorded least (`SKILL.md` §12). At leader and Network scope the spec offers unique people, classification and coverage, and does not say whether anything should replace the buckets. Settle it in Stage 5 against real data.

Two related questions have defined behaviour and are recorded in `SKILL.md` §12 as fairness questions rather than Stop Conditions: whether a leader should see someone who attended and has since left, and whether a mid-month joiner measured against the whole month is acceptable. An implementer follows the stated rules and does not stop on either.

