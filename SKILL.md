# G12 Church Management System — Architecture Skill

## Purpose
Use this skill when designing, implementing, reviewing, or extending the G12 Church Management System. The system manages people, pastoral hierarchy, Men's and Women's Networks, DCC attendance, Cell Group attendance, Cell Leaders, network development, authentication, authorization, reporting, and drill-down analytics.

The system is web-first and must remain API-first so Android and iOS applications can be added later without duplicating business logic.

---

## 1. Non-Negotiable Design Principles

1. Use one master Person record per individual.
2. Never create separate person databases for DCC, Cell, or leadership.
3. Pastoral hierarchy, roles/permissions, Cell leadership, and attendance are separate concepts.
4. All authorization is enforced server-side/API-side, never only in the frontend.
5. A leader can access only their authorized pastoral scope unless a broader role explicitly grants more access.
6. Bishop Oriel Ballano and Pastora Geraldine Ballano are Senior Pastors and can view the entire church: both Men's and Women's Networks, all reports, and all drill-down views allowed to the Senior Pastor role.
7. Avoid negative or judgmental wording throughout the application and analytics.
8. Cell meeting status has exactly three options: `HELD`, `RESCHEDULED`, and `NOT_HELD`. `NOT_HELD` is always declared by the responsible leader with a reason, and is never inferred from missing data. Do not introduce Failed, Excused, Unexcused, Bad Leader, Poor Performance, or similar labels, and never derive a score, rate, or ranking of leaders from meeting status.
9. Store facts and trends; let pastoral leaders interpret them.
10. Totals shown as people must be unique/distinct people, not summed attendance occurrences.
11. Do not hard-code 12 → 144 → 1728 as database roles or fixed hierarchy levels. Model an arbitrary-depth pastoral tree and calculate generations.
12. Preserve history for pastoral assignments, Cell category changes, attendance corrections, and other important changes.
13. Build a modular monolith first. Do not introduce microservices without a demonstrated need.

---

## 2. Platform Architecture

Preferred logical architecture:

```text
Desktop Web  ──┐
Mobile Web   ──┤   three client surfaces, used concurrently
Android/iOS  ──┘
               |
               v
        REST API /api/v1                  separately deployable
               |
Authentication + Authorization + Pastoral Scope
               |
    Application / Domain Services
               |
          PostgreSQL
               |
Background jobs / email / notifications as needed
```

### Chosen stack

This is settled, not a suggestion.

- **Backend:** NestJS + TypeScript
- **Database:** PostgreSQL
- **Frontend:** Next.js + TypeScript, as a pure client
- **API:** REST, versioned under `/api/v1`
- **Deployment:** containerized, portable across AWS, Hostinger/VPS, or another provider
- **Email:** provider abstraction; business logic must never depend directly on SES or any other provider
- **Redis / queues / workers:** add when needed, not required for the initial release

Two reasons decide the backend, and both come from requirements rather than taste.

**Authorization must be enforced structurally.** Section 7 makes the API the sole authority, and Section 22 sketches roughly forty endpoints, each needing a capability check and a scope check. NestJS guards make that declarative and reviewable in one line, and an endpoint that fails to declare a capability fails closed. On a team, the alternative — remembering to call a check inside every handler — erodes: the check is only as reliable as the least familiar developer writing the newest route.

**Mobile clients cannot be force-updated.** An installed app keeps calling `/api/v1` for months after the web client has moved on, and an iOS release passes through review before it can reach anyone. The API must therefore be deployable independently of the web application. If the API ships inside the web app, no web change can be released without redeploying the API that every phone depends on. Separate deployables is a requirement here, not a preference.

### The frontend is a client, like the phones

The Next.js application contains **no API routes and no server actions**. It consumes `/api/v1` exactly as the Android and iOS apps will.

Any logic placed in the web application is logic the mobile apps do not have. Core business rules live in the backend domain layer so that all three surfaces behave identically — and so that a rule fixed once is fixed everywhere.

If this boundary proves hard to hold, replace Next.js with a plain React SPA, which removes the option entirely. The framework matters less than the boundary.

### Three surfaces, used together

Desktop web, mobile web, and the native apps are used concurrently, by the same people and by different people against the same records. Mobile web is the bridge: leaders will open the web application on their phones long before a native app exists, so responsive design is an immediate requirement rather than preparation for the future.

The API must therefore be stateless, must support several concurrent sessions per account (Section 6), and must detect write conflicts rather than resolving them silently (Sections 14 and 23).

---

## 3. Person Model

### Required personal information

- First Name — required
- Middle Name — optional
- Last Name — required
- Birthday / date of birth — required
- Sex — required, exactly:
  - `MALE`
  - `FEMALE`
- Civil Status — required, exactly:
  - `SINGLE`
  - `MARRIED`
  - `WIDOWED`

### System-generated / derived

- Internal primary key: UUID
- Human-readable Member ID: system-generated, e.g. `M-001842`
- Age: calculate from date of birth; never persist age as authoritative data
- Network: organizational relationship; may be automatically assigned according to church rules
- Pastoral path
- DCC classification
- Cell classification
- Monthly attendance consistency
- Login/account status

### Two identifiers, two jobs

The UUID and the Member ID are not interchangeable, and are generated in different places.

The **UUID** is the internal primary key and every relationship points at it. It may be generated by the client, which is what allows a Person to be created offline on a phone and keep the same identity when the record later syncs (Section 23).

The **Member ID** is a human-readable handle for staff, printed reports, and conversation. It is assigned by the server from a database sequence, never by a client.

A Person created offline therefore has a UUID immediately and no Member ID until the record reaches the server. Interfaces must tolerate that gap rather than treating a missing Member ID as an error.

### Member ID generation

- Format `M-` followed by six zero-padded digits, from a database sequence.
- Assigned once, at creation, and immutable thereafter.
- **Never reused.** A Member ID belonging to an archived Person, or to a Person absorbed by Merge, is retired permanently. It appears in printed reports and in people's memories, and reassigning it would make two different people share an identifier across time.
- Gaps are expected and acceptable. A sequence skips values on rolled-back transactions, and closing the gaps would require a global lock on every Person creation for no benefit. The Member ID is a handle, not a count of members.
- It encodes nothing. Not Network, not year, not Cell, not role. Identifiers that carry meaning become wrong when the meaning changes, and a person's Network can change (Section 4).
- On exhausting six digits, widen the format. Never wrap and never reuse.

### Name handling

Do not store only one free-form `full_name` as the canonical structure. Keep first, middle, and last names separately. Display a composed full name in the UI.

Validation must support legitimate names containing spaces, hyphens, apostrophes, and Unicode characters. Do not use simplistic "letters only" validation.

### Duplicate prevention

Before creating a new person, search for possible existing people using normalized/fuzzy combinations of:

- first name
- middle name
- last name
- birthday
- sex as a supporting signal

Do not enforce a strict unique constraint on name + birthday because two different people can legitimately share those values.

If a possible match exists, show the user the existing record and allow authorized confirmation of whether it is the same person.

### Matching rules

Two rules bound everything below. The system **never** merges automatically, and the system **never** blocks creation. It surfaces candidates; a person decides. A matcher that blocks will be worked around by staff inventing spellings, which produces the duplicates it was meant to prevent.

**Normalize for comparison only.** Never alter the stored values. For matching, casefold, trim, collapse internal whitespace, strip diacritics, and treat hyphens and apostrophes as separators. Ignore the suffixes Jr, Sr, II, III when comparing, and compare them separately as a weak distinguishing signal.

Whitespace normalization carries unusual weight here. `Dela Cruz`, `DelaCruz`, and `de la Cruz` are the same surname, and treating them as different is the most common way a duplicate is created.

**Tier 1 — very likely the same person.** Present prominently, and require the user to explicitly acknowledge the candidate before a new Person is created:

- same birthday, and normalized last and first names both equal
- same birthday, last name equal, and first name a known nickname variant or within a small edit distance

**Tier 2 — possible.** Present in a candidate list:

- same birthday and last name equal
- last name and first name equal, where birthday differs or is absent
- high whole-name similarity with birthdays differing by a transposition of digits

**Never a match on its own:** a common surname alone, a first name alone, or sex alone. Sex is a supporting signal: a mismatch lowers confidence but never excludes a candidate, because it is a frequently mis-keyed field.

**Middle name absence never counts against a match.** It is optional (above) and is frequently left blank.

**A woman's last name may change on marriage.** Where last names differ, birthday together with first name remains a Tier 2 signal on its own. Do not require surname equality.

Thresholds and edit distances must be calibrated against real data rather than fixed here. Log the candidates shown and what the user chose, and revisit the rules once there is enough history to see what the matcher is missing and what it is over-reporting.

### Person Lifecycle (Current / Archived)

A Person must not normally be hard-deleted merely to reduce a leader's current People count. Every Person has a lifecycle state:

- `CURRENT`
- `ARCHIVED`

Archiving removes the Person from applicable current-network totals from the effective archive date forward, but must preserve their historical identity, attendance, pastoral relationships, Cell relationships, and audit history in full.

A real Person who has stopped attending must not automatically be archived. Lack of recent attendance is a participation/reporting concern (Section 16, Participation), not identity deletion.

An archived Person can be restored to `CURRENT`. Archiving and restoring must be recorded as historical events, not merely toggled, so that Network Summary can show and explain when and why a Person's status changed (Section 16).

