# 2026-09-11 — Four cross-module reads are re-homed, and one of them needs a port

Section 2's main rule is that no module reaches another's tables "for anything a service
interface can answer". Four reads do, and no clause admits any of them — not the exemption,
which covers a read *joined onto a query rooted in a table the reading module owns*, not a
port, and not a service call:

| Read | Rooted in | Owned by |
| --- | --- | --- |
| `CellMeetingsService`, a person's name by id | `persons` | `people` |
| `CellMeetingsService`, a person id by account id | `accounts` | `auth` |
| `DccAttendanceService`, a person id by account id | `accounts` | `auth` |
| `PeopleReadService.awaitingReassignment` | `pastoral_assignments`, and reads `accounts` and `account_roles` | `hierarchy`, `auth` |

**All four are re-homed onto the route Section 2 already prescribes.** Section 2 is not
amended.

## They are not alike, and the remedy is not uniform

**Three are ordinary service calls and always could have been.** The three in `attendance`
are lookups — a name by identifier, a person by account — and `AttendanceModule` already
imports both `PeopleModule` and `AuthModule`. Nothing was blocking them; they were written
as queries because the tables were reachable.

**`awaitingReassignment` splits.** Its root is `pastoral_assignments`, and `people` already
imports `HierarchyModule`, so that half is a service call too. Its `accounts` and
`account_roles` read is the only genuine cycle in the set: `auth` imports `PeopleModule`,
so `people` cannot import `auth` back. That one takes a port, which is exactly and only what
Section 2 reserves a port for.

So: three calls, one call, one port.

## Why not widen Section 2

The third option was to state that a standalone lookup in another module's table is
permissible. That is not a widening of the exemption — the exemption is about joins onto a
query you root yourself — it is a reversal of the **main rule**, whose own words are "for
anything a service interface can answer". A service interface can answer all four. Widening
it would have left the rule saying the opposite of what it says.

## The cost, which falls on one query

The `ADMIN` exclusion in `awaitingReassignment` is a correlated `NOT EXISTS` inside the
paging query. Behind an interface it becomes a set the query filters against, which is the
shape decision 0234 examined for `withoutACell` and found harmless to paging: a materialised
set applied in the `WHERE` clause leaves the `LIMIT` operating on the filtered rows, so a
page comes back full.

**That precedent is good and is not evidence.** It was established about a different query,
and this one is verified on its own terms rather than by citation.

*That last sentence was false when it was written, and `architecture-guardian` established
it by mutation: applying the exclusion after `slice(0, limit)` — the exact truncation this
section argues against — left all nineteen cases of the route's suite green. The property
held; nothing in the repository asserted it, which is the same thing as not having verified
it. A case now does, and it was checked the only way that means anything: under that
mutation it is the one test of the twenty that fails.*

## What this does not do

**It does not settle whether Section 2's exemption enumerates instances or argued
instances.** That is a separate Stop Condition about the *exemption*, and none of these four
reads is an exemption candidate — they are main-rule violations. Retiring both because one
change touched the same section is how a question comes to be recorded as settled while
nothing settles it.

**It does not decide whether `people.manage_pastoral_assignment` may be held at `NETWORK`
scope**, nor any other question the attention list carries. Moving a read changes no
authorization.

## What the mandatory review found

The re-homing was correct — all four reads moved, the port direction is a genuine cycle,
paging is right and the rows match the query it replaced. Every finding was in the
refusal, the verification or the prose, and three are worth keeping here:

**The port's refusal branch was dead on the only fault that produces it.** It tested
`=== null`, and Nest injects `undefined` for an unresolved `@Optional()` token, so a
deployment missing the binding got a `TypeError` rather than the named refusal. This
repository already documents the trap in `cells.index.service.ts` and uses a falsy check;
this port did not, having been written from the shape rather than from the reason.

**The refusal also sat behind two early returns**, so an unbound port was invisible on a
healthy tree and would have surfaced on the day a leader departed rather than on the day of
the deployment. It is now the first thing the method does. `cells.index.service.ts` states
that counter-rule too.

**Section 2 requires two things of an inversion port and this shipped one.** The
module-graph assertion was there; the case exercising the unbound refusal was not.
`admin-accounts-port-unbound.e2e.spec.ts` is that case.

Two questions the review raised are **escalated rather than settled**, and `CLAUDE.md`
carries both: whether a re-homing may give up the single-snapshot property the query it
replaced had — one statement became four, on the pool — and whether Section 2 bounds the
set a re-homed read may materialise, `brokenEdgesWithin` taking no scope argument. Neither
is decided here. The first has a one-line remedy that is deliberately not applied, because
adopting decision 0210's mechanism outside the scope 0210 names is a ruling.

---

Decision 0241, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — `NODE_ENV` is required, and an absent one refuses to start](0240-node-env-is-required.md)
