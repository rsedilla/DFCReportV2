# Design reconciliation: the redesign against SKILL.md

On 2026-09-14 the owner reviewed a Claude Design handoff for the leader-facing application —
Record, Reports, People, Cells and Network, on desktop and phone — against `SKILL.md`, one
disagreement at a time. This file records what was decided, so the UI phases build the
reconciled design rather than the handoff.

`SKILL.md` remains the source of truth. Where this file and `SKILL.md` disagree, `SKILL.md`
wins and this file is the thing to fix. **Nothing here is a ruling.** The one outcome that
changed a rule is decision 0245, linked below. For every other row, *Follows* names what the
outcome relies on, or the rule it departs from.

**The handoff itself is not in the repository.** Its prototype uses real names from the
church's leadership tree, and this repository is public.

## Decisions

| Area | The handoff | Decided | Follows | Built in |
| --- | --- | --- | --- | --- |
| Sidebar | Record · Reports · People · Cells · Network | Adopted, with Account and session in the sidebar footer | [Decision 0245](decisions/0245-the-sidebar-follows-the-design.md) | PR #126, merged |
| Ordering leaders | Coverage tables sorted furthest behind first | Leaders A to Z with the viewer first, and an *Awaiting a record only* filter. Listing the viewer first is a design choice: it ranks nobody, and the specification does not mention it | §13, §22; attention lists ordered by name (§9, decision 0228); §1 Principle 7 for the label | UI-6 |
| Status tags | Red fill on statuses, stages and figures; "9 days late", "Owed" | Anything about records awaiting is a plain outlined word and never a colour, in factual wording such as "Awaiting a record", "1 meeting awaiting" and "All recorded". Red is used on a person's stage and on a period being open; which facts carry it is a design choice, and every stage carries the same red | §13, §17, §23, §1 Principle 7 | UI-1 (style), with each screen (wording) |
| Accent colour | Red | Red replaces teal. A design choice rather than a rule: decision 0245 adopts no visual language, and §23's contrast rule binds the red in both themes | §23 | UI-1 |
| Name fields | One "Full name" box | One "Full name" label over three boxes: First, Middle, Last | §3 | UI-4 |
| Person form | No Sex, Civil status or Birthday | On Add, Sex and Civil status are required and Birthday is optional and prompted. On Edit, Sex is read-only and corrected only by an Admin through its own route, and a recorded Birthday cannot be cleared while whether it may be is an open question in `CLAUDE.md` | §3, §4, §7 | UI-4 |
| Cell on the person forms | A Cell dropdown on Add and Edit | Optional Cell when adding, offering only the Cells §7 and §10 allow, as a second write under `cell.manage_membership` once the person exists. On Edit the Cell is read-only with *Move to another Cell* | §7, §10 | UI-4 |
| Journey stage | *Correct this stage* with a reason | No override. The stage is shown with the attendance behind it and a link to correct that attendance | §9 | UI-4 |
| Export | *Export CSV* from Reports | Not in the pilot; left as an open question (PR #127) | — | — |
| Dark theme | None | Kept: a dark version of the design is derived | §23, decision 0235 | UI-1 |
| Year view | Person by month for the year | Left out of the pilot, although §18 asks for January to December reports. Two open questions bear on it: which month's classification an in-progress year carries, and whether §20's placement graph may authorize a per-person view | §18, decision 0222 | — |
| Preview as | See the app as another person | Dropped: prototype only | — | — |
| Offline queue | "Saved on this device" states | Dropped for now | §23, *Deferred until required* | — |

## Terms

The handoff's copy uses shorthand from its design sessions. Code, routes, labels and tests
use the system's terms: *Sundays* are **DCC Attendance** and a *Sunday service* is a **DCC
event** (§9); *Journey stage* is **classification** (§9, §12); and *Move to another leader* is a
**pastoral reassignment** (§5).

## Phases

The redesign is applied in phases after these decisions, each its own pull request:
UI-1 tokens and components, UI-2 the app shell, UI-3 recording, UI-4 People, UI-5 Cells,
UI-6 Reports and Network, and UI-7 sign-in and account.
