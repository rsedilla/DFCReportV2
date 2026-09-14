# Design reconciliation: the redesign against SKILL.md

On 2026-09-14 the owner reviewed a Claude Design handoff for the leader-facing application —
Record, Reports, People, Cells and Network, on desktop and phone — against `SKILL.md`, one
disagreement at a time. This file records what was decided, so the UI phases build the
reconciled design rather than the handoff.

`SKILL.md` remains the source of truth. Where this file and `SKILL.md` disagree, `SKILL.md`
wins and this file is the thing to fix. **Nothing here is a ruling.** Where a decision changed
a rule it is a numbered decision in `docs/decisions/`, linked below; everything else follows a
rule `SKILL.md` already states.

**The handoff itself is not in the repository.** Its prototype uses real names from the
church's leadership tree, and this repository is public.

## Decisions

| Area | The handoff | Decided | Follows | Built in |
| --- | --- | --- | --- | --- |
| Sidebar | Record · Reports · People · Cells · Network | Adopted, with Account and session in the sidebar footer | [Decision 0245](decisions/0245-the-sidebar-follows-the-design.md) | PR #126, in review |
| Ordering leaders | Coverage tables sorted furthest behind first | Leaders A to Z, the viewer first, with a *Behind only* filter | §13, §22, decision 0226 | UI-6 |
| Status tags | Red fill on some statuses; "9 days late", "Owed" | Every tag the same red, so colour never tells one row from another; factual wording such as "Awaiting a record" and "1 meeting awaiting" | §17, §13, §1 Principle 7 | UI-1 (style), with each screen (wording) |
| Accent colour | Red | Red replaces teal | — | UI-1 |
| Name fields | One "Full name" box | One "Full name" label over three boxes: First, Middle, Last | §3 | UI-4 |
| Person form | No Sex, Civil status or Birthday | All three are on the form | §3 | UI-4 |
| Cell on the person forms | A Cell dropdown on Add and Edit | Optional Cell when adding; on Edit the Cell is read-only with *Move to another Cell* | §10 | UI-4 |
| Journey stage | *Correct this stage* with a reason | No override. The stage is shown with the attendance behind it and a link to correct that attendance | §9 | UI-4 |
| Export | *Export CSV* from Reports | Not in the pilot; recorded as an open question in `CLAUDE.md` | — | — |
| Dark theme | None | Kept: a dark version of the design is derived | §23, decision 0235 | UI-1 |
| Year view | Person by month for the year | Left out until the open question on an in-progress year's classification is ruled | Decision 0222 | — |
| Preview as | See the app as another person | Dropped: prototype only | — | — |
| Offline queue | "Saved on this device" states | Dropped for now | — | — |

## Terms

The handoff's copy uses shorthand from its design sessions. Code, routes, labels and tests
use the system's terms: *Sundays* are **DCC Attendance** and a *Sunday service* is a **DCC
event** (§9); *Journey stage* is **classification** (§9, §12); and *Move to another leader* is a
**pastoral reassignment** (§5).

## Phases

The redesign is applied in phases after these decisions, each its own pull request:
UI-1 tokens and components, UI-2 the app shell, UI-3 recording, UI-4 People, UI-5 Cells,
UI-6 Reports and Network, and UI-7 sign-in and account.
