# G12 Church Management System

People, pastoral hierarchy, DCC and Cell attendance, leadership development, and reporting for a G12 church organised into two homogeneous networks.

**Status: Stage 1, foundations.** The skeleton is in place and carries no features: authentication, the authorization guard, the first migration with the Section 5 constraints, and continuous integration. `SKILL.md` remains the contract everything is written against.

## Start here

| Document | What it is |
| --- | --- |
| [SKILL.md](SKILL.md) | **Source of truth.** Every domain rule, permission, reporting definition, and invariant. 26 sections. |
| [CLAUDE.md](CLAUDE.md) | Project governance: review gates, definition of done, and the decisions log. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | How the system gets built, in order, and how you know a stage is finished. |

Read `SKILL.md` before planning or implementing anything. Where any other instruction disagrees with it, `SKILL.md` wins.

## Layout

| Path | What it is |
| --- | --- |
| `api/` | The API. NestJS, TypeScript, PostgreSQL, served under `/api/v1` |
| `api/migrations/` | Hand-written SQL. The constraints of `SKILL.md` §5 live here |
| `api/test/authorization/` | The eleven authorization cases. **They fail until Stage 2, deliberately** |
| `web/` | The web client. Next.js, no API routes, no server actions |
| `docker-compose.yml` | PostgreSQL 16 for local development |

Commands to install, run, migrate and test are in [CLAUDE.md](CLAUDE.md) under Running the project.

## Stack

Settled in [SKILL.md](SKILL.md) §2. Changing it requires a recorded decision, not a pull request.

- **API** — NestJS + TypeScript, REST under `/api/v1`, separately deployable
- **Database** — PostgreSQL 16, with hand-written SQL migrations and no ORM
- **Web** — Next.js + TypeScript as a pure client: no API routes, no server actions
- **Mobile** — Android and iOS later, against the same API

The API is the product. The web application is its first client; the phones are the next two. All three surfaces are used concurrently, so the API is stateless, token-authenticated, and detects write conflicts rather than resolving them silently.

## The rules broken most often by accident

Each is stated in full in `SKILL.md`. This list is an index, not a substitute.

- Authorization is enforced by the API, never by a client — §7
- Capability and scope are separate grants, and both are checked on every request — §7
- An invariant that can be a database constraint must be a database constraint — §5
- Totals of people are distinct people, never summed attendance occurrences — §20
- History is effective-dated and never overwritten in place — §1, principle 12
- No judgmental wording anywhere, and never a ranking of leaders — §1, §13
- One canonical Person; DCC and Cell attendance never create each other — §1, §12

## Before you open a pull request

`CLAUDE.md` defines when a change **must** receive `architecture-guardian` review, and what "done" means. In short:

- Domain rules added or changed in `SKILL.md` have tests
- Authorization is tested at the API layer, not only the service layer
- Reporting changes include a §20 reconciliation test
- Constraints the specification claims are verified to exist in the schema

The eleven-case authorization test suite in `CLAUDE.md` must stay green. Case 7 runs concurrently — a sequential version passes without the database constraint it exists to check.

## Agents

`.claude/agents/` holds two definitions used with Claude Code:

- **architecture-guardian** — read-only review of a change against `SKILL.md` invariants
- **qa-engineer** — tests, and owner of the authorization suite

Security review uses `/security-review`; correctness and cleanup use `/code-review`. Do not add agents that duplicate them.

## Open questions

See `CLAUDE.md` → Decisions → **Open — awaiting a ruling**.

These are stop conditions. If your work depends on one, ask for a ruling rather than deciding it in code, and record the answer in the decisions log and in `SKILL.md` together.
