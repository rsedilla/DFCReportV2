# 2026-09-16 — Conquest: three goals are derived, one is confirmed, and a goal reached stays reached

The owner sent a Claude Design handoff for a new module, Conquest: the four G12 goals of every
person under a leader's care — Win 3, Open a cell, Completion of 12, Raise 12 leaders — as a
table of checkboxes saved deliberately. The word appears nowhere in `SKILL.md`, in this ledger
or in the code, so it is a new ministry domain rather than a screen over an existing one, and
building from the handoff directly would have shipped invented rules.

Six questions were put to the owner one at a time, each with a drawing, on 2026-09-16, and
items 1 to 6 are their answers. They are recorded together because they are one feature.

**Items 7, 8 and 9 are not owner answers and are marked as such.** Item 7 follows from the
handoff and the screens the owner approved. Items 8 and 9 were settled during
`architecture-guardian`'s reviews, which found that the capability list left a statement nobody
could withdraw and that neither capability reached a Network root. All three are open to the
owner to overturn; what would be wrong is presenting them among the six.

## The ruling

**1. What each goal means, and which the records already hold.** Section 27 states them. Open a
cell, Completion of 12 and Raise 12 leaders are computed from `cell_leadership_requests`,
`cells`, `cell_leaderships` and `pastoral_assignments`; Win 3 is stated by a leader.
*(Amended by decision 0250 later the same day: SUYNL gave the church a record Win 3 can be read
from, so all four are derived and a leader states only history the records cannot hold. The
ground below — that nothing records who won whom — is still true and is not what 0250
overturned.)*

**2. A goal reached stays reached**, carrying the date it was first reached, with the current
standing shown beside it.

**3. Correcting a confirmation requires a reason and supersedes rather than deletes.**

**4. `conquest.view_subtree` reads a subtree, `conquest.confirm` files for the actor's own
direct disciples, and `conquest.confirm_on_behalf` files for a downline leader.**

**5. Conquest figures do not enter the reporting surface.** Its four counts live at the head of
its own screen, and a per-leader breakdown is not built.

**6. The specification is written now; the code is built after the pilot.**

**7. Conquest is the sidebar's sixth item**, extending decision 0245 from five, placed as
Section 19 places it, and its own item rather than a screen under `Record`
*(amended by decision 0250: the sixth item is `Growth` and Conquest is one of its three tabs;
the argument against `Record` carried over unchanged)* — `Record` is
attendance against a dated event with a submission window closing behind it (Sections 9 and
13), and a goal is reached on a day nobody scheduled. **Not an owner answer.**

**8. Correcting travels with whichever capability filed**, rather than becoming a third one, and
a correction is attributed to the confirming leader named on the row rather than to the actor
who filed it. **Not an owner answer.**

**9. A Network root's goals are confirmed by an actor holding `conquest.confirm` at Whole
Church, and such a row carries no confirming leader.** A root is nobody's direct disciple and
nobody's downline, so item 4's pair reaches neither of them. **Not an owner answer**, and it is
Section 9's own answer to the identical problem applied one domain over rather than invented.

## The ground

**Deriving is Section 9's rule rather than a preference.** Section 9 forbids hand-maintaining a
classification attendance history can derive, and Section 5 refuses a `status` column beside
`ended_at` for the same reason — a second copy free to contradict the rows it duplicates. *(That
sentence read "Section 5 forbids a second representation of a fact a table already holds" until
decision 0250: Section 5 states no such general rule, and denormalizes the root seat where two
triggers keep the copy honest.)*
Raise 12 leaders is the sharper case: Section 16 already evaluates that condition from the
tree, so a tick would be free to contradict the rows it reads — different figures, one being a
current-state snapshot and the other a milestone, over the same records.

**Win 3 is the one goal no record holds, and that was checked rather than assumed.** No column
in any migration records who brought a person; Section 9's VIP workflow captures the leader a
person is placed under, which is a different fact. Adding a *brought by* field to Section 3
would make it derivable and was not taken, because it changes what is asked of every person at
registration.

**Nothing is inferred from the rung below.** The owner asked whether opening a Cell should tick
Win 3. It should not: no rule of this church requires three before a Cell is opened, so the
inference is only as true as a rule nobody has written, and an inferred tick carries no date,
names no confirming leader, and could never be corrected. The rungs were checked one at a time,
and the arithmetic differs — Raise 12 leaders entails Completion of 12, while Completion of 12
entails nothing about a Cell.

**Reached once is reached, because that is what the ladder means.** A milestone reached is not a
level somebody falls out of, and a leader who watched somebody complete their twelve is not
told in September that it never happened. Reproducibility is deliberately not offered as a
second ground: Section 3 and Section 16 already provide for a current-state figure that is
reproducible for a closed month, so that argument runs the other way.

