# 2026-08-30 — Section 10's "at any scope" was resting on a scope value


First review pass on the leadership-request slice. Eleven findings, of which four were
live and one was an authorization gap the specification states in terms and the code did
not deliver.

**A wider grant of `cell.request_leadership` defeated the self-naming prohibition.**
Section 10: "No holder of the capability, at any scope, may name themselves." The
implementation rested that entirely on `SUBTREE_EXCL_SELF` — and `scopeCovers` returns
true on its first line for a `WHOLE_CHURCH` grant, before the target is read at all,
while a `NETWORK` grant compares the target's Network, which for the actor is their own.
Section 7 permits Admin to grant beyond a role's defaults and has no mechanism refusing a
*wider* grant, so either is an ordinary row. Reproduced: a Leader with one such grant
named themselves and got 201, the row landing `PENDING` and approvable.

It needed no ruling, which is worth recording because the review offered it as a Stop
Condition. Section 10 says "at any scope" and cites section 5 invariant 4 as "the same
prohibition ... for the same reason" — and that one is a domain check rather than a scope
value, which is also the shape section 7 prescribes wherever a rule forbids acting on
oneself. So the check is section 10 implemented rather than a rule invented. Whether
section 7 should *additionally* refuse a grant of this capability wider than
`SUBTREE_EXCL_SELF` is a second question, and that one is a new section 7 mechanism —
`WHOLE_CHURCH_ONLY` runs the other way — so it is listed as open.

**Three docblocks asserted the prohibition was enforced by the scope value**, which was
true only of the default grant. That is the recurring class rather than a new one: a
mechanism described from the configuration in front of it.

**An absent Cell was distinguishable from one out of scope.** Section 22 requires both to
answer `SCOPE_DENIED` in one message with one details payload, with `NOT_FOUND` reached
only by an actor whose scope would have covered it. Every other Cell route inherits that
from the guard, which resolves a Cell target; this one resolves the prospective leader, so
the domain layer owes it and did not pay. The fix reproduces the guard's own mechanism — a
target resolving to nobody — rather than restating it.

**A decline note was unbounded for four of the five reasons.** `class-validator` skips
*every* decorator on a property whose `@ValidateIf` is false, so with the condition on the
reason alone, the trim, the minimum and the 500-character maximum were inert unless the
reason was `OTHER`: a 5,000-character note stored untrimmed against `TIMING_DEFERRED`. The
DTO was `CloseCellDto.note`'s stack minus its `|| note !== undefined` disjunct — dropped
without re-deriving what it was for, in a docblock citing that same DTO's other
half-closed fix and saying "it is not repeated here". Section 25 rule 19, again.

Its docblock also stated a rule section 10 does not have — that a note is "refused
otherwise" — while migration 0009 permits a note beside any reason and nothing refused it.
Three things wrong in one field: a rule invented, a sentence false of the code, and a
bound unreachable.

**A client-supplied cursor still reached PostgreSQL as a cast error.** The guard used
`Date.parse`, which is a far wider predicate than PostgreSQL's `timestamptz` parser:
`new Date().toString()` — V8's own rendering — passes it and arrives as a "time zone not
recognized" error, a reproduced 500. It matches the format this code emits now, which is
a cast to text and therefore fixed.

**Three rules had nothing that could fail on them**, all three mutations confirmed green
before the fix. The keyset's tie-break and its `ORDER BY id` are justified by "two
requests can share a `requested_at`" — and nothing in the suite produced two, because
`now()` is transaction start and every case submits in its own. They are pinned now by
rows written directly at one instant, which no endpoint can produce. And both `sameId`
comparisons on this path fail *open*, so with the identifier pipe registered globally no
end-to-end case could reach either; they are called directly with a mis-cased identifier,
which is what section 7's 2026-08-23 rule prescribes and what this repository has had to
add twice before.

**Four statements were false of a mechanism rather than of the code.** Two `@ValidateIf`s
on one property are ANDed rather than replaced — the conclusion drawn from it was right
and the reason was not, in two files and a commit message. The finality trigger is
`BEFORE UPDATE FOR EACH ROW` rather than deferred, so it fires at the statement and not at
COMMIT. A commit message said nine mutations each reddened "exactly its own case" when the
first reddened seven. And section 10's own new sentence claimed `OWN_SUBTREE`, `NETWORK`
and `WHOLE_CHURCH` "resolve to exactly that set" — `NETWORK` does not, being wider than
"any leader upline of them acting within their own subtree", and that sentence was the
stated reason for not restating the list in code.

**One claim was too strong in the other direction.** The Stop Condition recorded for
section 19's requester-facing list said no capability *can* guard it. Section 7 names
none, which is the finding; but `cell.view_subtree` against an actor target is the shape
the duplicate-candidates route already uses one domain over. The item stays open — which
of three answers is right is not derivable — but it is a reading to be chosen rather than
a surface that cannot be built.

**Two comments in migration 0009 now point at open items that no longer exist**, both
escalations this branch's own rulings closed. The migration is merged and only the first
may be corrected in place, so they stand and are corrected here — which is the third time
this log has had to record exactly that, after migrations 0005 and 0007.

---

Decision 0149, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — Three small settlements from building step one of the request workflow](0148-three-small-settlements-from-building-step-one-of-the.md) | Next: [2026-08-30 — Ten on the request fix batch, and a fix claimed in the past tense that was never made](0150-ten-on-the-request-fix-batch-and-a-fix-claimed-in-the-past.md)