Historical reports must remain reproducible: a report for a past period reflects each Person's lifecycle state as it stood at that time, not their current state. Archiving someone today must never change the total shown for a period before their archive date, no matter when the report is re-run. Classification and monthly-attendance reports (DCC, Cell) are period-based and never filtered by current lifecycle state, for any period including the present one. Only current-state inventory metrics (Total People, Current Cell Leaders, Cell Groups, Cell Leaders with 12+ Members, Participation) reflect lifecycle state, and only as of the period being reported.

"New Cell Leaders for a selected period" (Section 16) is period-based like attendance reporting and is not affected by a leader's later archival. "Leaders with 12+ Direct Leaders" (Section 16) is a current-state snapshot and does reflect current lifecycle state, for both the leader and the counted direct leaders.

Archive reasons must use neutral, operational language — never judgmental concepts such as "for cause," "disciplined," "bad leader," or similar. Use:

- `NO_LONGER_IN_CURRENT_NETWORK`
- `RECORD_CREATED_IN_ERROR` — for a genuinely erroneous individual record, not a duplicate
- `OTHER` — requires a note

Duplicate Person records must be corrected through Person Merge (below), never through ordinary archiving with `RECORD_CREATED_IN_ERROR`.

Archiving and restoring are RBAC-controlled capabilities (Section 7). Ordinary leaders do not have unrestricted authority to archive people.

### Archiving a Person who leads a Cell

A Person holding an active Cell leadership assignment (Section 11) cannot be archived while that assignment stands. The archive is rejected, naming what must be resolved first — for example, that the Person leads `CELL-011`, which has nine members.

Resolve it deliberately, in one of two ways: reassign the Cell to another leader, or close the Cell (Section 10, Cell lifecycle). Either is an explicit, authorized, audited action.

Two alternatives were considered and rejected. Allowing the archive and leaving the leadership assignment in place produces a Cell whose leader is not a current Person, which corrupts Current Cell Leaders and every metric derived from it. Allowing the archive and automatically closing the Cell silently ends nine people's Cell membership, dropping them out of Cell reporting with no decision recorded about where they go.

The membership of nine people is a pastoral decision, not a side effect of an administrative form. This follows the same principle as a Network change that would orphan a pastoral edge (Section 4): reject and require the conflict to be resolved, rather than resolving it silently.

The same rule applies to Person Merge where the absorbed Person leads a Cell.

### Person Merge (Duplicate Correction)

Duplicate or created-in-error Person records must be correctable separately from ordinary archiving. Appropriately authorized users may merge one Person record into another while preserving and safely reconciling historical references.

A merge never rewrites historical attendance, pastoral, or audit records to point to a different Person — the absorbed record's history remains exactly as originally recorded, and is resolved to the surviving Person's identity when reports are generated. Identity resolution applies to every period, including periods already reported. A report for a past period, re-run after a merge, counts the merged pair as one person, and its unique-people total is therefore one lower than when the report was first run.

This is a correction, not a rewrite. A merge asserts that the two records were always one person. A past report that counted them twice was wrong at the time — it counted one human being as two, in breach of Section 1, Principle 10. Lowering the total repairs that defect; it does not alter history.

Distinguish this carefully from the lifecycle guarantee in Person Lifecycle above. Archiving is a change of state that applies from its effective date forward, and must never alter a total for an earlier period. A merge is a statement about identity that was always true. The two behave differently on purpose.

Derived figures move with the total. If each duplicate record had attended twice in the period, the surviving Person attended four times, and the classification report for that period shifts accordingly — two fewer 2nd Timers and one more 4th Timer, for a net reduction of one. Buckets must still reconcile to the new total (Section 20).

Because a previously published total can change, every merge must be surfaced in Network Summary as an explaining movement (Section 16), so that a leader holding an earlier printed report can be shown why the figure moved.

A Person may only be merged once (into a survivor that has never itself been merged away) — this keeps identity resolution unambiguous. If a survivor later turns out to also be a duplicate, that requires a separate, deliberate correction; there is no automatic chain-merging.

Because a merge is effectively irreversible, cross-entity, and can affect more than one leader's or Network's data, Person Merge requires Whole Church-level authorization (Section 7) — in practice, an Admin-level capability, not an ordinary leader action — and requires an explicit reason. There is no "undo merge" capability; an incorrect merge must be corrected manually and deliberately, not automatically reversed.

Where merging the two records' current relationships (e.g. both have an active but different Cell membership) would require choosing between two legitimately different current facts, the system must not silently pick one — it must flag the conflict for authorized human resolution rather than guessing.

Person Merge is an identity/data-correction operation and must never provision credentials or grant system access — this stays strictly separate from Account Provisioning (Section 6), which remains its own explicit, authorized workflow:

- A merge must never automatically create a new Account for the surviving Person.
- If the absorbed Person has an Account, that Account must be disabled as part of the merge, and its active sessions and refresh tokens must be revoked immediately, not merged or transferred to the survivor.
- Passwords, sessions, refresh tokens, activation tokens, or any other credentials are never merged or transferred to the survivor.
- If the surviving Person already has an Account, it remains subject to its existing account status and authorization rules, unaffected by the merge.
- If the surviving Person has no Account, they remain without one after the merge — if they later require login access, an authorized user must use the normal Account provisioning/activation workflow (Section 6), not the merge action.
- All merge-related Account changes must be audit logged (Section 21).

---

## 4. Networks and Senior Pastors

The church has two homogeneous organizational networks:

- Men's Network
- Women's Network

Senior Pastors:

- Bishop Oriel Ballano
- Pastora Geraldine Ballano

Both Senior Pastors have church-wide visibility across both Men's and Women's Networks.

Sex may be used to automatically propose/assign the appropriate network according to the church's homogeneous-network rule, but store the actual network relationship explicitly rather than deriving it on every query.

### Network assignment history

A person's network relationship must be preserved historically (effective-dated), the same way pastoral assignments and Cell category are, so that Network-scoped reports remain accurate for past periods even if a person's network is later corrected or changed.

For Version 1, a person's initial network assignment becomes effective on the date/time the Person is encoded/created in the new system. Do not attempt to reconstruct or infer network history from before the person was encoded, and do not fabricate legacy network-change dates. The system is authoritative for network history from each person's encoding date forward; subsequent network changes must preserve their actual effective history from that point on.

### Correcting a person's sex

A person's recorded sex may be corrected — most often an ordinary data-entry fix. Because sex determines Network, this is never an ordinary field edit and is explicitly outside `people.edit_basic` (Section 7).

Correcting sex is an explicit, authorized, audited operation. Where the correction changes the person's Network, it is carried out as a Network change: the current Network assignment is closed and a new one opened, effective-dated, preserving history exactly as any other Network change does. Never re-derive Network silently from the new sex value.

A Network change must never leave a person under a pastoral leader in their former Network. If the person has an active pastoral assignment that the change would render cross-Network, the Network change and the corresponding pastoral reassignment must be performed together as a single atomic operation — neither can validly precede the other, since each alone leaves the tree in an invalid state. The system must reject a Network change submitted without the reassignment it requires, and must never silently drop the person's pastoral assignment to resolve the conflict.

The same applies to Cell membership and Cell leadership: a Network change must not leave the person holding relationships that the homogeneous-network rule no longer permits. Where resolving this requires choosing between legitimately different facts, flag it for authorized human resolution rather than guessing (Section 3, Person Merge).

---

## 5. Pastoral Hierarchy

Model pastoral responsibility as an arbitrary-depth tree.

Example:

```text
Oriel
  -> Raymond
       -> Mark
            -> Juan
```

A leader can see their authorized subtree. A leader cannot automatically access a parallel/sibling branch.

Do not encode `12`, `144`, or `1728` as account roles.

### Pastoral assignments do not cross Networks

A leader and their direct pastoral subordinate must belong to the same Network (Men's or Women's) — pastoral hierarchy does not cross Networks, consistent with the homogeneous-network rule in Section 4.

