# 2026-08-30 — Four on the second fix batch, and a pin that pinned nothing


Third pass, scoped to the second batch's fixes. The `to_char` key was executed against the
database across five `DateStyle`s, four zones and seven instants and is correct; the shared
sentinel, the deterministic tie-break fixture and the section 10 and `@Transform`
corrections were all verified true. Every finding is again a statement or a test, which is
the convergence signal — but one of them is the batch's own headline fix arriving with a
case that pins nothing, and one is a fix that created two new instances of the defect it
was fixing.

**The `German, DMY` case pinned nothing, and three places said it did.** `createTestDb`
opens its own pool and the application opens another, and `SET DateStyle` is per
connection — so a case that sets it on the test pool and then makes an HTTP request has
changed nothing about the session the query runs in. Reverting the fix left the case green.
It reddened under the mutation only because the cast's shape fails the new pattern under
*every* style, which is an unrelated reason.

*Found independently while the pass was running, and the pass confirmed it with two hazards
I had not seen.* A `SET` without `LOCAL` changes the one pooled connection that ran it, so
the restore may be handed a different one and leave the first dirty. And a dirty one is
worse than untidy: **under a non-ISO `DateStyle` the driver's own `timestamptz` parser
returns `null`**, so every later timestamp read on that connection comes back empty and
reads as a defect in whatever case drew it. Reproduced.

The property is pinned now where it can be — `test/database/cursor-rendering.spec.ts`, on
one dedicated `Client` rather than a pool, across all five styles. The format string is
shared with the query rather than copied, because a test carrying its own copy keeps
passing after the query's has changed.

**The orphaned-docblock fix created two more orphans, in the two files it touched — and
then a third, in the file the fix was originally about.** Sharing the format string
between the query and its test put `CURSOR_INSTANT_FORMAT`'s docblock between
`CURSOR_INSTANT`'s and `CURSOR_INSTANT`, so the long block describing the rendering
documented nothing and the regex it describes had none. Caught by reading the file after
the pass reported, not by the pass. Four instances on this branch, three of them created
by a fix for one of the others, which is enough to say the fix is the hazard: inserting a
documented declaration next to a documented declaration is where this happens, and the
check is to read the two lines above every `export` a batch adds.** Moving
`NIL_UUID` out of the guard left its docblock behind, floating between two import blocks
and describing nothing; inserting it into `common/identifiers.ts` put it between
`canonicalId`'s docblock and `canonicalId`, so the twenty-six-line rationale for the whole
identifier-canonicalization rule documented a constant and `canonicalId` had none. That is
the previous pass's headline shape — a fix undone in the act of making it — and it is the
second batch running in which this defect has appeared.

**Section 7 stated the removed mechanism in a second place and only one was amended.** The
entry said "Section 7 now says the scope value is chosen to match the prohibition and does
not enforce it"; line 1632 was amended and line 1471, a hundred and sixty lines earlier and
what a reader meets first, still scoped the domain-check rule to "where the grant must
still reach oneself as a *source*" — which is exactly the implicature that a domain check is
unnecessary here. It also made the service's citation wider than its source. Both now say
the same thing.

**And a correction carried the superseded reason.** The entry defended the time-zone half by
saying the pattern accepts `+00`, `+05:45` and `-02:30` — properties of the pattern that had
just been deleted. The one that shipped accepts no offset at all, because `at time zone
'UTC'` makes the key zone-independent and it always ends `Z`. Right answer, wrong reason, in
the entry recording wrong reasons.

Also: a sentence asserting that a `NETWORK` grant "compares a Network that for the actor is
their own" was true of one of the two grants that can be issued, and is narrowed to say the
grant covers the actor wherever it names their own Network.

---

Decision 0151 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — Ten on the request fix batch, and a fix claimed in the past tense that was never made](0150-ten-on-the-request-fix-batch-and-a-fix-claimed-in-the-past.md) | Next: [2026-08-30 — Approval records the leadership and leaves the account pending](0152-approval-records-the-leadership-and-leaves-the-account.md)
