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

## What this does not do

**It does not settle whether Section 2's exemption enumerates instances or argued
instances.** That is a separate Stop Condition about the *exemption*, and none of these four
reads is an exemption candidate — they are main-rule violations. Retiring both because one
change touched the same section is how a question comes to be recorded as settled while
nothing settles it.

**It does not decide whether `people.manage_pastoral_assignment` may be held at `NETWORK`
scope**, nor any other question the attention list carries. Moving a read changes no
authorization.

---

Decision 0241, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — `NODE_ENV` is required, and an absent one refuses to start](0240-node-env-is-required.md)