A leader needing to review reports from another Network (e.g. an oversight leader checking both Senior Pastors' direct 12 for reporting accuracy) does not require a pastoral reassignment or a cross-network hierarchy edge. That need is met entirely through an explicit RBAC scope grant (Section 7) — read-only reporting visibility at the needed scope, independent of and without altering the leader's own pastoral position.

Because Senior Pastors may perform reassignments in either Network (Section 7), this constraint must be enforced as a server-side invariant on every assignment write, not merely implied by the shape of the hierarchy. See Changing a person's pastoral leader below.

### Network roots

Each Network has exactly one root leader: Bishop Oriel Ballano for the Men's Network, and Pastora Geraldine Ballano for the Women's Network (Section 4).

A root leader has no pastoral leader and therefore no active pastoral assignment. This is the intended state, not missing data.

A Person with no active assignment is a root only when they are a designated Network root. Any other Person without one is unassigned — surface them as such rather than silently rendering them as a second root of the tree.

A root leader cannot be reassigned by anyone, Admin included, because there is no valid leader above them. Changing who holds a root position is a deliberate Network-level decision, not a pastoral reassignment.

Never represent a root as an assignment pointing at itself. A self-referencing row is rejected by the no-self-assignment constraint, and would make the root its own ancestor — a one-node cycle.

### Recommended historical model

Prefer a pastoral assignment/history table for a long-lived production system:

```text
pastoral_assignments
- id
- member_id
- leader_id nullable
- started_at
- ended_at nullable
```

This allows a person to move to another leader without destroying history.

An assignment is active when `ended_at` is null. That is the single definition. Do not add a separate `status` column beside it: two independent representations of the same fact drift apart, a row ends up with `ended_at` null and a status saying otherwise, and the uniqueness constraint in Changing a person's pastoral leader guards only one of them. If a status value is ever needed for another purpose, derive it — never store it as a second source of truth.

`leader_id` is nullable because Network root leaders have no leader above them (below).

### Direct leaders vs descendants

Always distinguish:

- Direct Leader: immediate parent in pastoral tree
- Direct Leaders: immediate children who qualify as leaders
- Descendants / subtree: all people recursively below a leader

For "completed 12 leaders", count direct leaders only, not all descendants.

### Changing a person's pastoral leader

Reassigning a person to a different pastoral leader is an explicit, authorized, audited operation. It is never a side effect of another action (Section 3, Section 8).

Who may perform it:

- Admin, per explicit administrative permission (Section 7).
- Any leader upline of the person, acting within their own authorized pastoral subtree.
- Senior Pastors (Bishop Oriel Ballano, Pastora Geraldine Ballano), across both Men's and Women's Networks, under their built-in Whole Church scope (Section 7).

The capability is `people.manage_pastoral_assignment` (Section 7).

The following invariants are non-negotiable. Enforce them server-side in the domain/application layer, with database constraints as a backstop. UI filtering is never sufficient (Section 1, Principle 4).

**1. Both endpoints must be within the actor's authorized scope.**

A reassignment has a source (the person's current leader) and a destination (the new leader). The actor must be authorized for both. Validating only one side is a security defect:

- validating only the source lets an actor move people out of their authorized scope and lose them
- validating only the destination lets an actor pull people in from a branch they do not oversee

Admin and Senior Pastors satisfy this at their scope. An ordinary upline leader does not, and must be checked on both sides of every reassignment.

**2. No cycles.**

A person may never be assigned under one of their own descendants. Assigning Manuel under Mark, where Mark is already below Manuel, creates a cycle and causes recursive subtree queries to fail to terminate.

Reject the operation before writing. Recursive subtree queries must additionally carry their own cycle detection, so that a cycle introduced by any other means — data migration, direct SQL, or defect — surfaces as an error rather than a hang.

**3. At most one active pastoral assignment.**

A person has at most one active pastoral assignment at any moment.

Zero is legitimate in exactly three situations: a Person encoded but not yet assigned, an archived Person whose assignment has ended, and a Network root leader (above). Every other Person has exactly one.

A reassignment closes the current assignment and opens the new one within a single transaction. It must never leave two open assignments, and must never leave a person who had a leader without one. Enforce with a uniqueness constraint over the person where `ended_at` is null — the constraint permits zero rows and forbids two.

Two concurrently open assignments would place one person in two branches at once and double-count them in every subtree total, violating the unique-people rule in Section 20.

**4. No self-assignment and no upline re-parenting.**

A leader may never change their own pastoral assignment, nor the assignment of anyone upline of them. Only Admin or a Senior Pastor may do so.

Without this, a leader can detach themselves from their own leader or re-attach themselves higher in the tree — privilege escalation through the org chart, since authorized scope is derived from tree position.

**5. The resulting edge must not cross Networks.**

The new leader and the person must belong to the same Network. Because Senior Pastors may act in either Network, this check — not the structure of the tree — is now the only thing preventing a cross-Network edge, and must be a hard server-side invariant on every write.

Reassignment never changes a person's Network. If a person genuinely belongs in the other Network, that is a separate, explicit, audited Network change (Section 4) and must be performed first. The system must reject the reassignment rather than silently flipping the person's Network to make the edge legal.

**Subtree movement.**

When a leader is reassigned, their entire subtree moves with them. Only the reassigned person's own assignment row changes; their descendants' assignments are untouched and continue to resolve through the tree.

Never rewrite or denormalize descendant assignments to reflect a leader's move. Doing so destroys assignment history (Section 1, Principle 12), and a partial rewrite silently detaches a branch — the descendants disappear from the moved leader's totals while appearing under no one.

Moving a leader without their disciples is not a reassignment of that leader. It requires separately reassigning each affected disciple, each subject to every invariant above.

**Effective dating.**

A reassignment takes effect at the time it is recorded. Backdating `started_at` to an earlier date silently rewrites which leader a person belonged to during a past period, changing totals for periods that have already been reported — directly violating the reproducibility guarantee in Section 3.

Backdating is therefore a separate capability, `records.backdate_effective_date` (Section 7), held by Admin only. It requires an explicit reason, is audit logged with both the recorded date and the effective date (Section 21), and must surface in Network Summary as a correction (Section 16).

The same rule governs every other effective-dated relationship: Network assignment (Section 4), Cell membership (Section 10), and Cell leadership (Section 11). Ordinary users record changes as of now. Only Admin may set an effective date in the past, and only with a reason.

**Database enforcement.**

Service-layer checks are not sufficient on their own. The first data-fix script written directly against the database bypasses every one of them. Each invariant that can be expressed as a constraint must also exist as a constraint.

One active assignment — a partial unique index over the person, where the assignment is open:

```sql
CREATE UNIQUE INDEX pastoral_assignments_one_active
  ON pastoral_assignments (member_id)
  WHERE ended_at IS NULL;
```

No self-assignment — a check constraint covers the degenerate case; the wider rule against re-parenting an upline stays in the domain layer:

```sql
ALTER TABLE pastoral_assignments
  ADD CONSTRAINT pastoral_assignments_no_self
  CHECK (member_id <> leader_id);
```

Same-Network edge — because Network is effective-dated on the Person rather than stored on the assignment row, this cannot be a simple check constraint. Enforce it with a constraint trigger on insert and update of `pastoral_assignments`, and re-validate it on every Network change (Section 4).

No cycles — a cycle spans many rows and cannot be expressed as a row-level constraint. Reject it in the domain layer before writing, and make every recursive subtree query cycle-safe so that a cycle introduced by any other means surfaces as an error rather than an unbounded query:

```sql
WITH RECURSIVE subtree AS (
  ...
)
CYCLE member_id SET is_cycle USING path
```

The `CYCLE` clause requires PostgreSQL 14 or later. On earlier versions, carry an explicit visited-path array and stop when a node repeats.

Any query that walks the pastoral tree must carry cycle detection. A subtree query without it is a defect, not a performance preference.

**Lifecycle state.**

An archived Person (Section 3) must not be reassigned. Restore them to `CURRENT` first — an explicit, authorized decision — and then reassign. Keeping the two operations separately authorized and separately audited prevents an archived record from re-entering a leader's current totals through a side door.

A Person absorbed into another by Merge (Section 3) must never be reassigned. The surviving Person is the only valid target.

Every reassignment is audit logged as a pastoral leader transfer with actor, target, previous leader, new leader, and timestamp (Section 21), and must be explainable in Network Summary as a pastoral transfer (Section 16).

---

## 6. Authentication and Accounts

Person records and login accounts are separate.

Ordinary members/attendees do not automatically require accounts.

### Normal qualification for a Leader account

A person normally becomes eligible/required for a Leader account when formally designated as a Cell Leader.

Exceptions with explicit system access:

- Senior Pastor
- Administrator

### Account fields

- person_id
- email — required for accounts and unique after normalization
- password_hash
- account status
- role(s)/permissions
- last_login
- created_at / updated_at

### Authentication V1

Include:

- Login with email + password
- Logout
- Forgot Password
- Password Reset via email
- Account Activation / Set Password via email
- Change Password
- Secure token handling

Do not require 2-step verification/MFA in V1.

### Tokens, not browser sessions

Authentication is token-based from the first release: a short-lived access token plus a refresh token. Do not build a cookie-and-server-session model for the web application and plan to add tokens for mobile later. The API serves three client surfaces (Section 2), and only two of them are browsers.

### Several devices at once

One account may hold several valid sessions simultaneously — a leader recording attendance on a phone while reviewing reports on a laptop is ordinary use, not an anomaly. Issue and track refresh tokens per device or per session, and never evict an existing session merely because a new login has occurred.

Signing out on one device ends that session only.

Revocation, by contrast, is account-wide. Where account access is disabled — at archive, at merge, or by an authorized administrative action — **every** refresh token for that account is revoked and every active session becomes invalid immediately, on all devices. Access already granted must not outlive the revocation by the remaining life of an access token that happens to be long; keep access-token lifetime short enough that immediate means immediate in practice.

### Password reset security

- Generate cryptographically secure, single-use reset token
- Store only a hash of the reset token server-side
- Give it a short expiration (e.g. 30 minutes)
- Return the same forgot-password response whether or not the email exists
- Invalidate token after use
- Do not let admins know or choose another user's password

### Account activation

When a person becomes a Cell Leader and has no account:

1. Require email.
2. Create/reuse the person's single account.
3. Send activation/set-password email.
4. User creates their own password.

One person has one account even if they lead multiple Cell Groups.

Assigning Cell leadership and provisioning an account are separately authorized. Where designating a person as a Cell Leader would trigger account creation, the actor must hold both the Cell-leadership capability and `accounts.manage` against that same target — mirroring the dual-authorization rule for archiving a Person who holds an active account (Account access at archive, below).

An actor authorized only to assign Cell leadership may record the leadership assignment, but must not thereby cause an account to be created or an activation email to be sent. The account step is left pending for an authorized actor and is separately audit logged (Section 21). Leadership assignment is never a back door into account provisioning.

### Account access at archive

Person lifecycle (Current/Archived, Section 3) and Account access status (e.g. Active/Disabled) are separate concepts. Account access must never be silently inferred from an archive reason.

When an authorized user archives a Person who has an active account, the workflow must explicitly surface the account-access decision:

- `Disable account access` — default selection
- `Keep account access` — requires explicit authorized selection

This decision must be audit logged (Section 21) regardless of which option is chosen — the decision itself is the auditable fact, not only its effect.

Restoring an archived Person to `CURRENT` must never automatically reactivate a disabled account. Reactivation is always a separate, explicit, authorized decision.

Both archiving a Person and changing account access are RBAC-controlled capabilities (Section 7). Completing an archive for a Person who holds an active account requires authorization for both the lifecycle change (`people.manage_lifecycle`) and the account-access change (`accounts.manage`), both scoped to that same target Person/account — an actor authorized for only one, or authorized for both but not against this same target, must not be able to complete the other by default.

Disabling account access must take effect immediately, not only block future logins — any active session for that account must be treated as no longer valid.

---

## 7. Authorization Model

Use:

```text
Identity + Permission + Pastoral Scope = Access
```

Do not equate hierarchy position with software permissions.

Example permissions may include:

- `people.view_subtree`
- `people.edit_basic`
- `people.manage_lifecycle`
- `people.manage_pastoral_assignment`
- `dcc.take_attendance`
- `dcc.view_subtree`
- `dcc.submit_on_behalf`
- `dcc.correct_subtree`
- `cell.take_attendance`
- `cell.view_subtree`
- `cell.submit_on_behalf`
- `cell.correct_subtree`
- `cell.manage_membership`
- `cell.manage_lifecycle`
- `reports.view_subtree`
- `records.backdate_effective_date`
- `accounts.manage`
- `roles.manage`
- `audit.view`

The API must check both permission and scope.

Senior Pastors have explicit church-wide scope across both networks.

Admins may have system-wide operational permissions even if they are not pastoral leaders.

### Scope of `people.edit_basic`

`people.edit_basic` covers corrections to a person's own descriptive fields only: first name, middle name, last name, birthday, and civil status.

It does not cover sex, Network, pastoral assignment, Cell membership, Cell leadership, lifecycle state, or account state. Each of those is governed by its own capability.

Sex is excluded deliberately. Sex determines Network under the homogeneous-network rule (Section 4), and Network determines which pastoral edges are legal (Section 5). If sex could be changed as an ordinary field edit, an actor could flip a person's Network and create a cross-Network pastoral edge without ever invoking `people.manage_pastoral_assignment`, bypassing the invariants in Section 5 entirely. Correcting a person's sex is handled as a Network-affecting correction (Section 4).

### Role catalog

Three roles exist. Each carries the default capabilities and scopes below. Anything beyond a role's defaults requires an explicit, Admin-issued grant, and is read-only unless a management capability is granted alongside it.

| Capability | Senior Pastor | Admin | Leader |
| --- | --- | --- | --- |
| `people.view_subtree` | Whole Church | Whole Church | own/subtree |
| `people.edit_basic` | Whole Church | Whole Church | own/subtree |
| `people.manage_lifecycle` | Whole Church | Whole Church | — |
| `people.manage_pastoral_assignment` | Whole Church | Whole Church | own/subtree |
| `dcc.take_attendance` | Whole Church | Whole Church | own/subtree |
| `dcc.view_subtree` | Whole Church | Whole Church | own/subtree |
| `dcc.submit_on_behalf` | Whole Church | Whole Church | own/subtree |
| `dcc.correct_subtree` | Whole Church | Whole Church | own/subtree |
| `cell.take_attendance` | Whole Church | Whole Church | own/subtree |
| `cell.view_subtree` | Whole Church | Whole Church | own/subtree |
| `cell.submit_on_behalf` | Whole Church | Whole Church | own/subtree |
| `cell.correct_subtree` | Whole Church | Whole Church | own/subtree |
| `cell.manage_membership` | Whole Church | Whole Church | own/subtree |
| `cell.manage_lifecycle` | Whole Church | Whole Church | own/subtree |
| `reports.view_subtree` | Whole Church | Whole Church | own/subtree |
| `audit.view` | Whole Church | Whole Church | — |
| `records.backdate_effective_date` | — | Whole Church | — |
| `accounts.manage` | — | Whole Church | — |
| `roles.manage` | — | Whole Church | — |
| Person Merge | — | Whole Church | — |

Four of these defaults are deliberate and must not be widened for convenience.

**Senior Pastors do not hold `roles.manage` or `accounts.manage`.** Granting permissions and administering accounts is Admin's operational responsibility; Senior Pastor and Admin are different responsibilities even where their visibility overlaps (Section 19). Keeping grant-making out of the Senior Pastor role means the two highest-visibility accounts in the church cannot escalate their own authority, and every permission change has a second party involved.

**Senior Pastors do not hold `records.backdate_effective_date`.** Backdating rewrites totals for periods already reported (Section 3) and is a data-correction operation, not a pastoral one.

**Senior Pastors do not perform Person Merge.** Section 3 already places it at Whole Church authorization as an Admin-level capability.

**Leaders do not hold `people.manage_lifecycle`.** Archiving reduces a leader's own People count, which is precisely the incentive Person Lifecycle guards against (Section 3). Archival is requested by a leader and performed by Admin or a Senior Pastor.

A role is a starting set, never a ceiling or a substitute for the checks themselves. The API still evaluates capability and scope on every request (Section 7, above); it never infers permission from a role name.

### Capability and Scope are independent grants

Authorization is expressed as two independent dimensions that combine to form Access:

- **Capability** — what an action a user may perform, e.g.:
  - view DCC reports
  - view Cell reports
  - view Cell Leader reports
  - view Network Summary
  - manage attendance
  - manage people
  - administer accounts/permissions
- **Scope** — what data a capability applies to, e.g.:
  - own/subtree
  - Men's Network
  - Women's Network
  - Whole Church

A capability without an explicit scope grant is not usable; a scope grant without an explicit capability grants nothing.

Senior Pastors (Bishop Oriel Ballano, Pastora Geraldine Ballano) receive Whole Church scope by role/policy, built in — this does not require a separate Admin-issued grant.

`people.manage_pastoral_assignment` is a management capability, not a reporting one. Admin holds it per explicit administrative permission. A leader holds it at own/subtree scope, over their own pastoral subtree only. Senior Pastors hold it at Whole Church scope and may therefore reassign within either Network. It is never conferred by a read-only reporting scope grant. The invariants governing its use are defined in Section 5, Changing a person's pastoral leader.

`records.backdate_effective_date` governs setting an effective date in the past on any effective-dated relationship: pastoral assignment (Section 5), Network (Section 4), Cell membership (Section 10), and Cell leadership (Section 11). It is Admin-only and always requires a reason. It is never granted to ordinary leaders, because backdating changes totals for periods that have already been reported (Section 3).

Being an Associate Pastor, or being part of a Senior Pastor's direct 12, does not by itself grant Whole Church or Network-level reporting scope. Pastoral hierarchy position and system authorization are separate concepts (Section 1, Principle 3). Any leader other than a Senior Pastor who needs reporting visibility beyond their own pastoral subtree must receive that scope through an explicit, Admin-issued grant.

Expanded reporting scope granted this way is read-only by default. It grants visibility into reports at the wider scope; it does not grant the ability to manage attendance, move people, change Cell assignments, or administer accounts outside the leader's normal authorized management scope, unless separate management-capability permissions are explicitly granted alongside it.

Example: an Associate Pastor may remain pastorally under Bishop Oriel while Admin separately grants DCC report visibility at Whole Church scope. This allows whole-church DCC report visibility. It does not allow that Associate Pastor to edit attendance, move people, change Cell assignments, or manage accounts outside their normal authorized management scope.

All permission and scope grants — creation, modification, and revocation — must be audit logged (Section 21).

The backend/API is the sole authority for authorization. Web and mobile UI filtering is never sufficient security on its own (Section 1, Principle 4).

---

## 8. People Search

Support searching for a specific person by name.

When an authorized user opens a person, show their pastoral path, for example:

```text
Oriel
  -> Raymond
       -> Mark
            -> Juan Dela Cruz
```

Search results and profile fields must respect authorization and pastoral scope.

### Church-wide search and duplicate prevention

Leaders may search the church-wide Person directory by name, primarily for identity resolution and duplicate prevention (see Section 3, Duplicate prevention).

For a person within the searching leader's authorized pastoral scope, return full profile fields as normally authorized.

For a person outside the searching leader's authorized pastoral scope, return only the minimum information necessary to identify a possible existing record:

- Member ID
- Full Name
- Sex
- Current Network
- Current Direct Leader's name

Do not expose, for a person outside the searching leader's pastoral scope:

- birthday / date of birth
- calculated age
- civil status
- DCC attendance, DCC history, or DCC classification
- Cell attendance, Cell history, or Cell classification
- Cell membership or Cell IDs
- reports
- account information
- complete pastoral/downline information

Selecting an existing person during a duplicate-resolution workflow reuses that Person record but must not automatically transfer pastoral ownership, Cell membership, or any other relationship. Any such transfer requires its own explicit, authorized action.

Senior Pastors retain authorized whole-church visibility across both Men's and Women's Networks per Section 4 and are not subject to the out-of-scope restriction above. Admin access follows explicit administrative permissions per Section 7.

---

## 9. DCC Attendance

Sidebar label: `DCC Attendance`.

DCC uses Blackboard-style checklist attendance.

### DCC calendar

DCC attendance follows the official church Sunday calendar. There is exactly one applicable DCC event per Sunday, church-wide — Men's Network and Women's Network attend the same DCC event. Special events, conferences, revival meetings, leadership meetings, or other gatherings do not automatically create additional DCC attendance events for this reporting domain.

Therefore a calendar month has 4 or 5 applicable DCC events, determined by the actual number of Sundays in that month — never an unexplained arbitrary limit.

### DCC has no meeting status

The three-status model in Section 13 is specific to Cell meetings and does not apply to DCC. `NOT_HELD` in particular has no DCC equivalent.

A Cell meeting is one leader's meeting, and only that leader can say whether it took place. DCC is a single church-wide service. Whether it happened is one fact about the whole church, known to church leadership, not something 140 leaders each report separately.

Where the church holds no service on a given Sunday — a calamity closing the building, or a Sunday absorbed into a conference — that Sunday simply carries no DCC event. The month then has one fewer applicable event, and every report follows automatically.

Removing a Sunday from the DCC calendar is a deliberate Admin action, never inferred from an absence of attendance records. It requires a reason, is audit logged (Section 21), and must be visible on any report covering that month, so that a month showing four events where the calendar shows five is explained rather than merely odd.

A leader who has not yet submitted their people's attendance for an event that did take place is a reporting gap, not a cancelled service. Those are tracked as coverage.

### DCC submission window

DCC attendance for a calendar month may be recorded or corrected until the 7th of the following month, at 23:59 Asia/Manila — the same close as Cell attendance (Section 13). After that the month is closed, and only Admin may amend it, using `records.backdate_effective_date` (Section 7), with a reason, audit logged, and surfaced in Network Summary as a correction.

DCC coverage is shaped differently from Cell coverage. A Cell has one leader and its coverage counts recorded meetings out of scheduled meetings. A DCC event is church-wide, and many leaders each submit for their own people, so DCC coverage counts **how many responsible leaders have submitted** for an event, not how many events exist.

Report that figure at every scope, as a single line, on the same terms as Cell coverage: factual, no ranking of leaders by it, and no derived score (Section 13).

Each attendance record must ultimately identify:

- person
- DCC event/date
- present state
- responsible leader/reporting scope
- actor who entered/submitted it
- timestamps/audit metadata

### DCC classification

Classification is derived from lifetime DCC attendance history:

- 1st DCC attendance -> `VIP`
- 2nd -> `2ND_TIMER`
- 3rd -> `3RD_TIMER`
- 4th -> `4TH_TIMER`
- 5th and beyond -> `REGULAR`

Do not let leaders manually maintain classification when it can be derived from attendance history.

### Adding a DCC VIP

When adding a VIP:

1. Search existing People first.
2. Reuse existing Person if matched.
3. Otherwise create one Person record using the core personal fields.
4. Record DCC attendance only.
5. Do not automatically create Cell attendance.

The Person becomes available to other authorized modules, but participation remains domain-specific.

### DCC monthly reporting

For a selected month, primary `TOTAL` means unique people who attended at least once in that scope/period.

Do not present a separate attendance-occurrence total as the primary pastoral KPI.

Provide two independent views of the same unique population:

#### Classification view

- VIP
- 2nd Timer
- 3rd Timer
- 4th Timer
- Regular
- Total unique people

Each person must appear in exactly one classification bucket for the report snapshot.

#### Monthly Attendance view

Classify each unique person by how many DCC services they attended that month:

For a 4-Sunday month:

- Once
- Twice
- Thrice
- Completed (4/4)

For a 5-Sunday month:

- Once
- Twice
- Thrice
- 4 Times
- Completed (5/5)

`Completed` always means attendance at every applicable DCC event for that calendar month — not always exactly four, and not an arbitrary reporting limit; it follows directly from the DCC calendar rule above.

All bucket counts must sum to the same unique total.

---

## 10. Cell Groups

A Cell Group is a first-class entity.

A Cell Group has only the required operational information:

- internal UUID
- human-readable system-generated Cell ID, e.g. `CELL-001842`
- leader
- category
- day schedule
- time schedule
- lifecycle state: `ACTIVE` or `CLOSED`

No Cell Name is required.

### Cell categories

Exactly:

- `YOUTH`
- `YOUNG_PRO`
- `COUPLE`

A Cell Leader can lead one or many Cell Groups. Never assume one Cell Leader = one Cell Group.

Example:

```text
Mark
  -> CELL-001842 / Youth
  -> CELL-002193 / Young Pro
  -> CELL-003104 / Couple
```

### Category changes

Cell category is editable over time, e.g. Youth -> Young Pro.

- Keep the same Cell ID.
- Preserve category history with effective dates.
- Historical reports must use the category valid at the time being reported.
- Audit category changes.

### Cell lifecycle

A Cell Group is `ACTIVE` or `CLOSED`. Every count of Cells, Cell Leaders, Cell categories, and Cell members means active Cells unless a report explicitly says otherwise.

#### Closing is declared, never inferred

No period of inactivity closes a Cell. Not three months of `NOT_HELD`, not three months of silence, not any threshold.

The reasoning is the same as for `NOT_HELD` itself (Section 13). A leader honestly declaring `NOT_HELD` through a difficult quarter is engaged and telling the truth; closing their Cell for it teaches them to record `HELD` instead. A leader who has reported nothing has told the system nothing, and inferring closure from silence asserts a fact on no evidence.

Automatic closure would also defeat two rules deliberately written elsewhere. Archiving a Person who leads a Cell is rejected until the Cell is resolved (Section 3); if Cells closed themselves, that decision about their members could be waited out instead of made. And Cell Leader is the qualification for a Leader account (Section 6), so an inferred closure could remove a real leader's system access while they are caring for a sick parent.

Prolonged inactivity is a signal worth surfacing to a person, and Section 15 requires it. It is never an instruction to the database.

#### Closure reasons

Exactly:

- `MULTIPLIED` — the Cell split into new Cells
- `MERGED_INTO_ANOTHER_CELL`
- `LEADER_STEPPED_DOWN` — with no replacement leader
- `MEMBERS_DISPERSED` — members moved away, graduated, or transferred
- `CREATED_IN_ERROR`
- `OTHER` — requires a note

`MULTIPLIED` is listed first deliberately. A Cell closing because it multiplied is the outcome the whole model exists to produce, and the reason list must not read as a list of failures (Section 1, Principle 7).

#### What closing does

Closing a Cell is an explicit, authorized, audited action carrying an effective date and a reason. The capability is `cell.manage_lifecycle` (Section 7), held by the Cell's current leader, any leader upline of them acting within their own authorized subtree, Admin, and Senior Pastors.

On closure, as one transaction:

- the Cell's state becomes `CLOSED` as of the effective date
- the active Cell leadership assignment ends on that date (Section 11)
- active memberships end on that date, preserving every membership record in full (Section 10, Managing Cell membership)

Members must be dealt with explicitly rather than silently. Present the Cell's current members at the point of closure, allow them to be assigned to another Cell in bulk, and allow them to be left unassigned by explicit choice. People left without a Cell appear in the attention list in Section 15. Closure is not blocked on reassigning them — `MEMBERS_DISPERSED` has nowhere to send them — but it must not complete without the decision being made and recorded.

A closed Cell keeps its Cell ID permanently. The ID is never reused, for the same reason a Member ID is not (Section 3).

Attendance already recorded against a closed Cell remains exactly as recorded, and historical reports for periods before the closure are unaffected. A Cell closed mid-month simply has fewer recorded meetings that month, and the denominator follows automatically (Section 12).

#### Reopening

A closed Cell is not reopened as an ordinary action. Where a ministry restarts, create a new Cell.

Reversing a closure recorded in error is an Admin correction requiring a reason and an audit entry, not a control available to a leader.

### Cell Membership

Cell membership is a distinct, explicit relationship from Cell Leadership (Section 11) and Cell Attendance (Section 12).

Model membership historically, e.g.:

```text
cell_memberships
- id
- person_id
- cell_id
- started_at
- ended_at nullable
- source/reason (optional)
```

A person currently belongs to a Cell when they have an active (not ended) Cell membership record for that Cell.

A Cell member is assigned to exactly one active Cell Group at a time. This is distinct from Cell Leadership: a Cell Leader may lead multiple Cell Groups (conducting different Cell meetings for different sets of people, Section 11), but an ordinary member's active assignment is always to a single Cell.

A person's Cell monthly attendance denominator (Section 12) is therefore determined only by the applicable meetings of that person's one assigned Cell Group — never combined across every Cell the same leader happens to lead. For example, if Mark leads CELL-001 (Youth) and CELL-002 (Young Pro), Juan — assigned to CELL-001 — is evaluated only against CELL-001's meetings; CELL-002's meetings are not part of Juan's denominator. Do not introduce a "primary Cell" concept — the single active assignment already defines this relationship.

Cell attendance does not automatically create or end Cell membership. Membership changes only through an explicit, authorized workflow. Attendance at a Cell other than a person's assigned Cell, if ever supported, must not automatically transfer their assignment or alter their monthly denominator.

### Managing Cell membership

The capability is `cell.manage_membership` (Section 7). It is held by:

- the Cell's current leader, over their own Cells
- any leader upline of that Cell's leader, acting within their own authorized pastoral subtree
- Admin
- Senior Pastors, at Whole Church scope, in either Network

A person has **at most one** active Cell membership. Zero is legitimate: a Person who attends DCC but belongs to no Cell, a newly encoded Person, and an archived Person all have none.

Moving a member from one Cell to another closes the current membership and opens the new one **within a single transaction**. It must never leave two open memberships, and never silently drop a person out of every Cell. Enforce with a uniqueness constraint over the person where `ended_at` is null, exactly as pastoral assignment does (Section 5).

The member and the Cell's leader must belong to the same Network, consistent with the homogeneous-network rule (Section 4). A Network change must not leave a person holding a membership the rule no longer permits; resolve both together or reject the change (Section 4).

Cell membership does not have to mirror pastoral assignment. A person may be pastorally under one leader and a member of another leader's Cell. These are separate relationships (Section 1, Principle 3), and neither one changes the other.

Archiving a Person ends their active Cell membership from the archive effective date, preserving the membership record in full. Restoring them does not automatically restore the membership; re-adding them to a Cell is a separate authorized action.

Every membership change is audit logged with actor, person, Cell, and effective date (Section 21).

Cell membership, like Cell Leadership and Cell category, must preserve history so that current and past membership can both be determined.

---

## 11. Cell Leadership

Do not model Cell Leader merely as a free-text role.

Prefer an explicit leadership assignment, e.g.:

```text
cell_leaderships
- id
- person_id
- cell_id
- started_at
- ended_at nullable
```

A person is a current Cell Leader when they have at least one active Cell leadership assignment on an `ACTIVE` Cell (Section 10). Closing a Cell ends its leadership assignment on the closure effective date; a leader whose only Cell closes is no longer a current Cell Leader from that date, and this is recorded rather than inferred.

The leadership assignment record itself is preserved in full. History shows that the person led that Cell for that period.

Cell Leader is the normal qualification for a standard Leader login account.

---

## 12. Cell Attendance

Sidebar label: `Cell Attendance`.

Cell Attendance uses the same familiar checklist UX as DCC but is a separate attendance domain.

DCC attendance and Cell attendance must never automatically create each other.

### Cell classification

Cell has its own independent classification journey:

- 1st Cell attendance -> VIP
- 2nd -> 2nd Timer
- 3rd -> 3rd Timer
- 4th -> 4th Timer
- 5th+ -> Regular

A person may therefore be DCC Regular and Cell 2nd Timer, or vice versa.

Unless church rules later state otherwise, treat Cell classification as a Cell-ministry attendance history rather than resetting a person simply because they attended a different Cell Group.

### Cell monthly reporting

Use the same two views as DCC:

#### Classification

- VIP
- 2nd Timer
- 3rd Timer
- 4th Timer
- Regular
- Total unique people

#### Monthly Attendance

Each Cell has exactly one logical scheduled Cell meeting per calendar week, per its configured schedule (Section 13). A Cell therefore has 4 or 5 **scheduled** meetings in a calendar month, determined the same way as the DCC calendar rule (Section 9).

Scheduled meetings are not the denominator. The denominator is the meetings that actually took place and were recorded:

```text
denominator = count of HELD + RESCHEDULED meetings
              for that person's assigned Cell, in that month
```

`NOT_HELD` meetings are excluded. Nobody can attend a meeting that did not take place, and counting one would mark every member of the Cell absent for something that never happened.

Unreported meetings are excluded. An unreported meeting is an absence of data, not a fact about attendance (Section 13). Treating silence as non-attendance penalises disciples for a record their leader has not yet submitted.

Because the denominator is derived per Cell per month, the buckets vary with it. For a denominator of N:

- Once
- Twice
- Thrice
- ... continuing to N-1
- Completed (N/N)
- Total unique people

A Cell whose October held five scheduled meetings, one of them `NOT_HELD`, reports against a denominator of 4, and its highest bucket is `Completed (4/4)`. Never label buckets from the calendar count.

`Completed` means the person attended every `HELD` or `RESCHEDULED` meeting of their assigned Cell (Section 10) recorded in the reporting month.

Every Cell monthly attendance view must show recording coverage beside the buckets, as a single line — for example `4 of 5 meetings recorded`. Coverage is never a bucket, and never a fourth status.

Coverage is what stops a thin record reading as a strong one. A Cell that records one meeting out of four and reports every attendee as `Completed (1/1)` is not a complete Cell, and the coverage line says so on the same screen, factually and without judgement.

When aggregating multiple Cells, deduplicate people with `COUNT(DISTINCT person_id)` so a person attending more than one Cell is not counted twice in the leader/network total.

---

## 13. Cell Meeting Status

Exactly three user-facing statuses exist:

- `HELD` — shown to users as **Met**
- `RESCHEDULED` — shown as **Moved**
- `NOT_HELD` — shown as **Did not meet**

Never add other statuses. Stored enum values must never appear in the interface. Use the plain-language labels above so wording cannot drift from screen to screen.

**`HELD`** — the meeting took place on its scheduled date. Attendance is recorded against it.

**`RESCHEDULED`** — the meeting took place, or is planned, on a date other than its scheduled one.

**`NOT_HELD`** — the responsible leader explicitly reports that the meeting did not take place and is not being made up. A reason is required. No attendance is recorded.

### NOT_HELD is declared, never inferred

No job, deadline, or process may convert an unreported meeting into `NOT_HELD`. An unreported meeting means the leader has not yet told the system what happened. It does not mean the meeting failed to occur. Writing `NOT_HELD` from silence records a fact nobody established, and creates a false record that must later be corrected.

An unreported meeting is therefore not a status at all. It is an outstanding task, shown to the responsible leader as a meeting awaiting a record, and reflected in reports only through the coverage figure (Section 12).

### Reasons for NOT_HELD

Exactly:

- `LEADER_UNAVAILABLE` — shown as **Leader could not be there**
- `WEATHER_OR_CALAMITY` — shown as **Weather or calamity**
- `HOLIDAY_OR_CHURCH_EVENT` — shown as **Holiday or church event**
- `NO_MEMBERS_AVAILABLE` — shown as **Members could not come**
- `OTHER` — shown as **Other**, and requires a note

The reason is required. The list is fixed and is not administrator-configurable: reasons that can be edited at runtime make reporting incomparable across periods. Adding a reason is a deliberate change to this specification. Review `OTHER` notes periodically, and promote a recurring one into the list on the evidence.

Reasons follow normal pastoral scope and are recorded in the audit log with the meeting.

### Leader present, nobody attended

If the leader was present and the meeting was available, the meeting is `HELD` with zero attendance. It counts in the denominator, and every member is recorded as not having attended. The opportunity existed, and that is the fact worth keeping.

`NO_MEMBERS_AVAILABLE` applies only where it was known in advance that no one could attend, so the meeting was not held. The interface must say so where the reason is chosen.

### Who conducted the meeting

Record `facilitated_by` on the meeting. It is nullable and defaults to the Cell's current leader.

Where a leader cannot conduct their own meeting and another person runs it — a disciple, or an upline leader — record that person as the facilitator. Three roles are distinct, and all three may differ on a single meeting:

- **responsible leader** — the Cell's current leader (Section 11); reporting rolls up to them
- **facilitator** — who conducted this meeting
- **submitter** — who entered the record (Section 14)

Facilitating is never leadership. It does not touch `cell_leaderships`, never makes the facilitator a current Cell Leader, never counts toward New Cell Leaders (Section 16), and never moves Cell members into the facilitator's counts. A genuine handover of a Cell is a separate, deliberate change to `cell_leaderships`. There is no threshold at which repeated facilitation becomes leadership.

### Submission window

Attendance for a calendar month may be recorded or corrected until the 7th of the following month, at 23:59 Asia/Manila (Section 20). After that the month is closed.

Once closed, unreported meetings remain permanently unreported and outside the denominator, and coverage for that month is frozen. Only Admin may amend a closed month, using `records.backdate_effective_date` (Section 7), with a reason, audit logged (Section 21), and surfaced in Network Summary as a correction (Section 16).

Before close, remind the responsible leader of any meeting still awaiting a record. Prompting a leader before the deadline is always preferable to labelling the gap after it.

For a rescheduled meeting, preserve:

- original scheduled date/time
- new scheduled date/time
- optional note/context
- who rescheduled it
- timestamp

A rescheduled meeting remains one logical meeting, not two separate meetings, and does not create an additional applicable meeting for that calendar week.

A `RESCHEDULED` Cell meeting remains associated with its original logical weekly meeting and its original reporting month, even when the new date falls in a different calendar month. Rescheduling changes the meeting's actual date/time, never its identity or which reporting period it belongs to. For example, a January 31 Cell meeting rescheduled to February 2 remains part of January's Cell meeting report and does not create an additional February meeting.

A `RESCHEDULED` meeting that ultimately does not take place may be changed to `NOT_HELD`, preserving both records.

### Meeting summary, and the ranking prohibition

The pastor-facing meeting summary reports, at any scope:

- Met (`HELD`)
- Moved (`RESCHEDULED`)
- Did not meet (`NOT_HELD`), with its reason breakdown
- Coverage, as a single line: recorded out of scheduled

```text
Total Meetings = Held + Rescheduled + Not Held
Coverage       = Total Meetings / Scheduled
```

Sorting and filtering are permitted. A leader may sort or filter any column within their authorized scope, and the system may offer attention lists such as Cells with meetings awaiting a record. Finding the Cells that need help is pastoral work.

Ranking is prohibited. Never present:

- rank positions of leaders or Cells, such as `#1 of 140` or `37th`
- any composite score summarising a leader — faithfulness rate, consistency score, compliance percentage
- an ordered leaderboard as a default or landing view
- value-laden encoding of meeting status, such as red/amber/green, cross marks, or `underperforming`
- side-by-side comparison of leaders who do not oversee one another, offered as a feature

The reason is practical as well as pastoral. `NOT_HELD` exists to obtain honest reporting of Cells that are not meeting. If declaring it places a leader at the bottom of a visible ranking, leaders will record `HELD` instead, and the signal the status was created to capture is lost. Ranking the measure destroys the measure.

This mirrors the existing treatment of `Cell Leaders with 12+ Members` (Section 16): show the number, never label the person.

"Scheduled" is a calendar concept (derived from a Cell's configured Day and Time against the calendar when needed, e.g. to calculate applicable meetings for Section 12), not a meeting status. Do not introduce `SCHEDULED` or any other value as a Cell meeting status.

---

## 14. Attendance Override / Report on Behalf

A higher authorized leader may take attendance on behalf of a downline leader within their pastoral subtree.

Conducting a meeting and reporting a meeting are separate facts, and this section governs only the second.

- **Conducting** on behalf is recorded as `facilitated_by` on the Cell meeting (Section 13). It describes who ran the meeting.
- **Reporting** on behalf is recorded as the submitter below. It describes who entered the record.

Neither concept extends to pastoral assignment. A reassignment records the actor only, and this is deliberate. Attendance carries a responsible leader because attendance rolls up to whose meeting it was, and that leader is a reporting dimension. A pastoral assignment has no equivalent: the assignment row is itself the fact, no report aggregates by "whose assignment this was", and a responsible-leader field would be written on every reassignment and read by nothing. The actor is recorded in the audit log (Section 21) and the movement is surfaced in Network Summary (Section 16), which is sufficient.

Either may happen without the other. A disciple may conduct a meeting that the Cell leader then reports; an upline leader may report a meeting the Cell leader conducted. Neither changes who the responsible leader is, and neither changes any leadership assignment.

Before submission, use language such as:

- `Take Attendance on Behalf`

For already-submitted attendance that requires correction, use:

- `Correct Attendance`

Preserve:

- responsible leader
- actual submitter/actor
- submission type
- original values
- corrected values
- optional/required correction reason as appropriate
- audit history

Never silently overwrite submitted attendance.

### Concurrent writes from different devices

Because the same record can be reached from several surfaces at once (Section 2), the rule above needs a mechanism rather than only an instruction.

Every attendance and meeting record carries a version. A client submits the version it read. If the stored version has since moved, the server rejects the write with a conflict and does not apply it.

A conflict is resolved by a person, never by the system. Present both values, with who recorded each and when, and let an authorized user decide. This is the same principle Person Merge applies to conflicting relationships (Section 3): where two legitimately different facts are in play, the system must not silently pick one.

For example: a leader records nine present on a phone, loses signal, and an upline leader records eight on behalf from a laptop in the meantime. When the phone reconnects, its submission is based on a version that no longer exists. Last write wins would discard the second record without trace, in breach of the rule above. The correct behaviour is to reject, surface both figures, and ask.

---

## 15. Cell Leaders Module

Sidebar label: `Cell Leaders`.

Purpose:

- show Cell Leaders in the current user's authorized scope
- show how many Cells each leader leads
- show Cell IDs, categories, schedules, and unique people
- drill into a leader and then into each Cell
- show classification and monthly attendance reports
- show Met / Moved / Did not meet counts and trends factually, with the reason breakdown and the coverage line (Section 13)
- show meetings conducted by someone other than the Cell leader, as a factual support signal, never as a score

### Cells needing attention

Surface Cells that have gone quiet, as a working list for the leader who oversees them:

- Cells with no meeting held for a configurable number of months, three by default
- Cells with meetings still awaiting a record (Section 13)
- People with no active Cell membership within the viewer's scope (Section 10)

Each entry offers the actions that resolve it — recording the missing meeting, confirming the Cell is still running, or closing it with a reason. The list detects; a person decides. Nothing on it changes any record on its own.

This is an attention list, not a ranking. It is filtered by a threshold, never sorted into an order of merit, and carries no score or colour grading (Section 13, Meeting summary and the ranking prohibition).

Because the threshold triggers a prompt rather than a state change, it can be tuned freely. Nothing irreversible depends on where it is set.

Because one leader can have multiple Cells, always distinguish:

- Cell Leaders
- Cell Groups
- Unique Cell People

Do not assume these counts are equal.

---

## 16. Network Summary Module

Sidebar label: `Network Summary`.

Do not add a separate sidebar link for leadership-development metrics. Put them inside Network Summary.

Recommended tabs:

- Overview
- Development
- Generations
- Tree

### Overview

Show, for the selected scope:

- Total People — distinct people in the pastoral subtree
- Direct Leaders
- Cell Leaders
- Cell Groups
- Cell Group categories:
  - Youth
  - Young Pro
  - Couple

### Development

Show:

1. DCC VIPs
2. Cell VIPs
3. Current Cell Leaders
4. New Cell Leaders for selected period
5. Cell Leaders with 12+ Members
6. Leaders with 12+ Direct Leaders

Every metric must support drill-down to the underlying people/leaders.

### DCC VIPs and Cell VIPs are reported separately

DCC and Cell are independent classification journeys (Section 12). A person may be a DCC VIP and a Cell Regular, or the reverse. Development therefore reports two distinct figures and never a single merged `VIPs` number:

- **DCC VIPs** — people whose first DCC attendance falls in the selected period
- **Cell VIPs** — people whose first Cell attendance falls in the selected period

A person may appear in both, and that is correct. Each figure counts unique people within its own domain (Section 20).

The two are kept apart because the pastoral follow-up differs. Someone who has attended a Cell but not yet a Sunday service needs an invitation to DCC; someone who has attended DCC but belongs to no Cell needs a Cell assignment. A merged total supports neither action without drilling down first, and choosing only one domain makes the other domain's newcomers invisible in Development.

Where a combined figure is genuinely wanted, present it in addition to the two, labelled `VIPs (DCC or Cell)`, and compute it as `COUNT(DISTINCT person_id)` across both. Never present it instead of the two.

### New Cell Leaders

Definition:

A person whose first qualifying Cell leadership started within the selected reporting period.

Do not use account creation date as the source of truth.

Store leadership start date/history.

### Cell Leaders with 12+ Members

Definition:

A current Cell Leader qualifies for `Cell Leaders with 12+ Members` when at least 12 distinct people currently belong (per Section 10, Cell Membership) to one or more Cell Groups led by that leader.

This metric is based on current Cell membership, not DCC attendance and not Cell attendance for a selected month.

If a leader has multiple Cells, deduplicate people across those Cells — count each person only once per leader, even if they belong to more than one Cell led by the same leader.

Use positive/factual wording such as:

- `Cell Leaders with 12+ Members`
- progress display such as `8 / 12`, `12 / 12`

Do not label leaders negatively for being below 12.

### Leaders with 12+ Direct Leaders

Definition:

A leader with at least 12 direct pastoral children who qualify as leaders.

Count direct leaders only. Do not include deeper descendants.

### Generations

Calculate actual hierarchy depth/counts dynamically.

Example:

- Direct Leaders
- Generation 2
- Generation 3
- Generation 4

Do not hard-code actual counts to 12, 144, 1728. Targets/capacity may be shown separately if explicitly requested.

### Tree

Provide interactive/collapsible pastoral hierarchy.

Desktop may use a visual tree. Mobile should prefer collapsible hierarchical navigation rather than an excessively wide graph.

### Participation

Add a Participation section under Network Summary (do not add a separate sidebar link). Participation reporting is based on actual attendance history:

- No DCC attendance in the last 3 months
- No Cell attendance in the last 3 months
- No DCC and no Cell attendance in the last 3 months
- The same three views for the last 6 months

Participation reporting looks back over a rolling window ending at the report's date (or a selected historical date), not a calendar-month bucket — this is a distinct meaning of "month" from DCC/Cell Monthly Attendance (Sections 9, 12), which is bucketed by calendar month. Document and label this distinction clearly wherever both appear.

Archived people and Person records absorbed into another via Merge are excluded from Participation reporting — they are not part of current counts (Section 3).

Use neutral/factual language throughout. Do not label people as ghost, inactive, failed, lost, bad, or other judgmental terminology (Section 1, Principle 7).

Reports must support authorized drill-down from Whole Church / Network / Leader to the actual people, consistent with every other Network Summary metric.

### Explaining changes in current totals

Network Summary must make material changes in current People totals explainable through historical movements and corrections, not silent number changes. Examples:

- New people
- Pastoral/Network transfers
- Archived records
- Restored records
- Duplicate merges/corrections
- Pastoral assignments performed by a Senior Pastor acting in the other Network

Senior Pastors may reassign within either Network (Section 5). When a Senior Pastor acts in a Network other than their own, the movement must be attributed to them by name, rather than appearing as an unexplained change in that Network's totals. The leader whose branch changed must be able to see who made the change and when. Reach that is visible is reach that can be reviewed.

---

## 17. Senior Pastor Reporting

Both Bishop Oriel Ballano and Pastora Geraldine Ballano can select:

- Whole Church
- Men's Network
- Women's Network
- Specific leader / subtree

They can drill down recursively:

```text
Whole Church
  -> Network
      -> Leader
          -> Downline Leader
              -> Cell
                  -> Person
```

### My 12 / Direct Leaders report

For any leader, support a Direct Leaders report. Do not build an Oriel-only special report; use the same recursive report engine scoped to the current selected leader.

For Senior Pastors this can present their direct 12.

Useful views include:

- DCC classification
- DCC monthly attendance
- Cell classification
- Cell monthly attendance
- Current Cell Leaders
- New Cell Leaders
- Cell Leaders with 12+ Members
- Leaders with 12+ Direct Leaders
- Cell Groups
- Unique people
- Met / Moved / Did not meet trends, with reason breakdown and coverage

Do not create competitive or judgmental rankings. Show factual comparisons and trends.

This applies to meeting status by name. Senior Pastor reporting is the widest scope in the system and therefore the place where a leaderboard is most tempting and most damaging. Leaders must never be ranked, scored, or colour-coded by `NOT_HELD`, by coverage, or by any figure derived from them. Sorting and filtering within an authorized scope remain permitted; see Section 13, Meeting summary and the ranking prohibition.

A month is provisional until it closes on the 7th of the following month (Section 13). Reports must indicate whether the period shown is open or closed, because an open month's coverage figure is still changing.

---

## 18. Monthly and Yearly Reporting

Senior Pastors can view January through December for a selected year.

Reports must support:

- Whole Church
- Men's Network
- Women's Network
- Specific leader/subtree

Monthly reports must be generated from underlying individual attendance and relationship data, not manually entered aggregate totals.

Historical reports must respect historical pastoral assignments and Cell category history where applicable.

---

## 19. Dashboard / Sidebar Guidance

### Leader sidebar

```text
Dashboard
My People
My Network
DCC Attendance
Cell Attendance
Cell Leaders
Network Summary
Search
```

Do not add Birthday as a sidebar item.

Birthday remains person data and is used to calculate age.

### Senior Pastor sidebar

Keep navigation similarly compact. Senior Pastors have whole-church scope for the same reporting modules.

### Admin dashboard

Admin focuses on platform operations:

- People management
- Networks / pastoral assignments
- DCC Attendance administration
- Cell Attendance administration
- Accounts
- Roles & Permissions
- Audit Logs
- System Settings

Senior Pastor and Admin are different responsibilities even when permissions overlap.

---

## 20. Reporting Semantics

### Time zone and period boundaries

All dates and reporting periods are computed in **Asia/Manila**, the church's local time zone. This is the single authority for every period boundary in the system, and determines:

- which calendar day a meeting or attendance record belongs to
- which Sunday a DCC event falls on (Section 9)
- which calendar week a Cell meeting belongs to (Section 13)
- which calendar month any period-based report covers (Sections 9, 12, 18)
- the moment a month closes for submission (Section 13)

Store timestamps in UTC. Convert to Asia/Manila whenever deriving a date, a week, or a month.

Never bucket a report directly by a raw UTC timestamp. A Cell meeting at 16:00 Saturday in Manila is 08:00 Saturday UTC and buckets correctly by accident, but a record written at 07:00 Monday in Manila is 23:00 Sunday UTC, and a report grouped in UTC places it in the wrong week and, at a month boundary, the wrong month. Historical reports would then disagree with what leaders actually recorded.

Asia/Manila observes no daylight saving time, so the offset is a constant +08:00. Do not hard-code `+8`. Use the named zone, so the system stays correct if that ever changes.

### Unique people

When a report says `Total People`, it means distinct people in the relevant scope and period.

Never inflate totals by summing the same person across multiple weeks or multiple Cells.

### Classification vs monthly attendance

These answer different questions:

Classification:

> Where is this person in their DCC or Cell attendance journey?

Monthly Attendance:

> How many applicable meetings/services did this person attend during this month?

Keep them separate in UI and data logic.

### Reconciliation

For a classification report:

```text
VIP + 2nd + 3rd + 4th + Regular = Total Unique People
```

For monthly attendance:

```text
Once + Twice + Thrice + 4 Times (if applicable) + Completed = Total Unique People
```

If reconciliation fails, treat it as a data/reporting integrity issue.

---

## 21. Audit Logging

Audit important actions, including:

- Person creation/update
- Pastoral leader transfer
- Network change
- Sex correction, and any Network change it causes
- Backdated effective date on any historical relationship, with reason
- Cell leadership assignment left with account provisioning pending
- Account creation/activation/disablement
- Role/permission changes
- Attendance submission on behalf
- Attendance corrections
- Cell creation
- Cell leader assignment
- Cell category change
- Cell reschedule
- Cell meeting declared Not Held, with reason
- Cell meeting facilitator recorded
- Cell membership added, moved, or ended
- Cell closed, with reason and the decision taken about its members
- Cell closure reversed by Admin, with reason
- DCC event removed from the calendar, with reason
- Person archive
- Person restore
- Person merge
- Account access decision at archive (Disable or Keep)
- Account reactivation

Record actor, target, action, timestamp, and relevant before/after values.

Audit logs should preserve facts without judgmental labels.

---

## 22. API Guidance

Recommended REST areas:

```text
/api/v1/auth
/api/v1/people
/api/v1/networks
/api/v1/leaders
/api/v1/cells
/api/v1/dcc
/api/v1/reports
/api/v1/search
```

Examples:

```text
POST /api/v1/auth/login
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
GET  /api/v1/auth/me

GET  /api/v1/people/{id}
GET  /api/v1/people/search
GET  /api/v1/people/{id}/pastoral-path

GET  /api/v1/network/my-tree
GET  /api/v1/leaders/{id}/children
GET  /api/v1/leaders/{id}/descendants
GET  /api/v1/leaders/{id}/summary

GET  /api/v1/dcc/events/{id}/roster
POST /api/v1/dcc/events/{id}/submit

GET  /api/v1/cells/{id}
GET  /api/v1/cells/{id}/members
GET  /api/v1/cells/{id}/meetings
POST /api/v1/cells/{id}/meetings/{meetingId}/submit

GET  /api/v1/reports/dcc/monthly
GET  /api/v1/reports/dcc/yearly
GET  /api/v1/reports/cells/monthly
GET  /api/v1/reports/cells/yearly
GET  /api/v1/reports/network-summary
```

Controllers/routes should delegate to authorization and application/domain services rather than containing SQL/business logic directly.

---

## 23. Offline / Mobile Readiness

Web UI must be responsive from the beginning. Leaders will use the web application on phones before any native app exists, so mobile is a current surface, not a future one (Section 2).

### Required from the first write endpoint

These are not deferred. They are cheap to design in and expensive to retrofit, and mobile-shaped usage begins on day one:

- **Client-generated idempotency keys on every write.** A leader recording attendance on an unreliable connection will retry, and a retry must never create a second record.
- **Version checks on every update**, so concurrent writes conflict rather than overwrite (Section 14).
- **Stable UUIDs**, generatable by the client, so a record drafted offline keeps its identity when it syncs.
- **Server-side validation on every sync path.** A client is never trusted to have validated anything.

### Deferred until required

- offline draft storage on the device
- background sync and queueing
- partial or delta synchronisation

Do not build offline complexity before it is needed. Do not make architectural choices that prevent it — in particular, never let the server assign an identity that the client needed before it could sync.

---

## 24. Security Baseline

- HTTPS everywhere
- Passwords hashed with a modern password hashing algorithm such as Argon2id or bcrypt
- Short-lived access tokens with a secure refresh strategy, sized for several concurrent devices per account (Section 6)
- Refresh tokens stored hashed, revocable individually and account-wide
- Server-side authorization
- Database not publicly exposed
- Input validation
- Parameterized queries / safe ORM usage
- Rate limiting for authentication and sensitive endpoints
- CORS restrictions
- Secure secrets/environment handling
- Automated backups
- Audit logging
- Least-privilege database/application credentials

Do not expose the entire church dataset to the browser and filter it client-side.

---

## 25. Coding-Agent Rules

When generating or reviewing code for this system:

1. Never bypass server-side pastoral-scope authorization.
2. Never duplicate Person records across ministry modules.
3. Never automatically copy DCC attendance into Cell attendance or vice versa.
4. Never store age as authoritative data; derive it from birthday.
5. Never add civil-status values beyond Single, Married, Widowed unless requirements explicitly change.
6. Never add sex values beyond Male and Female unless requirements explicitly change.
7. Never add Cell categories beyond Youth, Young Pro, Couple unless requirements explicitly change.
8. Never add Cell meeting statuses beyond Held and Rescheduled unless requirements explicitly change.
9. Never introduce negative/judgmental leader labels or analytics.
10. Never assume one Cell Leader has only one Cell.
11. Never count duplicate people twice when aggregating multiple Cells or branches.
12. Never count descendants as direct leaders.
13. Never use account creation date to determine when someone became a Cell Leader.
14. Never silently overwrite attendance, pastoral assignments, or Cell category history.
15. Never let frontend code be the sole authority for roles, permissions, scope, classifications, or report calculations.
16. Prefer derived reports from normalized source data over manually entered aggregate totals.
17. Keep infrastructure/provider-specific integrations behind adapters/interfaces where practical.
18. Preserve API versioning for future mobile clients.

---

## 26. Core Domain Summary

```text
CHURCH
  |
  +-- Men's Network
  +-- Women's Network

PERSON
  |
  +-- Pastoral Assignments -> hierarchical tree
  +-- Optional User Account
  +-- DCC Attendance History -> DCC classification
  +-- Cell Attendance History -> Cell classification
  +-- Cell Leadership Assignments -> 0..many Cells
  +-- Cell Membership -> 0..many Cells

CELL GROUP
  |
  +-- Cell ID
  +-- Leader
  +-- Youth / Young Pro / Couple
  +-- Day
  +-- Time
  +-- Members (current & historical)
  +-- Meetings
       +-- Held / Rescheduled / Not Held
       +-- Attendance

REPORTING
  |
  +-- DCC Classification
  +-- DCC Monthly Attendance
  +-- Cell Classification
  +-- Cell Monthly Attendance
  +-- Cell Leaders
  +-- Network Summary
       +-- Overview
       +-- Development
       +-- Generations
       +-- Tree
```

This specification is the architectural source of truth unless a later explicit church requirement changes a rule.
