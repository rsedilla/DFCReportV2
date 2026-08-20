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

### Open — awaiting a ruling

Nothing is currently awaiting a ruling. Items reaching a Stop Condition are recorded here until settled.

