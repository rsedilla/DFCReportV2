# Roadmap

How this system gets built, in order, and how you know a stage is finished.

This is a sequence, not a schedule. No dates, because they would be invented. Each stage names what it delivers, what "done" means, and what is most likely to go wrong.

Read [SKILL.md](../SKILL.md) before starting any stage. Read [CLAUDE.md](../CLAUDE.md) before opening any pull request.

---

## Stage 0 — Finish the specification

**Where the project currently is.**

The specification is complete and the open-ruling list is empty. What remains is the last review pass and getting it onto `main`.

- Final `architecture-guardian` pass on the open pull request
- Address whatever it finds
- Merge

**Done when:** `main` carries the specification, and the decisions log in `CLAUDE.md` has nothing awaiting a ruling.

**Risk:** merging a large specification branch on a self-approval. Add a second code owner first — a single-owner `CODEOWNERS` cannot be satisfied by the author.

---

## Stage 1 — Foundations

The skeleton everything else hangs on. **No features are built in this stage.**

- Repository layout: `api/` (NestJS), `web/` (Next.js), `docker-compose.yml` for local PostgreSQL
- **Continuous integration from day one** — lint, typecheck and tests on every pull request, required by branch protection
- Authentication skeleton: short-lived access tokens, refresh tokens, several concurrent sessions per account, account-wide revocation (`SKILL.md` §6)
- The authorization guard: capability × scope, failing closed, applied declaratively (`SKILL.md` §7)
- **First migration** carrying §5's constraints as hand-written SQL: the partial unique index, the no-self check, the same-Network constraint trigger, and cycle-safe recursive queries
- **The eleven authorization tests, written and failing** (`CLAUDE.md`, Authorization test suite)

**Done when:** CI is green on an application with no features, the guard denies by default, and the eleven tests fail for the right reason.

**Why the tests come first:** they are derived entirely from the specification and need no implementation to exist. Writing them now makes guard behaviour the thing the API is built toward, rather than something verified afterwards when it is expensive to change.

**Risk:** treating CI as a later task. Retrofitting it across an existing codebase is how gaps ship.

---

## Stage 2 — People and the pastoral tree

- Person: core fields, mobile number, Member ID sequence, duplicate matching (`SKILL.md` §3)
- Networks, effective-dated (§4)
- Pastoral assignments, with all five invariants enforced in the domain layer and in the database (§5)
- Accounts: provisioning, activation, password reset (§6)
- **Import the leadership tree** — roughly a thousand people, through the dry-run, adjudicate, commit flow (§2, Initial data load)

**Done when:** all eleven authorization tests are **green**, including case 7 exercised concurrently, and the real leadership tree is loaded in a development database.

**Why import the tree here:** everything built after this point is developed against real names, real depth, and real edge cases, rather than against fixtures that are always tidier than production.

**Risk:** case 7 passing sequentially. A sequential test passes against application-layer checks alone and tells you nothing about whether the partial unique index exists.

---

## Stage 3 — Cells

- Cell entity, Cell ID sequence, lifecycle (§10)
- Categories and schedules, both effective-dated
- Membership, with single-transaction moves
- The creation workflow: request, approve, decline (§10, Creating a Cell)
- Cell leadership assignments (§11)

**Done when:** a Cell can be requested, approved, and closed; membership moves atomically without leaving two open rows; and a schedule change preserves history so a past month's coverage figure does not move.

**Risk:** creating a Cell without opening its category and schedule rows. A Cell with no schedule row has no derivable scheduled meetings and therefore no coverage figure for its first month.

---

## Stage 4 — Attendance

- DCC calendar generated twelve months ahead (§9)
- DCC recording, responsible leader, roll-up to the nearest account-holding upline
- Cell meetings: three statuses, five `NOT_HELD` reasons, `facilitated_by` (§13)
- Month close on the 7th, Admin-only amendment afterwards
- **Idempotency keys and version conflicts** (§14, §23)

**Done when:** a leader records a full month of Cell meetings and a month of DCC, the month closes on the 7th, and a concurrent double submission produces a conflict for a person to resolve rather than a silent overwrite.

**Risk:** deferring idempotency and version checks. Both are cheap now and expensive to retrofit, and a leader on an unreliable connection will retry on the first Saturday of real use.

---

## Stage 5 — Reporting

- Classification and monthly attendance, for both domains (§9, §12)
- Coverage, as a single line rather than a bucket
- Network Summary: Overview, Development, Generations, Tree, Participation (§16)
- Role-specific dashboards, with scope and period on every tile (§19)
- Materialized closed months (§20)

**Done when:** the reconciliation tests pass at every scope — classification buckets and monthly-attendance buckets each summing to the same unique-people total — and they run in CI.

**Why it matters:** this is where §20 stops being prose and becomes something enforced. A reconciliation failure is a data-integrity defect, not a rounding issue.

**Risk:** building the sorting and filtering surface without the ranking prohibition (§13). The guardrail is easy to omit and hard to remove once leaders have seen a leaderboard.

---

## Stage 6 — Pilot

**One branch only.** A single Senior Pastor's direct leader and their subtree — on the order of twenty to thirty Cells — running for **one full month cycle**, including the close on the 7th.

**Done when:** a month closes with real data, and the figures survive contact with people who already know what they should be.

**Why a pilot rather than a launch:** the largest risk in this project is not technical. It is whether several hundred leaders will record every week. The pilot is where that becomes visible, at a scale where the design can still change.

**Risk:** piloting without Stage 5. Recording without reporting gives a pastor nothing, and a pilot that shows no value will not survive contact with a busy leader.

---

## Stage 7 — Rollout

- Leaders encode their own Cell members, network by network
- **Close the initial-encoding phase** by the audited Admin action (§2)
- Backups verified by an actual restore (§24)
- `/security-review` across the codebase

**Done when:** the encoding phase is formally closed, and every new Cell from that point goes through request-and-approve.

**Risk:** leaving the encoding phase open. A relaxation attached to a phase that never ends is a permanent relaxation.

---

## Later — Mobile

React Native, against the same `/api/v1`.

Nothing in Stages 1 through 7 should need to change. That is what the API-first constraint and the separate deployables were bought for — if a mobile client forces an API change, something in the earlier stages was built as a web feature rather than as an API.

---

## Two things worth holding onto

**Stages 1 through 4 are not shippable on their own.** Recording without reporting gives pastors nothing to act on. Plan Stage 5 before scheduling any pilot.

**The order is load-bearing.** Authorization before features, because a guard retrofitted across forty endpoints leaves gaps. Tests before endpoints, because they are derived from the specification and cost nothing to write early. Real data before reporting, because fixtures are always tidier than a real pastoral tree.
