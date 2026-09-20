# 2026-09-16 — Growth: SUYNL is recorded lesson by lesson, Training is five graduations, and Win 3 becomes derived

Hours after the Conquest specification was written, the owner sent a second Claude Design
screen and the church's own definitions for it: **Training**, the schools a disciple passes
through. Drawing it produced a third domain, **SUYNL**, the ten one-to-one lessons that come
before them. Neither word appears anywhere in `SKILL.md`, in this ledger or in the code, so
both are new ministry domains on the same terms Conquest was.

The three are one screen with three tabs and three separate records. Section 28 states them;
Section 27 is amended, because SUYNL turns out to hold the evidence Win 3 was missing.

Items 1 to 10 are the owner's answers, each drawn and answered one at a time on 2026-09-16.
**Items 11 to 17 are not owner answers, except the Training half of item 12, which is** — the
rest were settled while the specification was written, from the arguments the answers above
already rest on. They are open to the owner to overturn; what would be wrong is presenting them
among the ten.

## The ruling

**1. Training is its own module owning its own table**, rather than sharing Conquest's.

**2. Training is five graduations — `ENCOUNTER` first, then `LIFE_CLASS`, `SOL_1`, `SOL_2`,
`SOL_3`.** Life Class is a single graduation tick; its lessons are not recorded here.

**3. There is no eligibility gate.** An earlier proposal requiring four SUYNL lessons before
the Encounter is withdrawn. The order is displayed and never enforced.

**4. SUYNL is recorded lesson by lesson**, ten lessons, and **graduates automatically at ten
of ten**. A finished person collapses to one line carrying a `Correct` action.

**5. A SUYNL lesson tick carries the day it was filed.** No date is stated on this tab.

**6. A graduation carries a date where the leader knows it and none where they do not.**

**7. A past graduation date is not the backdating of Section 3, and a leader may state one** —
while no report counts graduations by period. **The condition is the ruling's, not a caveat
added to it**, and the same answer reaches Section 27's pre-encoding `reached_on`, which was
recorded as open until today.

**8. Growth is one sidebar item with three tabs — `SUYNL`, `Training`, `Conquest`.** The
sidebar stays at six items.

**9. The counts live at the head of their tabs and never in Reports or Section 16**, as of now
rather than as of a period, each clicking through to the people behind it.

**10. Win 3 is derived: at least three direct pastoral disciples each with at least three
SUYNL lessons recorded.** All four Conquest goals are therefore derived, that tab carries no
routine tick, and **a disciple who leaves still counts toward a Win 3 already reached**.

**11. SUYNL is also its own module owning its own table.** **Not an owner answer** — item 1's
argument applied one domain over, and the three records are corrected on different terms.

**12. Six capabilities, three for each of the two new modules**, in the shape Section 9 uses for DCC and Section 27
for Conquest: `suynl.view_subtree`, `suynl.confirm`, `suynl.confirm_on_behalf`, and the three
`training.*` counterparts. **Item 12's Training half is the owner's**, named when the
Training questions were settled; the SUYNL half and the separation below are not.

**13. Neither set reaches the other, and `conquest.*` reaches neither.** **Not an owner
answer.** An administrator must be able to let a leader file lessons and not graduations, and
a derived figure is read under the capability guarding the route that returns it.

**14. Win 3's first-reached date is computed, not materialised.** **Not an owner answer**, and
the drawing session named it as something the ruling had to settle either way.

**15. A Network root's lessons and graduations are filed by an actor holding the confirming
capability at Whole Church, and such a row carries no confirming leader.** **Not an owner
answer** — Section 27's rule for the identical problem, reused rather than re-derived.

**16. A person who has not graduated has no row**, and Section 11's sentence is amended rather
than read narrowly. **Not an owner answer.**

**17. Only current rows ever count, at every instant**, so a lesson corrected away never counted
and both a graduation and a Win 3 date move when one is withdrawn. **Not an owner answer** — it
is what a correction means, and the derivation is undefined without it.

## The ground

**Two modules rather than one, because one of them is temporary.** An enrolment application is
planned elsewhere and will own enrolment and lesson progress for the schools. When it takes
over, Training's write endpoint is retired and its rows stay as history, which the migration
policy requires anyway; a table shared with Conquest would mean stopping writes for half a live
table's catalog values. The same argument makes SUYNL separable from Training: its record is a
lesson, corrected lesson by lesson, and Training's is a graduation.

**Only SUYNL is recorded lesson by lesson, and that is a recording decision.** Life Class also
runs to ten lessons. Recording them here as well would give the church two records of one fact,
free to disagree, with nothing able to keep them in step — and the owner's stated goal is how
many people are in the process rather than a per-person grid of every lesson. Section 5 denormalizes the root seat where two
triggers keep the copy honest, and states no general rule either way.

**Ten of ten is a graduation and is not stored.** A graduation tick beside ten lesson rows would
be free to contradict them — the argument Section 9 makes of classification, which decision 0249
applied to a goal.
This is the same rule that made three Conquest goals derived, applied inside one table.

**A filing date is what the derivation needs.** Win 3's date is read from these instants, so a
stated day would have to be the one the derivation used, and nothing would keep the two in step
for the lessons where a leader states one and not the others. The two tabs
differ because one is read by a derivation and the other is not. *A first version argued instead
that a stated date here would reach Section 3's backdating rule, which the ruling below denies
four paragraphs later; one of the two had to go.*

