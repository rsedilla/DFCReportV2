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
- **Migrations:** hand-written SQL files, applied in order by a runner held in the repository
- **Data access:** a typed query builder over the PostgreSQL driver, not an ORM
- **Frontend:** Next.js + TypeScript, as a pure client
- **Styling:** Tailwind CSS, in the web application only; its palette carries no judgement (Section 13)
- **UI components:** in the web application, headless primitives vendored into the repository; not a component framework carrying its own design system
- **API:** REST, versioned under `/api/v1`
- **Deployment:** containerized, portable across AWS, Hostinger/VPS, or another provider
- **Email:** provider abstraction; business logic must never depend directly on SES or any other provider
- **Redis / queues / workers:** add when needed, not required for the initial release

Two reasons decide the backend, and both come from requirements rather than taste.

**Authorization must be enforced structurally.** Section 7 makes the API the sole authority, and Section 22 sketches roughly forty endpoints, each needing a capability check and a scope check. NestJS guards make that declarative and reviewable in one line, and an endpoint that fails to declare a capability fails closed. On a team, the alternative — remembering to call a check inside every handler — erodes: the check is only as reliable as the least familiar developer writing the newest route.

**Mobile clients cannot be force-updated.** An installed app keeps calling `/api/v1` for months after the web client has moved on, and an iOS release passes through review before it can reach anyone. The API must therefore be deployable independently of the web application. If the API ships inside the web app, no web change can be released without redeploying the API that every phone depends on. Separate deployables is a requirement here, not a preference.

One reason decides the migration and data-access tooling, and it is the same reason.

**The constraints are the design.** Section 5 requires a partial unique index, a check constraint, and a constraint trigger that is `DEFERRABLE INITIALLY DEFERRED`, and every subtree query carries a `CYCLE` clause. No ORM models any of those. A tool that generates migrations by diffing a model against the database does not merely fail to create them — it proposes dropping what it cannot see, on every migration, forever. So the schema lives in hand-written SQL, and the query layer is a typed builder that composes SQL rather than hiding it.

The cost is accepted deliberately: table types are written and reviewed rather than generated, and the schema tests are what keep them honest.

**A component library may style, and may not judge.** The web application uses headless, accessible primitives — dialog, combobox, menu, tabs, date picker — vendored into the repository as source the team owns, rather than consumed as a versioned dependency with a look attached. Component frameworks that carry their own design system are deliberately not used **in the web application**. This says nothing about the native clients: their framework is not chosen, and a platform toolkit is a different question from a web component library. That ruling is open, and is indexed as open in `CLAUDE.md`.

The ordinary reason is that they bring a second styling engine, which duplicates and fights the first.

The reason that puts this in the specification rather than in somebody's preferences is the vocabulary they impose. Those frameworks express state as `error`, `success`, `warning` and `severity`, and hand that to every developer as the default way to render a figure.

What is forbidden is precise, and is worth stating precisely here so that nobody reads it as wider than it is. Section 13 forbids value-laden encoding **of meeting status**, red/amber/green named among the examples. Section 17 forbids leaders being ranked, scored **or colour-coded by `NOT_HELD`, by coverage, or by any figure derived from them**. Section 19 forbids a dashboard colour-grading leaders. Colour itself is not prohibited and is not a ranking — this application uses it for structure, hierarchy and legibility, and the palette that shipped with Tailwind does exactly that.

The collision is that those frameworks make the prohibited use the *easy* one. `severity="error"` on a Cell that reported `NOT_HELD` is a five-second change that reads as idiomatic in review. `NOT_HELD` exists so that a leader can report honestly that their Cell could not meet, and if declaring it paints their row red, leaders will record `HELD` instead — ranking the measure destroys the measure (Section 13). A toolkit whose defaults push against a rule this specification cares about has to be resisted on every screen, by everyone, indefinitely, so it is not adopted.

Accessibility is the other half of "headless". A dialog that traps focus, or a menu that cannot be dismissed from a keyboard, is not a styling defect and is not fixed by a stylesheet, and building those behaviours by hand is where the defects come from. The web application conforms to **WCAG 2.2 Level AA** (Section 23, Accessibility), so the primitives are chosen for whether they meet it rather than for how they look.

### The frontend is a client, like the phones

The Next.js application contains **no API routes and no server actions**. It consumes `/api/v1` exactly as the Android and iOS apps will.

Any logic placed in the web application is logic the mobile apps do not have. Core business rules live in the backend domain layer so that all three surfaces behave identically — and so that a rule fixed once is fixed everywhere.

If this boundary proves hard to hold, replace Next.js with a plain React SPA, which removes the option entirely. The framework matters less than the boundary.

### Three surfaces, used together

Desktop web, mobile web, and the native apps are used concurrently, by the same people and by different people against the same records. Mobile web is the bridge: leaders will open the web application on their phones long before a native app exists, so responsive design is an immediate requirement rather than preparation for the future.

The API must therefore be stateless, must support several concurrent sessions per account (Section 6), and must detect write conflicts rather than resolving them silently (Sections 14 and 23).

### Scale

Sized against the church as it stands, not a hypothetical:

- roughly **800 active Cell Groups**
- **3,000 to 4,000 people** attending DCC each Sunday, face to face
- on the order of **10,000 to 15,000 Person records** once members, DCC-only attendees, and archived records are counted
- roughly **3,400 Cell meetings** and **50,000 attendance records per month**, around 600,000 a year

This is a small database. Three million attendance rows after five years is unremarkable for PostgreSQL on a modest instance, and the write pattern is gentle: a few hundred DCC submissions spread across Sunday evening, and around 800 Cell submissions across a week.

**Do not design for a scale problem that does not exist.** Principle 13 stands — a modular monolith, with no service extraction, sharding, or general caching layer introduced without a demonstrated need. Storing closed-month reports is not such a layer: those figures are stable by rule (Section 13) rather than merely assumed to be, and the need is demonstrated below.

Two consequences do follow from these figures, and both are requirements rather than optimisations:

- Reports for closed months are materialized (Section 20). A live whole-church aggregate over a month of attendance, recomputed on every drill-down, is slow enough to be felt.
- The indexes reporting depends on exist in the **first** migration, not once somebody complains: attendance by event and person, attendance by person and date, and pastoral assignment by leader for subtree traversal.

Design headroom for two to three times these figures. The church is growing toward a larger structure, and the tree is arbitrary-depth by rule (Principle 11) precisely so that growth never requires a schema change.

### Modules

Principle 13 requires a modular monolith. These are the modules, and the list is not advisory — a monolith with no named seams is just a monolith, and the option to extract a service later exists only if the seams were drawn at the start.

| Module | Owns |
| --- | --- |
| `people` | Person, Member ID, lifecycle, duplicate matching, merge |
| `networks` | Network assignment and its history |
| `hierarchy` | Pastoral assignments, subtree resolution, the Section 5 invariants |
| `auth` | Accounts, tokens, sessions, the capability and scope guard |
| `cells` | Cells, categories, schedules, membership, leadership, the creation workflow |
| `attendance` | DCC events and attendance, Cell meetings and attendance, the submission window |
| `reporting` | Classification, monthly attendance, coverage, Network Summary, stored figures |
| `audit` | The audit log |
| `admin` | Settings, the initial-encoding phase, administrative operations |

**A module owns its tables.** No other module reads or writes them directly. Cross-module access goes through the owning module's service interface, never through its repository or its tables.

This is what makes "enforced in the domain layer" a statement rather than a hope. The five pastoral-assignment invariants (Section 5) have exactly one place to live because `hierarchy` is the only writer of `pastoral_assignments`. Where four modules write a table, an invariant needs checking in four places, and the fourth is the one somebody forgets — which is also why those invariants carry database constraints as a backstop.

Organise by module, never by layer. A `controllers/`, `services/`, `entities/` layout spreads every feature across four folders and gives no boundary anything can be enforced on.

**That rule is about how the application is divided into modules, and reaches no further.** How one module arranges its own files is a judgement for whoever writes it: the boundary this section cares about is the module's, and it is enforced by table ownership rather than by filenames. A module holding a service for its reads alongside services for its operations breaks nothing here, because none of them can touch a table the module does not own.

Stated because the rule reads as though it governs every seam, and the first module large enough to need dividing — `people`, split into five services in Stage 2 — had no way to answer from this section whether a read/write seam was permitted. The answer is that this section does not ask. What it forbids is a *module* that is a layer, which is the arrangement that leaves an invariant with four homes and no owner.

### Initial data load

The church already exists. Roughly 800 Cells are running under an established leadership structure, and the system's first task is to record what is already there rather than to govern what gets created. Initial encoding is a distinct phase with its own rules.

The two halves of the data live in different places and are loaded differently.

**The leadership tree is known centrally and is small.** The Senior Pastors, their direct leaders, and the leaders below them number in the low thousands. Admin imports it: names, sex, and each person's direct leader. Network follows from sex (Section 4). Every pastoral assignment created this way takes an effective date of the encoding date, exactly as Section 4 requires for initial Network assignment. Do not fabricate historical dates for relationships that predate the system.

**Cell members are known only to their own leaders.** Nobody holds a central, current list of every member of every Cell. Each Cell Leader encodes their own members once they have an account. This is slower than a central import and considerably more accurate, and it doubles as the leader's first real use of the application.

The sequence matters. The tree must exist before leaders can be assigned, accounts provisioned, or Cells attached in the right place.

**Admin creates the initial Cells and their leadership assignments.** A leader cannot create their own first Cell: an account is provisioned when a person becomes a Cell Leader (Section 6), and a person becomes a Cell Leader only through an active leadership assignment on an existing Cell (Section 11). Admin therefore creates the Cell and the leadership assignment directly, exercising `cell.approve_creation` and `cell.manage_leadership` at Whole Church scope, which is also what allows the leader's account to be provisioned. During initial encoding there is nothing to request, because the Cells already exist and are not in dispute; approval is not bypassed, since Admin is the approver.

One rule is relaxed for this phase: **the request step is skipped**, and Admin creates Cells directly (Section 10). Approval is not bypassed, since Admin is the approver.

**Initial encoding ends by a deliberate, audited Admin action, and ends once.** The phase flag is held under `settings.manage` (Section 7). While it is open, the direct-create path is available. Once closed, that path is gone and every new Cell goes through request-and-approve. The transition records actor and timestamp (Section 21).

A relaxation attached to a phase with no defined end is a permanent relaxation. The flag is what makes this one temporary, so it is a required part of the design rather than an operational detail.

Everything else holds, and three points are stated because they are where a bulk load is most likely to go wrong.

**Imports execute through the domain services, never as direct database writes.** Every pastoral assignment created by an import is subject to the full set of Section 5 invariants: both endpoints in scope, no cycles, at most one active assignment, no self-assignment, and the same-Network edge. A spreadsheet of a leadership tree is the most likely source of a cycle this system will ever see, and Section 5 says plainly that a script written straight against the database bypasses every service-layer check. The partial unique index and the same-Network constraint trigger must exist **before** the import runs, per the migration policy in `CLAUDE.md`.

**Every record carries its own audit entry.** Admin is the actor on all of them, but a single entry for an import touching thousands of Persons and assignments records no target and no before-and-after values, which Section 21 requires. Write per-record entries linked by an import batch identifier.

**Duplicate matching runs as a separate pass, not inline.** Section 3 fixes two bounds: the system never merges automatically and never blocks creation, and a Tier 1 candidate requires a person to acknowledge it before a new Person is created. An unattended import has nobody present at each row, so it can satisfy neither bound inline. Import therefore runs in two phases: a dry run that produces a candidate report, human adjudication of what it finds, and only then a commit. A large encoding effort spread across many hands is the most likely source of duplicate Person records this system will ever see, and this is the phase where the matcher earns its keep.

Member IDs are assigned by the server from the sequence. Nothing is backdated.

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
- Mobile Number — optional

```text
persons
- id                  UUID, may be client-generated (Two identifiers, below)
- member_id           M-000000, server-assigned, immutable, never reused
- first_name
- middle_name         nullable
- last_name
- birth_date
- sex                 MALE | FEMALE
- civil_status        SINGLE | MARRIED | WIDOWED
- mobile_number       nullable
- merged_into_id      nullable, set where this Person was absorbed by a merge
- created_at
- updated_at
```

Lifecycle, Network, pastoral assignment, Cell membership and Cell leadership are not columns here. Each is effective-dated in its own table, because each carries history the specification guarantees (Section 26).

### Contact information

The mobile number is the only contact detail the system holds, and it is the primary means of reaching a person.

**No email address on a Person.** Email exists solely as a login credential on an Account (Section 6), where it is required and unique. It is deliberately not personal information, and must not be added as one. Most people in the church never hold an account; making an email mandatory would stall the VIP registration workflow (Section 9), and a mandatory field that people cannot fill is filled with fictions, which corrupts both the data and duplicate matching.

Keeping the two apart also closes an escalation path. Every leader holds `people.edit_basic` within their subtree (Section 7). If the login email were an editable Person field, a leader could change a downline leader's email to one they control, trigger a password reset, and take over the account. The mobile number carries no such risk because it authenticates nothing.

**No messaging handles.** Do not store Messenger, Viber, WhatsApp, or similar identifiers. They change often, they are held inconsistently, and a mobile number already reaches the same person. Following someone up is the leader's pastoral responsibility, and the system's job is to hold the number, not the conversation.

**Optional, not required.** A first-time visitor may decline to give a number, and a required field would be satisfied with a fabricated one. Prompt for it clearly when a Person is created, particularly when adding a DCC VIP (Section 9), and leave it empty when it is genuinely not given.

Store a normalized form suitable for dialling alongside the value as entered. Validate loosely: family abroad, visitors, and landlines all produce numbers that do not match a local mobile pattern, and rejecting them loses real contact detail for no benefit.

A mobile number is ordinary descriptive information, editable under `people.edit_basic` (Section 7). It is not visible outside the viewer's pastoral scope (Section 8).

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

**A sex mismatch annotates a candidate; it does not lower its tier.** The Tier 1 conditions above carry no sex term, and demoting on a mismatch would take the acknowledgement requirement off exactly the candidates most likely to be one person recorded twice — same name, same birthday, sex entered wrong. The discrepancy travels with the candidate so that the person deciding sees it and weighs it. A differing suffix is treated the same way, and for the same reason.

**A matching mobile number is a strong signal, but never sufficient alone.** Households share numbers, and a minor is commonly recorded with a parent's number, so two different people legitimately holding the same number is normal rather than exceptional. Treat a matching number with an equal last name as Tier 2, and with equal first and last names as Tier 1. Never treat a number alone as a match, and never block creation on one.

**Middle name absence never counts against a match.** It is optional (above) and is frequently left blank.

**A woman's last name may change on marriage.** Where last names differ, birthday together with first name remains a Tier 2 signal on its own. Do not require surname equality.

**Tier 2 candidates need somewhere to appear.** A creation workflow can only ever refuse on Tier 1, so if candidates were surfaced only at the moment of creation, every Tier 2 match would be computed and discarded. They are presented before creation instead, by a pre-flight lookup the encoder makes with the details they have so far — which is also what Section 9 asks for as the first step of registering a VIP: search existing People first.

That lookup reads the whole directory, as Section 8's church-wide search does and for the same reason. What it may say about a candidate depends on whether that candidate is inside the viewer's pastoral scope, and the rule has two parts — of which the first is the one that is easy to get wrong.

**Which candidates appear.** A candidate outside the viewer's scope is surfaced only if they would **still** have matched a subject carrying nothing Section 8 protects — no birthday, no mobile number. Membership out of scope is therefore a function of the names and sex alone.

The test is whether a publishable rule *would* have matched, not which rule actually won. Someone matching on both their names and their birthday is classified by the stronger rule, which reads the birthday — but their presence is already explained by the names, so hiding them protects nothing and loses a real candidate.

This is not a refinement of the field rule below, it is the load-bearing half. **Membership of the list is itself a disclosure**: submit a first name that matches nobody and a surname Section 8 already makes readable, and the only rule that can fire is the one comparing birthdays — so "this person is in the result" *is* "their birthday equals the value I submitted", answered identically every time and writing nothing. No redaction of the returned object reaches that, because the object is not where the answer is.

**What an appearing candidate carries.** In scope, the tier and the reasons it matched. Out of scope, neither. The reasons name the field, and the tier is derived from which rule fired — with an equal first and last name, Tier 1 means the birthday matched and Tier 2 means it did not, so returning the tier church-wide is the same oracle one step removed.

Both parts apply wherever candidates are returned, including the refusal that asks for a Tier 1 acknowledgement.

**Only a candidate the viewer can be shown in full may gate creation**, which means one inside their pastoral scope. Two reasons, and the second is the one that is easy to miss.

An out-of-scope Tier 1 candidate cannot be shown with its tier or reasons, so refusing on one would answer "acknowledge this" with nothing to acknowledge, leaving that Person impossible to create at all — a worse failure than the duplicate, and what this section means by never blocking creation.

And the refusal itself is a channel. Every Tier 1 rule reads a birthday or a mobile number, so gating on an out-of-scope candidate would make the response vary — refused against created — with a value Section 8 protects. That is the same disclosure as the candidate list, one field further out.

**The cost is real and is accepted here rather than discovered later.** A cross-branch duplicate whose match rests on a birthday — the woman whose surname changed on marriage is the case this section names — is no longer surfaced to a leader outside her branch. It is still surfaced to the leader who holds her, and to Admin and the Senior Pastors at Whole Church scope, which is where a merge is authorized from in any case (Section 3, Person Merge).

Thresholds and edit distances must be calibrated against real data rather than fixed here. Log the candidates shown and what the user chose, and revisit the rules once there is enough history to see what the matcher is missing and what it is over-reporting.

### Person Lifecycle (Current / Archived)

A Person must not normally be hard-deleted merely to reduce a leader's current People count. Every Person has a lifecycle state:

- `CURRENT`
- `ARCHIVED`

Archiving removes the Person from applicable current-network totals from the effective archive date forward, but must preserve their historical identity, attendance, pastoral relationships, Cell relationships, and audit history in full.

A real Person who has stopped attending must not automatically be archived. Lack of recent attendance is a participation/reporting concern (Section 16, Participation), not identity deletion.

An archived Person can be restored to `CURRENT`. Archiving and restoring must be recorded as historical events, not merely toggled, so that Network Summary can show and explain when and why a Person's status changed (Section 16).

Lifecycle is therefore effective-dated, not a column:

```text
person_lifecycle
- id
- person_id
- state              CURRENT | ARCHIVED
- reason             nullable, from the archive reason list above
- note               nullable, required where reason is OTHER
- actor_id
- started_at
- ended_at           nullable
```

A `lifecycle_state` column on the Person plus audit rows satisfies every sentence above and still cannot answer "who was `CURRENT` on 31 March". An audit log is a log, not a queryable as-of source: it is not indexed for the question, it is archived off in time, and reconstructing state by replaying it is exactly what this table exists to avoid. Without the table the reproducibility guarantee below is a hope; with it, the guarantee is a query.

Historical reports must remain reproducible: a report for a past period reflects each Person's lifecycle state as it stood at that time, not their current state. Archiving someone today must never change the total shown for a period before their archive date, no matter when the report is re-run. Classification and monthly-attendance reports (DCC, Cell) are period-based and never filtered by current lifecycle state, for any period including the present one. Only current-state inventory metrics (Total People, Current Cell Leaders, Cell Groups, Cell Leaders with 12+ Members, Participation) reflect lifecycle state, and only as of the period being reported.

"New Cell Leaders for a selected period" (Section 16) is period-based like attendance reporting and is not affected by a leader's later archival. "Leaders with 12+ Direct Leaders" (Section 16) is a current-state snapshot and does reflect current lifecycle state, for both the leader and the counted direct leaders.

Archive reasons must use neutral, operational language — never judgmental concepts such as "for cause," "disciplined," "bad leader," or similar. Use:

- `NO_LONGER_IN_CURRENT_NETWORK`
- `RECORD_CREATED_IN_ERROR` — for a genuinely erroneous individual record, not a duplicate
- `OTHER` — requires a note

Duplicate Person records must be corrected through Person Merge (below), never through ordinary archiving with `RECORD_CREATED_IN_ERROR`.

Archiving and restoring are RBAC-controlled capabilities (Section 7). Ordinary leaders do not have unrestricted authority to archive people.

### Archiving a Person who leads a Cell

A Person holding an active Cell leadership assignment (Section 11) cannot be archived while that assignment stands. The archive is rejected, naming what must be resolved first — for example, that the Person leads `CELL-000482`, which has nine members.

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

Because a merge is effectively irreversible, cross-entity, and can affect more than one leader's or Network's data, Person Merge requires the `people.merge` capability at Whole Church scope (Section 7). It is Admin-only, is not held by Senior Pastors, is never an ordinary leader action, and requires an explicit reason. There is no "undo merge" capability; an incorrect merge must be corrected manually and deliberately, not automatically reversed.

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

Network is assigned automatically from sex, according to the homogeneous-network rule, and is displayed on the form while the Person is being encoded. Store the resulting relationship explicitly rather than deriving it on every query.

It is assigned rather than proposed for confirmation. Under the homogeneous-network rule the mapping is total, so a confirmation step asks the encoder to approve a tautology, and confirmations of tautologies are clicked without being read. The field that can genuinely be wrong is sex, which the encoder is entering at that moment, so the Network is shown beside it rather than behind a second click.

