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

Written to `SKILL.md` §22.

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
"because a probe there creates a record every time, which is loud". That is
false.* A Tier 1 refusal throws before the transaction is opened, so a probe
writes nothing — the branch's own test asserts the Person count is unchanged. The
creation refusal is exactly as silent as the read, and it now applies the same
scope filter. Recorded rather than deleted: a false justification in this log is
worse than none, because the next reader takes it as settled.

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

### Open — awaiting a ruling

**One item awaits a ruling and blocks Stage 5. Eight other things are unsettled, none of them blocking. They are listed at the end, so this section is the whole of what is open.**

Nine items that stood here on 2026-08-22 were settled that day and are recorded above. Seven were Stop Conditions for Stage 2, and the last two were opened and closed the same day by `architecture-guardian` passes.

**What an aggregate Cell attendance view offers in place of buckets.** Monthly-attendance buckets are a Cell-scope view only, because N belongs to a Cell and aggregating across different N inflates `Completed` for the Cells that recorded least (`SKILL.md` §12). At leader and Network scope the spec offers unique people, classification and coverage, and does not say whether anything should replace the buckets. Settle it in Stage 5 against real data.

Two related questions have defined behaviour and are recorded in `SKILL.md` §12 as fairness questions rather than Stop Conditions: whether a leader should see someone who attended and has since left, and whether a mid-month joiner measured against the whole month is acceptable. An implementer follows the stated rules and does not stop on either.

**Unsettled, and not blocking anything.** None of these is a Stop Condition. An implementer proceeds and settles them in passing; they are listed here because a reader looking for what is open should not have to find it inside the body of a ruling.

- **Whether the API runs as more than one instance, and what clock skew revocation may assume.** §6 says any instance can serve any request, and account-wide revocation compares two timestamps both stamped by an API process. On one instance that is one clock; on several it is not, and §24 now requires synchronised clocks without bounding the skew this comparison tolerates. The row lock added for the uncommitted-revocation window orders the two events in the database and does not depend on clocks, so this affects the comparison rather than the ordering. Settle it before the first multi-instance deployment.
- **The application's database role.** §24 requires least-privilege credentials and none exist: the API connects as the owner of every table, so it holds `TRUNCATE`, which bypasses the no-delete triggers entirely, and `DROP`. The no-delete rule leans on this role to make its `TRUNCATE` exemption safe. Creating it is deployment work with no ruling attached, but until it happens §5's exemption is unprotected.
- **Whether a revocation may be undone in place.** Nothing addresses setting `revoked_at` back to `NULL`, and the schema permits it on `account_roles` and `capability_grants`. It erases a revocation exactly as a `DELETE` would, one column over — and the Senior Pastor cap depends on `revoked_at` being monotone for the count to mean anything over time.
- **The native client framework.** `SKILL.md` §2 settles the web stack and says nothing about Android and iOS. Deferred since the specification was written; indexed here because two rules now point at it as open.
- **What the native clients owe on accessibility.** `SKILL.md` §23 binds the web application to WCAG 2.2 AA and says the equivalent obligation for a native client is the platform accessibility API rather than WCAG. Which platform guarantees, and what would fail a build, is a ruling to make when the client is.

- **The root's representation.** §5 says both that a root leader has "no active pastoral assignment" and that "A root leader has a null `leader_id`", and invariant 3 lists zero assignments as legitimate for a root. Those disagree about whether a row exists. The schema permits either, the test fixtures insert a row, and the same-Network trigger passes a null-`leader_id` row without comparison, so nothing currently depends on the answer — §4's backdate floor was deliberately written over edges with a leader so that it does not. Settle it before anything queries "is this person a root", which is a different question under each reading.
- **The `audit_log.action` identifier vocabulary has no home in `SKILL.md`.** §21 gives prose descriptions and says `action` is "an identifier from the list above"; the identifiers themselves are minted in `api/src/database/schema.ts` and shaped by a regex in the migration. The next module to write an entry has nothing to consult, so `pastoral_assignment.transferred` and `pastoral.transfer` are equally defensible. §21 deliberately does not close its list, so this is a naming convention to record rather than an enumeration to fix.
- **Whether `audit_log`'s append-only guarantee tolerates `TRUNCATE`.** §5 records the exemption for history tables and leans it on a least-privilege role that does not exist, which is already open above. §21 says nothing at all, and the test suite truncates `audit_log` before every test. Same answer as the `TRUNCATE` question above, most likely, but it is not written down for the one table whose whole purpose is that nothing removes a row.
