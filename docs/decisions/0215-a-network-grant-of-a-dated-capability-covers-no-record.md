# 2026-09-07 — A Network grant of a dated capability covers no record

`GET /api/v1/reports/dcc/monthly` is the first route guarded by a capability Section 7
resolves **as of the period being viewed**. Section 7 fixes that datedness to the
capability and names three — `cell.view_subtree`, `reports.view_subtree` and `audit.view`.
Decision 0214 supplied the dated walk those need for `OWN_SUBTREE` and
`SUBTREE_EXCL_SELF`, and supplied nothing for `NETWORK`.

`scopeCovers` resolves a `NETWORK` grant through `NetworksService.currentNetwork`, which is
undated. So an October report authorized that way would be measured against the leader's
**current** Network, and Section 4 lets a Network change — reached through
`people.correct_sex` — move it.

**A `NETWORK` grant of a capability that resolves as of a period covers no record, and the
request is refused.** Fail-closed, and refused where the grant is read rather than where the
tree is walked, so the message can name the grant.

## What this settles and what it does not

It settles **what the system does**. It does not settle **what a `NETWORK` grant of such a
capability ought to mean**, which stays open in `CLAUDE.md` as the Stop Condition that
produced this: either Section 7 states that a Network grant resolves undated and gives its
reason, or a dated route owes a `network_as_of` resolution. This ruling is the third
answer, and it is deliberately the one that decides nothing about Networks — it refuses to
authorize where no rule exists, which is Section 7's fail-closed default rather than a new
rule about Network scope.

**Recorded as a ruling because the code was making the decision either way.** The refusal
was written first, at the owner's direction, and `architecture-guardian` found it settling
an escalated Stop Condition in a `switch` branch with nothing in `docs/decisions/` and
nothing in `SKILL.md` — which `CLAUDE.md` says means the work is unfinished. The refusal is
kept and written down rather than removed, because removing it would authorize an October
report against a November Network.

## The refusal names the grant, not the record

Section 7 already draws this distinction for a capability granted too narrowly, and gives
the reason: *"'not over this record' would be a lie. It says another target would work; for
a capability section 7 gives at Whole Church only, none would. An administrator reading the
generic wording goes looking for the right record, and the thing to fix is the grant."*

The same is true here for the same reason — under this ruling **no** target works for a
`NETWORK` grant of a dated capability — so the refusal joins that path rather than the
generic one. It is a second cause of one outcome, so the two carry different words: the
first says the capability is Whole Church only, which would be false of
`reports.view_subtree`, and this one says the grant has no dated resolution.

*The first implementation used the generic message, which was exactly the lie that comment
names.*

## Why not the alternatives

**Resolve it undated**, as `scopeCovers` does today for every other target. That is the
answer the open bullet offers first, and it authorizes a past period against a present
Network — the failure the datedness exists to prevent, admitted silently.

**Build `network_as_of` now.** `networks` already has the function; what is missing is a
ruling that a Network grant *should* be dated, and inventing one to unblock a route is
deciding a Stop Condition at a keyboard. It stays escalated.

**Refuse at the grant instead**, so such a grant cannot be issued. That is a real option and
is not taken here: Section 7's `WHOLE_CHURCH_ONLY` mechanism refuses grants that are too
*narrow*, and there is no mechanism for a scope value that carries a prohibition — which is
itself an open question in `CLAUDE.md`, about `cell.request_leadership`. Two capabilities
wanting one would be the point to build it.

## What this costs

An administrator may issue a `NETWORK` grant of `reports.view_subtree` that the database
accepts and this route always refuses. That is visible rather than silent — the refusal says
so in words — and it is the cost of not deciding the Networks question here. It goes away
whichever way that Stop Condition is settled: a dated resolution makes the grant work, and a
statement that Network grants resolve undated makes this ruling wrong and removable.

---

Decision 0215, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-06 — A report's guard walks the as-of tree, outside the report's snapshot](0214-a-reports-guard-walks-the-as-of-tree-outside-the-reports-snapshot.md)