**A handover is not an opening, and the request tells them apart.** The opener holds the
earliest leadership of a Cell an approved `NEW_CELL` request names, and
`cell_leadership_requests.cell_id` is set at approval for that kind alone (migration 0009).
Earliest leadership by itself does not carry it, because a Cell recorded at setup has one.

**Direct creation during initial encoding is the exception the pilot will meet.** Section 2 has
Admin record roughly 800 existing Cells directly, writing one leadership for a Cell that has
been running for years. The leader confirms which it was, and both answers are recorded — a
question with only one available answer could never be dismissed. The same gap reaches
Completion of 12 and Raise 12 leaders, since the import fabricates no history.

**`conquest` computes none of this itself.** The four tables belong to `cells` and `hierarchy`,
and Section 2 admits no exemption for a module rooting a query in another's tables when it owns
nothing the query starts from. `cells` computes the Cell half, `hierarchy` the pastoral half,
and `conquest` composes — the route Section 2 already names for `reporting`.

**`conquest.view_subtree` is a read capability**, added to Section 7's Read list rather than
falling into "every other capability" by omission. Two migrations are owed when the module is
built: the `capability` enum gains all three identifiers, and the read-only CHECK constraint
gains this one alone.

**The authorization shape is DCC's, deliberately.** Section 9 rests a record on the person's
direct pastoral leader and provides an on-behalf capability for the upline who must cover. The
reason is not hypothetical: the Men's Network root had no account, which left his twelve
disciples on nobody's DCC checklist. No new scope value is introduced.

**Conquest stays out of Reports because Section 16 is next door.** Two of its metrics are close
to these rungs and identical to neither, and a Reports block would put near-identical counts in
front of one leader with nothing saying which question each answers. The per-leader breakdown
is refused by this ruling rather than by Sections 17 and 19, which permit sorting and forbid
ranking: an unordered table would be permitted, and the figure it carries reads as a standing
whatever its order.

**The specification is written now because the decisions are fresh.** `CLAUDE.md` says a
decision living only in a chat session does not exist. The code waits because the pilot gate is
a leader recording one month unaided, which Conquest does not help with, and because leaders
using it may change the screen.

## What it costs

**A leader cannot see where somebody stands from the tick alone**, so the current standing is
carried beside it.

**A derived goal nobody stated cannot be corrected on this screen.** It looks wrong because a
Cell leadership or a pastoral assignment is wrong, which is the right place to fix it and is
further away. *(Decision 0250 adds a third source: a SUYNL lesson, once Win 3 became derived.)* Where a leader did state one — a pre-encoding confirmation, or a setup Cell's
answer — it is corrected here like any other.

**A Cell opened before encoding and closed before it cannot be confirmed at all**, since every
`OPEN_A_CELL` confirmation names a Cell and no row holds that one. What is lost is a Cell that
had already ended before the church was encoded.

**The pilot ships without the goals.**

## What this does not settle

- ~~**What date a confirmation of a pre-encoding goal carries, and who may set it.**~~
  **Settled by decision 0250 the same day**: the confirming leader states it, without
  `records.backdate_effective_date`, while no report counts these goals by period — which
  condition is part of that ruling and is itself recorded as open. It is an owner ruling and not
  a deduction: 0250 records two attempts to derive it from Section 7 and why both failed.
- **Whether Conquest counts replace Section 16's two metrics, sit beside them, or stay
  separate**, owed by the first Reports block that carries them.
- **What a Cell closed `CREATED_IN_ERROR` does to Open a cell.** Section 27 states two rules
  that meet here, and a derived goal has no confirmation to supersede.
- **What governs a Conquest count asked for at a scope the actor does not hold, or for a past
  period.** Section 27 bounds its own screen and claims nothing beyond it.
- **Which resolution `conquest.view_subtree` takes.** Section 7 names three viewing
  capabilities that resolve as of the period viewed and makes every other resolve as a write;
  this is a fourth, and the closed form answers it by default rather than by decision.
- **What a Win 3 confirmation records beyond a boolean**, and therefore what a leader disputing
  one can point at. *Narrowed by decision 0250 to a pre-encoding confirmation alone: a derived
  Win 3 points at three disciples and their lesson rows.*
- **Whether the ladder should ever be enforced.** A refusal reaches only what a leader states,
  never what the records say; a rule requiring three before a Cell is opened belongs in
  Section 10.
- **Any Conquest surface for a person viewing their own goals.**

---

Decision 0249, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-15 — A person's current Cell is read under `cell.view_subtree`](0248-a-persons-current-cell-is-read-under-cell-view-subtree.md)
