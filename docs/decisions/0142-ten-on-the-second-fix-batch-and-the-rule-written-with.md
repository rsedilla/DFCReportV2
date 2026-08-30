# 2026-08-29 — Ten on the second fix batch, and the rule written with nothing that could fail on it


Third `architecture-guardian` pass, scoped to the fixes. The mechanism the batch was
mostly about — the backdating check moved inside the transaction — was confirmed
correct: `coversWith` plus `grantCoversNothing` reproduces `authorize`'s split for every
actor the role catalog admits, and a `church` target short-circuits before the executor
is used. Everything found was again in what the batch said, and in what it left unpinned.

**The rule the batch wrote into section 7 had nothing that could fail on it.** Section 7
gained "a closure backdated across a destination's handover is scoped against the leader
who holds that Cell today", and mutating the code to resolve as of the effective date
left the whole suite green — every destination case either closed as Admin, whose Whole
Church grant returns true before the target is read, or named a Cell that never changed
hands. That is this branch's own headline fault, committed on the rule it added to the
source of truth.

**And the case written for it took two attempts.** The first used an undated closure, so
both readings resolved to the same leader; the second dated it *after* the destination's
handover, which does the same. It discriminates only with a Leader holding an explicit
Whole Church grant of `records.backdate_effective_date` — because an undated closure
takes effect now and only Admin can otherwise backdate — closing at a date *before* the
handover. Three versions, two of which passed against the mutation they named.

**Section 8's new paragraph forbade what section 12 requires.** It said a member's
attendance is "no more visible on a roster than in a search", and section 12's *roster
view* is defined as listing every member **with their attendance for the month**, to the
identical reader set. The amendment was written about `GET /cells/{id}/members` and used
the word section 12 had already bound. Corrected by saying what each surface carries
rather than what "a roster" does.

**The day question moved in one place and not the other.** `closureTooEarly` still chose
between "the earliest legal date is X" and "this cannot be backdated" on `Date.now()`,
one method below the block moved for exactly that reason — and the commit message
asserted "both halves of that comparison moved". One had.

**Section 7's new paragraphs were inserted inside a bullet list**, terminating the closed
enumeration of what a scope resolves against and leaving five target kinds in a second
list, with three paragraphs about one member of it reading as though they governed all
seven. Moved to a subsection of their own.

**Three more statements false of the code**: `capability.guard.ts` said whether a Cell's
existence is a `NOT_FOUND` case "is escalated in CLAUDE.md — section 22 settles it for a
Person and for nothing else", which section 22 had settled for a Cell by name and which
the same batch cited one file away; the new `ORDER BY started_at DESC` was called "the
tie-break the trigger has", when neither it nor the trigger has one and the restore state
its own reason invokes is exactly where two rows share a `started_at`; and the roster's
docblock claimed section 22 compliance while binding no `limit`, which is the
truncation-without-a-cursor shape this log already carries as open for
`/people/duplicate-candidates`, arrived at deliberately.

**Two Stop Conditions, both settled.**

*A write carrying a **forward** effective date.* Section 7's paragraph settled only past
dates, and `CellsConfigurationService.changeSchedule` is the one write in the system
whose effective date is in the future. The rule generalises rather than needing a second:
authority is decided when the write is made, whichever direction the date points, so a
schedule change is authorized by who holds the Cell now and not by whoever may hold it
next month. Written to section 7.

*What a backdated closure with `reason: OTHER` owes.* One note, carrying both. That
reason already requires a note, so for it alone the backdating rule adds no field — which
is a weaker outcome than for the other four and is accepted in writing rather than taken
silently, as the code had been taking it. The alternative is a second free-text field,
which is structure nothing else in this specification has and section 26 would have to
index, to obtain a distinction nothing can enforce. Written to section 10.

---

Decision 0142, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Ten more on the fixes, and the one the fixes introduced](0141-ten-more-on-the-fixes-and-the-one-the-fixes-introduced.md) | Next: [2026-08-29 — Seven on the third fix batch, and a 500 on a documented parameter](0143-seven-on-the-third-fix-batch-and-a-500-on-a-documented.md)