**An optional graduation date is Section 3's own argument.** That section makes birthday and
mobile number optional because a mandatory field somebody cannot fill gets filled with a
fiction, and leaders will be asking about graduations from years back. The cost is stated on
the screen: a figure counting graduations within a period counts only the dated rows.

**The date rule is a ruling and not a deduction, and two attempts to derive it failed.** The
first argued that Section 7's list of what `records.backdate_effective_date` reaches is closed
and that every member moves a total already reported; the list's own closing clause forbids that
inference. The second argued that `graduated_on` is not an effective date and the capability
governs effective dates; one item on that same list — amending attendance after a month has
closed — carries no effective date at all, so what an effective date is does not bound the
capability's reach either. Both were refuted by `architecture-guardian`, one per review.

So the specification settles neither side, and **whether Section 7's list is a rule or an
enumeration is now recorded as open in its own right**. What stands is the owner's answer to the question that was
asked: the confirming leader states the date. Leaders are being asked about graduations from
years back, and the alternative leaves the church's own history unrecordable by the people who
know it. **The condition is part of the ruling**: it holds only while no report counts these by
period, and the first report that does moves such a date into the class Section 3 protects.

**Win 3 stops being the exception.** Section 27 made it the one stated goal because nothing
recorded who won whom — and nothing does now either. What SUYNL supplies is different and
sufficient: three direct disciples each carrying three lessons is the church's own evidence
that three people are being discipled one to one, and it is a record the church keeps for its
own reasons rather than one kept to feed a tick.

**Its date is computed because a stored one could contradict the rows.** Both terms are dated —
lesson filing instants, and pastoral assignment history — so the earliest instant at which the
condition held is a question the database answers. Section 5 does denormalize where something
keeps the copy honest, the root seat carrying two triggers for exactly that; a materialised Win 3
date would have nothing checking it against the rows it came from. **The cost is real and is stated in Section 27**: a later change
to what Win 3 means rewrites every date it ever gave, with nothing recording the old one.
Materialising survives such a change and buys it by storing a fact the records hold.

**A disciple who leaves still counts, and that needs no exception.** Because both terms are
dated, an instant in the past is unaffected by who is a disciple today. Section 27's milestone
rule arrives here by derivation rather than by a rule written to protect it.

**SOL 3 is called Leadership, and Section 11 said there was no graduation status.** There is
one now, so the sentence is amended rather than read narrowly. The church has SOL 3 graduates
who lead no Cell — the owner's own situation, offered unprompted — which is exactly the reading
that sentence exists to forbid: leadership is earned by leading a Cell.

**Three tabs rather than three sidebar items.** Seven items are more than the phone's bottom bar
was drawn for at the narrowest width Section 23's layout check runs at, which that section calls
the one where overflow is hardest; and the three tabs are what one leader asks one person about
in one sitting. `Growth` is a label on a sidebar item and never a module, Section 2
naming a module for what it owns.

**Growth stays out of Reports for Conquest's reason and one of its own.** Section 16 defines no
metric these duplicate, so the Conquest argument does not carry — but a Reports block would make
these counts period figures, which is precisely the trigger item 7 turns on.

## What it costs

**A lesson done long before it was recorded carries the later day.** SUYNL is recorded from the
pilot forward, and history the records cannot hold is confirmed under Section 27 instead.

**Correcting one lesson can move a Win 3 date, or remove the goal.** That is right rather than
regrettable — the correction says the tick was wrong — and it is the visible edge of item 14.

**Every school is stated by a leader asking their people.** Nothing is derivable, because no
enrolment, class or attendance record exists for these schools.

**The pilot ships without any of it.**

## What this does not settle

- **Whether a Growth figure may ever be reported by period.** It is the trigger item 7 turns
  on, and the first report that does owes a ruling on who may state a date. Escalated.
- **Where a pre-encoding Conquest confirmation and a setup Cell's answer are filed**, now that
  the Conquest tab carries no save bar. Section 27 keeps both.
- **What happens to `training_graduations` when the enrolment application exists** and owns
  lesson progress for the schools — whether a graduation becomes derivable from it, and which
  record is then authoritative.
- **Which resolution `suynl.view_subtree` and `training.view_subtree` take.** Section 7 names
  three viewing capabilities that resolve as of the period viewed and makes every other resolve
  as a write. With `conquest.view_subtree` these are three more, and the closed form answers
  them by default rather than by decision.
- **What a confirmation and a derivation together say about one goal.** A `WIN_3` row stating a
  date and a derived first-reached instant can both exist for one person, and since this ruling
  all four goals are in that position rather than three. Nothing says which the reader gets.
  Escalated, and owed by the write endpoint rather than by the screen.
- **Whether `records.backdate_effective_date`'s reach is a rule or an enumeration.** Section 7
  states a rule over a category and then says the list is not generative; Section 5 restates it
  generatively. Until it is settled nothing may be grounded on that list's membership in either
  direction, which is why the ruling above is grounded on neither.
- **Any Growth surface for a person viewing their own lessons, graduations or goals.**

---

Decision 0250, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-16 — Conquest: three goals are derived, one is confirmed, and a goal reached stays reached](0249-conquest-three-goals-are-derived-and-one-is-confirmed.md)
