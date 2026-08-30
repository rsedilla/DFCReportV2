# 2026-08-29 — Seven on the third fix batch, and a 500 on a documented parameter


Fourth `architecture-guardian` pass, scoped to the third fix batch alone. The mechanism
that batch was about — the backdating check moved inside the transaction — was confirmed
correct for a second time, and `closureTooEarly`'s day decision was confirmed to have
moved with it. Everything found was elsewhere, and two were live.

**The pagination this branch added to satisfy section 22 could not run.** The cursor
carried the Member ID alone and the comparison looked the other two ordering keys up in
a scalar subquery, which compiles to a row constructor against a single-column subquery:
`subquery has too few columns`. It is an analysis error, so it fires before a row is
read, on every Cell and every cursor value — and `42601` is not a code
`postgres-errors.ts` classifies, so it rendered `INTERNAL_ERROR`. A 500 on `limit`, which
section 22 documents. I reproduced it against `dfc_ci` before acting on it.

It was not confined to a read. `POST /cells/{id}/closure` refuses any member list that is
not exactly the current membership, and this route is the only way to obtain one — so a
Cell with more members than the page was **closable by nobody**, which is the failure the
pagination was added to prevent, reached at 200 members instead of 500.

Nothing could fail against it, for a reason worth keeping: the `$if` guard meant the
broken SQL was never *built* unless a cursor was present, and no case supplied one.
`tsc` was clean throughout. A green suite and a clean typecheck over a query that cannot
be planned is the sharpest form of this branch's recurring fault.

**The fix is section 25 rule 19 applied where the batch had skipped it.**
`people.read.service.ts` already pages this shape and carries its whole key in the
cursor, and the reason is not incidental: a lexicographic keyset needs every key it
orders by. Carrying one key forces the lookup, and it also makes the boundary unstable —
a member renamed between two pages moves the key the lookup would have found, so rows are
skipped or repeated. The batch reused the `limit + 1` half and the envelope half and
re-derived neither of the other two.

The cursor is now base64url of all three keys, which also closes the second half: what it
emitted was a bare Member ID, six digits off a sequence (section 3) and published
church-wide (section 8), so a client could construct one — precisely what section 22 says
a cursor must never be.

**The rule this branch wrote into section 7 was written into section 8.** The three
paragraphs were correctly lifted out of section 7's target-resolution bullet list, where
they were terminating a closed enumeration, and reinserted eighty lines further down —
past the section boundary. Section 7 line 1475 was left saying a Cell resolves through its
leader "as of the period being viewed" with nothing in section 7 qualifying it, which is
the exact ambiguity the rule exists to close, while four citations in two services and in
this log all pointed at section 7. This is the seventh false "written to section x" claim
recorded here and the first where the section is off by one — the failure mode the others
share is that nobody greps, and a heading in the wrong section survives a grep for the
*rule*.

**Three unpinned rules and two false statements**, all the classes this branch has been
recording:

The `SCOPE_DENIED` case added by the previous batch pins one of the two things its comment
claims. It does pin the error split — deleting it and throwing `CAPABILITY_DENIED`
unconditionally reddens it, verified. It does not pin the `{ kind: 'church' }` target, and
**nothing can**: `coversWith` discards a grant `grantCoversNothing` voids before reaching
`scopeCovers`, so a narrower grant of a `WHOLE_CHURCH_ONLY` capability is skipped whatever
target it is given, and a Whole Church grant returns true on `scopeCovers`'s first line
before the target is read. Only `ADMIN` holds `records.backdate_effective_date`, at Whole
Church, so both routes bypass the argument. The mutation was run and the case stayed green.
The choice is right on section 7's terms and unfalsifiable, which is now said in both
places rather than implied by a green case. `people.sex-correction.service.ts` already
recorded this fact about the same capability, one module over, in a comment correcting an
earlier version of itself.

Section 10's new backdated-`OTHER` rule — one note carries both — had nothing that could
fail on it: all fourteen backdated cases paired a date with one of the other four
reasons, and all four `OTHER` cases were undated, so a service demanding a second
explanation passed the whole suite. *This entry first said seventeen, which is the number
of `effective_date` occurrences in that file — three of them are the two dated today and
the one dated 2099, none of which is a backdate. Counting the grep rather than the thing
the grep was standing in for, in the paragraph about a rule nothing could fail against.* Section 7's forward-dated clause is unfalsifiable by
construction, `changeSchedule` being its only subject and no leadership row existing at a
future instant; that one is now said in the docblock, as its two neighbours already do.

And a comment the batch inserted into a *pre-existing* case described the case below it:
Rosalio's placement under the root is what makes the Leader-actor case discriminate, and
the case it was written into closes as Admin, whose Whole Church grant returns true before
any target is read.

**What this pass did not find is worth recording too**, because three passes running had
found a live defect in the previous batch's own mechanism and this one did not: nothing
reads a host clock or an authority outside the transaction that relies on it, in either
service.

**The Stop Condition is listed as open rather than answered.** Section 22 does not define
what a collection endpoint does with a forged, stale or unparseable cursor. The roster
now matches `GET /api/v1/people` — treated as absent — because two endpoints on one API
answering differently is the thing worth avoiding until the rule exists, and because it
discloses nothing: the worst a tampered value does is start the page elsewhere in a roster
the reader may already see in full. That is consistency with the only implementation this
repository has, not a ruling.

---

Decision 0143, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Ten on the second fix batch, and the rule written with nothing that could fail on it](0142-ten-on-the-second-fix-batch-and-the-rule-written-with.md) | Next: [2026-08-29 — Five on the fourth fix batch, and a bound that moved underneath its payload](0144-five-on-the-fourth-fix-batch-and-a-bound-that-moved.md)
