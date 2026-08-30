# 2026-08-29 — Five on the fourth fix batch, and a bound that moved underneath its payload


Fifth `architecture-guardian` pass, scoped to the fourth batch alone. The mechanism that
batch was about — the three-key cursor and the keyset consuming it — was traced and
executed and is correct: the comparison is total, since all three keys are `NOT NULL`
with not-blank checks on the names, it uses the same operators and collation as the
`ORDER BY` so it cannot disagree with the ordering, and `limit + 1` emits a cursor iff a
further row exists. One live defect, one unpinned rule, three statements broader than the
code.

**A bound on a cursor is a bound on its payload, and this one changed underneath its
bound.** `@MaxLength(200)` was written when the cursor was a bare Member ID of eight
characters. The batch that made it carry two names rewrote the docblock directly above
the decorator and left the number — so the server can emit a cursor its own DTO refuses,
answering `VALIDATION_FAILED` on a value the client was handed. On this route that is the
defect the batch had just fixed, one status code milder: the closure needs a member list
that is exactly the current membership, this route is the only way to build one, so a
Cell over the page size is closable by nobody.

**The precedent cited for the fix was carrying the same defect**, which is the part worth
keeping. `people.dto.ts` bounds its cursor at 500 and was named — by the review and by
`roster-cursor.ts` — as comfortably fitting the payload. It does not: measured, the
roster's worst case is 870 and `/people`'s is 899, because its third key is a UUID rather
than a Member ID. Copying 500 would have been section 25 rule 19 for the third time on
this branch, in the fix for a finding whose own heading is rule 19.

So the bound is **measured rather than borrowed**, and the arithmetic is the interesting
half: `class-validator` counts UTF-16 units, so the costliest 100 units is 100
three-byte characters — a four-byte character costs two units and buys 200 bytes rather
than 300, which makes the intuitive worst case not the worst case. It lives in
`common/cursor.ts` because both modules use it and a bound copied into two DTOs drifts,
and `roster-cursor.spec.ts` computes the worst payload and asserts it fits with real
headroom, so lowering it reddens rather than waiting for a name long enough to find it.

***It was first written as a derivation, and that word was wrong.*** The measurement
covers the paths that validate a name, and `persons` stores names as bare `text` while
the tree import writes through the services rather than a DTO and bounds nothing — so a
300-character name is representable today and produces a 2,470-character cursor. No
finite constant is provably sufficient while no rule states a maximum name length, and
section 3 states none. The constant is therefore a request-size guard set about four
times clear of any validated path, its docblock says so, and the missing rule is listed
as open below. Found by checking my own premise rather than by the review — the premise
being one this batch had just written into three files. `/people` is fixed in
the same change, on the precedent this repository set on 2026-08-23: a pre-existing defect
of the identical class is closed with it, because leaving it means a reader checking the
citation finds the defect still in it.

**The paging case pinned that a filter existed, not that it was lexicographic** — and the
fixture is why. Two members with distinct last names page correctly under
`last_name >` alone, and under `member_id >` alone. The property every one of the four
places that justify this change names — a lexicographic keyset needs every key it orders
by — had nothing that could fail on it, and section 3 says plainly that a congregation of
several thousand holds two people who share a name.

**The corrected fixture took two attempts, and the second is the lesson.** Three members,
two sharing a full name, so each disjunct decides a boundary. Created in name order, the
Member IDs come off the sequence in that same order — so the tie-break agrees with the
ordering by accident and a `member_id`-only comparison still pages perfectly. That
mutation was run and passed. They are now created in reverse, so the member sorting last
by name holds the lowest Member ID, and all three mutations redden.

**Three statements broader than the code**, all of one kind: a consistency claim that
held for one step of three. "Matches `GET /api/v1/people`" was true of the decoder and
false of the validation in front of it — different length bounds, and `/people` refusing
an empty `cursor=` while the roster answered page one. Both now bind the same
`@Length(1, …)`, which is the cheaper fix than narrowing a sentence that is the whole
justification for the behaviour. And the open list's two count sentences disagreed,
because the instruction to recount lives in the italic and the batch updated only that;
the bolded twin, which is what a reader meets first, said thirty-one. Both now say it and
both say they move together.

The fourth finding — "seventeen backdated cases" — was already corrected in `d6833aa`
before this pass reported, by the same method the entry recommends: counting the set
rather than the grep that stood in for it. Fourteen.

**What five passes cost, and what they bought.** 12, 10, 10, 7, 5. Every pass but the
last found a live defect in the batch before it, and three of the five found one in the
mechanism the previous batch had just built. The two the fourth and fifth passes found
were both invisible to a green suite and a clean typecheck — a query that cannot be
planned, and a bound nothing reaches until a name is long enough.

---

Decision 0144, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Seven on the third fix batch, and a 500 on a documented parameter](0143-seven-on-the-third-fix-batch-and-a-500-on-a-documented.md) | Next: [2026-08-29 — Four on the fifth fix batch, and a disjunction pinned with a member missing](0145-four-on-the-fifth-fix-batch-and-a-disjunction-pinned-with-a.md)