A sex recorded in error is corrected through the audited Network-change path (Correcting a person's sex, below), which is the proper remedy and leaves a trail that a silent confirmation click would not.

### Network assignment history

```text
network_assignments
- id
- person_id
- network            MENS | WOMENS
- reason             nullable, for a correction
- actor_id
- started_at
- ended_at           nullable
```

A `network` column on the Person cannot answer which Network someone belonged to during a past month, and every Network-scoped report for a closed period depends on that answer.

A person's network relationship must be preserved historically (effective-dated), the same way pastoral assignments and Cell category are, so that Network-scoped reports remain accurate for past periods even if a person's network is later corrected or changed.

For Version 1, a person's initial network assignment becomes effective on the date/time the Person is encoded/created in the new system. Do not attempt to reconstruct or infer network history from before the person was encoded, and do not fabricate legacy network-change dates. The system is authoritative for network history from each person's encoding date forward; subsequent network changes must preserve their actual effective history from that point on.

### Correcting a person's sex

A person's recorded sex may be corrected — most often an ordinary data-entry fix. Because sex determines Network, this is never an ordinary field edit and is explicitly outside `people.edit_basic` (Section 7).

Correcting sex is an explicit, authorized, audited operation, governed by `people.correct_sex` (Section 7). It is Admin-only at Whole Church scope, and no other role holds it. Where the correction changes the person's Network, it is carried out as a Network change: the current Network assignment is closed and a new one opened, effective-dated, preserving history exactly as any other Network change does. Never re-derive Network silently from the new sex value.

**A correction always carries a reason.** The `reason` column on `network_assignments` is nullable because an initial assignment has nothing to explain; a correction is the case it exists for. The reason is required by the operation, is written to the Network row, and appears in the audit entries the correction produces (Section 21).

**A correction that changes nothing is refused as malformed input.** Sex has two values and the Network mapping is total, so a submitted sex equal to the recorded one is the only way for a correction to change neither. It answers `VALIDATION_FAILED` (Section 22) rather than succeeding silently: the operation demands a reason and writes an audit trail, and an audited correction that corrected nothing is a record that misleads whoever reads it later. A client that lost the response to a real correction recovers it by retrying with the same `Idempotency-Key`, which is what that header is for — not by resubmitting a value that is already in force.

**An archived Person's sex may be corrected only where no reassignment is forced.** Section 5 forbids reassigning an archived Person, and the atomic pair below *is* a reassignment, so a correction for an archived Person who still holds an open pastoral edge is refused: restore them first, which is an explicit and separately audited decision. Where they hold no open edge — the ordinary state after archival — nothing is stranded and the Network change stands alone, so the correction proceeds. A data correction on an archived record is legitimate; re-parenting one is not.

A Network change must never leave a person under a pastoral leader in their former Network. If the person has an active pastoral assignment that the change would render cross-Network, the Network change and the corresponding pastoral reassignment must be performed together as a single atomic operation — neither can validly precede the other, since each alone leaves the tree in an invalid state. The system must reject a Network change submitted without the reassignment it requires, and must never silently drop the person's pastoral assignment to resolve the conflict.

**The two carry one effective instant, and it is the same instant.** The closing of the old Network row, the opening of the new one, the closing of the old pastoral assignment and the opening of the new one all take an identical timestamp, stamped once by the API and written to all four rows.

This is not a tidiness preference. The old edge is legal for every moment up to the change and illegal from the change onward, so the only moment at which it can be closed without ever having been invalid is the exact instant the new Network takes force. The same-Network check on a Network change looks at edges open at the effective date or beginning after it (Section 5, Database enforcement); an edge closed at exactly that instant is neither, and passes. An edge closed a microsecond later is open at it, is compared with the corrected Network already in force on one end and the old one on the other, and is rejected — which is correct, because for that microsecond it genuinely was a cross-Network edge.

So the schema permits the atomic operation at one instant and at no other. Stated here because the failure mode of leaving it unwritten is specific and bad: an implementer meets a constraint violation, reads it as the timestamps being too close together, and separates them — which does not fix the write, and if the check were ever loosened to admit it would open the gap this rule exists to close.

**A Network root's sex is not corrected through this path.** Section 5 gives each Network exactly one root, says a root cannot be reassigned by anyone including Admin, and calls changing who holds a root position a deliberate Network-level decision rather than a pastoral one. Moving a root between Networks here would leave one Network with no root and the other with two, which no rule permits and nothing else would refuse. The correction is rejected before the disciple refusal below, so that a root — who by construction leads people — is refused for the reason that actually applies.

**A Network change is refused while the person leads anyone.** If the person holds any open pastoral assignment as the **leader**, the change is rejected, naming the disciples that must be moved first. Each is then moved by an ordinary, separately authorized, separately audited reassignment (Section 5), and the Network change is attempted again once none remains.

This is the rule Section 3 already applies to archiving a Person who leads a Cell, and the one this section states for a Network change that would orphan a pastoral edge: reject and require the conflict to be resolved, rather than resolving it silently. Where a leader's twelve disciples must each find a new leader, that is twelve pastoral decisions, and the alternatives were to have an administrator supply twelve destinations inside one correction payload or to have the system choose them by rule. Both put a pastoral judgement inside a data-correction form.

It also removes the need for the correction itself to carry more than one reassignment. With no open downline edge left, the only edge the change must resolve is the person's own, which is the single atomic pair described above.

**This one is a domain-layer rule and the database cannot hold it.** The same-Network trigger is `DEFERRABLE INITIALLY DEFERRED` and therefore sees only the state at commit, so a transaction that closes a disciple's edge, opens their replacement, and performs the correction all at once commits legally — the schema still permits exactly the combined operation this rule forbids. The refusal is a precondition on the state the request arrives in, which no constraint can observe. It is enforced in `networks`, tested at the API layer, and named here so that nobody reads the passing constraint as agreement.

**The two sides would have taken different destinations, which is why doing them separately is also clearer.** The person being corrected moves to a leader in their **new** Network — they are the one whose Network is changing, and the trigger compares their replacement edge against the corrected value already in force. A disciple moves within their **own, unchanged** Network, because nothing about them has changed. Those are two different rules, applied by two different people at two different times, and running them through one endpoint invited applying one rule to both.

**A backdated correction reaches only as far as it can be made legal.** Where `records.backdate_effective_date` (Section 7) is used to give the correction an effective date in the past, that date must be **strictly later** than the latest of:

- the `started_at` of the person's current pastoral assignment;
- the `ended_at` of every already-closed assignment touching them, **in either direction**.

**Strictly later, not "at or after", and the difference is a real failure rather than pedantry.** Both bounds break at exact equality, for the same underlying reason: at the instant a row starts or ends, the corrected Network is already the one in force, so a comparison made at that instant sees the new value on one end of an edge and the unchanged value on the other.

- At `eff` equal to the current assignment's `started_at`, the atomic pair closes that assignment at its own start. The resulting zero-length row is re-validated on the closing write and compared at that timestamp, where the person already resolves to the corrected Network while their old leader does not. The assignment was cross-Network for the whole of its life under the corrected value, so there is no instant at which it can honestly be closed.
- At `eff` equal to the `ended_at` of a zero-length closed edge, the same happens on the Network side. The edge is selected and compared at its own timestamp, where the person resolves to the corrected Network. Being closed, it cannot be reassigned.

One instant later, both pass: the old row still covers the comparison instant, both ends resolve to the old Network, and the edge was legal for every moment it existed.

The reason there is a limit at all is that the remedy runs out. The check reaches forward from the effective date, so a correction backdated into a period the person has since left strands an assignment that closed before today: it must be reassigned to satisfy Section 5, and it cannot be, because a period that has already ended cannot be given a different leader without rewriting a closed row — which Principle 12 and Section 5 both forbid. There is no legal write that resolves it, so permitting the attempt would mean permitting a failure with no remedy to offer.

**The limit covers both directions because the check does.** The same-Network check on a Network change considers every edge touching the person as a person *and* as a leader (Section 5, Database enforcement). A closed edge on which they were the leader, ended after the effective date, has exactly the problem above and involves no row of their own — so a floor bounding only their own assignment would leave it unreachable.

Open downline edges need no term of their own, because the rule above has already refused the change while any exists. That is deliberate: a floor carrying a term that can never bind reads as though it were doing work.

The case that term used to cover is worth keeping, because it is why the refusal has to be unconditional rather than date-aware. An open edge on which the person is the leader and which **began after** the effective date cannot be resolved at all: closing it at the effective date is impossible, since that precedes its own `started_at`, and closing it at its own start leaves it beginning after the effective date, so it is still selected and still compared. The refusal therefore reaches every open leader-side assignment whatever its dates, and a narrower rule that only refused edges overlapping the effective date would let this one through.

Each term is a maximum over rows that may be empty, and an empty term contributes nothing. A Person encoded but not yet assigned has no rows at all, so their floor is unbounded and a correction may be backdated freely — there are no edges to strand.

The floor's second term is written over **edges**, which are rows with a leader, so a Network root's own row never enters it: a row with a null `leader_id` is passed without comparison by the same-Network trigger and can never be an edge the correction has to strand.

**A correction may not be dated at or before the moment the Network it corrects took effect.** This is separate from the floor above and is not one of its terms: it bounds the Network row rather than the pastoral edges. At that instant the correction would close the live Network row at its own `started_at`, and Section 5 makes such a row inert — no instant resolves to it — so the period the person spent in their former Network would disappear from every as-of query, and every past-period Network-scoped report for them would move, with nothing raised.

Section 5 reserves a zero-length close for a row entered in error, written deliberately by a path that says it is correcting. A sex correction is not that. It is effective-dated, and this section already accepts in writing that closed periods keep the Network recorded for them, including where it is now known to be wrong — erasing the period outright is the opposite of that bargain, not a stronger form of it.

It is reachable wherever the floor is empty, which is most ordinarily a Person with no pastoral assignment at all, whose correction this section says may be backdated freely. "Freely" means as far back as the record goes, not before the record begins. The refusal names the day after the Network row began.

The system therefore **rejects the correction and names the earliest date it can legally take**, rather than failing with a constraint violation the administrator cannot act on. The rejection is a rule about what can be recorded, not about the actor's authority, so it answers `INVARIANT_VIOLATION` (Section 22).

**Where no date can clear the floor, the refusal names none.** The floor can fall on the current day — moving a disciple aside closes their edge as of today, which the paragraph below makes the *ordinary* outcome — and the day after today is tomorrow, which no correction may take because an effective date is a correction to the past. Naming it would hand the administrator the one answer guaranteed to be refused again, which is the failure this rule exists to prevent. The system instead says that the correction cannot be backdated at all and will take effect now if submitted without an effective date. That always succeeds: every bound is read from a row already written, so it lies in the past.

**The floor is an instant and the effective date is a day, so the answer is the day after the floor's day.** An effective date is a date-only field (Section 22) resolved to the start of that day in Asia/Manila (Section 20), while the floor above is a timestamp taken from rows written at whatever moment they were written. The earliest legal date is therefore the Manila calendar day *following* the day the floor falls in, and that holds however the floor sits within its day: the start of the floor's own day is never strictly later than the floor, and the start of the next day always is. A correction with no effective date takes the instant it is recorded and has no floor to clear, since every bound above lies in the past.

This is why the refusal names a **date** rather than echoing the floor. An administrator handed a timestamp would have to work out which day to submit, and the day containing that timestamp is the one day that will be refused again.

**One consequence is sharp, and follows from the two rules together rather than from either alone.** Moving a disciple out of the way closes their edge as of today, and that `ended_at` becomes the floor immediately. So a correction for someone who has just had disciples moved cannot be backdated at all: it takes effect from today forward, and the months in which they led those disciples keep the Network recorded for them. Anyone reading only the refusal rule would expect clearing the disciples to unblock a backdated correction, and it does the opposite.

The cost is real and is accepted: closed periods keep the Network that was recorded for them, including where it is now known to be wrong. Two things make that the better failure. Those periods have already been reported, and Section 3 guarantees a re-run reproduces what was reported — a correction reaching into them would move totals for months a leader may be holding on paper. And a person's Network is derived from sex, which the correction is fixing; the reported figures for a closed month reflected the church's understanding at the time, which is what a historical report is for. Where the true history genuinely matters, it belongs in the audit entry the correction already writes (Section 21), not in a rewritten relationship row.

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

A root leader has no pastoral leader above them, and that fact is **recorded as a row**: an active pastoral assignment whose `leader_id` is null. The row exists and is what makes them a root. This is the intended state, not missing data.

Earlier wording said a root had "no active pastoral assignment" *and* that a root leader has a null `leader_id`, which are different claims about whether a row exists. The row-based reading is the settled one, for two reasons. It is the only one under which "is this person a root" is a question the database can answer, and every rule that needs to distinguish a root from an unassigned Person depends on that — a Network change is refused for a root (Section 4) and must not be refused for someone merely unassigned. And the alternative needs a durable record of who the roots are, which Section 7 declined to create on the grounds that it would put the church's two most consequential positions behind a row somebody could edit.

**A Person with no active assignment row at all is therefore never a root; they are unassigned** — surface them as such rather than silently rendering them as a second root of the tree.

A root leader cannot be reassigned by anyone, Admin included, because there is no valid leader above them. Changing who holds a root position is a deliberate Network-level decision, not a pastoral reassignment.

Never represent a root as an assignment pointing at itself. A self-referencing row is rejected by the no-self-assignment constraint, and would make the root its own ancestor — a one-node cycle.

### Recommended historical model

Prefer a pastoral assignment/history table for a long-lived production system:

```text
pastoral_assignments
- id
- person_id
- leader_id          nullable, only for a Network root
- started_at
- ended_at           nullable
```

This allows a person to move to another leader without destroying history.

An assignment is active when `ended_at` is null. That is the single definition. Do not add a separate `status` column beside it: two independent representations of the same fact drift apart, a row ends up with `ended_at` null and a status saying otherwise, and the uniqueness constraint in Changing a person's pastoral leader guards only one of them. If a status value is ever needed for another purpose, derive it — never store it as a second source of truth.

`leader_id` is nullable because Network root leaders have no leader above them (below).

### Direct leaders vs descendants

Always distinguish:

- Direct Leader: immediate parent in pastoral tree
- Direct Leaders: immediate children who qualify as leaders (Section 11, What "qualifies as a leader" means)
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

Zero is legitimate in exactly two situations: a Person encoded but not yet assigned, and an archived Person whose assignment has ended. Every other Person has exactly one, and a Network root leader is not an exception — their row exists and carries a null `leader_id` (Network roots, above).

A reassignment closes the current assignment and opens the new one within a single transaction. It must never leave two open assignments, and must never leave a person who had a leader without one. Enforce with a uniqueness constraint over the person where `ended_at` is null — the constraint permits zero rows and forbids two.

Every effective-dated table carries the same shape of constraint, and each is required rather than optional (Database enforcement, below): one open row per person for `person_lifecycle`, `network_assignments` and `cell_memberships`; one open row per Cell for `cell_categories` and `cell_schedules`; one open row per Cell for `cell_leaderships`, since a Cell has one leader at a time; one `PENDING` row per prospective leader for `cell_creation_requests`; and one active row per account per role for `account_roles`. `account_roles` carries two further uniqueness constraints of its own, both named in Section 7 rather than here because each states a rule about authority rather than about effective dating: one occupant per Senior Pastor slot, and at most one of `SENIOR_PASTOR` and `ADMIN` per account. `capability_grants` is deliberately exempt: an account may hold the same capability at more than one scope, and the widest applicable grant governs.

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

**A backdated reassignment carries two bounds of its own**, computed by the same code as Section 4's floor and deliberately not identical to it. It shares Section 4's first term exactly. Its second term differs in both directions — it reaches only the rows on which this person is the subordinate, and unlike Section 4's it does not require the row to carry a leader. And Section 4's separate bound on the Network row does not apply at all, because a reassignment does not write one.

- **Strictly later than the latest of** the `started_at` of the person's current assignment and the `ended_at` of every already-closed assignment on which **this person is the subordinate**. Computed by the same code as Section 4's floor, with the second term deliberately different — see below.

  The first term: at that instant exactly the reassignment closes the current row at its own start, and a zero-length row is inert (History is never deleted, below) — so the leader the person actually had for that whole period disappears from every as-of query and from every report that resolves through it, with nothing raised. Below it, the row cannot be closed at all. Neither is a correction; both are erasure.

  The second term matters for a Person with **no** open assignment, whom the first does not bound at all. The one-active constraint is partial over `ended_at IS NULL`, so an effective date inside an already-closed period is permitted by the schema and leaves two rows valid at one instant — and "who was this person's leader on date D" then has two answers, which Section 20's reproducibility and Section 9's responsible leader both depend on not happening.

  It also reaches a closed row that carried **no** leader — a period during which the person was a Network root. Section 4's term excludes those, because a row with no leader is not an edge and cannot be stranded; this one includes them, because what it prevents is two rows valid at one instant and a former root period overlaps exactly as any other does.

  **It reaches only the rows on which this person is the subordinate, and Section 4's reaches both directions.** The difference is not an inconsistency: the two rules guard different triggers. A Network change is validated against every edge touching the person in either direction, so a correction can strand either and the limit covers both. A reassignment writes one person's own row and is validated against that row alone, so a former disciple's closed edge can neither be stranded by it nor overlap it. Borrowing the wider term would refuse a legitimate Admin correction for every leader who has ever had a disciple moved — which Section 4 makes the *ordinary* precondition of a Network correction — for no invariant's sake.
- **The resulting edge is validated as of the effective date, not as of now.** The same-Network trigger compares `network_as_of` on both ends at the assignment's `started_at`, so a reassignment backdated into a period when either person belonged to a different Network is rejected at commit. Validating against today's Networks would let the system answer that the edge is legal and then fail on it. Where either Network is unknown at that instant — the system is authoritative only from each person's encoding date forward (Section 4) — the reassignment is refused rather than attempted.

The refusal names the earliest date the reassignment can legally take, and where the bound falls on the current day it names none and says the reassignment can only take effect now, exactly as Section 4 does. It answers `INVARIANT_VIOLATION`: it is a rule about what can be recorded, not about the actor's authority.

**A reassignment naming the leader the person already has is refused**, as `VALIDATION_FAILED`, for the reason Section 4 gives for refusing a sex correction that changes nothing: the operation is audited, and a transfer whose previous and new leader are the same misleads whoever reads the log. It would also place a boundary in the assignment history where nothing happened, so a report asking how long the person has been under that leader answers wrongly ever after. A client that lost the response retries with the same `Idempotency-Key`, which is what that header is for.

The reason `records.backdate_effective_date` requires is required by the operation whenever an effective date is given, and is not required otherwise. An ordinary reassignment is audit logged without one, because it records a decision taken today and the audit entry already carries who made it.

The same rule governs every other effective-dated relationship: Network assignment (Section 4), Cell membership (Section 10), and Cell leadership (Section 11). Ordinary users record changes as of now. Only Admin may set an effective date in the past, and only with a reason.

**History is never deleted.**

A row of an effective-dated table is never removed: `person_lifecycle`, `network_assignments` and `pastoral_assignments` here, and `account_roles` and `capability_grants`, whose revocation history Section 7 calls audit material. A table added later that carries the same shape is covered by the same rule and gets the same trigger in the migration that creates it — the rule is not satisfied by being written here. A row entered in error is corrected by closing it and opening the right one, which is what effective dating is for. This is Principle 12 stated as an operation rather than as an aspiration, and it is enforced by the database.

**A row entered in error is closed at zero length.** Correcting one means closing it and opening the right one, and the correction is not a change of fact at a later date — it is the assertion that the closed row was never true. Its `ended_at` therefore equals its `started_at`, and every effective-dated table permits that:

```sql
CHECK (ended_at IS NULL OR ended_at >= started_at)
```

The strict `>` this replaced made the prescribed correction impossible to perform honestly. Closing the row a microsecond later is the only thing it allowed, and that records a non-zero period during which a fact that was never true was in force — small enough to look harmless and permanent enough to be read back later as history.

A zero-length row is inert by construction rather than by convention, which is what makes this safe:

- **It resolves to nothing as of any instant.** An as-of lookup asks for `started_at <= t` and `ended_at > t`, and at `t` equal to the shared timestamp the second test fails, while above it the first does. There is no `t` at which the row is the answer.
- **It occupies no open-row constraint.** Every uniqueness constraint in this section is partial over `ended_at IS NULL`, and a zero-length row has `ended_at` set. Closing one in error therefore never blocks opening the correct row in its place.
- **It is invisible to an as-of comparison, which is what the same-Network checks make.** Both compare `network_as_of` at an instant, and by the point above no instant resolves to a zero-length row.

That last point is narrower than it looks, and the difference matters. A zero-length row is inert as an *answer*; it is not thereby excluded from being *examined*. The same-Network check on a Network change selects edges open at, or beginning after, the effective date, and a zero-length assignment row whose shared timestamp falls after that date **is** one beginning after it. It is selected and compared, at its own timestamp, against the corrected Network — and being closed, it cannot then be reassigned to resolve what it reports.

So a zero-length row on `pastoral_assignments` is not free. It is inert for every query that asks who someone's leader was, and it still participates in the check that guards Network changes. Writing one is a correction of a row entered in error, never a way to record that an edge briefly existed, and the backdate floor in Section 4 counts its timestamp exactly as it counts any other.

The cost is that an inert row is also an invisible one, so a defect that closes a live row at its own start date removes it from every query with nothing raised. That is a domain-layer discipline, not a schema one: a zero-length close is written deliberately, by a correction path that says it is correcting, and never as the ordinary way to end a relationship.

`refresh_tokens` and `account_tokens` are deliberately not named, and are the one exception. They carry operational state rather than history, and they may be pruned under the retention rule in Section 6 — which is a floor rather than a licence, because deleting the wrong row destroys a security signal rather than a historical fact.

The reason is narrower than "history is valuable". Every same-Network check in this section fires on insert and update, so a `DELETE` is the one write that passes none of them: removing a person's current Network row makes their Network resolve to an older one, or to none, and every open pastoral edge beneath them becomes cross-Network with nothing raised and nothing to revisit it. The first data-fix script written straight against the database is exactly where that arrives.

**Database enforcement.**

Service-layer checks are not sufficient on their own. The first data-fix script written directly against the database bypasses every one of them. Each invariant that can be expressed as a constraint must also exist as a constraint.

No deletion — a trigger on every table holding history, refusing unconditionally:

```sql
CREATE TRIGGER pastoral_assignments_no_delete
  BEFORE DELETE ON pastoral_assignments
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();
```

`TRUNCATE` fires no row trigger, so it bypasses this rule exactly as a `DELETE` would. It is left available because it is how a test suite resets between cases, and **the protection is meant to be the privilege, not the trigger**: Section 24 requires least-privilege database credentials, and an application role without `TRUNCATE` on these tables is what makes the exemption safe.

That role does not exist yet. Until it does, nothing prevents the application from truncating a history table, and saying otherwise would be asserting an enforcement that is not there — which is the failure this rule exists to prevent. It is recorded as open in `CLAUDE.md`.

One active assignment — a partial unique index over the person, where the assignment is open:

```sql
CREATE UNIQUE INDEX pastoral_assignments_one_active
  ON pastoral_assignments (person_id)
  WHERE ended_at IS NULL;
```

No self-assignment — a check constraint covers the degenerate case; the wider rule against re-parenting an upline stays in the domain layer:

```sql
ALTER TABLE pastoral_assignments
  ADD CONSTRAINT pastoral_assignments_no_self
  CHECK (person_id <> leader_id);
```

Same-Network edge — because Network is effective-dated on the Person rather than stored on the assignment row, this cannot be a simple check constraint. Enforce it with a constraint trigger on insert and update of `pastoral_assignments`, and re-validate it on every Network change (Section 4).

The trigger must be **`DEFERRABLE INITIALLY DEFERRED`**. Section 4 requires a Network change and its accompanying reassignment to happen in one atomic operation, because either alone leaves the tree invalid. A trigger firing per statement sees that intermediate state and rejects whichever runs first, making the mandated operation unperformable. Deferred to commit, it sees only the final state.

The two firing paths need **different** comparison dates, and one rule cannot serve both.

**On a write to `pastoral_assignments`**, compare the Networks in force as of the assignment's `started_at`. An edge must have been legal when it was created, and where Admin backdates one under `records.backdate_effective_date` that differs from today — validating against now would reject a correction that was true at the time.

**On a Network change**, compare against every assignment **touching the person in either direction** — those where they are the subordinate *and* those where they are the leader — that is **open at the change's effective date or begins after it**, each one as of the later of the two dates — the moment from which the corrected Network governs that edge. Using the assignment's `started_at` here makes the check a no-op: a person assigned in January under a same-Network leader, whose Network is corrected in August, is compared against January's Networks, which matched, so the change commits and leaves them under a leader in their former Network — exactly what Section 4 requires the system to reject.

"Or begins after it" is not a refinement, it closes a hole. `records.backdate_effective_date` allows Admin to set the effective date in the past, so an assignment can begin *after* the date a Network correction takes effect and therefore not be open at it. A correction backdated to April, with an assignment opened in June that was legal when it was made, would commit while leaving a permanent cross-Network edge — and nothing revisits it, because no row of `pastoral_assignments` is written and the other trigger never fires. Section 4's guarantee is absolute, so this check has to reach forward from the effective date rather than stopping at it.

**"In either direction" is not decoration either.** A person's Network governs every edge they sit on, and they sit on two kinds: the one above them and one for each disciple below. Checking only the first leaves a leader's whole downline cross-Network the moment their own Network is corrected — the same permanent, unrevisited breach the paragraph above describes, differing only in which end of the edge moved. It is also what bounds how far a correction may be backdated (Section 4): the floor is computed over edges in both directions precisely because this check considers both.

A root leader has a null `leader_id` (Network roots, above) and the trigger passes such a row without comparison — there is no leader to compare against.

**Serializing a Network change against a concurrent edge write — an advisory lock on the person, taken in ascending lock key.**

The same-Network triggers are `DEFERRABLE INITIALLY DEFERRED`, so each sees only what its own transaction can see at commit. That leaves a window neither closes: a transaction opening an edge under a person, with a `started_at` just before a Network change's effective instant and committing just after it, is invisible to the change's comparison, while its own trigger compares at its `started_at`, where that person's Network was still the old one. The edge is then permanently cross-Network and nothing revisits it — which contradicts this section's own requirement that the rule hold on every write.

Every path that opens a pastoral edge takes a transaction-scoped advisory lock on the **leader** it is attaching to, and every path that changes a Network takes one on the person being changed, before reading anything it will rely on. A caller needing more than one takes them in ascending **lock key**, so that two operations moving people under each other cannot deadlock.

Ordered by the key rather than by the person id, because the key is what is actually taken: two ids that collided on one key could otherwise be acquired in opposite orders by two callers, which is a real cycle rather than the mere over-serialization a collision is otherwise. The key is computed from the identity and not from its spelling — a UUID is compared case-insensitively everywhere else in the system, so a key derived from the raw text would let the same person named in two cases take two locks that serialize against nothing.

An advisory lock rather than a row lock on `persons`: the two paths belong to different modules and `persons` belongs to neither of them alone (Section 2), so a row lock would mean reading a table to coordinate rather than to read data. This is coordination, and it is transaction-scoped, so no path can leak it by failing.

**The wait is bounded, and the bound is a requirement rather than a tuning choice.** An advisory lock waits indefinitely and the connection pool is bounded (Section 24), so an unbounded wait lets one client left idle in a transaction consume every connection — and the liveness probe shares that pool, so a healthy process is then read as dead and restarted, losing the transactions that were making progress. A request that cannot take the lock within a few seconds gives up and answers `RESOURCE_BUSY` (Section 22).

**The bound covers the whole transaction, not only the advisory acquisition.** It is set once, before the locks are taken, and stays in force for the row locks the caller's own writes take afterwards — including the idempotency key's. That is deliberate: those waits are unbounded otherwise, and an unbounded wait anywhere inside a transaction holding a pooled connection is the same hazard. It follows that an elapsed wait must answer `RESOURCE_BUSY` **wherever it is raised**, including at a call site that knows nothing about locks; classified as an unexpected failure it would be a 500 for ordinary contention.

**That answer is a 5xx deliberately.** Section 22 stores a 4xx against the idempotency key and releases the key on a 5xx, because the first is a decision the rules reached and the second carries none. Contention reached no decision, so storing it would answer every later retry of that key with the same transient failure for the whole retention period — the dead end the release rule exists to prevent. Falling on the 5xx side of that split makes the correct behaviour structural rather than a special case in the interceptor that each new code has to remember.

No cycles — a cycle spans many rows and cannot be expressed as a row-level constraint. Reject it in the domain layer before writing, and make every recursive subtree query cycle-safe so that a cycle introduced by any other means surfaces as an error rather than an unbounded query:

```sql
WITH RECURSIVE subtree AS (
  ...
)
CYCLE person_id SET is_cycle USING path
```

**PostgreSQL 16 is the minimum version.** The `CYCLE` clause requires 14 or later, and pinning the version here means the visited-path fallback is never written.

Any query that walks the pastoral tree must carry cycle detection. A subtree query without it is a defect, not a performance preference.

**Lifecycle state.**

An archived Person (Section 3) must not be reassigned. Restore them to `CURRENT` first — an explicit, authorized decision — and then reassign. Keeping the two operations separately authorized and separately audited prevents an archived record from re-entering a leader's current totals through a side door.

A Person absorbed into another by Merge (Section 3) must never be reassigned. The surviving Person is the only valid target.

**An archived Person may not be given a new disciple either.** They may not be reassigned, and they may not be the *destination* of someone else's assignment: a live pastoral edge under a Person who is not `CURRENT` corrupts every subtree total that walks through them, which is the same corruption Section 3 refuses when archiving a Person who leads a Cell. Restore them first — an explicit, separately authorized decision — or choose another leader. The refusal answers `INVARIANT_VIOLATION`: it is a rule about what may be recorded, whoever submits it.

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
- account status — exactly:
  - `PENDING_ACTIVATION` — created, activation email sent, no password set
  - `ACTIVE`
  - `DISABLED`
- last_login_at
- created_at / updated_at

### Session and token storage

```text
refresh_tokens
- id
- account_id
- token_hash         the token itself is never stored
- device_label       nullable, for the user's own sign-out list
- replaced_by_id     nullable, the token issued when this one was rotated
- issued_at          stamped by the API process, never by the database
- expires_at
- last_used_at       nullable
- revoked_at         nullable
```

An access token lives **15 minutes**. A refresh token lives 30 days from issue and is rotated on use: the old row is revoked and a new one issued, so a refresh token replayed after use is a reuse signal and revokes the whole account chain.

`replaced_by_id` is what makes that signal readable, and it is set by rotation and by nothing else. It governs what happens when a revoked token is *presented*: one carrying a replacement was rotated, so presenting it again is a reuse signal; one without was revoked by a sign-out or by an account-wide revocation, and is simply refused. Without the column those cases are indistinguishable, and an ordinary sign-out looks exactly like a stolen token.

It is not a classification of every revoked row. Account-wide revocation leaves the same shape as a sign-out, deliberately: nothing needs to escalate a token whose account has already been revoked.

**Three rules make immediate revocation hold, and each is easy to lose.**

`issued_at` is **stamped by the API process**, not by a database default. It is compared against `sessions_revoked_at` and against an access token's issued-at, both of which the API stamps, and the database's clock is a different one. A token sitting on the wrong side of that comparison is a session that outlives its revocation, or a sign-in refused for no reason.

**Rotation is ordered against revocation in the database, not in the application.** A rotation takes the account row under a lock before it claims a token, and re-reads the marker there. Checking the marker before opening the transaction is not enough: that read sees committed state, so a revocation that has stamped its marker and not yet committed reads as absent, and a token can be rotated in that window into a replacement the revocation never sees.

Revocation takes the same row, in the same order, first. Two paths taking one pair of locks in opposite orders deadlock, and the loser is normally the revocation — which would mean the one operation that must not fail silently failing silently.

**The marker is the boundary.** A refresh token whose `issued_at` is at or before `sessions_revoked_at` is dead, whatever its own row says; one issued after it is a new session and is untouched. Everything below follows from that one comparison — `issued_at` against the marker, never the order in which rows happened to commit.

The marker is stamped **last**, after the tokens are revoked. That is what catches a row the revoking statement missed: the statement takes its snapshot before the marker is read, so a row it could not see but which was issued before that read still sorts on the dead side of the comparison. A row issued after the marker is read escapes both, and is meant to.

A sign-in can land inside a revocation's transaction. Issuing a refresh token takes no lock on the account, so the revocation does not exclude the insert itself — though in practice a sign-in usually waits a statement earlier, when it stamps `last_login_at` on the account row, which the revocation does hold. What remains is a sign-in that passed that point before the revocation began: it is refused if its `issued_at` precedes the marker read, and survives if it follows it.

That is the intended answer rather than an accident of lock modes. Revocation ends the sessions that existed when it ran; it was never a bar on signing in again, and somebody holding the password signs in a moment later in any case. Closing the window would buy nothing that an attacker cannot simply wait out.

**Simultaneous presentation is not reuse.** Where two requests present the same live refresh token at the same instant, one wins the rotation and the other is refused — and that is all. The winner's session is untouched and no account-wide revocation follows.

Reuse is a presentation of a token **after** it has been used, which is the case above: the token already reads as revoked, and it carries a replacement. Two requests arriving together is what an ordinary mobile client does when two calls hit 401 at once, and treating it as theft would sign a leader out of every device for behaving normally — on clients that cannot be force-updated (Section 2).

The cost is accepted deliberately and stated so it is not mistaken for an oversight: an attacker racing a stolen token within the same instant is not detected at that moment. They are detected on the next presentation, because the token they hold is by then revoked and replaced.

**Retention: a token row outlives what can still be presented.** `refresh_tokens` and `account_tokens` are the one exception to the no-deletion rule (Section 5), because they hold operational state rather than history. They may be pruned, and the floor is not their expiry.

A row may be deleted only once its `expires_at` is **more than 30 days past**. Retention is therefore always longer than the life of the token the row describes.

The floor is set by the reuse signal rather than by the token's validity. A rotated row is what makes a replay readable: it is revoked and carries a `replaced_by_id`, and that pair is the whole difference between a stolen token and a token this system never issued. Prune the row and a presented copy resolves to nothing, so it is refused as unknown and **no account-wide revocation fires** — the theft is not merely undetected, it is indistinguishable from a typo. Any retention rule that reaches a row a client could still present has removed a security control, not a dead record.

Thirty days beyond expiry is chosen because that is the window in which revoking still helps. A live theft is a presentation inside the stolen token's own 30-day life, and that is the case the signal exists to catch. Past it the token is refused on its own expiry whatever the row says, and the attacker's danger is the live descendant token further down the chain, which no retention policy reaches in either direction.

Two consequences are accepted rather than glossed:

- **A long-expired stolen token no longer raises the alarm.** Today a replay is checked for reuse before it is checked for expiry, so an expired rotated token still revokes the account. After pruning it will not. That is a deliberate narrowing, and the check order is left as it is so the signal holds for every row still retained.
- **Rows are deleted oldest first.** `replaced_by_id` references `refresh_tokens` with no cascade, so a row is still referenced by the one it replaced until that one goes. Deleting forward along the chain satisfies the constraint; deleting an arbitrary row does not, and a prune that fails halfway is worse than one that never ran.

`account_tokens` follows the same rule and the same reasoning, on a much shorter clock: a reset token lives 30 minutes (Password reset security, below), and a redeemed or expired row is retained the same 30 days past `expires_at` so that a replay is refused as used rather than as unknown.

Nothing in this specification requires a retention job to exist. It permits one, and fixes what it may not touch if it is written.

**Immediate revocation and a stateless API are in tension, and the resolution is explicit.** A bearer token verified by signature alone cannot be revoked before it expires, so Section 6's requirement that revocation take effect immediately, on all devices, is not satisfiable by a short lifetime alone.

Every request therefore checks the account's `sessions_revoked_at` (above) against the access token's issued-at, and rejects a token issued at or before it — a single lookup keyed by account, cacheable, invalidated on revoke.

That comparison is inclusive as the refresh-token one is, but it is **not the same boundary, and it is coarser**. A JWT's `iat` carries whole seconds, so an access token minted in the same second as a revocation cannot be ordered against it, and is refused. It errs towards ending a session the holder can restart by signing in, rather than towards honouring one an administrator has just revoked. The consequence is bounded and accepted: a sign-in that lands **after** the marker but within the same second as it holds a refresh token that is valid — the session lives, by the rule above — and an access token refused until that second has elapsed. A sign-in falling at or before the marker has no divergence to describe, because both its tokens are correctly dead. A per-token `revoked_at` cannot answer this, because an access token has no row. The API remains stateless in the sense Section 2 requires: it holds no server-side session, no per-request state, and any instance can serve any request. What it does not do is trust a signature unconditionally.

A 15-minute access token is short enough that this check can be cached briefly without making "immediately" a lie, and long enough that the refresh path is not on every request.

```text
accounts
- id
- person_id
- email               unique after normalization
- password_hash       nullable until activated
- status              PENDING_ACTIVATION | ACTIVE | DISABLED
- sessions_revoked_at nullable, the account-wide revocation marker
- last_login_at       nullable
- created_at
- updated_at
```

One Person has at most one Account, whatever number of Cells they lead (above). Roles and capability grants are not columns here; they are held separately (Section 7, How grants are held).

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

**Signing in supports a password manager** (WCAG 2.2, criterion 3.3.8; Section 23). Paste into the password field is never blocked, autofill is never obstructed, and the field is marked up so a manager can fill it.

That is what makes a password permissible. A password *is* a cognitive function test under 3.3.8 — it is remembered — and the criterion permits one where any of four conditions holds: an alternative not relying on such a test, a mechanism that assists in completing it, object recognition, or personal content. Two are live for a password, and **this system relies on the mechanism**: support for password managers. Blocking paste therefore does not merely inconvenience, it removes the thing conformance rests on. It is usually done in the name of security and produces the opposite, by pushing people toward passwords short enough to type from memory.

**No sign-in step is a puzzle, an image-selection challenge, or a transcription task.** Two of those three are already required, and only one is a house rule, which is worth keeping straight:

- a puzzle or a transcription challenge is a cognitive function test that neither object-recognition nor personal-content covers, so 3.3.8 forbids it outright unless an alternative or a mechanism is provided. A distorted-text CAPTCHA on its own is a conformance failure, not a matter of taste
- **image selection is permitted by 3.3.8** under object recognition. Refusing it here goes beyond Level AA and matches 3.3.9 at AAA, and it is a choice about the people using this system, most of whom sign in on a phone

### Tokens, not browser sessions

Authentication is token-based from the first release: a short-lived access token plus a refresh token. Do not build a cookie-and-server-session model for the web application and plan to add tokens for mobile later. The API serves three client surfaces (Section 2), and only two of them are browsers.

### Several devices at once

One account may hold several valid sessions simultaneously — a leader recording attendance on a phone while reviewing reports on a laptop is ordinary use, not an anomaly. Issue and track refresh tokens per device or per session, and never evict an existing session merely because a new login has occurred.

Signing out on one device ends that session only.

Revocation, by contrast, is account-wide. Where account access is disabled — at archive, at merge, or by an authorized administrative action — **every** refresh token for that account is revoked and every active session becomes invalid immediately, on all devices. Access already granted must not outlive the revocation by the remaining life of an access token that happens to be long; keep access-token lifetime short enough that immediate means immediate in practice.

### What a password must be

**Twelve characters minimum, 128 maximum, and no composition rule of any kind.**
No required uppercase, digit or symbol; no forced rotation; no truncation before
hashing.

Length rather than complexity, because this system's accessibility conformance
rests on password managers. Section 23's criterion 3.3.8 permits a password only
where a mechanism assists in completing it, and support for managers is that
mechanism (Section 6, Authentication V1). Composition rules push people toward
short passwords they can retype from memory, which is the behaviour that criterion
exists to prevent — so a rule that forces a symbol works against the thing
conformance depends on.

The maximum exists only so that a hash is bounded, and it is high enough that no
passphrase a person would choose reaches it. **The password is never truncated to
fit**: silently hashing a prefix means a longer password is no stronger than its
first *n* characters, and the holder cannot tell.

A password below the minimum is refused with `VALIDATION_FAILED` (Section 22), on
the request that sets it — activation, reset, or change. It is never refused at
sign-in, where the stored password is whatever it was when it was set.

### Password reset security

- Generate cryptographically secure, single-use reset token
- Store only a hash of the reset token server-side
- Give it a short expiration (e.g. 30 minutes)
- Return the same forgot-password response whether or not the email exists
- Invalidate token after use
- Do not let admins know or choose another user's password

```text
account_tokens
- id
- account_id
- purpose             PASSWORD_RESET | ACTIVATION
- token_hash          the token itself is never stored
- expires_at
- used_at             nullable
- created_at
```

Single-use: `used_at` is set on redemption and a token with it set is refused. Issuing a new token of a purpose invalidates any outstanding one of the same purpose for that account.

### Account activation

When a person becomes a Cell Leader and has no account:

1. Require email.
2. Create/reuse the person's single account.
3. Send activation/set-password email.
4. User creates their own password.

**Provisioning is an explicit action under `accounts.manage`, and what it may
create is bounded by what qualifies the holder.** Cell leadership is the ordinary
qualification and it is the one this section describes. The two exceptions above —
Senior Pastor and Administrator — are the others, and they are exceptions to the
*qualification*, never to the workflow: each still gets an account created,
an activation email sent, and a password the holder sets themselves.

**An account is therefore provisioned together with the role that qualifies it**,
and a request naming no qualifying role is refused with `INVARIANT_VIOLATION`
(Section 22). That is a rule about what may be recorded rather than about the
actor's authority, which is the distinction Section 22 draws.

The consequence is worth stating because it is a phase rather than a permanent
rule: until `cells` exists, only an `ADMIN` or `SENIOR_PASTOR` account can be
provisioned, because a `LEADER` account's qualification is an active Cell
leadership assignment (Section 11) and there is nothing yet to hold one. A
`LEADER` provisioning request is refused for that reason rather than accepted with
the check deferred — an account for someone who has not opened a Cell would
detach "leader" from "leads a Cell", which Section 11 makes non-negotiable.

The first Admin account is the one exception to all of it, created by a system
action because there is no account above it to do the creating (Section 7,
`granted_by`).

**An archived Person is not provisioned an account.** The request is refused with
`INVARIANT_VIOLATION`, naming the restore that must happen first. This section
covers the account-access decision *at* archive and reactivation *after* it, and
said nothing about creating one for somebody already archived — but every
neighbouring rule points one way: Section 5 refuses an archived Person as the
destination of a pastoral assignment, and Section 3 refuses archiving somebody who
leads a Cell. An archived Person does not acquire new live relationships, and an
account is one.

**Which Senior Pastor seat a provisioning request takes is chosen by the server.**
Section 7 caps the role at two slots and calls a slot a seat rather than a rank, so
naming one chooses nothing meaningful — and a caller naming an occupied seat would
meet a constraint violation for a decision it should never have been making. The
free seat is taken; where both are held the request is refused with
`INVARIANT_VIOLATION`, naming the revocation that records a succession. The partial
unique index remains the enforcement, so two concurrent requests for one free seat
still resolve to one account.

**An activation email may be re-sent.** Step 3 above sends one and defined no second
path, which left an account unreachable whenever a delivery failed: the Person
already has an account, so provisioning refuses, and the holder's only route was the
forgotten-password flow — which happens to work on a `PENDING_ACTIVATION` account and
records itself as a password reset rather than an activation.

Re-sending mints a fresh token and supersedes the outstanding one by the rule above,
so a link from an earlier attempt stops working. That is the right way round: the
reason to re-send is that the earlier one reached nobody. It is available only while
the account is `PENDING_ACTIVATION` — an active holder who has forgotten their
password uses the reset flow, and a disabled one is not invited back in through an
activation link, since reactivation is a separate authorized decision.

**A delivery failure never fails the request that caused it.** This holds for
provisioning and for a re-send alike: each records its outcome before the message is
attempted, so raising afterwards would hand the client a failure while the store
holds the success that every retry reproduces (Section 22). The failure is recorded
for an operator, who re-sends — and a re-send that cannot be delivered is recorded
the same way rather than reported, since it has already committed a token.

One person has one account even if they lead multiple Cell Groups.

Assigning Cell leadership and provisioning an account are separately authorized. Where designating a person as a Cell Leader would trigger account creation, the actor must hold both `cell.manage_leadership` and `accounts.manage` against that same target — mirroring the dual-authorization rule for archiving a Person who holds an active account (Account access at archive, below).

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

The capabilities are exactly:

- `people.view_subtree`
- `people.create`
- `people.edit_basic`
- `people.manage_lifecycle`
- `people.manage_pastoral_assignment`
- `people.correct_sex`
- `dcc.take_attendance`
- `dcc.view_subtree`
- `dcc.submit_on_behalf`
- `dcc.correct_subtree`
- `cell.take_attendance`
- `cell.view_subtree`
- `cell.submit_on_behalf`
- `cell.correct_subtree`
- `cell.manage_membership`
- `cell.manage_leadership`
- `cell.request_creation`
- `cell.approve_creation`
- `cell.manage_lifecycle`
- `reports.view_subtree`
- `people.merge`
- `records.backdate_effective_date`
- `settings.manage`
- `accounts.manage`
- `roles.manage`
- `audit.view`

Each capability guards one endpoint family, and the boundaries are not left to inference:

- `dcc.*` guards everything under `/api/v1/dcc` — rosters, submissions, corrections, and DCC figures reached directly
- `cell.*` guards everything under `/api/v1/cells`, including meeting records, membership, leadership, and outstanding-record lists
- `reports.view_subtree` guards `/api/v1/reports` — the aggregate reporting surface, Network Summary, and the notification content derived from it (Section 13). It never substitutes for `dcc.view_subtree` or `cell.view_subtree` on the domain endpoints, and neither of those substitutes for it
- `dcc.correct_subtree` and `cell.correct_subtree` guard amendment of an already-submitted record (Section 14), separately from `take_attendance`, which guards the first submission

This list is a **closed enumeration**, on the same terms as the scope values below. A guard cannot fail closed against an open list, and `capability_grants.capability` stores one of these identifiers. Adding a capability is an amendment to this specification, never a runtime action.

The API must check both permission and scope.

Senior Pastors have explicit church-wide scope across both networks.

Admins may have system-wide operational permissions even if they are not pastoral leaders.

### Scope of `people.edit_basic`

`people.edit_basic` covers corrections to a person's own descriptive fields only: first name, middle name, last name, birthday, civil status, and mobile number.

It does not cover sex, Network, pastoral assignment, Cell membership, Cell leadership, lifecycle state, or account state. Each of those is governed by its own capability — sex and the Network change it forces by `people.correct_sex`.

Sex is excluded deliberately. Sex determines Network under the homogeneous-network rule (Section 4), and Network determines which pastoral edges are legal (Section 5). If sex could be changed as an ordinary field edit, an actor could flip a person's Network and create a cross-Network pastoral edge without ever invoking `people.manage_pastoral_assignment`, bypassing the invariants in Section 5 entirely. Correcting a person's sex is handled as a Network-affecting correction (Section 4).

### Role catalog

Three roles exist. Each carries the default capabilities and scopes below. Anything beyond a role's defaults requires an explicit, Admin-issued grant, and is read-only unless a management capability is granted alongside it. **Two capabilities are an exception and may not be granted to an account holding `SENIOR_PASTOR` at all** — see How grants are held, below.

| Capability | Senior Pastor | Admin | Leader |
| --- | --- | --- | --- |
| `people.view_subtree` | Whole Church | Whole Church | own/subtree |
| `people.create` | Whole Church | Whole Church | own/subtree |
| `people.edit_basic` | Whole Church | Whole Church | own/subtree |
| `people.manage_lifecycle` | Whole Church | Whole Church | — |
| `people.manage_pastoral_assignment` | Whole Church | Whole Church | own/subtree |
| `people.correct_sex` | — | Whole Church | — |
| `dcc.take_attendance` | Whole Church | Whole Church | own/subtree |
| `dcc.view_subtree` | Whole Church | Whole Church | own/subtree |
| `dcc.submit_on_behalf` | Whole Church | Whole Church | own/subtree |
| `dcc.correct_subtree` | Whole Church | Whole Church | own/subtree |
| `cell.take_attendance` | Whole Church | Whole Church | own/subtree |
| `cell.view_subtree` | Whole Church | Whole Church | own/subtree |
| `cell.submit_on_behalf` | Whole Church | Whole Church | own/subtree |
| `cell.correct_subtree` | Whole Church | Whole Church | own/subtree |
| `cell.manage_membership` | Whole Church | Whole Church | own/subtree |
| `cell.manage_leadership` | Whole Church | Whole Church | own/subtree |
| `cell.request_creation` | subtree, excl. self | subtree, excl. self | subtree, excl. self |
| `cell.approve_creation` | — | Whole Church | — |
| `cell.manage_lifecycle` | Whole Church | Whole Church | own/subtree |
| `reports.view_subtree` | Whole Church | Whole Church | own/subtree |
| `audit.view` | Whole Church | Whole Church | — |
| `records.backdate_effective_date` | — | Whole Church | — |
| `settings.manage` | — | Whole Church | — |
| `accounts.manage` | — | Whole Church | — |
| `roles.manage` | — | Whole Church | — |
| `people.merge` | — | Whole Church | — |

Five of these defaults are deliberate and must not be widened for convenience. Two of the capabilities they cover — `roles.manage` and `accounts.manage`, for a Senior Pastor — may not be widened at all, by any grant and for any reason; the rest are defaults an Admin may deliberately exceed.

**Senior Pastors do not hold `roles.manage` or `accounts.manage`.** Granting permissions and administering accounts is Admin's operational responsibility; Senior Pastor and Admin are different responsibilities even where their visibility overlaps (Section 19). Keeping grant-making out of the Senior Pastor role means the two highest-visibility accounts in the church cannot escalate their own authority, and every permission change has a second party involved.

**Senior Pastors do not hold `records.backdate_effective_date`.** Backdating rewrites totals for periods already reported (Section 3) and is a data-correction operation, not a pastoral one.

**Senior Pastors do not hold `people.merge`.** Section 3 places it at Whole Church scope as an Admin capability. A merge is irreversible, crosses both Networks, and can lower totals for periods already reported, so it stays with the role whose job is data correction.

**`people.correct_sex` is Admin-only, and Senior Pastors do not hold it.** Correcting a person's sex moves them between Networks, which can change totals for periods that have already been reported — the same property that keeps `people.merge` and `records.backdate_effective_date` with the role whose job is data correction. It also forces the pastoral reassignment in Section 4, so granting it to a leader would be a route to moving people between Networks without ever invoking `people.manage_pastoral_assignment`.

**Leaders do not hold `people.manage_lifecycle`.** Archiving reduces a leader's own People count, which is precisely the incentive Person Lifecycle guards against (Section 3). Archival is requested by a leader and performed by Admin or a Senior Pastor.

A role is a starting set, never a ceiling or a substitute for the checks themselves. The API still evaluates capability and scope on every request (Section 7, above); it never infers permission from a role name.

### Capability and Scope are independent grants

Authorization is expressed as two independent dimensions that combine to form Access:

- **Capability** — the action a user may perform, named by one of the identifiers above
- **Scope** — what data a capability applies to, e.g.:
  - `OWN_SUBTREE` — the actor's pastoral subtree, including the actor
  - `SUBTREE_EXCL_SELF` — the same, excluding the actor
  - `NETWORK` — one Network, named on the grant
  - `WHOLE_CHURCH`

The four scope values are a closed enumeration. A guard cannot fail closed against an open one, so do not add a fifth without amending this specification.

`SUBTREE_EXCL_SELF` is used by `cell.request_creation` alone, where the only prohibited object is the target itself (Section 10). Everywhere else `OWN_SUBTREE` includes the actor, deliberately — a leader edits their own basic details and records their own attendance. Where a rule forbids acting on oneself but the grant must still reach oneself as a *source* — pastoral reassignment, Section 5 invariant 4 — the prohibition is a domain check, not a scope value (How grants are held, below).

Scope resolves against a target. Where the target is a Person, it resolves through their pastoral position. Where it is not:

- a **Cell**, a Cell meeting, a membership or a leadership resolves through the Cell's leader **as of the period being viewed**, falling back to its last leader where the Cell is closed. A closed Cell keeps its history and its roster visible to the leader who led it (Sections 10 and 15), which resolving through a current leader it no longer has would prevent
- a **DCC event** is church-wide and resolves through nothing; the endpoints on it are scoped by the people they return, so a roster or a submission covers only the requester's own authorized people (Section 9)
- an **Account** resolves through its Person
- a **report scope selector** is itself the target: a request for a scope the actor does not hold is `SCOPE_DENIED`, never silently narrowed to what they do hold
- an **audit entry** resolves through its target
- a **setting** is Whole Church only, and is never in scope at any narrower value

A capability without an explicit scope grant is not usable; a scope grant without an explicit capability grants nothing.

Senior Pastors (Bishop Oriel Ballano, Pastora Geraldine Ballano) receive Whole Church scope by role/policy, built in, on every capability their role carries — this does not require a separate Admin-issued grant. The one exception is visible in the catalog: `cell.request_creation` is held at subtree scope by every role, because naming oneself on a request is prohibited for everyone (Section 10).

`people.manage_pastoral_assignment` is a management capability, not a reporting one. Admin holds it per explicit administrative permission. A leader holds it at own/subtree scope, over their own pastoral subtree only. Senior Pastors hold it at Whole Church scope and may therefore reassign within either Network. It is never conferred by a read-only reporting scope grant. The invariants governing its use are defined in Section 5, Changing a person's pastoral leader.

`settings.manage` governs the church-wide operational settings held by the system. It is Admin-only, at Whole Church scope, and every change is audit logged with its previous and new values (Section 21).

The settings it governs today are the Cell attention threshold (Section 15) and the initial-encoding phase flag (Section 2). Both alter behaviour for the entire church from a single control, which is why neither is per leader and why both carry an audit trail: a threshold change silently re-populates every leader's attention list, and closing the encoding phase permanently removes Admin's direct-create path for Cells.

A setting is not a place to record domain rules. Anything that changes what a figure means, rather than a single operational parameter, belongs in this specification and not behind a control.

```text
settings
- key                 a fixed identifier, e.g. cell_attention_months
- value
- updated_by          null only for the system action that seeds the defaults
- updated_at
```

The key set is fixed by this specification, not open. Today it holds the Cell attention threshold (Section 15) and the initial-encoding phase flag (Section 2).

`records.backdate_effective_date` governs setting an effective date in the past on any effective-dated relationship: pastoral assignment (Section 5), Network (Section 4), Cell membership (Section 10), and Cell leadership (Section 11). It is Admin-only and always requires a reason. It is never granted to ordinary leaders, because backdating changes totals for periods that have already been reported (Section 3).

Being an Associate Pastor, or being part of a Senior Pastor's direct 12, does not by itself grant Whole Church or Network-level reporting scope. Pastoral hierarchy position and system authorization are separate concepts (Section 1, Principle 3). Any leader other than a Senior Pastor who needs reporting visibility beyond their own pastoral subtree must receive that scope through an explicit, Admin-issued grant.

Expanded reporting scope granted this way is read-only by default. It grants visibility into reports at the wider scope; it does not grant the ability to manage attendance, move people, change Cell assignments, or administer accounts outside the leader's normal authorized management scope, unless separate management-capability permissions are explicitly granted alongside it.

Example: an Associate Pastor may remain pastorally under Bishop Oriel while Admin separately grants DCC report visibility at Whole Church scope. This allows whole-church DCC report visibility. It does not allow that Associate Pastor to edit attendance, move people, change Cell assignments, or manage accounts outside their normal authorized management scope.

All permission and scope grants — creation, modification, and revocation — must be audit logged (Section 21).

### How grants are held

An account's effective authority is the union of two sources: the defaults of the roles it holds, and any capability granted to it explicitly.

```text
account_roles
- id
- account_id
- role               SENIOR_PASTOR | ADMIN | LEADER
- senior_pastor_slot 1 or 2 where role is SENIOR_PASTOR, null otherwise
- granted_by         null only for a system action, which is the first Admin account
- granted_at
- revoked_at         nullable
```

`SENIOR_PASTOR` is held by exactly the two Persons named in Section 4, and by nobody else. Section 1, Principle 6 names them, and the role carries Whole Church scope on `people.manage_lifecycle`, `people.manage_pastoral_assignment` and `audit.view` — so this is a constraint the system enforces, not a convention it assumes. Granting it to a third account is rejected. An account holds at most one active row per role, **and at most one of `SENIOR_PASTOR` and `ADMIN` in total**.

An account's effective authority is the union of its roles' defaults, and Admin's set is a superset of a Senior Pastor's — so an `ADMIN` row beside a `SENIOR_PASTOR` one does not produce a Senior Pastor who also helps with administration. It produces an account holding every capability in the system, for which every exclusion this section writes for the role is void.

It is self-perpetuating, which is why it is a constraint rather than a caution: such an account holds `roles.manage`, so it can retain the pair and revoke anybody else's roles, and its own permission changes no longer involve a second party. It would also mask the identity check above — where the configuration is lost, that check refuses the `SENIOR_PASTOR` row and the account falls to nothing, and an `ADMIN` row beside it keeps the account at full authority so the control never bites, for exactly the two accounts it exists for.

**The cost is accepted rather than worked around.** Section 6 gives one Person one Account, so the two Senior Pastors cannot perform an administrative action at all: provisioning, a merge, a backdated record and a sex correction are each somebody else's to do. That is this section's own sentence — every permission change involves a second party — made true rather than aspirational, and the friction is the mechanism rather than a side effect of it.

**Enforced by a partial unique index**, not by a check in `auth`. The identity half above must live in the application because the database holds no durable representation of who the two Persons are; this rule has no such gap, since role combination is entirely inside `account_roles`. An index therefore decides it where the state lives rather than where a request happens to pass, and is what a `pg_restore --disable-triggers` still enforces. It is not quite unrepresentable, and the difference is worth knowing: a full restore builds indexes after loading, so a dump already holding the pair loads and then fails index creation — loud, and not the same as impossible. Any endpoint that grants a role answers `INVARIANT_VIOLATION` (Section 22) rather than letting the constraint surface as an unhandled error.

`LEADER` is outside the limit. It confers strictly less than either governing role and carries none of the excluded capabilities, so an account may hold it beside one of them without escalating anything.

**The role row is one route to that authority, and an explicit grant is the other.** The role catalog above permits Admin to grant any capability explicitly, so a Whole Church grant of `roles.manage` reaches the same place with no `ADMIN` row and no uniqueness constraint violated — and invisibly to the identity check, which filters role rows and not grants. That route is closed for two capabilities and left open for the rest.

**`roles.manage` and `accounts.manage` are never held by an account holding `SENIOR_PASTOR`, by role or by explicit grant.** A grant of either against such an account is rejected, and so is a `SENIOR_PASTOR` row on an account already carrying one. An endpoint that issues a grant or a role answers `INVARIANT_VIOLATION` (Section 22) rather than letting the constraint surface as an unhandled error. No endpoint issues a capability grant at all today, and the one that issues a role does so only on an account created in the same transaction, which can carry no grants — so this is the contract the first endpoint to reach it owes.

**The stopping point is two rather than the seven this section withholds, and the seven are not alike.** This pair is what makes the combination self-perpetuating: a holder can grant themselves the remaining five and revoke everybody else's roles, so the second party this section requires is present when the grant is issued and never again, and no Admin can undo it afterwards. `records.backdate_effective_date`, `people.merge` and `people.correct_sex` are withheld on a different ground, stated above — each moves totals for periods already reported — and each use is a single audited operation whose authority an Admin can still revoke. `settings.manage` and `cell.approve_creation` are withheld by the table and argued nowhere above.

So the other five remain ordinary Admin-issued grants: explained, audited, revocable, and requiring a second party every time. Only the pair that removes the second party permanently is refused outright. **A capability joins that pair by amending this section**, which is where the argument for refusing it rather than auditing it has to be made.

**Enforced in both directions, and in two places.** The rule spans `account_roles` and `capability_grants`, so no index reaches it and the database half is a pair of constraint triggers: enforcing on grants alone would be walkable from the other side — grant first, add the role second — so whichever row arrives second is the one refused. Each path takes `FOR NO KEY UPDATE` on the account before it looks, because a deferred trigger sees only its own transaction's commit-time state and two concurrent transactions writing the role and the grant would otherwise each see nothing and both commit, which is the defect this section's own Senior Pastor cap was corrected for.

**And the grant is refused again where authority is assembled**, for the reason this section gives twice already: a constraint trigger is skipped entirely by `pg_restore --disable-triggers`, so a rule enforced only by one is a rule a restore can load straight past. A grant-making capability held by an account carrying a `SENIOR_PASTOR` row therefore contributes nothing, exactly as a `read_only` grant of a write capability does, and a request needing it is refused `CAPABILITY_DENIED` — the account holds it at no scope, so `SCOPE_DENIED` would send an administrator to widen a scope that cannot exist. Unlike the identity check, this one reads the role **row** rather than an honoured role, so that the two enforcement points refuse the same states rather than nearly the same ones.

The cost is the same one the role limit above accepts, and it is the reason for that rule rather than a side effect: the two Senior Pastors cannot be handed grant-making authority even temporarily, and an unreachable Admin is answered by a second Admin account rather than by widening theirs.

The `SENIOR_PASTOR` two-holder cap is enforced in two places, because the two halves of *that* rule are enforceable in different ways. The **count** is a database constraint: there are two slots, a holder occupies one, and a partial unique index over the slot permits no second occupant of either. Revoking a row frees its slot, which is how a succession happens.

The slot exists so that an *index* enforces the cap rather than a check that runs. A constraint trigger counting active rows is skipped entirely under `pg_restore --disable-triggers`, so a restore could load a third Senior Pastor in silence; a unique index is enforced there. The slot number itself means nothing and is not an ordering: it is a seat, not a rank. **Which two Persons** hold it is checked in the `auth` domain layer, since the database holds no durable representation of who Bishop Oriel Ballano and Pastora Geraldine Ballano are, and inventing one — a flag on the Person, a reserved identifier — would make the two most consequential accounts in the church depend on a row somebody could edit.

**What the check reads is deployment configuration.** The two Persons are named to the application by their Person identifiers in its environment, validated when the process starts. Nothing in the database says who they are, which is the property the paragraph above requires.

What settles it is whether editing the source would be an **escalation for whoever can edit it**. A flag on the Person is editable under `people.edit_basic`, which an ordinary Leader holds over their own subtree. A `settings` row is editable under `settings.manage`, which is Admin's — and Admin deliberately holds neither seat, so a setting would let Admin name themselves into one and collapse the separation this section builds between `accounts.manage` and the two most visible accounts in the church. The environment is editable by whoever deploys the API, and that person already holds `JWT_SECRET` and can mint a session for any account that exists. Binding the seat to configuration hands them nothing they did not already have.

**It is enforced in two places, and the second is the one a restore cannot skip.** At the moment the role is granted, a request naming a Person who is not one of the two is refused with `INVARIANT_VIOLATION` (Section 22) — a rule about what may be recorded, whoever submits it, which is the distinction that section draws against `SCOPE_DENIED`. And when an account's effective authority is assembled, a `SENIOR_PASTOR` row whose account belongs to any other Person contributes nothing: no role default, and no exemption from the rules Section 5 decides by role rather than by capability.

The second is not redundancy for its own sake. The count moved from a counting trigger to a unique index precisely because `pg_restore --disable-triggers` skips a check that runs, and a check made only where the row is written is skipped by a restore in exactly the same way. The identity half therefore needs an enforcement point that every request passes through, not only the endpoint that writes the row.

**Which code such a refusal answers depends on which of those two consequences did the refusing**, and both follow one principle: the code names the half that failed.

Where the request needed a capability the row would have carried, and nothing else the account holds carries it, the refusal is `CAPABILITY_DENIED` (Section 22): the row contributes none of the role's capabilities at **any** scope, so `SCOPE_DENIED` would send an administrator to widen a scope that does not exist. The qualifier is load-bearing — an account holding a second role, or an explicit grant, keeps whatever that names, and is then refused on its own terms. That is the opposite of the rule below for a capability held at a scope covering nothing, and the two differ on exactly what those codes distinguish: a grant issued at a narrower scope than this section permits still *names* the capability, so it is held and only the scope is unusable, while a refused `SENIOR_PASTOR` row names nothing at all.

Where the actor holds the capability by any other route — another role's defaults, or an explicit grant at any scope that capability permits — and it is the withheld **exemption** that refuses, that is a statement about the actor's authority over a target rather than about what they hold, and it answers `SCOPE_DENIED`, exactly as Section 5 invariant 4 does for every other actor. Nothing here is a special case of that rule; the account simply no longer holds a role that rule exempts.

Where the configuration is what is wrong rather than the row, this means a real Senior Pastor is told they hold nothing while `account_roles` says otherwise. That is the accepted cost of failing closed, and what resolves it is the error the system logs at the refusal, which names both possible causes — a row that bypassed provisioning, and configuration that is unset or wrong.

**Where the configuration is absent the check fails closed, and the API still starts.** A fresh installation has to boot and run the initial import (Section 2) before either Person exists to be named, so this cannot be a value the process refuses to start without. Absent — unset, or blank — means no `SENIOR_PASTOR` account can be provisioned and any existing row confers nothing, and the process says so at startup.

**Anything else that does not name one or two distinct, well-formed identifiers stops the process**, and that includes a value which is present and names nobody. A bare separator is what a deployment template renders for an empty list, so it is among the likeliest ways this arrangement fails — and it *looks* configured, which is the whole of the distinction being drawn: a blank value and a missing one both read as "not set yet", while a typo strips both Senior Pastors of their authority just as silently and leaves nothing for a reviewer to notice.

**The value is read once, when the process starts.** Naming the two after the initial import, and a succession later, each take effect on the next restart. That is the one operational step between the import having created them and their holding the role, and it is written down because an operator who sets the variable and sees nothing change would otherwise conclude the check is broken.

**The free seat is read unfiltered**, because the index it has to agree with is. A row held by an account this rule refuses to honour still occupies its slot, and reporting that seat as free would offer a provisioning request a seat the insert then rejects.

**A succession is an amendment to Section 4 and a configuration change together.** Section 4 names the two Senior Pastors, so who holds the role is recorded in this specification and approved as any other change to it is. Revoking the role row frees the seat; the configuration follows the section. Neither alone moves a seat.

`granted_by` is null only for a role granted by a **system action**, which is the first Admin account and nothing else: there is no account above it to have granted it. This mirrors the same allowance for `audit_log.actor_id` (Section 21). Every other role grant has an actor.

```text
capability_grants
- id
- account_id
- capability         an identifier from the list above
- scope_type         OWN_SUBTREE | SUBTREE_EXCL_SELF | NETWORK | WHOLE_CHURCH
- scope_network      nullable, required where scope_type is NETWORK
- read_only          defaults to true
- reason             required; a grant explains itself
- granted_by         required; an explicit grant is always issued by an Admin
- granted_at
- revoked_at         nullable
```

**Role defaults are specification, not data.** The role catalog above is the authority for what each role carries, and it is not editable at runtime. Changing a role default is a change to this document and a deploy, which is what keeps the catalog and the running system from diverging. `roles.manage` governs which roles and grants an account holds, never what a role means.

**Every capability check names both halves.** The guard resolves a capability and a scope for the actor, then evaluates the scope against **the request's primary target** — the record being read or written. Neither half alone is sufficient, and an account with no matching row is denied: the absence of a grant is a denial, never a default allow.

**An endpoint that declares no capability is denied.** The capability and the target are declared on the endpoint, and an endpoint declaring neither is refused rather than allowed. This is what makes Section 2's structural enforcement real: forgetting the declaration closes an endpoint instead of opening it, which is the failure a busy afternoon actually produces.

Exactly two kinds of exemption exist, and each endpoint taking one names its reason where it is written:

- an endpoint reachable **without authentication**, which is a closed list: sign-in, token refresh, the password reset and activation flows, and the liveness probe. The first four have no token to present yet, or are presenting the refresh token as the credential. The probe answers only whether the process is serving and reads nothing belonging to the church
- an endpoint requiring **authentication and no capability**, because it acts on the caller's own session: reading their own claims, signing out, ending their own sessions

Neither ever covers an endpoint that reads or writes a Person, a Cell, attendance, a report, an account other than the caller's own, or a setting. Adding an endpoint to the unauthenticated list is an amendment to this section, not a decision taken in a controller, because that list is the whole of the API's unauthenticated surface and its value is that it can be read in one place.

A request is allowed where **any** active role default or active grant for that capability covers the target. Authority only widens; there is no mechanism for narrowing a role default on one account, and none is needed — removing the role or disabling the account is the answer.

**The guard is not the whole check.** Several operations impose further conditions that a capability and a scope cannot express, because they concern objects other than the primary target. Reassigning a person is the clearest: Section 5 requires the person's *current* leader and their *new* leader both to be within the actor's scope, forbids the actor acting on themselves, and forbids acting on anyone upline of them. That is three objects with three different rules, and a grant carries one scope.

Those conditions are enforced in the owning module's domain layer — `hierarchy` for Section 5, `cells` for the Section 10 workflow — and are additional to the guard, never a substitute for it and never expressible as a scope value. A developer who implements the guard and believes the rule is implemented has built half of it.

`SUBTREE_EXCL_SELF` exists for the one case where a scope value genuinely does the work: `cell.request_creation`, where the only prohibited object *is* the target (Section 10).

A grant is revoked by setting `revoked_at`, never by deleting the row. The history of who could do what, and when, is part of the audit record.

**`read_only` is valid only on a read capability.** The twenty-six divide cleanly:

- **Read:** `people.view_subtree`, `dcc.view_subtree`, `cell.view_subtree`, `reports.view_subtree`, `audit.view`
- **Write:** every other capability in the list

A grant of a read capability may set `read_only` true or false; true is the default and the normal case, and false is meaningless there but harmless. A grant of a **write** capability with `read_only` true is **rejected at creation**, not stored and silently ineffective. Without that rejection an Admin granting a management capability and leaving the flag at its default creates a row that grants nothing, with nothing to indicate why the holder is being denied.

The flag exists because a scope widened beyond a leader's normal management scope is a reporting grant unless something says otherwise (above). It is the visible difference between letting someone see a Network and letting them change it.

**An identifier supplied by a client is compared canonically, always.** A `uuid` column compares case-insensitively and application code does not, so a person named with their identifier in uppercase is one record to every query and a different string to every comparison written in the application. Identifiers are therefore normalized at the request boundary, and any comparison that decides authority normalizes again rather than trusting that they were.

**The boundary normalizes every route, not the routes that remember to ask.** It is applied globally, to path parameters, query parameters and bodies alike, so a route added later is inside the rule without its author knowing the rule exists. A pipe wired onto each parameter, and a transform wired onto each identifier field, were both first attempts and are exactly the failure Section 2 gives as the reason the capability guard is declarative: a convention held per call site is only as reliable as the least familiar developer writing the newest one.

**A value is canonicalized only where the field's name says it is an identifier *and* the value is UUID-shaped**, and the intersection is what makes it safe to run over a whole request. Each half stops a different corruption. Name alone would rewrite a Member ID, which is `M-` and six digits (Section 3). Shape alone would rewrite a **credential**: a password is arbitrary bytes, case-sensitive, and nothing in its content marks it as one — so a password that happens to be UUID-shaped would be silently lowercased and that account could never sign in again. Field names are chosen by this system; the contents of a password are not.

Which names count is Section 22's field-naming convention, and it is load-bearing here rather than tidy: the boundary keys on it literally. A bare `id` is in the set because a path parameter binds under exactly that name, so excluding it would put every path parameter outside the rule — which is the case the boundary was written for.

Arguments this application constructed rather than received are skipped, by the framework's own bucket for anything that is not a body, a path parameter or a query. Today that means the authenticated actor and the idempotency claim.

**Two different things are outside the rule, and only one of them is an exclusion.** An uploaded file or a raw body falls in the same bucket and *is* client input, so a route binding one — or an identifier decorator built as a custom parameter — needs naming here rather than inheriting the skip. But a request header, a session, a host and a caller's address are not offered to any pipe at all, whatever bucket they would land in, so naming them here would not reach them: an identifier arriving in a header is normalized by the code that reads it or not at all. The `Idempotency-Key` is the one that exists, and it reaches a `uuid` cast in SQL rather than a comparison in TypeScript.

The distinction is recorded because the first version of this paragraph collapsed it, describing a remedy that works for half the set it implied.

**The idempotency fingerprint canonicalizes separately**, because interceptors run before pipes and it would otherwise be taken over the spelling the client used. Left raw, one retry of one request with an identifier in a different case fingerprints differently and is answered `IDEMPOTENCY_KEY_REUSED`, which Section 22 makes permanent — turning an ordinary retry into a dead end.

**What this does not do is validate.** Whether a value is a UUID at all is decided by the capability guard for the one target it resolves scope against (Section 7, the guard checks one target) and by the DTOs for every field they declare. A path parameter that is neither — a second identifier in a route path, which Section 22 already sketches — is validated by neither, and reaching a `uuid` comparison with one produces a database error rather than an answer. A route with a path parameter the guard does not resolve against must validate it itself.

This is stated in Section 7 because the consequence is an authorization one. Invariant 4 below is two identifier comparisons and is the only check on its path that fails **open**; against the one actor class it exists to stop, a comparison that answers "this is not you" is the whole of the escalation. The same defect has also appeared where it merely fails closed — a duplicate acknowledgement that could never be satisfied, blocking a Person from being created at all (Section 3), and a lock that took two keys for one person and serialized nothing (Section 5).

**Invariant 4 of Section 5 binds every operation that can reassign, not only the reassignment endpoint.** A sex correction can perform a reassignment (Section 4), so it refuses a target that is the actor's own Person or anyone upline of them unless the actor holds Admin or Senior Pastor. The Whole Church rule below does not cover it and cannot: that one asks how far a grant reaches, and this one asks who the actor is relative to the target. A holder of an explicit Whole Church grant passes the first and must not pass the second, or the capability becomes the escalation route it is Admin-only to close.

It is refused whether or not the particular correction turns out to force a reassignment. The capability moves a person between Networks either way, and a rule that switched itself off depending on whether the target currently holds an edge would be one nobody could reason about — including the actor, who cannot see that state before submitting.

This is the one authorization rule in the system decided by **role** rather than by capability, and Section 5 states it that way deliberately: what matters is that Admin and the Senior Pastors sit outside the pastoral incentive the rule guards against, not that they hold something extra.

**A capability this catalog gives only at Whole Church covers nothing when granted
narrower.** The guard cannot hold that on its own: it asks whether a grant covers
the request's target, so a grant issued at `OWN_SUBTREE` passes for everyone inside
that subtree. A grant of one of these at any narrower scope therefore covers no
target at all, and the request is refused with `SCOPE_DENIED`.

**`SCOPE_DENIED` rather than `CAPABILITY_DENIED`**, which is the opposite of how a
`read_only` grant of a write capability is treated, and the difference is the point.
That one is rejected at creation and so never exists; this one exists and names the
right capability with the wrong scope. An administrator diagnosing it needs to be
sent to the scope, and `CAPABILITY_DENIED` would send them to grant a capability
they had already granted — which is the distinction this section draws between the
two codes.

The rule is general rather than named per capability, because the hole is. It was
first closed for `people.correct_sex` alone, and the same shape was open on
`accounts.manage`, `roles.manage`, `people.merge`, `records.backdate_effective_date`,
`settings.manage`, `people.manage_lifecycle` and `cell.approve_creation`.

**`audit.view` is deliberately not among them**, and the two lines above say why:
an audit entry resolves through its target, which is machinery with no purpose
unless the capability can be held narrower — at Whole Church a target is never
consulted. A narrower grant of a read gives strictly *less* than the default
rather than more, so there is no escalation to close. The sentence naming a
setting as "Whole Church only, and never in scope at any narrower value" is how
this section says what this rule says, and it is written for settings and not for
audit on purpose. `accounts.manage` was the worst of them: a subtree-scoped grant is a
route to provisioning yourself an Admin account and signing in as one, which is the
escalation the whole catalog is arranged to prevent. Naming them one at a time is as
many chances to miss the next.

A **wider** grant is untouched. This section contemplates Admin issuing authority
beyond a role's defaults, and this rule is about a grant that cannot mean what it
says, not a cap on anyone.

**`people.correct_sex` exists at Whole Church and at no narrower scope**, and is the
case that first established the rule above. The catalog above gives it one scope, and the rule is stated here because the guard alone would not hold it: the guard asks whether the actor's grant covers the target, so a grant issued at `OWN_SUBTREE` would pass for anyone inside that subtree. Held at a subtree scope it becomes exactly the escalation route this capability is Admin-only to close — moving a person between Networks, and re-parenting them in the process, without ever holding `people.manage_pastoral_assignment` (Section 4). A grant of it at any narrower scope therefore covers nothing, and the operation refuses with `SCOPE_DENIED`, in the same spirit as the `read_only` rejection above: a row that cannot mean what it appears to mean is refused rather than honoured in part.

`read_only` belongs to `capability_grants` and to nothing else. **A role default carries no such flag**, and none is to be derived for one: a role's authority is exactly what the catalog above says it is. Anywhere an account's effective authority is presented — `/api/v1/auth/me` is the case that exists — authority carried by a role reports no `read_only` value rather than an invented one, because a client branching on a value this specification never defined is branching on a rule that does not exist.

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
- mobile number, or any other contact detail
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

A Cell meeting is one leader's meeting, and only that leader can say whether it took place. DCC is a single church-wide service. Whether it happened is one fact about the whole church, known to church leadership, not something several hundred leaders each report separately.

Where the church holds no service on a given Sunday — a calamity closing the building, or a Sunday absorbed into a conference — that Sunday simply carries no DCC event. The month then has one fewer applicable event, and every report follows automatically.

Removing a Sunday from the DCC calendar is a deliberate Admin action, never inferred from an absence of attendance records. It requires a reason, is audit logged (Section 21), and must be visible on any report covering that month, so that a month showing four events where the calendar shows five is explained rather than merely odd.

A leader who has not yet submitted their people's attendance for an event that did take place is a reporting gap, not a cancelled service. Those are tracked as coverage.

### DCC submission window

DCC attendance for a calendar month may be recorded or corrected until the 7th of the following month, at 23:59 Asia/Manila — the same close as Cell attendance (Section 13). After that the month is closed, and only Admin may amend it, using `records.backdate_effective_date` (Section 7), with a reason, audit logged, and surfaced in Network Summary as a correction.

DCC coverage is shaped differently from Cell coverage. A Cell has one leader and its coverage counts recorded meetings out of scheduled meetings. A DCC event is church-wide, and many leaders each record their own people, so DCC coverage counts **how many responsible leaders have a record for the event**, not how many events exist. It measures whether the record exists, never who entered it — a submission made on behalf, or by an upline standing in for a leader who holds no account (below), completes that leader's coverage.

Report that figure at every scope, as a single line, on the same terms as Cell coverage: factual, no ranking of leaders by it, and no derived score (Section 13).

```text
dcc_events
- id
- event_date          a Sunday, Asia/Manila
- removed_at          nullable
- removed_by          nullable
- removal_reason      nullable, required where removed_at is set
```

A removed event is retained rather than deleted, so a month showing four events where the calendar holds five is explained by a record rather than by an absence.

```text
dcc_attendance
- id
- dcc_event_id
- person_id
- present
- responsible_leader_id    nullable only for a Network root (below)
- recorded_by
- recorded_at
- superseded_at            nullable
- superseded_by            nullable
- correction_reason        nullable
- version
```

At most one non-superseded row may exist per `(dcc_event_id, person_id)`, enforced by a partial unique index where `superseded_at` is null. `superseded_by` holds the id of the replacing row, not an actor.

A correction never overwrites. The prior row is marked superseded and a new row written, so the record carries its own history (Section 1, Principle 12; Section 14).

### Generating the DCC calendar

DCC events are generated automatically, one per Sunday, on a rolling horizon of at least twelve months ahead. Every Sunday carries an event unless an Admin has deliberately removed it.

Do not create events lazily on first use. If an event exists only once somebody has recorded attendance against it, then a Sunday nobody submitted for has no event at all — and a missing event becomes indistinguishable from a cancelled service. That is precisely the ambiguity the Cell meeting statuses exist to remove (Section 13), and it must not be reintroduced here.

Because every Sunday has an event by default, an absent event always means a recorded, audited decision, and coverage is measurable against a denominator that exists before anyone submits anything.

### Attendance is face to face

Only physical attendance at the DCC service is recorded. Online or streamed participation creates no attendance record and affects no classification, monthly attendance bucket, total, or Participation report (Section 16).

This is a deliberate exclusion, not an omission. Recording attendance is a leader's responsibility for the people under them (below), and that responsibility rests on a leader knowing who was in the room. Do not add an online attendance state, a viewing record, or a separate present-state value for remote participation.

Naming Participation matters, because that is where the exclusion has pastoral rather than merely numerical effect: a person who watches every week online is indistinguishable from one who has stopped attending, and will appear on the list of people with no DCC attendance in three months. That is a consequence of the rule, and it must be a known one rather than a surprise.

The same rule applies to Cell meetings, and is stated in Section 12.

### Responsible leader for DCC attendance

The responsible leader for a person's DCC attendance is their **direct pastoral leader, as of the event date** (Section 5).

Every person has exactly one direct pastoral leader, so every person is covered exactly once. A leader records their **direct** pastoral children only; totals aggregate upward through the tree, so no leader re-records people their downline has already recorded, and nobody is missed between two levels.

**Cell leadership is not involved.** A leader who disciples people but leads no Cell is still the responsible leader for their direct children's DCC attendance. This is deliberately different from qualifying as a leader for counting (Section 11): responsibility for attendance follows position in the pastoral tree, while counting follows Cell leadership. A person may be a responsible leader without being counted as a leader, and that is correct.

**Fixed as of the event date.** A later reassignment never moves historical records. If a person moves from one leader to another in November, October's DCC records remain with whoever was responsible in October, and re-running October's report returns the same figures (Section 3).

**An upline leader may record on behalf** of a downline leader within their pastoral subtree (Section 14). The responsible leader remains the direct pastoral leader; the actor is recorded separately. Coverage measures whether the record exists, not who entered it, so a submission made on behalf completes that leader's coverage for the event.

**Where the responsible leader holds no account**, the submission falls to the nearest upline leader who does.

An account is provisioned when a person becomes a Cell Leader (Section 6), so a leader who disciples people but has not yet opened a Cell cannot sign in. They remain the responsible leader — the definition follows position in the pastoral tree and never depends on whether someone can log in — and their upline records for them under the on-behalf rule above.

The interface must make this workable. A leader's DCC checklist shows their own direct pastoral children, **and** the direct children of every downline leader for whom they are the nearest account-holding upline. That qualification matters: where a leader with an account sits between them and the leader without one, the obligation is the nearer leader's, and showing it to both leaves each assuming the other will submit.

Coverage will then show such a leader as covered by someone else every week, and that is worth seeing rather than hiding: a leader carrying several account-less downlines is stretched, and nothing else in the system would reveal it.

The arrangement is intended to be temporary. When that leader takes a Cell, their account becomes provisionable and, once provisioned, they become their own submitter and the covering load falls away. Leadership is earned by leading a Cell (Section 11), and the account follows the Cell rather than preceding it.

Provisioning is not automatic. Section 6 requires an actor holding both `cell.manage_leadership` and `accounts.manage` against that person, and where only the first is held the account step is left pending. A pending account can persist, so the covering arrangement must be able to persist with it rather than assuming it resolves on its own.

A Network root leader has no pastoral leader and therefore no responsible leader (Section 5, Network roots). Admin records their attendance, and roots are excluded from coverage denominators.

### DCC classification

Classification is derived from lifetime DCC attendance history:

- 1st DCC attendance -> `VIP`
- 2nd -> `2ND_TIMER`
- 3rd -> `3RD_TIMER`
- 4th -> `4TH_TIMER`
- 5th and beyond -> `REGULAR`

Classification is **evaluated as of the end of the reporting month**, from the attendance history standing at that moment. A person who was a VIP in October and attended again in November is a VIP on October's report forever. Without this rule a closed month's figures move every time someone attends again, which Section 20 forbids and Section 3 makes a reproducibility guarantee. Cell classification carries the identical rule (Section 12).

Do not let leaders manually maintain classification when it can be derived from attendance history.

### Adding a DCC VIP

When adding a VIP:

1. Search existing People first.
2. Reuse existing Person if matched.
3. Otherwise create one Person record using the core personal fields, **including the pastoral leader they are being placed under**.
4. Ask for a mobile number. It is optional (Section 3), but this is the moment it is most likely to be given and most needed later: a first-time visitor who does not return is exactly who Participation reporting surfaces (Section 16), and a leader cannot follow up a name alone.
5. Record DCC attendance only.
6. Do not automatically create Cell attendance.

The Person becomes available to other authorized modules, but participation remains domain-specific.

### A DCC attendance record requires a pastoral leader

Every DCC attendance record carries a responsible leader, and that is the person's direct pastoral leader (below). **The rule is written over the edge, not over the row.** A Person whose open pastoral assignment carries a null `leader_id` has no leader above them, and a Person with no open assignment row at all has no assignment to resolve one from; the two are different states and only the first is a Network root (Section 5, Network roots).

A Person with no open assignment row cannot have DCC attendance recorded, because there is no responsible leader to record it against. A Network root has an open row and no leader above them, which is the intended state rather than missing data: their attendance is recorded by Admin, their record carries no responsible leader, and they are excluded from coverage denominators. They remain in every unique-people total; nothing here removes the two Senior Pastors from the figures they appear in.

This is why step 3 above captures the leader at creation rather than leaving it for later. In practice the answer is already known outside the system: someone brings a visitor, and the leader they are being placed under is settled by that relationship before anyone opens the application. The workflow records a decision the church has already made.

Naming the leader on the creation form is not a side effect of another action, which Section 5 forbids. It is a field on the form, entered deliberately, and it creates a pastoral assignment subject to every invariant in Section 5 — in particular the same-Network rule.

Section 5 still permits a Person to exist with no active assignment, which happens during bulk import and wherever a record is created before the placement is settled. Such a Person simply cannot have DCC attendance recorded until they have a leader.

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

Classify each unique person by how many DCC services they attended that month.

Let **N** be the number of applicable DCC events in the month — the Sundays that carry a DCC event, per the DCC calendar above. N is normally 4 or 5, and is fewer where a Sunday carries no service.

Buckets are derived from N:

- Once
- Twice
- Thrice
- ... continuing to N-1
- Completed (N/N)
- Total unique people

Never label buckets from the number of Sundays in the calendar. A month with five Sundays where one carried no service has N = 4, and its highest bucket is `Completed (4/4)`.

`Completed` always means attendance at every applicable DCC event that month. It is never a fixed number and never an arbitrary reporting limit.

Cell monthly attendance derives its denominator the same way (Section 12), but the two domains diverge deliberately beyond that: DCC aggregates its buckets at any scope because one applicable event set covers the whole church, while a Cell's N belongs to that Cell alone and its buckets are a Cell-scope view only. Section 12 gives the reason.

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

```text
cells
- id
- cell_id             CELL-000000, server-assigned, immutable, never reused
- state               ACTIVE | CLOSED
- closed_at           nullable
- closure_reason      nullable, required where closed_at is set
- closure_note        nullable, required where the reason is OTHER
- created_at
```

Leader, category and schedule are not columns here. Each is effective-dated in its own table, so a Cell's report for a past month reads the values in force then (Sections 10 and 11).

### Cell ID generation

The internal UUID is the key every relationship points at. The Cell ID is a human-readable handle for staff, reports, and conversation — the same split as Person (Section 3, Two identifiers, two jobs).

- Format `CELL-` followed by six zero-padded digits, from a database sequence.
- Assigned once, at creation, by the server. Immutable thereafter.
- **Never reused.** A closed Cell keeps its ID permanently (Cell lifecycle, below), and reassigning it would make two different Cells share an identifier across time.
- Gaps are expected and acceptable. The Cell ID is a handle, not a count of Cells.
- **It encodes nothing.** Not category, not Network, not year, not leader.

The last rule matters more here than it looks. Category is editable and the Cell ID deliberately does not change with it (Category changes, below), so an identifier such as `YTH-0042` becomes a lie the moment a Youth Cell becomes Young Pro. Every attribute a Cell ID might encode is an attribute that can change.

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

```text
cell_categories
- id
- cell_id
- category           YOUTH | YOUNG_PRO | COUPLE
- actor_id
- started_at
- ended_at           nullable
```

Cell category is editable over time, e.g. Youth -> Young Pro.

- Keep the same Cell ID.
- Preserve category history with effective dates.
- Historical reports must use the category valid at the time being reported.
- Audit category changes.

### Schedule changes

Day and time are editable over time, and are effective-dated exactly as category is:

```text
cell_schedules
- cell_id
- day_of_week
- time_of_day
- started_at
- ended_at nullable
```

This is not optional bookkeeping. Scheduled meetings for a month are derived by running the Cell's configured day against the calendar (Sections 12 and 13), so a report for a past month must use the schedule that was in force **during that month**, never the current one.

Without history, moving a Cell from Saturday to Sunday in June silently rewrites the coverage figure for every earlier month, because March has five Sundays and four Saturdays. A month recorded as `4 of 4` becomes `4 of 5`, and shifts again on the next schedule change. That breaks the guarantee in Section 3 that a past period's figures do not move.

**A schedule change takes effect at the start of the following month.** A Cell moving from Saturday to Sunday, decided in August, runs on Sunday from 1 September. A month therefore has exactly one schedule throughout.

A Cell running for a whole month has 4 or 5 scheduled meetings. A Cell created or closed part-way through a month has fewer, because its schedule row opens at approval (Creating a Cell, above) or ends at closure. That is a partial month rather than an anomaly, and N follows from the meetings actually recorded either way.

Mid-month changes were considered and rejected. Resolving them per week is possible but leaves a month able to hold three or six scheduled meetings, sometimes two on consecutive days, and the coverage denominator becomes something a leader cannot predict from their own calendar.

A Cell needing to move a **single** meeting at short notice — a lost venue, a clash — does not use the schedule for it. That is a `RESCHEDULED` meeting (Section 13). The two mechanisms are deliberately separate: the schedule is the Cell's standing day and time, and a reschedule is one meeting moving once.

Two invariants here are expressible as database constraints and must exist as constraints, not only in service code (Section 5, Database enforcement):

- one active schedule per Cell — a partial unique index on `cell_id` where `ended_at` is null
- a schedule row starts on the first day of a month — a trigger, not a check constraint, because the rule admits an exception a row-level check cannot see

The second admits one exception: a Cell created part-way through a month opens its first schedule row at approval. Only `records.backdate_effective_date` may open a schedule row on any other date, and doing so is a correction, audited as one.

Audit schedule changes as category changes are audited.

### Creating a Cell

A Cell is created through a two-step workflow: the prospective leader's upline **requests** it, and **Admin approves**. **No actor may approve a request they submitted.**

Outside initial encoding (Section 2), this is the only path by which a Cell comes into existence. `cell.manage_lifecycle` governs closure and confers no power to create one (Cell lifecycle, below).

**Step one — the request.** A leader upline of the prospective Cell Leader submits a request naming that person, the Cell's category, and its day and time. The capability is `cell.request_creation` (Section 7), held over the actor's subtree **excluding themselves**. In practice this is a leader saying that one of their own disciples is ready to lead.

No holder of the capability, at any scope, may name themselves. Without that exclusion a leader whose only Cell has closed — who keeps their account (Section 11) — could restore their own Current Cell Leader status, re-enter New Cell Leaders for the period, and restore their upline's Leaders-with-12+ count, with no upline involved and with Admin, who has no pastoral basis to judge readiness, as the only reviewer. Section 5, invariant 4 writes the same prohibition for pastoral assignment, for the same reason.

**Step two — Admin approves.** The capability is `cell.approve_creation`, held by Admin only and granted to no other role.

The enforceable control is the per-request rule stated above: **no actor may approve a request they submitted.** That is what must be checked on every approval, and it holds even where one person happens to hold both capabilities. Do not rely instead on the two capabilities never meeting in one actor — Admin holds both by default, and separation expressed only through role defaults is separation an Admin-issued grant can undo (Section 7).

Admin holds approval because approving a new Cell Leader means provisioning their account, and Section 6 requires one actor to hold both `cell.manage_leadership` and `accounts.manage` against the same target. Admin is the only role holding `accounts.manage` (Section 7), so approval and the account land with one authorized actor rather than stalling between two.

**Approval revalidates the target.** The state at approval governs, never the state at request. Reject the request, creating nothing, where the prospective leader has since been archived (Section 3), absorbed by a Merge (Section 3), moved outside the requester's authorized subtree, or had their Network changed (Section 4). Approval must also confirm that the prospective leader and their pastoral leader share a Network, because a Cell inherits its leader's Network and Section 5 forbids a cross-Network edge.

Without revalidation, approval creates an active leadership assignment for an archived Person and proceeds to provision their credentials — precisely the outcome Section 3's archive guard exists to prevent.

**On approval**, in a single transaction:

- the Cell is created as `ACTIVE`, with a server-assigned Cell ID (above)
- its category history row opens (Category changes, above)
- its schedule row opens (Schedule changes, above)
- the Cell leadership assignment is created for the named leader (Section 11)
- the account step for that leader proceeds (Section 6)

The category and schedule rows are not optional extras. A Cell created without a schedule row has no derivable set of scheduled meetings, and therefore no coverage figure for its first month (Section 12).

**Everything takes effect at approval, never at request.** New Cell Leaders is defined by when a leadership assignment starts (Section 16), so a request submitted on 30 September and approved on 2 October belongs to October. Nothing about a request is backdated to when it was made.

**Direct creation during initial encoding.** While initial encoding is open (Section 2), Admin may create a Cell and its leadership assignment directly, without a request. That path closes with the phase and is not available afterwards.

```text
cell_creation_requests
- id
- prospective_leader_id
- requested_by
- category                YOUTH | YOUNG_PRO | COUPLE
- day_of_week
- time_of_day
- state                   PENDING | APPROVED | DECLINED
- decline_reason          nullable, from the fixed list below
- note                    nullable, required where the reason is OTHER
- decided_by              nullable
- cell_id                 nullable, set on approval
- requested_at
- decided_at              nullable
```

**Request states.** A request is `PENDING`, `APPROVED`, or `DECLINED`. Never add another. A `PENDING` request creates no Cell, holds no members, records no attendance, and appears in no count or metric. At most one `PENDING` request may exist for a given prospective leader. Enforce it with a partial unique index on the prospective leader where the state is `PENDING`, exactly as pastoral assignment and Cell membership do for their own single-active rules (Section 5, Section 10). Without it two uplines may each submit, both may be approved, and nothing downstream catches the duplicate, because a leader may legitimately lead many Cells.

Declined requests are retained — they are part of the record of how a leader was developed.

**Declining.** Admin may decline a request with a reason, from a fixed list:

- `LEADER_DEVELOPMENT_CONTINUING`
- `TIMING_DEFERRED`
- `DUPLICATE_REQUEST`
- `SUBMITTED_IN_ERROR`
- `OTHER` — requires a note

The list is fixed and not administrator-configurable, for the reason given in Section 13. It is deliberately short and neutral. A decline is a durable record about a named person, and an unconstrained free-text field is exactly where a judgmental label about a prospective leader would be written (Section 1, Principle 7). A decline records that a Cell was not opened at this time. It never records an assessment of the person.

**Seeing the queue.** Pending requests appear on the Admin dashboard (Section 19), and a request's outcome appears to the requester in their own outstanding work (Section 19). Neither is a notification; notifications remain confined to Section 13. This surface is necessary rather than optional: a pending request holds up a real leader's account provisioning, so the person who can act on it must be able to see it.

**Why two steps.** Creating a Cell mints a Cell Leader, and that act moves Current Cell Leaders, New Cell Leaders for the period, and the requesting leader's own progress toward Leaders with 12+ Direct Leaders (Section 16). The requester benefits from the outcome, so a second party is required.

The same shape governs the other actions where a leader would benefit from the result. Archival reduces a leader's own People count, and is requested by a leader and performed by Admin or a Senior Pastor. Person Merge lowers totals for periods already reported, and is Admin only — not held by Senior Pastors (Section 3, Section 7).

**What the system does not model.** The church communicates a new Cell Leader to the Senior Pastors and their direct leaders outside the application, in conversation. Do not build a notification or an approval tier for that. It is a different thing from the Admin queue above, which is the workflow's own task surface.

### Cell lifecycle

A Cell Group is `ACTIVE` or `CLOSED`. Every count of Cells, Cell Leaders, Cell categories, and Cell members means active Cells unless a report explicitly says otherwise.

#### Closing is declared, never inferred

No period of inactivity closes a Cell. Not three months of `NOT_HELD`, not three months of silence, not any threshold.

The reasoning is the same as for `NOT_HELD` itself (Section 13). A leader honestly declaring `NOT_HELD` through a difficult quarter is engaged and telling the truth; closing their Cell for it teaches them to record `HELD` instead. A leader who has reported nothing has told the system nothing, and inferring closure from silence asserts a fact on no evidence.

Automatic closure would also defeat two rules deliberately written elsewhere. Archiving a Person who leads a Cell is rejected until the Cell is resolved (Section 3); if Cells closed themselves, that decision about their members could be waited out instead of made. And Cell Leader is the qualification for a Leader account (Section 6), so an inferred closure could remove a real leader's system access while they are caring for a sick parent.

Prolonged inactivity is a signal worth surfacing to a person, and Section 15 requires it. It is never an instruction to the database.

#### Closure reasons

Exactly:

- `MERGED_INTO_ANOTHER_CELL`
- `LEADER_STEPPED_DOWN` — with no replacement leader
- `MEMBERS_DISPERSED` — members moved away, graduated, or transferred
- `CREATED_IN_ERROR`
- `OTHER` — requires a note

Multiplication is deliberately absent, and must not be added. When a Cell multiplies, a disciple opens a new Cell and the original continues under the same leader. Multiplication creates Cells; it never closes one. A leader who hands their Cells to disciples and stops leading has stepped down, which the list already covers.

Keep every reason factual and free of judgement (Section 1, Principle 7). A closure is an operational fact about a Cell, never an assessment of its leader.

#### What closing does

Closing a Cell is governed by `cell.manage_lifecycle` (Section 7). Creating one is not: outside initial encoding (Section 2), a Cell comes into existence only through the request-and-approve workflow above, and `cell.manage_lifecycle` confers no power to create. Closing is an explicit, authorized, audited action carrying an effective date and a reason, held by the Cell's current leader, any leader upline of them acting within their own authorized subtree, Admin, and Senior Pastors.

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

A Cell's monthly denominator is its own recorded meetings and is never combined across every Cell the same leader happens to lead (Section 12). For example, if Mark leads `CELL-001842` (Youth) and `CELL-002193` (Young Pro), Juan — assigned to `CELL-001842` — is evaluated only against `CELL-001842`'s meetings; `CELL-002193`'s meetings are not part of Juan's denominator. Do not introduce a "primary Cell" concept — the single active assignment already defines this relationship.

**A person's attendance is recorded against the Cell whose meeting they attended**, always, and moving between Cells never alters a record already made.

How a person who moved is presented in monthly reporting is defined in Section 12: they appear in the report of each Cell whose meetings they attended. Whether that is the right answer is open, and Section 12 records it as a fairness question rather than a Stop Condition — an implementer follows the rule and does not stop.

What holds regardless: their attendance at each Cell stays in that Cell's meeting records; they are counted once at leader and Network scope; and they remain in Total People and in Participation (Section 16) whatever their Cell membership.

At leader and Network scope this changes nothing, because those totals deduplicate with `COUNT(DISTINCT person_id)` (Section 12) and the person is counted once regardless of how many Cells they passed through.

### Only members are recorded

Cell attendance is recorded only for the Cell's own members. The roster for a meeting is exactly the people holding an active membership of that Cell on the meeting date.

Where a meeting was rescheduled (Section 13), the roster is taken from the **actual date the meeting took place**, not the date it was originally scheduled for. Membership can change between the two, and the roster should be the people who could actually have been there. The meeting still belongs to its original reporting month; only the roster follows the actual date.

There is no visitor or guest state. A person coming to a Cell for the first time is added as a member by the leader, and then recorded present. A person is either a member of the Cell or is not recorded against it.

This keeps one list on the leader's screen rather than two, and keeps the roster, the membership, and the monthly denominator the same set of people.

Attendance at another leader's Cell is not recorded. Someone who visits a Cell they do not belong to is not marked present there, and their own monthly denominator remains their own Cell's meetings.

The consequence is accepted deliberately: a person who attends once and does not return remains a member until removed, and counts toward that leader's member total. Removing them is an ordinary authorized action (below), so this is routine tidying rather than a defect. Do not compensate for it by inventing a visitor state or by expiring membership automatically — membership ends when a person ends it (Section 10, Cell lifecycle applies the same principle to Cells).

Cell attendance still never creates or ends membership by itself. Membership changes only through the explicit workflow below, and marking someone present is not that workflow.

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

### What "qualifies as a leader" means

For counting — Direct Leaders (Section 5) and Leaders with 12+ Direct Leaders (Section 16) — a person qualifies as a leader when they are a **current Cell Leader**: they hold at least one active Cell leadership assignment on an `ACTIVE` Cell.

Leadership is earned by leading a Cell, not conferred by designation. There is no commissioning flag, no graduation status, and no leader role existing apart from actually leading a Cell.

A person with disciples but no Cell is not counted as a leader. They remain in Total People, they appear in the pastoral tree, and their own disciples count normally. They enter the leader count when their Cell opens.

**Qualification is not filtered by recent activity.** A leader whose Cell has met irregularly, or who has honestly declared `NOT_HELD` through a difficult season (Section 13), remains a current Cell Leader. Filtering the count on recent meetings would remove a leader for reporting truthfully, and would make every development metric flicker month to month with the timing of submissions.

The expectation of weekly meeting is real, and it is enforced through the Cell rather than through the count. A Cell that has genuinely stopped meeting appears on the attention list (Section 15), and a person closes it. Closing ends the leadership assignment, and that is what removes the leader from the count — a recorded human decision, never a filter applied at report time.

**Authorization never consults this definition.** Whether someone may reassign a person, manage Cell membership, or take attendance depends on their capability grant and their position in the pastoral tree (Section 7), not on whether they currently lead a Cell. A leader who has stepped back from leading keeps managing the people pastorally under them. Hierarchy position and system permission are separate concepts (Section 1, Principle 3).

---

## 12. Cell Attendance

Sidebar label: `Cell Attendance`.

Cell Attendance uses the same familiar checklist UX as DCC but is a separate attendance domain.

DCC attendance and Cell attendance must never automatically create each other.

Cell attendance is face to face. Only physical attendance at the Cell meeting is recorded; online or remote participation creates no attendance record and affects no classification, monthly attendance bucket, total, or Participation report. This mirrors DCC (Section 9), and for the same reason: recording attendance is the leader's responsibility for the people in front of them.

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

Two artifacts, doing two different jobs. Conflating them is a mistake this specification made twice and reversed twice; the note at the end of this section records why.

- The **monthly report** is statistical. It reconciles, it is reproducible, it aggregates. Its population is the people who attended.
- The **roster view** is operational. It shows a leader every member and who came. It reconciles with nothing, because it makes no statistical claim.

#### Classification

Population: the unique people who attended this Cell at least once in the reporting month.

- VIP
- 2nd Timer
- 3rd Timer
- 4th Timer
- Regular
- Total unique people

Classification is **evaluated as of the end of the reporting month**, from the attendance history standing at that moment. A person who was a VIP in October and attended again in November is a VIP on October's report forever. Without this rule a closed month's figures move every time someone attends again, which Section 20 forbids and Section 3 makes a reproducibility guarantee.

Classification carries no denominator, so it aggregates at any scope: a person's bucket is the same figure whichever Cell they attended.

#### Monthly Attendance

Population: the same unique people who attended this Cell at least once in the month. Both views therefore cover the same people and reconcile to the same total (Section 20).

Each Cell has one logical scheduled meeting per calendar week, per its configured schedule (Section 10, Schedule changes). A Cell running for a whole month therefore has 4 or 5 **scheduled** meetings. A Cell created or closed part-way through a month has fewer, and that is not an anomaly.

Scheduled meetings are not the denominator. The denominator is the meetings that actually took place and were recorded:

```text
N = count of HELD + RESCHEDULED meetings
    for the Cell, in that month
```

`NOT_HELD` meetings are excluded. Nobody can attend a meeting that did not take place, and counting one would mark every attendee absent for something that never happened.

Unreported meetings are excluded. An unreported meeting is an absence of data, not a fact about attendance (Section 13). Treating silence as non-attendance penalises disciples for a record their leader has not yet submitted.

Buckets are derived from N:

- Once
- Twice
- Thrice
- ... continuing to N-1
- Completed (N/N)
- Total unique people

`Completed` means attendance at every recorded meeting of this Cell in the month. Never label buckets from the calendar count.

**Where N is zero**, the Cell recorded no meetings, so nobody attended and the population is empty. The view shows the coverage line alone and no buckets. Do not render a `Completed (0/0)` bucket: with no meetings there is nothing to complete, and a bucket whose condition every person satisfies is not a bucket.

Every Cell monthly attendance view shows recording coverage beside the buckets, as a single line — for example `4 of 5 meetings recorded`. Coverage is never a bucket and never a status.

Coverage is what stops a thin record reading as a strong one. A Cell that records one meeting of four and reports every attendee as `Completed (1/1)` is not a complete Cell, and the coverage line says so on the same screen, factually and without judgement.

#### Monthly Attendance does not aggregate

**Bucket views exist at Cell scope only.** At leader, Network and Whole Church scope, report unique people, classification, and coverage — never monthly-attendance buckets.

N belongs to a Cell. Two Cells in the same month can hold N = 5 and N = 2, so a member of the second who attended twice is `Completed` while a member of the first who attended twice is `Twice`. Placing both in one column makes aggregate `Completed` mean "attended everything their own Cell happened to record", which is inflated by exactly the Cells that recorded least. A leader recording one meeting a month would contribute the most `Completed` people in the Network.

That is the pattern Section 13 removes from meeting status, reappearing in a denominator. It is not fixable by relabelling, because the buckets have no common axis to relabel onto.

DCC aggregates precisely because it does not have this problem: there is one applicable event set for the whole church in a month, so every person shares one N (Section 9). The asymmetry is real and deliberate, not an inconsistency between the two domains.

#### The roster view

The monthly report cannot show a leader who did **not** come, because its population is people who attended. That person is often the one most worth seeing, so the leader gets a second artifact for it.

The roster lists every current member of the Cell with their attendance for the month — which meetings they attended, and whether they attended at all. It is available to the Cell's leader, their upline within scope, Admin and Senior Pastors.

It is an operational list, not a statistical report. It carries no buckets, no classification, and no totals that must reconcile with anything, and it is never aggregated across Cells. It reflects membership as it currently stands, so unlike the monthly report it is **not** reproducible for a past period and must not be presented as though it were.

Keep the wording factual. A member with no attendance is shown with no attendance; nothing labels them, scores them, or orders members against one another (Section 13).

#### Scope

A Cell report belongs to the Cell's leader. It appears within the authorized scope of that leader, their upline, Admin and Senior Pastors (Section 15). It is not resolved through the pastoral leader of each individual member, who may differ — membership need not mirror pastoral assignment (Section 10).

#### What is deliberately unsettled

Three questions about Cell monthly attendance remain live. Two have defined behaviour and are open only as to whether that behaviour is right; the third has none.

The rules above **do** define what happens in each of the first two cases. What is unsettled is whether the answer is the right one:

- A person who attended a Cell and has since left appears in that Cell's report, because the population is who attended it. Whether a leader should see someone no longer theirs is open.
- A member who joined part-way through the month is measured against the Cell's whole month, so `Completed` is unreachable for them and they read the same as a full-month member who came once. Whether that is acceptable is open.
- What an aggregate view should offer in place of buckets, beyond unique people and coverage, is genuinely undefined.

The first two are fairness questions with a defined behaviour behind them; an implementer follows the rules above and does not stop. The third has no defined behaviour and is a Stop Condition.

Each of the first two was previously "fixed" by changing the definition, and each fix broke either reconciliation (Section 20) or reproducibility (Section 3). Settle them against real data during implementation, verify with the reconciliation tests, and record the ruling here.

Whatever answers them must satisfy all of: every person in the population lands in exactly one bucket of each view; both views sum to the same total; a closed month's figures never move; no bucket rewards a Cell for recording fewer meetings; and no person's silence is reported as another person's absence.

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

Before close, outstanding records are surfaced in two distinct ways, and they must not be confused.

**Every leader sees their own outstanding work**, always, on their dashboard: meetings awaiting a record appear as tasks with the action attached (Section 19). This is not a notification and is not limited to anyone; it is simply the leader's own list.

**Notifications go to the direct leaders of both Senior Pastors, and to Admin.** In-app notifications about outstanding records are sent to the direct pastoral children of Bishop Oriel Ballano, the direct pastoral children of Pastora Geraldine Ballano, and Admin. Nobody else receives one.

```text
notifications
- id
- recipient_account_id
- kind
- period              nullable, the month the content concerns
- payload             rendered at read time, never stored beyond what scope permits
- read_at             nullable
- created_at
```

**The Senior Pastors are deliberately not notified.** They retain full church-wide visibility and see everything they choose to look at (Section 7); they are simply not the people the application interrupts. Following up an outstanding record is the work of the leaders directly under them, and a notification reaching the top of the church for a Cell that has not filed a record inverts that.

Recipients see church-wide figures, including names, which exceeds the own/subtree scope a leader holds by default. That visibility is not implied by their position — Section 7 is explicit that a Senior Pastor's direct leaders receive no wider scope by virtue of being in the direct 12. It comes from an explicit, Admin-issued grant of `reports.view_subtree` at Whole Church scope, read-only, recorded and audited like any other grant.

Notification content never exceeds the recipient's granted scope. Where the grant is withdrawn, the notification narrows with it rather than continuing to disclose what the recipient may no longer see.

Notifications are in-app only. No email, no SMS, no push.

The system does send transactional email — password reset and account activation — and that provider stays (Sections 2 and 6). What this rule settles is that pastoral reminders add no channel beyond the application itself: no scheduled mail job, no queue, and no background worker, and no church data leaving the system inside a message.

The design is deliberate. Accountability in this church runs through pastoral relationship, not through the application: the two Senior Pastors and their direct leaders see where their Networks stand, and follow up with the people they oversee personally. A leader behind on records hears from their own leader, not from an automated message. The application's job is to make the gap visible to the person who will make the call.

```text
cell_meetings
- id
- cell_id
- week_starting           the Monday of the week this meeting belongs to (Section 20)
- reporting_month         the month this meeting reports in, fixed at creation
- scheduled_date
- status                  HELD | RESCHEDULED | NOT_HELD
- scheduled_time
- actual_date             nullable, set where the meeting was rescheduled
- actual_time             nullable
- not_held_reason         nullable, required where status is NOT_HELD
- not_held_note           nullable, required where the reason is OTHER
- facilitated_by          nullable, defaults to the Cell's current leader
- responsible_leader_id
- submitted_by            nullable
- submitted_at            nullable
- version                 for conflict detection (Section 14)
```

```text
cell_meeting_changes
- id
- cell_meeting_id
- from_status
- to_status
- from_date               nullable
- from_time               nullable
- to_date                 nullable
- to_time                 nullable
- reason                  nullable
- note                    nullable
- actor_id
- occurred_at
```

A meeting's changes live in their own rows, not in columns on the meeting. A meeting rescheduled twice would overwrite the first reschedule in a single set of columns, and Section 13 requires a `RESCHEDULED` meeting later declared `NOT_HELD` to preserve both records. The same argument that made attendance append-only applies here: the record must carry its own history (Section 1, Principle 12).

`reporting_month` is stored rather than derived. A rescheduled meeting keeps its original reporting month even when its actual date falls in the next one (below), so deriving the month from a date would move the meeting between periods the moment it is rescheduled.

```text
cell_attendance
- id
- cell_meeting_id
- person_id
- present
- recorded_by
- recorded_at
- superseded_at        nullable
- superseded_by        nullable
- correction_reason    nullable
- version
```

At most one non-superseded row may exist per `(cell_meeting_id, person_id)`. Enforce it with a partial unique index where `superseded_at` is null (Section 5, Database enforcement); two live rows for one person at one meeting inflate their monthly bucket and break the reconciliation in Section 20.

`superseded_by` holds the id of the row that replaced this one, not an actor. The actor is `recorded_by` on the successor.

A correction never overwrites in place. The prior row is marked superseded and a new row written; `version` detects a concurrent write (Section 14) and is not a history mechanism. An `UPDATE` plus an audit row does not satisfy Principle 12 — the record must carry its own history, and a shape offering only one mutable row per person per meeting cannot.

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
- show a Cell's category and schedule history, with effective dates
- show a Cell's roster for a month: every current member and their attendance (Section 12, The roster view)
- drill into a leader and then into each Cell
- show classification and monthly attendance reports
- show Met / Moved / Did not meet counts and trends factually, with the reason breakdown and the coverage line (Section 13)
- show meetings conducted by someone other than the Cell leader, as a factual support signal, never as a score

### Cells needing attention

Surface Cells that have gone quiet, as a working list for the leader who oversees them:

- Cells with no meeting held for a set number of months, three by default. The threshold is a single church-wide Admin setting, changed under `settings.manage` (Section 7) and audit logged, never per leader: an attention list that differs by viewer makes two people discussing the same Cell talk past each other, one seeing it flagged and the other not.
- Cells with meetings still awaiting a record (Section 13)
- People with no active Cell membership within the viewer's scope (Section 10)

Each entry offers the actions that resolve it — recording the missing meeting, confirming the Cell is still running, or closing it with a reason. The list detects; a person decides. Nothing on it changes any record on its own.

This is an attention list, not a ranking. It is filtered by a threshold, never sorted into an order of merit, and carries no score or colour grading (Section 13, Meeting summary and the ranking prohibition).

Because the threshold triggers a prompt rather than a state change, it can be tuned freely. Nothing irreversible depends on where it is set.

Schedule and category history are shown because both are effective-dated, and both change what a past month's figures mean (Section 10). A Cell that has moved day three times in a year is worth a leader knowing about; it usually means a venue problem or a leader under strain.

Both are shown as history, never as a count or a rate. Do not derive a stability score, do not surface frequent changes on the attention list, and do not order leaders by them. A leader who changes day often is not thereby a worse leader, and Section 13's prohibition on derived scores applies here exactly as it does to meeting status.

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

A current Cell Leader qualifies for `Cell Leaders with 12+ Members` when at least 12 distinct people belong (per Section 10, Cell Membership) to one or more Cell Groups led by that leader, **as of the end of the period being reported** — which for the current period means now. Section 3 already classes this as a current-state metric reflecting state as of the period reported; naming the as-of date here keeps it agreeing with the membership figures for the same month, and stops a closed period's answer moving as people join and leave.

This metric is based on current Cell membership, not DCC attendance and not Cell attendance for a selected month.

If a leader has multiple Cells, deduplicate people across those Cells — count each person only once per leader, even if they belong to more than one Cell led by the same leader.

Use positive/factual wording such as:

- `Cell Leaders with 12+ Members`
- progress display such as `8 / 12`, `12 / 12`

Do not label leaders negatively for being below 12.

### Leaders with 12+ Direct Leaders

Definition:

A leader with at least 12 direct pastoral children who qualify as leaders (Section 11, What "qualifies as a leader" means) — that is, twelve immediate children who are each themselves a current Cell Leader.

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
- Cell coverage — monthly-attendance buckets are a Cell-scope view only (Section 12)
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

### The sidebar is navigation

The sidebar carries links, never counts. Metrics belong on the Dashboard and inside the reporting modules, where they can carry the scope and period that make them meaningful. Adding live numbers to navigation means computing scoped queries on every page load and displaying figures stripped of the context needed to read them.

This is the same rule already applied to leadership-development metrics and Participation, both of which live inside Network Summary rather than earning their own sidebar link (Section 16).

### Dashboard

Every tile carries four things: what it counts, the value, the scope it covers, and the period it covers.

```text
People                          DCC — October 2026
11,480                          4,120 people attended
Whole Church · as of today      Whole Church · open until 7 Nov
```

Scope must appear on the tile. The same tile reads 12 for a Cell leader and 11,480 for a Senior Pastor, and a figure without its scope cannot be discussed, screenshotted, or compared.

**Separate current-state tiles from period-based tiles.** Total People, Cell Leaders, Cell Groups and Direct Leaders are current-state and carry no period. Attendance figures are period-based and are meaningless without one. Group them separately; never interleave them in one row. Section 3 depends on this distinction being clear, and a dashboard is where it is most easily lost.

**An open period must say so.** A month still open for submission is still changing. The same tile on the 5th and the 31st of a month shows very different numbers with nothing having happened.

**Attendance tiles count unique people, never occurrences.** A tile reading `DCC` shows the number of distinct people who attended at least once in the period, per Section 9, and drills through to the classification and monthly attendance views. Never surface an occurrence total as a headline figure (Section 1, Principle 10).

### Lead with what needs doing

A dashboard of counts tells a leader nothing to act on. Dashboard is the first item in the sidebar and the screen every user lands on, so outstanding work belongs above the numbers:

- meetings awaiting a record, for the user's own Cells (Section 13)
- Cells needing attention within their scope (Section 15)
- people with no active Cell membership within their scope (Section 10)
- the outcome of a Cell creation request the user submitted (Section 10)

Each entry carries the action that resolves it.

### Dashboards differ by role

One fixed set of tiles serves nobody. A Cell leader has no downline leaders to count; a Senior Pastor has no attendance of their own to record.

- **Cell leader** — meetings awaiting a record first, then their own Cells: members, and this month's recorded meetings and attendance.
- **Upline leader** — Cells needing attention first, then subtree totals: People, Direct Leaders, Cell Leaders, Cell Groups, and recording coverage.
- **Senior Pastor** — scope selector for Whole Church, Men's, and Women's; church-wide totals, coverage, and the Development metrics from Section 16.
- **Admin** — platform operations, per the Admin dashboard below, not pastoral metrics.

No dashboard ranks leaders, scores them, or colour-grades them (Section 13, Meeting summary and the ranking prohibition).

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

- Pending Cell creation requests (Section 10)
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

**The conversion runs the other way too, and it is fixed here rather than per endpoint.** A date-only field that has to become an instant — an effective date on any effective-dated relationship (Sections 4, 5, 10, 11) is the case that arises first — resolves to **00:00:00 on that day in Asia/Manila**. The day is the unit a person submitted, so the instant that represents it is the moment the day begins; anything else would place a record on a day nobody named. Both directions use the named zone, never a literal `+08:00`.

Never bucket a report directly by a raw UTC timestamp. A Cell meeting at 16:00 Saturday in Manila is 08:00 Saturday UTC and buckets correctly by accident, but a record written at 07:00 Monday in Manila is 23:00 Sunday UTC, and a report grouped in UTC places it in the wrong week and, at a month boundary, the wrong month. Historical reports would then disagree with what leaders actually recorded.

Asia/Manila observes no daylight saving time, so the offset is a constant +08:00. Do not hard-code `+8`. Use the named zone, so the system stays correct if that ever changes.

**A calendar week begins on Monday**, following ISO 8601, consistently with the date format used throughout. Sunday belongs to the week that began on the preceding Monday.

This is not a formatting preference. Section 13 makes the weekly meeting the unit of a Cell's identity — one logical meeting per Cell per calendar week, whatever date it lands on — so the week boundary decides which meetings fall in which week, and a rescheduled meeting's week is the week it was scheduled in. A Sunday-start convention is common locally and will be somebody's default, which is why the rule is fixed here rather than left to the calendar library.

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

### Closed periods are stable

A month closes on the 7th of the following month, 23:59 Asia/Manila (Sections 9 and 13). After close, no leader may add or correct a record, and only Admin may amend, with a reason and an audit entry.

A closed month's figures are therefore stable, and its reports **are** computed once and stored rather than recalculated on every request. Only the open month requires live computation. At the scale this church actually runs (Section 2), this is a requirement rather than an optimisation.

This matters at whole-church scope. A Network Summary for a single month aggregates a recursive walk of the pastoral tree against every DCC event and every Cell meeting in that month, deduplicated by person and bucketed twice, and each drill-down repeats it at a narrower scope. Recomputing years of closed history on every page view is avoidable work that the submission window has already made unnecessary.

Stored figures are invalidated and recomputed whenever the records they derive from change. Attendance amendment is not the only such change:

- **An Admin amends attendance in a closed month** (Sections 9 and 13). Invalidates that month.
- **A Person Merge** (Section 3). Invalidates **every** period, not one month. Identity resolution applies to all periods, and a merge deliberately lowers the unique-people total for periods already reported.
- **A backdated effective date** on any effective-dated relationship (Section 5). Invalidates every period the effective date reaches back into, because it changes which subtree a person belonged to during those periods.
- **An Admin reversal of a Cell closure** (Section 10). Invalidates the periods affected.

Prefer not to enumerate these in code at all. Key each stored figure to a version of the source records it derives from, and treat any change to those records as invalidating.

```text
report_snapshots
- id
- report_kind
- scope_type              CELL | LEADER | NETWORK | WHOLE_CHURCH
- scope_id                nullable for Whole Church
- period                  the reporting month
- source_version          see below
- payload
- computed_at
```

`source_version` is a value that changes whenever any record the figure derives from changes. A monotonic counter incremented by every write to attendance, membership, assignment, lifecycle, or merge — scoped no more narrowly than the widest of those a report reads — is sufficient and is cheaper to reason about than tracking which rows a given figure touched. A snapshot whose `source_version` no longer matches is recomputed rather than served. A hand-maintained list of triggers is a list somebody eventually forgets to extend, and a stale stored figure fails silently — it returns a number that looks right.

Stored figures are a cache, never a source. They are always derivable from the underlying records (Section 18), and a stored figure that cannot be reproduced from source data is a defect.

### Reconciliation

Both views of a domain cover the same population, and both must sum to it.

For DCC, the population is the unique people who attended at least once in the scope and period (Section 9):

```text
VIP + 2nd + 3rd + 4th + Regular              = Total Unique People
Once + Twice + Thrice + ... + Completed      = Total Unique People
```

For Cells, the population is the unique people who attended a Cell in the scope and period (Section 12):

```text
VIP + 2nd + 3rd + 4th + Regular              = Total Unique People
Once + Twice + Thrice + ... + Completed      = Total Unique People
```

Both domains report on attendees, so both reconcile the same way. Cell monthly-attendance buckets exist at Cell scope only, so the second identity is checked per Cell; classification reconciles at every scope, because it carries no denominator (Section 12).

A Cell's members who did not attend are shown in the roster view (Section 12), which is an operational list rather than a statistical report and reconciles with nothing. Attempts to make one report do both jobs failed twice, in both cases by breaking one of the two identities above.

If reconciliation fails, treat it as a data and reporting integrity issue.

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
- Cell creation requested
- Cell creation approved
- Cell creation declined, with reason
- Cell created directly by Admin during initial encoding
- Initial encoding closed
- Cell creation
- Cell leader assignment
- Cell category change
- Cell schedule change, day or time, with effective date
- Cell meeting rescheduled
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
- System setting changed, with previous and new values

```text
audit_log
- id
- actor_id            nullable only for a system action
- action              an identifier from the list above
- target_type
- target_id           required; text, because not every target is keyed by a UUID
- before              nullable
- after               nullable
- reason              nullable, required where the action demands one
- batch_id            nullable, groups the records of one bulk import
- occurred_at
```

Record actor, target, action, timestamp, and relevant before/after values.

**`action` is `<noun>.<past-tense verb>`**, lower snake case on both halves: `person.created`, `network.changed`, `pastoral_assignment.transferred`, `effective_date.backdated`, `setting.changed`. The noun is the thing the action happened to, which is usually the table or the relationship rather than the module performing it. The list above stays open — it opens with "including" — so this is a naming convention rather than an enumeration, and it is written down because without it `pastoral_assignment.transferred` and `pastoral.transfer` are equally defensible and a log that mixes them cannot be queried.

**One operation writes one entry per action it performed, not one entry per request.** The list above names several actions that occur together: a sex correction is a sex correction *and* the Network change it causes *and*, where one is forced, a pastoral leader transfer *and*, where the date was set in the past, a backdated effective date. Each is separately listed, so each is separately recorded, in the same transaction as the write. They are related by carrying the same actor, the same target and the same `occurred_at`; `batch_id` is not used for this, because it means one bulk import (Section 2) and overloading it would make an import indistinguishable from a compound correction.

The alternative — one entry describing everything — was rejected because the entries answer different questions and are read by different searches. Section 5 requires every reassignment to be logged as a pastoral leader transfer with its previous and new leader; a reader looking for transfers must find that one whether it arose from a reassignment or from a correction.

`target_id` is text rather than a UUID, and is required. Almost every target above is identified by a UUID, but not all: a setting is keyed by its `key` (Section 7), and a setting change is on the list. It carries no foreign key, because this log is append-only and an entry outlives the row it describes — a constraint that could refuse or cascade would make the trail depend on the survival of what it exists to remember.

The audit log is append-only. Nothing updates or deletes a row, and it is never a source for as-of state — a report answering "who was `CURRENT` in March" reads the effective-dated table, not this (Section 3).

Audit logs should preserve facts without judgmental labels.

---

## 22. API Guidance

Recommended REST areas:

```text
/api/v1/auth
/api/v1/accounts
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
POST /api/v1/auth/activate               sets the first password (Section 6)
GET  /api/v1/auth/me

POST /api/v1/accounts                    provisioning, `accounts.manage`
POST /api/v1/accounts/{id}/activation-email   re-send (Section 6)

GET  /api/v1/people                       search, church-wide (Section 8)
GET  /api/v1/people/duplicate-candidates  declared before /{id}, or it is one
GET  /api/v1/people/{id}
GET  /api/v1/people/{id}/pastoral-path
PUT  /api/v1/people/{id}/sex             the audited correction of Section 4
PUT  /api/v1/people/{id}/pastoral-leader  the reassignment of Section 5

GET  /api/v1/network/my-tree
GET  /api/v1/leaders/{id}/children
GET  /api/v1/leaders/{id}/descendants
GET  /api/v1/leaders/{id}/summary

GET  /api/v1/dcc/events/{id}/roster
POST /api/v1/dcc/events/{id}/submit

GET  /api/v1/cells/{id}
GET  /api/v1/cells/{id}/members
GET  /api/v1/cells/{id}/meetings
POST /api/v1/cells/{id}/meetings/{meeting_id}/submit

GET  /api/v1/reports/dcc/monthly
GET  /api/v1/reports/dcc/yearly
GET  /api/v1/reports/cells/monthly
GET  /api/v1/reports/cells/yearly
GET  /api/v1/reports/network-summary
```

### Conventions

Three clients consume this API concurrently (Section 2) and mobile builds cannot be force-updated, so these conventions are part of the contract rather than house style. Settle them before the third controller is written.

All requests and responses are JSON. No redirects, no HTML error pages, no form encoding — only one of the three surfaces is a browser.

**`/api/v1/accounts` is separate from `/api/v1/auth` deliberately.** Everything
under `/auth` is either on Section 7's closed unauthenticated list or acts solely
on the caller's own session, which is what makes that prefix's exemption from the
capability guard readable in one place. Provisioning is neither: it is an
administrative action on somebody else's Account, it carries `accounts.manage`, and
putting it under `/auth` would mean the prefix no longer describes one thing.

#### Dates and times

Timestamps are ISO 8601 with an offset. Date-only fields — an attendance date, an effective date, a Cell meeting date — are plain `YYYY-MM-DD` and are always Asia/Manila dates (Section 20). Never send a date-only field as a timestamp; the conversion is where months silently shift.

#### Field naming

One concept carries one field name across every endpoint. **Names are `snake_case`**, and an identifier's name is either a bare `id` or `ids`, or ends in `_id` or `_ids`.

That is not tidiness: it is what the boundary in Section 7 keys on when deciding whether a value may be canonicalized, so a field carrying an identifier under any other name is outside the rule and is compared in whatever case the client sent it.

**The bare forms are in the set because a path parameter binds under one.** A route declaring `{id}` hands the boundary the key `id`, so a convention admitting only the suffixed forms would exclude every path parameter in the API — which is the case the boundary exists for. The plural is admitted with it, at both positions, so that `ids` and `acknowledged_duplicate_ids` are one rule rather than two.

**`camelCase` is not used at this boundary**, and the convention is stated rather than assumed because the boundary cannot enforce what it is not told. A field named `meetingId` carries an identifier and is not canonicalized, which is a defect that shows up as an authorization comparison quietly answering on a spelling. The example routes above use `{meeting_id}` for this reason.

A pastoral leader is `pastoral_leader_id` wherever a request names one — Section 11 makes Cell leadership a first-class concept, so a bare `leader_id` does not say which kind of leader is meant. A **Cell's** leader is `cell_leader_id`, and the filter sketched under Filtering and sorting below carries that name rather than the bare one.

Naming the Cell filter now, before Stage 3 builds it, is the rule applied to itself: this section's own argument is that the only moment to fix a field name is before a client depends on one, and an example a specification documents is what the implementer copies.

Database columns are not bound by this: `pastoral_assignments.leader_id` needs no qualifier because its table supplies one.

A field name that differs between two endpoints for one concept is a permanent cost on three client codebases that cannot be force-updated, and the only moment to fix one is before any client depends on it.

#### Request bodies are bounded in depth

**A request whose JSON nests more than twenty levels is refused with
`VALIDATION_FAILED`, carrying `max_depth` in `details`, wherever anything in this API
reads that body.** No DTO describes it and no controller checks it: it is a property
of the request, refused at the boundary.

**The qualifier is exact rather than cautious.** The hazard is a recursive walk, so
a body nothing walks cannot produce one; the *rule* is therefore never violated by a
route that does not read its body, only unenforced there. That is stated because
three clients branch on this section and would otherwise read the rule as absolute.

**What enforces it is a walk over a bound argument**, which is where the rule can be
escaped. The identifier boundary walks whatever a route binds; the idempotency
fingerprint walks the body of every authenticated state-changing request. A route
therefore escapes exactly where **the body is not among the bound arguments and the
request is not an authenticated state-changing one**. Both halves are needed:
`POST /api/v1/auth/logout-all` binds nothing a client sent and is still covered,
because the fingerprint reaches its body regardless of what the handler bound.

Five routes are in that position today, in three shapes, and all are harmless because
nothing reads those bodies:

- binding **nothing at all** — the liveness probe;
- binding only a value **this application constructed** — `GET /api/v1/auth/me`,
  which takes the authenticated actor;
- binding a client-sent **path parameter or query, and no body** — the three `GET`
  routes under `/api/v1/people`.

A request carrying a 25-deep body to any of them is answered normally rather than
refused.

A fourth shape does not exist and would matter: a handler binding a **sub-field**,
`@Body('token')` rather than `@Body()`. That one can coexist with a route which goes
on to read the whole body by other means, and nothing prevents it. One added later is
outside the rule silently — the shape Sections 2 and 7 refuse everywhere else, and
the reason the boundary was made global rather than per route. Such a route either
binds the whole body, or the check moves somewhere a binding cannot escape.

The bound exists because **`JSON.parse` accepts a depth that the code reading its
result cannot**. V8 parses iteratively and has no practical limit — two hundred
thousand levels parses — while this API walks a body recursively at least twice on
every authenticated write: once to canonicalize identifiers (Section 7), once to
fingerprint it for idempotency. A few thousand levels exhausts the stack, and an
unhandled `RangeError` is an `INTERNAL_ERROR`: a 500, logged as a defect, produced
by ordinary input, on every write endpoint at once.

A body-size limit does not cover it. Depth is cheap: a nested array costs two bytes
per level, one for each bracket, so the payload that overflows arrives in
single-digit kilobytes — far inside any size limit worth setting.

**Twenty, and the number is deliberately far from both edges.** Levels are counted
as containers, per the rule below, so the deepest structure this specification
describes — an array of identifiers inside a body — is **two**: the body and the
array. The string inside the array is a leaf and is not a level. Twenty leaves room
for anything a future endpoint plausibly needs and is orders of magnitude short of a
stack, so it never has to be tuned against either.

**Refused, not truncated.** Accepting the request and declining to walk past the
bound is the tempting reading of "bounded", and it is worse than refusing: the part
below the bound keeps whatever the client sent, so identifiers there are compared in
whatever case they arrived — which is exactly the defect Section 7's boundary exists
to remove, reintroduced by its own safety valve, silently and only for the requests
nobody looks at.

`VALIDATION_FAILED` because a body no endpoint in this system describes is malformed
input, which is what that code means. It is not one of the retryable conditions: the
refusal is deterministic, so a client that retries the same body gets the same
answer.

On an authenticated write the refusal lands **before the idempotency key is
claimed**, so no row is written and the store-a-4xx rule below never applies. That
is a consequence of evaluation order rather than a rule: the identifier walk is
passed to the fingerprint as an argument, so it runs first and throws first. Nothing
should be built on it — the answer is the same either way, which is the property
that matters.

**Every walk over a client's body shares this one bound, and applies it at the same
point** — immediately before descending into a container, never on a leaf. Sharing
the number is not sufficient on its own. Two walks that count differently give one
body two answers, and the first implementation did exactly that: one counted a
primitive leaf as a level and the other did not, so a body at the bound was refused
or accepted according to whether its innermost value happened to be a string.

#### Pagination

Cursor-based, on every collection endpoint:

```text
GET /api/v1/people?q=dela+cruz&limit=50
{
  "data": [ ... ],
  "next_cursor": "b3BhcXVlLWN1cnNvcg"
}
```

- `limit` defaults to 50, maximum 200.
- The cursor is opaque. Clients pass it back unmodified and never construct one.
- `next_cursor` is absent or null on the last page.

Offset pagination is not used. Rows inserted while a client is paging shift every subsequent offset, which duplicates and skips records — a real problem on a directory that grows during a Sunday service, and a worse one for mobile sync.

Collection endpoints do not return total counts. A count over a large scoped set is expensive on every page, and totals are a reporting concern with their own endpoints and their own rules (Section 20).

#### Errors

One envelope, always:

```json
{
  "error": {
    "code": "SCOPE_DENIED",
    "message": "Human-readable, safe to display.",
    "details": {}
  }
}
```

`code` is stable and machine-readable; clients branch on it and never on `message`. At minimum:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No valid access token |
| `CAPABILITY_DENIED` | 403 | The actor lacks the capability (Section 7) |
| `SCOPE_DENIED` | 403 | The actor holds the capability but not over this target |
| `VALIDATION_FAILED` | 422 | Malformed or missing input |
| `VERSION_CONFLICT` | 409 | The record changed since it was read (below) |
| `PERIOD_CLOSED` | 409 | The reporting month is closed (Section 13) |
| `IDEMPOTENCY_KEY_REUSED` | 409 | The key was already used for a different request. Never retry |
| `REQUEST_IN_FLIGHT` | 409 | The original request with this key has not finished. Retry after a short delay |
| `INVARIANT_VIOLATION` | 409 | A domain rule rejects the write — cycle, cross-Network edge, two active assignments |
| `DUPLICATE_ACKNOWLEDGEMENT_REQUIRED` | 409 | A Tier 1 duplicate candidate must be acknowledged before the Person is created (Section 3). The candidates are in `details` |
| `NOT_FOUND` | 404 | No such record, or its existence must not be disclosed |
| `RESOURCE_BUSY` | 503 | Another operation holds the record this write must serialize against, and the wait timed out (Section 5). Transient: retry after a short delay |

`CAPABILITY_DENIED` and `SCOPE_DENIED` are deliberately distinct, because capability and scope are independent grants (Section 7) and an administrator diagnosing a permission problem needs to know which one failed.

A domain check that rejects the **actor's authority over a target** answers `SCOPE_DENIED`, even though it runs in the domain layer rather than in the guard. Section 5's prohibition on acting on oneself or on anyone upline is the case in point: it concerns who may act on this record, which is what `SCOPE_DENIED` means. `INVARIANT_VIOLATION` is for a record the rules reject however it was submitted and whoever submitted it — a cycle, a cross-Network edge, a second active assignment. Keeping the two apart is what lets a client, and an administrator reading a log, tell "you may not do this" from "this cannot be recorded".

Where revealing that a record exists would itself disclose something, return `NOT_FOUND` rather than a denial. People are not such a case: Section 8 already discloses minimal identity church-wide by design.

#### Write conflicts

`VERSION_CONFLICT` carries what Section 14 requires a person to see. The client renders a resolution dialog directly from it:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This record changed after you opened it.",
    "details": {
      "submitted_version": 3,
      "current_version": 4,
      "submitted": { "present": 9, "recorded_at": "2026-10-17T18:02:11+08:00",
                     "actor": { "id": "...", "name": "Manuel" } },
      "current":   { "present": 8, "recorded_at": "2026-10-17T18:15:40+08:00",
                     "actor": { "id": "...", "name": "Raymond" } }
    }
  }
}
```

Both values, both actors, both timestamps. A conflict response that omits any of them cannot satisfy Section 14, because the person resolving it cannot tell which record to keep.

#### Idempotency

Every state-changing request carries an `Idempotency-Key` header holding a client-generated UUID (Section 23):

```text
Idempotency-Key: 6f2b1c94-8b6a-4a1e-9a1e-2c9f4d5b7e01
```

```text
idempotency_keys
- key                 the client-generated UUID; unique per account, not globally
- account_id
- request_fingerprint a hash of method, path and body
- state               IN_FLIGHT | COMPLETED
- response_status     nullable until completed
- response_body       nullable until completed
- claim_id            identifies one claim; a takeover under the lease mints a new one
- claimed_at          when this attempt was claimed; bounds the claim, not the answer
- created_at
- expires_at          how long the response is retained
```

- **The rule reaches every authenticated state-changing request**, and only those. An unauthenticated one has no account to key a row by, so the store cannot hold it, and the exempt set is exactly **Section 7's closed unauthenticated list** — which makes this exemption closed too, and widening it an amendment to that list rather than a decision taken in a controller. The list is not restated here: it is named in one place on purpose, and the last two attempts to repeat it both left something out. Everything else that changes state carries a key, including an endpoint acting only on the caller's own session — signing out is state-changing, and a retried sign-out should return the answer the first one produced rather than run again.
- **A key is unique to the account that presented it**, never globally. A row is identified by the account and the key together, so two accounts may hold the same key without either seeing the other's stored response, and every rule below means "for this account". Global uniqueness would let a client that reused a key it had observed receive somebody else's response, or deny that person their own retry — and clients generate these values themselves, so a key is not a secret.
- **A write endpoint records its completion inside the transaction that performs the write.** The claim is taken before the handler; recording it *after* leaves a window in which the write has committed and the claim has not been closed, and the lease below then lets a retry perform that write a second time. Committing the record with the write closes it: either both are there or neither is. An endpoint that writes nothing may leave the recording to the surrounding machinery, since there is nothing to perform twice.

  Three obligations come with it, and nothing detects a breach of any of them.

  The status and body recorded must be **the response the endpoint returns**: a replay reproduces what was stored rather than what was sent, so a divergence hands two identical requests two different answers. This reaches failure too — an endpoint must not commit its completion and then fail, because the client would receive the failure while the store holds the success that every retry replays.

  The recording is the **last** statement in the transaction. It takes the key's row lock, and a concurrent retry waits on that lock rather than being answered `REQUEST_IN_FLIGHT`, so holding it across the work turns a short delay into the length of the request.

  And **a recording that matches nothing aborts the write**. A request that has lost its claim cannot record anything, so by the rule above its write must not commit either; the transaction is rolled back and the client is told to retry. Returning quietly instead would leave the write on disk with nothing recording it, and the retry that follows would perform it again — silently, which is worse than the response-mixing the claim identity closed.
- **A claim has an identity, and every write against it carries that identity.** A takeover under the lease mints a new one. Without it a request whose lease expired mid-flight would complete or release whichever claim replaced it — storing its own response against another request's work, discarding that request's own completion in silence, and, because a takeover also rewrites the fingerprint, leaving one request's response stored under another's. That is the cross-request leak the account-scoping rule above exists to prevent, arriving by a different door.
- **A claim and a response are bounded separately.** `expires_at` retains the answer; `claimed_at` bounds the attempt. A request whose process dies leaves its row `IN_FLIGHT`, and another request may take the claim over once it is older than a short lease — a minute, longer than any request this API should serve. Without the second bound the row sat unfinished for the whole retention, and every retry was told `REQUEST_IN_FLIGHT`, which this section defines as "retry after a short delay". A day is not a short delay, and the caller never learned the outcome.
- **A 4xx is stored against the key; a 5xx releases it.** A domain refusal is this request's outcome, decided by the rules, and a repeat of the same body is entitled to the same answer. An unexpected failure carries no decision and rolls back, so nothing was recorded and a retry cannot double-apply, while storing it would pin a transient failure to the key for the whole retention with no way past it.

  **The status is therefore load-bearing, and a new code is placed by which side of that split it belongs on.** A transient condition that reached no decision — contention on a lock, in `RESOURCE_BUSY` (Section 5) — must be a 5xx, or every later retry of that key replays it. Adding a retryable condition below 500 would require the store/release rule to grow an exception, and an exception each new code has to remember is exactly what this section avoids elsewhere.
- **The fingerprint is taken over a canonicalized body**: object keys sorted, arrays left in order, because order is meaning in an array. Nothing forbids a client reordering object keys on a retry and several JSON libraries do, and treating that as a different body answers `IDEMPOTENCY_KEY_REUSED` — which this section makes permanent and says must never be retried, turning an ordinary retry into a dead end.
- **A request missing the header is `VALIDATION_FAILED`.** A required header that is absent is malformed input, which is what that code means. It is named here rather than left to a controller, because three clients branch on it.
- **A replay reproduces the status and the body, and nothing else.** Headers are not stored and are not reproduced, so **no state-changing endpoint may put meaning in a response header** — a `Location` or an `ETag` that a client needs would not survive a retry. Stated as a constraint on endpoints rather than as a limitation of the store, because that is the direction it binds.
- The server stores the key with the response it produced, for at least 24 hours.
- A repeat of the same key with the same body returns the stored response and does not execute again.
- The same key with a **different body** returns `IDEMPOTENCY_KEY_REUSED`. This is permanent and the client must never retry it. It is a conflict rather than malformed input, so `VALIDATION_FAILED` would be wrong — a client branching on that code would show a field error for a replay.
- A retry arriving while the **original request is still in flight** returns `REQUEST_IN_FLIGHT`, and the client retries after a short delay. This is the case the header exists to handle: a phone on an unreliable connection resends before the first response arrives.

The two are separate codes deliberately. They demand opposite client behaviour — never retry, and retry shortly — and clients branch on the code alone (above), so a single code covering both would send a client into an endless retry of a permanent conflict.

This is required from the first write endpoint, not added later. A leader recording attendance on an unreliable connection will retry, and a retry must never create a second record.

#### Filtering and sorting

Filters are explicit named query parameters. Do not build a general query language; every filter is a parameter someone deliberately exposed and authorized.

Sorting uses `sort`, with a leading `-` for descending:

```text
GET /api/v1/cells?cell_leader_id=...&sort=-not_held_count
```

Sorting and filtering are permitted, including on meeting-status figures — finding the Cells that need help is pastoral work (Section 13).

The prohibition on ranking must be stated directly, because it does not follow from the shape of the model. Coverage is a rate (Section 13), so `sort=-coverage` over a collection of leaders is expressible and must be refused:

- No response carries a rank position, a composite score, or a grade. No such field exists, and none may be added.
- No endpoint sorts a collection of **leaders** by coverage, by `NOT_HELD`, or by any figure derived from them.
- No endpoint applies such a sort by default.

Sorting a leader's **own Cells** by those figures is permitted and useful — that is how a leader finds which of their Cells needs attention. Ordering **leaders against one another** by them is what Section 13 forbids.

#### Versioning

`/api/v1` remains available and behaviourally unchanged for as long as any client calls it. An installed mobile build keeps calling it for months, and an iOS release passes through review before it can reach anyone.

Additive changes — a new optional field, a new endpoint — do not require a new version. Removing a field, renaming one, narrowing a type, or changing the meaning of an existing value does. When in doubt, add rather than change.

Controllers/routes should delegate to authorization and application/domain services rather than containing SQL/business logic directly.

---

## 23. Offline / Mobile Readiness

Web UI must be responsive from the beginning. Leaders will use the web application on phones before any native app exists, so mobile is a current surface, not a future one (Section 2).

### Accessibility

**The web application conforms to WCAG 2.2 Level AA.** This is a requirement, not an aspiration, and the things that make it checkable are in `CLAUDE.md` under Definition of Done.

Level AA rather than A, because Level A omits colour contrast, and contrast is the criterion that decides whether a leader can read an attendance figure on their own phone, in a hall, at fifty. Not AAA: it asks for 7:1 contrast and a reading level this material cannot always meet, and a standard nobody meets is one everybody ignores.

Six criteria are called out, in four groups, because this system's own rules bear on them.

**1.4.3 Contrast, and 1.4.11 Non-text Contrast.** Body text meets 4.5:1 against the background it actually sits on, in both light and dark. 1.4.11 asks 3:1 of three things, and reporting needs all of them: the boundary of a control, the visible states of one such as focus or checked, and any graphical object required to understand content — which is what a chart mark is. A purely decorative rule or divider is exempt, and the palette keeps the decorative and the meaningful apart so that reaching for the wrong one on a form field is a visible mistake.

**2.5.8 Target Size (Minimum).** Interactive targets are at least 24 by 24 CSS pixels. Cell attendance is recorded by a leader tapping down a roster on a phone, often standing up, and a mis-tap here is a wrong attendance record rather than a cosmetic annoyance.

**3.3.8 Accessible Authentication (Minimum).** A password is a cognitive function test, and the criterion permits one only where a mechanism assists the user in completing it. Support for password managers is that mechanism: paste is never blocked, autofill is never obstructed. Section 6 carries the rule and the house decision that goes beyond it.

**2.4.11 Focus Not Obscured (Minimum), and 2.4.7 Focus Visible.** Focus is always visible, and the focused control is never *entirely* hidden behind a sticky header or a dialog. Level AA requires that much; requiring no part of it to be obscured is 2.4.12 at Level AAA, and is not claimed here. This is what makes the keyboard path usable at all, and it cannot be verified from a screenshot.

Conformance is about whether a person can perceive and operate the interface. It is not a licence to encode meaning in colour: Sections 13, 17 and 19 forbid encoding meeting status, coverage or a leader in colour, and no contrast ratio makes that permissible.

**No palette token is named for a judgement about a person, a Cell, or a figure derived from them.** There is no `success`, `danger` or `warning` token, and none is to be added. A palette that acquires one has settled the question those sections exist to keep open, before any screen is designed, and the name is what spreads: a token is used by whoever writes the next screen, on whatever it seems to fit.

This reaches names, not colour. Colour for structure, hierarchy and legibility is expected (Section 2).

**A form field failing validation may carry a colour, and the token is named `field-invalid`.** It is one token, and it is the only one of its kind.

The name is the whole ruling. `field-invalid` describes the state of an input — this field does not yet hold something the system can accept — and says nothing about the person filling it in or about any figure. `error` and `danger` were rejected for the reason the paragraph above gives: a token is used by whoever writes the next screen, on whatever it seems to fit, and a token called `error` will eventually colour a Cell that reported `NOT_HELD`. `field-` is a prefix that does not travel, because a Cell is not a field.

This is a different question from judging a leader, and it is settled narrowly on purpose. Validation is a statement about an input, made to the person who just typed it, and resolved by them in the next few seconds. Sections 13, 17 and 19 are about durable judgements rendered about other people, and nothing here touches them: no meeting status, no coverage figure, and no leader is ever rendered in `field-invalid`, whatever it would seem to fit.

Two constraints come with it, and both are conformance rather than taste:

- It meets **3:1 against the surface behind it** (1.4.11), because the invalid state of a control is exactly the "visible state of a component" that criterion names.
- It is **never the only indicator**. A field in error carries text saying what is wrong, and is associated with that text programmatically. Colour alone fails 1.4.1, and a leader recording attendance in a hall may not see it at all.

The native clients are not covered here. Their framework is not chosen (Section 2), and the equivalent obligation for them is the platform's own accessibility API rather than WCAG. That is a ruling to make when the client is, and it is indexed as open in `CLAUDE.md`.

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
- Automated backups, daily at minimum, with at least 30 days of retention
- Point-in-time recovery wherever the database host supports it
- A restore tested before go-live, and at least annually thereafter
- Audit logging
- Least-privilege database/application credentials
- **Synchronised clocks on every host running the API.** Account-wide revocation compares a token's issued-at against the account's revocation marker, and Section 6 requires both to be stamped by an API process. On more than one instance those are two clocks, and skew moves tokens across the boundary in both directions — admitting a token that should be dead, or refusing a sign-in that should work. Ordinary NTP is sufficient; the requirement is that it is not left to chance

### Backups

Daily is the minimum, and weekly is not acceptable here.

Attendance exists nowhere else. A week of loss is one DCC Sunday and roughly eight hundred Cell meetings (Section 2, Scale), and nobody can reconstruct who was present three weeks ago — leaders will not remember, and the submission window may have closed even if they did (Section 13). Unlike most business data, none of it can be re-derived from another system or a paper trail.

Corruption is also usually noticed late. A bad migration discovered three weeks after it ran needs a restore point from before it, which weekly backups with short retention will not have.

The cost argument does not apply. A church of several thousand people with years of attendance is a small database, and daily backups of it are inexpensive on any host. Point-in-time recovery, standard on managed PostgreSQL, reduces worst-case loss from a day to minutes and should be used where available.

A backup that has never been restored is an assumption. Test one before go-live and annually after, and record that it was done.

This is distinct from the per-migration snapshot required before touching relationship tables (Definition of Done, migration policy). Routine backups cover accidents; migration snapshots cover deliberate schema changes. Both are required.

Do not expose the entire church dataset to the browser and filter it client-side.

### The connection pool, and what shares it

The application connects through a **bounded** connection pool. A bound is required rather than optional: an unbounded pool turns a slow database into an unbounded number of backends, and the failure arrives as the database refusing connections to everything at once.

The bound has a consequence that reaches beyond this section, and it is recorded here because this is where the bound lives. **Any unbounded wait inside a transaction is a liveness hazard**, not merely a slow request: each waiting request holds a connection, and once they exhaust the pool nothing else can obtain one. That is why the person lock in Section 5 is bounded by a timeout, and why any lock wait introduced later must be too.

### Transaction isolation

The application runs at **`READ COMMITTED`**, PostgreSQL's default. It is named here because correctness now depends on it rather than merely tolerating it.

Section 5 requires a Network change and a reassignment to take an advisory lock on the person and then decide — scope, invariant 4, invariant 1, the backdate floor — against what the lock reveals. Under `READ COMMITTED` each statement after the lock takes a fresh snapshot and therefore sees the transaction that held the lock before it. Under `REPEATABLE READ` the snapshot is taken by the transaction's *first* statement, which is the key hashing inside the lock helper and runs before the lock is held: every check after it would then be decided on the state the request arrived with, which is exactly the staleness the lock exists to remove.

**A second dependency arrived with the grant limit in Section 7.** Its two constraint triggers take `FOR NO KEY UPDATE` on the account and then read the other table to decide, which is the same shape one statement further in: under `READ COMMITTED` the read after the lock sees the transaction that held it first, while under `REPEATABLE READ` the whole transaction answers from one snapshot taken before the lock — so the triggers would serialize correctly and then decide on stale reads, and because the two writers touch different tables neither raises a serialization failure to warn anybody.

The row lock also requires those trigger functions to be `VOLATILE`, which is their default. That is not a silent dependency: PostgreSQL runs a non-volatile function's statements read-only and refuses a row-locking `SELECT` inside one, so marking them otherwise fails at the lock rather than quietly weakening the rule.

Some of those cases would fail loudly rather than silently — where the loser's own assignment row was the one that moved, its update would meet a version committed after its snapshot and raise a serialization failure. The dangerous ones are the cases where nothing the loser writes has changed and only the *decision* is stale: a concurrent move of an intermediate ancestor leaves the actor's scope different and every row this request touches untouched, so it commits, and it commits a write the actor was no longer authorized to make.

A deployment that changes `default_transaction_isolation` therefore silently removes an authorization guarantee. That is checked rather than assumed.

**The liveness probe currently shares that pool**, and answers by reaching the database. So pool exhaustion presents to the platform as a dead process, and the response is a restart that discards the transactions still making progress — turning contention into lost work. Whether the probe should keep sharing the pool, and whether "healthy" should mean "can reach the database", is an operational decision recorded as open in `CLAUDE.md` rather than settled here.

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
8. Never add Cell meeting statuses beyond `HELD`, `RESCHEDULED`, and `NOT_HELD` (Section 1, Principle 8), and never infer `NOT_HELD` from missing data.
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
19. Never reuse a pattern from elsewhere in this system without first stating **why it has that shape**, and checking whether the reason holds where it is going.

Rule 19 is the only one here that is about the act of writing rather than about the domain, and it earns its place because it is the mistake this system's own history keeps producing. A guard, an executor threaded through a call chain, a floor over closed rows, a test that holds a lock — each was copied from a working use into a new one where part of the original justification did not carry, and each looked right at the call site.

The check is one sentence and it is answerable: *this had that shape because X; does X hold here?* Three worked examples, all real:

- Section 4's backdate floor reaches closed rows **in either direction** because the trigger it guards selects edges both ways. A reassignment fires a trigger that reads only the row being written, so the reason does not carry and Section 5's term is narrower.
- Passing a database executor down a call chain makes a read honour a caller's transaction — but only for the reads that actually take it. A predicate that reads an account's grants before evaluating scope keeps touching the pool however many executors it is handed.
- A test that holds a lock and asserts a request waits must first *dispatch* the request. The object that represents it is lazy, which the working example next to it handled and the copy did not.

None of these is caught by a type, a constraint or a passing test. The rule is stated because the alternative is finding each one again.

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

### Required persistent structures

Every structure the rules above depend on. A rule whose structure is missing is a rule that can be implemented in prose and fail in practice, so this list exists to be checked against a migration rather than read.

Shapes are given in the section that owns each rule; this is the index.

| Structure | Owner | Shape in |
| --- | --- | --- |
| `persons` | `people` | Section 3 |
| `person_lifecycle` | `people` | Section 3 |
| `network_assignments` | `networks` | Section 4 |
| `pastoral_assignments` | `hierarchy` | Section 5 |
| `accounts` | `auth` | Section 6 |
| `account_roles` | `auth` | Section 7, How grants are held |
| `capability_grants` | `auth` | Section 7, How grants are held |
| `refresh_tokens` | `auth` | Section 6, Session and token storage |
| `cells` | `cells` | Section 10 |
| `cell_categories` | `cells` | Section 10 |
| `cell_schedules` | `cells` | Section 10 |
| `cell_memberships` | `cells` | Section 10 |
| `cell_leaderships` | `cells` | Section 11 |
| `cell_creation_requests` | `cells` | Section 10 |
| `dcc_events` | `attendance` | Section 9 |
| `dcc_attendance` | `attendance` | Section 9 |
| `cell_meetings` | `attendance` | Section 13 |
| `cell_attendance` | `attendance` | Section 13 |
| `report_snapshots` | `reporting` | Section 20 |
| `account_tokens` | `auth` | Section 6, Account activation |
| `cell_meeting_changes` | `attendance` | Section 13 |
| `notifications` | `reporting` | Section 13 |
| `audit_log` | `audit` | Section 21 |
| `settings` | `admin` | Section 7, `settings.manage` |
| `idempotency_keys` | shared | Section 22 |

Five of these carry history the specification guarantees and would otherwise be built as a column on their parent, losing it silently: `person_lifecycle`, `network_assignments`, `cell_categories`, `cell_schedules`, `cell_memberships`. A column satisfies every sentence about them and cannot answer a question about a past period.

Adding a structure to this list is part of the change that introduces the rule needing it, never a follow-up.

---

This specification is the architectural source of truth unless a later explicit church requirement changes a rule.
