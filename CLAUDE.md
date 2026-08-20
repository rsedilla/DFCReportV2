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

No application code exists yet.

When the API and web application are scaffolded, this section carries the commands to install, run, migrate, seed, and test. Until it does, the Definition of Done above is a statement of intent rather than something anyone can check — filling this in is part of the scaffolding work, not a follow-up to it.

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

Requests are `PENDING`, `APPROVED`, or `DECLINED`, at most one pending per prospective leader, declines retained. Decline reasons are a fixed list — `NOT_YET_READY`, `TIMING_DEFERRED`, `DUPLICATE_REQUEST`, `SUBMITTED_IN_ERROR`, `OTHER` with a note — because a decline is a durable record about a named person and free text is where a judgmental label would be written.

Pending requests appear on the Admin dashboard. The earlier wording forbade any surface at all, leaving the approver nowhere to see a request that blocks a leader's account.

Written to `SKILL.md` §10, §7, §19, §21.

### 2026-08-20 — Initial encoding ends by an audited Admin action
While open, Admin may create Cells directly. Once closed, that path is gone and every Cell goes through request-and-approve. Three commits had attached relaxations to a phase with no terminating condition; a relaxation tied to a phase that never ends is a permanent relaxation. Written to `SKILL.md` §2 and §10.

### 2026-08-20 — A DCC attendance record requires a pastoral leader
The VIP workflow captures the pastoral leader at creation. In practice the answer is already settled outside the system — someone brings a visitor, and who they sit under is decided by that relationship before anyone opens the app. A Person with no active assignment simply cannot have DCC attendance recorded, since there would be no responsible leader. Written to `SKILL.md` §9.

### 2026-08-20 — A person who changes Cell mid-month reports under the new Cell
Their denominator is the new Cell's recorded meetings, and attendance at the Cell they left stays in that Cell's records without placing them in its monthly buckets. Leader and Network totals are unaffected, since those deduplicate by person. Written to `SKILL.md` §10.

### 2026-08-20 — A rescheduled meeting takes its roster from the actual date
Membership can change between the original and actual dates, and the roster should be the people who could actually have been there. The meeting still belongs to its original reporting month. Written to `SKILL.md` §10.

### 2026-08-20 — Notifications go to the direct leaders and Admin, not the Senior Pastors
The two Senior Pastors keep full visibility but are not interrupted by the application. Following up an outstanding record is the work of the leaders directly under them.

Recipients see church-wide figures, which exceeds the own/subtree scope their position confers. §7 is explicit that being in a Senior Pastor's direct 12 grants no wider scope, so this comes from an explicit Admin-issued grant of `reports.view_subtree` at Whole Church scope, read-only and audited. Notification content never exceeds the recipient's granted scope. Written to `SKILL.md` §13.

### 2026-08-20 — `settings.manage` for church-wide operational settings
Admin-only, Whole Church, audit logged with previous and new values. It governs the Cell attention threshold (§15) and the initial-encoding phase flag (§2) — both alter behaviour for the whole church from one control. A setting is explicitly not a place to record domain rules: anything that changes what a figure means belongs in the specification, not behind a control. Written to `SKILL.md` §7, §15, §2, §21.

### 2026-08-20 — A mid-month schedule change is resolved per week
The schedule in force on the first day of the week a meeting belongs to determines that meeting's scheduled date. The week is the unit because §13 already makes the weekly meeting the unit of identity. Without the rule a mid-month move can leave a week with two candidate dates or none, producing a month of three or six scheduled meetings and a coverage denominator with no defined value. Written to `SKILL.md` §10.

### Open — awaiting a ruling

Nothing is currently awaiting a ruling. Items reaching a Stop Condition are recorded here until settled.

