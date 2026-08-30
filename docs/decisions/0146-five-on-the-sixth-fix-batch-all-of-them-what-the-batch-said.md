# 2026-08-29 — Five on the sixth fix batch, all of them what the batch said about itself


Seventh `architecture-guardian` pass, scoped to the sixth batch. **The mechanism is sound
and was confirmed by execution**: every disjunct is reachable, none is dead, and all four
claimed mutations redden. Every finding is a statement — in the batch whose own heading is
*"Every sentence saying which assertion catches which mutation was wrong."*

**A fixture inversion was called load-bearing in four places and is load-bearing in none.**
The correction is written into the sixth-pass entry above, where the claim was made. What
is worth carrying separately is the shape: the reason `omega`'s inversion has its shape —
Member IDs come off a sequence — was carried to a second member without re-deriving
whether it does any work there, which is section 25 rule 19 applied to a *test fixture*
rather than to code. The fixture was simplified rather than re-explained: an inversion
that pins nothing is removed, not annotated.

**Two more claims about which mutation lands where.** `last_name >` alone was said to land
on the same member as the dropped tie-break; it selects only `Zamora`, so the two land on
different people and only one of them could ever have been right. And "every mutation
below is caught by one of these inversions rather than by the names alone" was false for
three of the four.

**A fix that half-closed on one word.** The batch replaced *derived* with *measured* in
four files and left two occurrences in a fifth — `roster-cursor.spec.ts`, four lines above
the paragraph it was adding — so two files edited in one commit contradicted each other on
the single word the commit existed to correct.

**And the bound's new thesis had nothing that could fail on it.** `common/cursor.ts` argues
the constant "still refuses a query string built to be enormous", and every assertion that
moved with it was a payload-fits check — reddening when it was *lowered*, never when it
was raised. It could have been four million with the suite green. One character over the
bound is now sent and refused, verified by raising the DTO's bound above the constant.

Two smaller ones: the docblock said "the create and edit DTOs" where three import the
constant, so an audit from the docblock stops one DTO short; and `SearchPeopleDto.q` kept a
bare literal `100`, the ninth site of the number the batch had just removed from eight —
now the name bound, since the term is matched against names and a bound below it would
leave a full-length name searchable only by prefix.

**Seven passes: 12, 10, 10, 7, 5, 4, 5.** The last two found nothing wrong with the
mechanism. What they found is that this branch's residual defect rate is entirely in prose
about itself, and that the prose gets a review pass of its own or it is wrong.

---

Decision 0146, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Four on the fifth fix batch, and a disjunction pinned with a member missing](0145-four-on-the-fifth-fix-batch-and-a-disjunction-pinned-with-a.md) | Next: [2026-08-30 — A requester may decline their own request, and a decision is final](0147-a-requester-may-decline-their-own-request-and-a-decision-is.md)
