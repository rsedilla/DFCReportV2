# 2026-09-10 — The archived-leader attention list keys on the condition, not on the lifecycle flag

Section 20 requires this list and names it by a lifecycle state:

> "**A person whose pastoral leader is archived appears on an attention list**, shown to the
> upline who can act, on Section 15's terms — filtered, never ranked. Required rather than
> advisable: a report that quietly reconstructs the chain removes the pressure to reassign
> anybody, so the transient state it accommodates would stop being transient."

It is required and it does not exist. There is no route, no service, no screen and no test,
which is the shape Section 23 is gated against — a conformance claim with nothing that can
fail on it. The screens block owed it and closed without it.

## What triggers the thing this list exists to counteract

The reconstruction is the rule one paragraph above it: "Where the chain reaches a leader who
held no assignment within the period, it continues from that leader's last assignment,
whenever it was." That fires on a leader **holding no assignment**, and Section 5's invariant
3 gives three legitimate causes of that — a Person not yet assigned, an archived Person, and
an administrator outside the pastoral structure.

So the trigger is wider than the name. Keyed on the lifecycle flag, the list surfaces one
cause of three and misses two, while the reconstruction fires on all three and hides all
three equally.

**The list keys on the condition: a person whose pastoral leader holds no open pastoral
assignment.** Archival is the commonest cause and is not the rule.

## Why the condition rather than the flag

**Because the list's stated purpose is to keep a repair feeling necessary**, and what needs
repairing is the gap, not the archival. A person whose leader was encoded and never assigned
is in exactly the position Section 20 describes: their figures are reconstructed through a
leader the tree does not place, and nothing says so.

**Because Section 5 already refuses to record which cause applies.** It says so in terms —
"the schema holds no `why`" — and declines to invent one. A list keyed on the flag would
therefore be keyed on the one cause the schema happens to record, which is an implementation
detail wearing a domain rule's clothes.

**Because the flag and the condition come apart in both directions.** An archived Person may
still hold an open assignment until it is closed, and an unarchived one may hold none.
Keying on lifecycle would flag the first, which needs nothing, and miss the second, which
needs a leader.

## The one exclusion, which Section 5 already names

**A person is not listed where their pastoral leader holds an `ADMIN` account.** Section 5
states this remedy for the neighbouring list — "the remedy is for that list to exclude
accounts holding `ADMIN`" — and it is the same remedy one relationship over: there it keeps
an administrator off a list of people waiting for a leader, and here it keeps their disciples
off a list of people whose leader needs replacing. An administrator outside the pastoral
structure is a deliberate arrangement rather than a gap.

**The exclusion is safe under either answer to a question nobody has settled.** Whether a
Person outside the pastoral structure may acquire disciples at all is recorded as an open
Stop Condition. If the answer is no, this exclusion covers a state nothing can reach and
costs nothing. If it is yes, the arrangement is deliberate and the exclusion is right. What
it must not do is prejudge that question, and it does not — it says only that this list is
not where that state is surfaced.

## It is current-state, and names no period

**The list asks about now.** Section 20 reaches it through a report over a period, which is
what makes the instant worth stating rather than assuming. But a person reassigned last week
needs no action today, whatever a past period's chain looked like, and Section 15's attention
lists are current-state throughout — its own Cell list is "Cells with no meeting held for a
set number of months", measured to now.

So this route names no period, and is therefore an **undated** viewing read under Section 7's
first clause rather than a dated one. That is the same reasoning decision 0204 applied to the
Cell roster and the opposite end of decision 0231, and both are cited so the next reader sees
that one rule produced both answers.

## Who sees it, and under what capability

**`people.view_subtree`, resolved against the actor**, with the scope narrowed inside the
service. Section 20 says "shown to the upline who can act", and the people whose leader has
left are Persons; Section 7 resolves a Person target through the pastoral tree, and this is
the Read capability for that domain. It is grantable `read_only`, which a management
capability would not be — the argument decision 0204 made for the Cell roster, unchanged.

`GET /api/v1/people/duplicate-candidates` already has this exact shape, an `actor` target
with the narrowing done in the service, so this is an existing reading of an existing
capability rather than a twenty-eighth capability.

**No new capability**, and deliberately not `reports.view_subtree`: that one is dated, and a
current-state list guarded by a dated capability would owe a resolution for a period it never
names — the error Section 7 warns against in the paragraph that defines the phrase.

## What it shows, and what it must not

Each entry names the person, their member identifier, and the leader who no longer holds an
assignment. **Ordered by name.** Never ranked, never colour-graded, and carrying no count of
how long the gap has stood (Sections 13, 15 and 17). A list ordered by staleness is a
leaderboard of neglect whatever it is called.

**Each entry carries the action that resolves it** (Section 19), which is reassigning the
person under `PUT /api/v1/people/{id}/pastoral-leader`. Section 5 governs who may perform it
and this ruling moves none of that: appearing on a list confers nothing.

## What building it found, and could not settle

**Section 20 says this list is shown to "the upline who can act", and under Section 7's
authorized graph no upline can see it.** The gap that puts somebody on the list is the same
gap that removes them from every ancestor's reach: `subtreeOf` walks open assignment rows,
so a leader holding none is not in their own upline's subtree, and their disciples are not
either. A subtree-scoped actor is therefore answered an empty list, and only a Whole Church
grant sees anything.

Reproduced against the database rather than reasoned about, and pinned as the behaviour that
ships — `awaiting-reassignment.e2e.spec.ts` asserts the empty answer for the leader who is
the departed leader's own upline, which is the actor Section 20 names.

**It is escalated rather than worked around, because the obvious fix is the one thing
Section 7 forbids.** The graph that *would* reach these people is Section 20's placement
graph, which continues past a leader who left — and decision 0214 refuses to let that graph
authorize anything, on the ground that Section 20 requires the condition widening it to be
surfaced as a gap needing repair rather than read as a grant of visibility. Using it here
would make this very list the licence that argument refuses.

So the route ships correct and, for every actor but a Whole Church holder, empty. That is
worth having: an administrator is exactly who can reassign across a break, and Section 5
already makes a cross-branch move a conversation between two leaders. But it is not what
Section 20 asks for, and the difference is recorded in `CLAUDE.md` rather than papered over.

## What this does not settle

**Whether the three causes should be told apart in the data.** They should not need to be for
this list, which is the point of keying on the condition — but the question Section 5 records
is about the schema and stands unchanged.

**The other two items Section 19 lists and nothing delivers**: people with no active Cell
membership within scope, and the outcome of a leadership request the user submitted. Both are
outstanding-work entries this ruling does not touch, and neither is made more or less owed
by it.

---

Decision 0232, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-10 — A collection whose period dates its figures is a dated viewing read](0231-a-collection-whose-period-dates-its-figures-is-a-dated-viewing-read.md)
