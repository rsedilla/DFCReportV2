# 2026-09-17 — The recording queue is a route of its own, and it reaches a closed Cell

Section 19 puts *meetings awaiting a record* at the head of a leader's Dashboard and says of
the closed-Cell half that it is "the only surface naming those meetings and the only thing
that makes the permission to record them reachable". The application does not serve it. The
Dashboard assembles its queue from `GET /api/v1/cells`, which is `ACTIVE`-only, so a Cell
closed part-way through a month takes its already-scheduled meetings out of the queue with
it — and nothing else names them, because every other route into a meeting needs the Cell's
identifier and no screen can supply one.

The permission is not the gap. `cell.take_attendance` resolves through a closed Cell's
leadership, and the submit route accepts while the month's window is open. Only the
**identifier** is missing. *What `GET /api/v1/cells/{id}/meetings` does for a closed Cell's
former leader is the code's behaviour and not a rule — Section 7 answers it twice and not
identically, which `CLAUDE.md` records as open and this ruling does not settle.*

## The ruling

**1. Section 19's recording queue is a route of its own**, rather than something a client
assembles from the Cells index. It answers what is awaiting a record from the actor.

**2. It is guarded by `cell.take_attendance` at an `actor` target.** The capability follows the
**act that resolves an entry** rather than the rows the answer contains, which is the
discriminator the people-without-a-Cell list already uses; the act here is submitting a
meeting's record, and that is `cell.take_attendance`. Section 7 makes the neighbouring argument
for the meeting roster and for the members route: requiring a management capability to reach an
attendance surface is what must not happen.

**3. Its population is the actor's own work and nobody else's** — every scheduled meeting with
no record, **whose Manila day has begun** and whose reporting month is still open, `ACTIVE` Cell
or `CLOSED`, **which the actor is the one Section 7 authorizes to file**. The capability admits
the caller; the restriction to their own meetings is a check in the owning module, which is what
Section 7 already says of the DCC checklist. The day bound is decision 0238's: a meeting whose
day has not begun takes no record, so without it the queue holds every remaining date of the
month and offers no act that resolves them.

**4. The leader it is shown to is the one Section 7 authorizes to file it**, which is Section
19's own words for this list and is not one rule but two. **On an `ACTIVE` Cell it is the current
leader**, whatever any record says — Section 7 states that in terms, and a Cell handed from A to
B has B filing a meeting held under A. **On a closed Cell whose window is open it is whoever led
the Cell on the scheduled date**, under Section 7's closed-Cell exception, "within this exception,
and only within it". So a Cell that changed hands and then closed gives the meetings before the
handover to one leader and those after it to another, while the same Cell before its closure gave
all of them to whoever held it then.

**5. The Cells index is not widened.** It stays `ACTIVE`-only and this ruling touches neither
its membership nor its filter.

Items 1, 2 and 5 follow the owner's choice of 2026-09-17 between three drawn options — a route
of its own, widening the Cells index, or a second narrow read beside it. **Item 3 is the owner's
choice of 2026-09-15**, restated here rather than decided again. **Item 4 is not an owner
answer**: it was settled while the route was specified, from Section 13's own resolution rule.

## The ground

**The population is the owner's choice of 2026-09-15, restated rather than re-decided.** "The
queue is the leader's own work and nobody else's": a downline leader's outstanding meetings
belong on an attention list, not on somebody else's to-do list. Section 19 agrees in its own
words — its bullet is "for the user's own Cells", and it puts the subtree case in a separate
bullet — and Section 13 says an unreported meeting is "shown to the responsible leader",
singular. *A first version of this ruling keyed the population to the actor's whole
`cell.take_attendance` scope, which the role catalog grants a Senior Pastor and an Admin at
Whole Church: that queue is every unrecorded meeting in the church. `architecture-guardian`
caught it against the choice above.*

**A route, because Section 19 describes outstanding work rather than a list of Cells.** What
the Dashboard needs is the meetings; it currently reconstructs them with two index calls and
then one request per Cell, and the thing it cannot reconstruct is the one Section 19 names
specifically.

