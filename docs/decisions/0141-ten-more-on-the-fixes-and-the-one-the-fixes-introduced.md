# 2026-08-29 — Ten more on the fixes, and the one the fixes introduced


Second `architecture-guardian` pass, scoped to the fix batch. The lock ordering was
confirmed again and every defect was in what the batch had done to everything else —
which is this repository's recorded rate for a fix batch rather than a surprise.

**The relaxation broke the rule it was relaxing.** Deciding "earlier than the current
day" moved the test onto `manilaDayOf(new Date())` at handler entry — a different clock
and a different moment from the `clock_timestamp()` the write is stamped with, read
after up to three seconds of lock waiting. A request arriving at 23:59:59.7 and waiting
past Manila midnight ends its rows at *yesterday's* midnight with no capability asked,
no note required and no `effective_date.backdated` entry. It fails open, on the endpoint
section 7 says backdating must not be reachable from without the grant.

That is section 5's own rule about the effective instant, applied one field over: an
operation reads what it will rely on **after** the lock. Issue #16 was the same fault on
the instant itself. The decision and the capability check both moved inside the
transaction; `coversWith` takes the executor, and the two error codes are chosen at the
call site because it collapses them.

**And the comment arguing for the strict version was left in place**, ten lines below
the code that now does what it forbids — two contradictory comments on one branch, with
the stale one surviving. Its stated reason was the live hazard above, discarded without
being answered.

**Section 7 was misquoted, and the misquote was load-bearing.** §7 resolves a Cell
"as of the period being viewed"; the batch paraphrased that as "ignoring dates
entirely", which is what licensed resolving a dispersal destination's scope through its
current leader. Corrected, and the question it papered over is settled below.

**The note fix was half-closed.** `@MinLength(1)` accepts two spaces and
`cells_other_requires_note` compares `btrim(...) <> ''`, so the same `INTERNAL_ERROR`
was still reachable — and a whitespace note satisfied the new backdating requirement,
so a backdated closure could carry a blank explanation.

**The new roster route ignored two things §22 settles.** It returned a bare `members`
array rather than the collection envelope, on an API §22 makes additive-only — the
moment before the first client is the only moment to fix that. And it answered 200 with
an empty list for a Cell that does not exist, while `POST /cells/{id}/closure` answers
`NOT_FOUND` in the same state, with a docblock justifying it by inverting §22's Cell
ruling: that ruling closes the oracle through the guard's uniform `SCOPE_DENIED` and
then *provides* `NOT_FOUND` for an in-scope actor.

**Three more statements were false of the code**: the DTO's `effective_date` docblock
still described the rule the same commit replaced, migration 0010 named a lock strength
the same commit changed ten lines above the sentence, and two configuration test
comments named `FOR UPDATE` after the service stopped taking it.

**Three fixes had nothing that could fail on them**, and the `40P01` widening had now
been promised twice in a docblock and delivered once. `test/unit/lost-lock-wait.spec.ts`
holds it. `isLockTimeout` also kept a name that no longer said what it matched, which is
the ground this repository renamed `cells_relationships_match_state` on one slice ago.

**And one thing the fixes introduced that the review did not find.** The case written to
pin `leaderAsOfWithin`'s row selection does not pin it: mutating the method to ignore
dates leaves it green, because `cell_leaderships_stay_in_network` makes every leader a
Cell ever has one Network, so which row is selected cannot change a Network comparison.
Only the *null* answer is observable, which is what the defect actually was. The test's
own comment claimed otherwise. Corrected in the test and stated in the read service,
rather than left as a green case asserting more than it holds — the fault this log
records more than any other, committed inside the batch correcting six instances of it.

**Two Stop Conditions, both settled.**

*What "the period being viewed" is for a write carrying a past effective date.* **Now.**
Authority resolves through the Cell's current leader whatever date the write is applied
at; the relationship being recorded resolves as of its own effective date. The direction
is forced: resolving authority as of the effective date would let a leader whose Cell
was handed away yesterday reclaim it by dating the action back far enough — privilege
recovered through a date field, which is §5 invariant 4's shape reached another way.
Nothing is lost the other way, since the leader who did hold it then is not thereby
entitled to act on it now. Written to §7.

*Whether a Cell roster may disclose the Cell membership of a person outside the reader's
pastoral scope.* **It may, and §8 now says why rather than being silently excepted.**
§8's forbidden list bounds the church-wide *directory* — it is written about searching,
and reading it as a general rule would forbid a Cell Leader their own roster. The
distinction is direction: a search starts from a person and would let any leader
assemble a profile of anyone; a roster starts from the Cell and is shown only to those
§10 authorizes to *change* that membership. §10 independently requires the members to be
presented at closure, so the disclosure is required rather than tolerated. The rest of
§8's list — birthday, contact details, attendance, classification — is no more visible on
a roster than in a search.

The route's own justification had been wrong in the half that mattered: it argued that
names and Member IDs are published church-wide, which is true, while the thing §8
protects is the **association** between them and the Cell.

---

Decision 0141 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Twelve findings on the closure, and the three the review escalated](0140-twelve-findings-on-the-closure-and-the-three-the-review.md) | Next: [2026-08-29 — Ten on the second fix batch, and the rule written with nothing that could fail on it](0142-ten-on-the-second-fix-batch-and-the-rule-written-with.md)