**Widening the Cells index was rejected for what it would have forced.** That list carries an
open question in `CLAUDE.md` — whether a collection's `ACTIVE`-state filter dates with its
membership, where Section 7 and decision 0231 say different things — and answering it was not
what this change is for. Six screens read that list; a queue reads none of them. A second narrow
read beside the index was rejected as the smallest diff with the worst shape: it leaves the queue
stitched from two sources, so the next surface needing a closed Cell's meetings remembers both.

**The key is Section 7's, and stating it unconditionally was the first version's error.** Section
7 makes the scheduled-date resolution an exception for a closed Cell and says an `ACTIVE` Cell
"resolves through its current leader, whatever any record says"; decision 0188 carries the same
"and only there" clause and records a draft of its own that omitted it. Keying the whole
population to the scheduled date would hand A a queue entry whose submission Section 7 resolves
through B — showing one leader a task the API refuses them and hiding it from the leader who owes
it, which is the defect Section 7's per-record rule exists to prevent, arriving from the other
side. *`architecture-guardian` caught it against all three homes.*

**The queue is derived from the schedule rather than read from `cell_meetings`**, no row
existing yet — and a closed Cell's schedule ends at its closure, which is why the meetings it
still owes are exactly those scheduled before that date.

## What it costs

**Two enumerations of a leader's Cells now exist and they do not agree**, deliberately: the
index is `ACTIVE`-only and the queue is not. A reader comparing them sees a Cell in one and not
the other, and the reason is that they answer different questions.

**The queue is the fifth place the submission window is evaluated.** Section 13 owns that rule
and this route reads it; a change to the window has one more caller. *This said "a second
place", which was wrong and was the kind of wrong this log keeps recording: `isMonthOpen` already
had four callers — the Cell meeting scope service, the Cell submit and reschedule paths, and the
DCC calendar. Counted by `grep -rn "isMonthOpen(" api/src` rather than remembered, after a review
put the figure at six by counting a DCC path that deliberately does not call it.*

## What this does not settle

- **Whether a leader who has left sees a queue at all.** The leader of a past meeting may hold no
  assignment now, which is the condition decision 0232's attention list exists for, met from the
  other side; what they see here is not stated. Their own queue is not the question — a subtree
  walk seeds at the actor, so they see their own rows — but since this queue holds only what the
  actor files, such a meeting is in **no** queue at all. What a wider grant reaches is Section
  15's attention list, not this route.
- **What `GET /api/v1/cells/{id}/meetings` answers a closed Cell's *earlier* leader.** The
  open question is about its **last** leader, and that is not the case this route creates.
  The queue splits a closed Cell's meetings by scheduled date, so it hands the Cell's
  identifier to whoever led on each date — leaders who are neither current nor last.
  `leaderForScopeWithin` resolves a closed Cell by `started_at DESC` with no `ended_at`
  filter, so it answers the last leader alone: an earlier leader is refused under **both**
  readings of Section 7, not merely one, and the open bullet does not cover them. It is one
  click away, because the recording screen's back link is unconditional. The `Record` action
  itself is unaffected — the roster resolves through `leaderForMeetingScopeWithin`, which
  gives the scheduled-date leader — so Section 19's "each entry carries the action that
  resolves it" holds. *An earlier version of this bullet described the newly reachable case
  as the already-open one; it is a wider case that nothing records.*
- **Where a scheduled meeting whose Cell had no leader on that date goes.** Already open for the
  coverage denominator, which carries such a pair with a null leader rather than dropping it. A
  queue keyed on the leader inherits it exactly: that meeting is in nobody's queue and nothing
  names it, which is the gap this route exists to close, one case over. Not reachable — a Cell's
  schedule and its leadership open and close together.
- **How the attention list this route redirects a downline leader's meetings to reaches a closed
  Cell.** Section 15 requires that list to carry one, "for meetings whose month is still open",
  and its only source is the same `ACTIVE`-only index this route was written because of. The gap
  is unchanged here and is now the one this ruling points at.
- **How a requester sees the outcome of a leadership request they submitted**, which is the
  other half of Section 19's outstanding work that no route serves. Unchanged by this ruling and
  still open.

---

Decision 0251, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-16 — Growth: SUYNL is recorded lesson by lesson, Training is five graduations, and Win 3 becomes derived](0250-growth-suynl-training-and-a-derived-win-3.md)
