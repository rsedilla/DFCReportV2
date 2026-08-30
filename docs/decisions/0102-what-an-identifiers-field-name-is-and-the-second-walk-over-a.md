# 2026-08-23 — What an identifier's field name is, and the second walk over a body


`architecture-guardian` on the identifier branch, escalating a Stop Condition: §22
said an identifier's field name "ends in `_id` or `_ids`" **and** said that is what
the boundary keys on. Both could not be true. The boundary also accepts a bare `id`,
a bare `ids`, and the `camelCase` forms, and §22's own example routes used
`{meetingId}` and `/cells?leader_id=`. Four things are settled here, and each is
amended into `SKILL.md` in the same change.

**A bare `id` is an identifier field name, and §22 moves rather than the code.** This
is the half that had to go the way it went: a path parameter binds under the name its
route declared, so `@Param('id')` hands the boundary the key `id`. A convention
admitting only the suffixed forms would put **every path parameter in the API**
outside the rule — which is the case the boundary was built for, and the case §7
names as the one where the comparison fails *open*. Narrowing the regex to match the
sentence would have been following the specification off a cliff.

The plural is admitted at both positions with it, so `ids` and
`acknowledged_duplicate_ids` are one rule rather than two.

**`camelCase` leaves the boundary, and §22 says the surface is `snake_case`.** The
regex accepted `Id`/`Ids` as defence in depth, and no route, DTO or fixture in the
repository names an identifier that way — so it was a shape kept without its reason
holding, which is §25 rule 19, merged the same morning, applied to the branch that was
open when it merged.

`forbidNonWhitelisted` was first cited here as a complete backstop and is a partial
one: `ValidationPipe` validates class metatypes only, so a binding typed as a plain
object is skipped, and the idempotency fingerprint walks the raw body before any pipe
runs. The narrowing rests on the argument below rather than on that.

The narrowing is the safer direction and not only the tidier one. A `meetingId`
arriving from a client is a naming defect, and it shows up as an authorization
comparison quietly answering on a spelling; a boundary that silently absorbs it is
what would hide the defect rather than surface it. §22's example route becomes
`{meeting_id}`.

**A Cell's leader is `cell_leader_id`, including in the filter §22 already
documents.** §22 forbade naming a Cell's leader `leader_id` and then, three
subsections later, documented `GET /api/v1/cells?leader_id=...`. Corrected now rather
than when Stage 3 builds it, on §22's own argument: the only moment to fix a field
name is before a client depends on one, and an example a specification documents is
what the implementer copies. Nothing calls `/cells` — it does not exist.

**The bound on a client's nesting refuses, and covers both walks**, and it is now in
§22 beside the other refusal shapes — the depth, the code, and refusing rather than
truncating are all client-visible on every route, and three clients branch on them.
*The first version of this entry claimed that amendment and did not make it*, which is
the failure the preamble of this log names in one line: a decision here but not in the
specification is unfinished work. It is the third time on this project that a
"written to §x" claim has been false, because nothing checks one.

This is the one that was a live defect rather than a disagreement, and it was
**pre-existing on `main`** — fixed here because it is the identical class this branch is about, and
because the branch carried a test comment claiming protection against it.

There are two recursive walks over a request body: the identifier walk, and the
idempotency fingerprint's `canonicalize`. The branch bounded the first and left the
second untouched, one line apart. `JSON.parse` is iterative in V8 and accepts any
depth — measured past two hundred thousand levels — while both walks are recursive
and do not. **A few thousand levels** overflows the stack, so an unhandled
`RangeError` rendered as `INTERNAL_ERROR` on **every authenticated write endpoint**,
for any signed-in leader. The earlier entry's claim that the walk was bounded was
true of the walk it named and false of the hazard.

*This paragraph first asserted "around three thousand levels, eighteen kilobytes" as
a measured pair, then replaced it with a second pair that did not reproduce either.*
Both are now withdrawn and **no threshold is quoted here at all**, which is what
`identifiers.ts` already says and what this paragraph's own next sentence requires:
the number moves with the payload's shape and with stack headroom at the call site,
so any bare figure is a measurement of one harness presented as a property of the
code. Three numeric claims in this entry could not be stood behind, which is enough
to stop making them.

What survives, because it is structural rather than measured: `JSON.parse` accepts
depths these walks cannot, and the cheapest payload is a nested **array** at two
bytes per level, one for each bracket — which is why a body-size limit does not cover
this and a depth bound is needed.

Worth recording against the original: its depth was wrong and its arithmetic was
not. Three thousand levels of `{"a":…}` really is 18,001 bytes; that shape simply
does not overflow at three thousand.

Two decisions inside it, and the first is not the obvious one.

**Exceeding the bound is refused, not truncated.** The first version stopped
descending and returned the container unchanged, which reads as graceful and is
worse: a request nested past the bound kept its identifiers in whatever case the
client sent, silently, and every comparison below became a comparison on a spelling
— which is the defect the boundary exists to remove, reintroduced by its own safety
valve. It answers `VALIDATION_FAILED`: a body no DTO in this system describes is
malformed input, which is what that code means.

*The reason first given here was §22's store-a-4xx rule, and that describes a path
this code does not take.* On the path that fires — an authenticated write — the
refusal is thrown inside the interceptor **before** the key is claimed, so no row
exists and the store/release split is never consulted. What actually makes the 4xx
right is that the refusal is deterministic: the same body gets the same answer
whether or not anything was stored, so nothing depends on which it is.

**One constant, shared by both walks — and applied at the same point, which is the
half that was got wrong.** Two bounds over one body is a disagreement waiting to be
found. The fingerprint's walk keeps its own check even though the interceptor reaches
the identifier walk first, because `fingerprint` is a public method and the ordering
of its callers is not a property it can rely on — exactly what the unbounded version
was resting on without saying so.

*The first version of this said sharing the constant "means one answer for one body",
and shipped a disagreement in the same commit.* The identifier walk asserted before
dispatching on type, so a primitive leaf occupied a level; the fingerprint walk
returned for a primitive before asserting, so it did not. A body at the bound was
therefore refused or accepted according to whether its innermost value happened to be
a string — client-visible arbitrariness, produced by the sentence denying it.

Both now assert immediately before descending into a container and never on a leaf,
which makes them agree for everything either walk sees: parsed JSON. A `Date` or a
class instance would still be counted by one and not the other, and neither can occur
in a parsed body.

Recorded at length because it is §25 rule 19 — merged that morning, and cited three
paragraphs earlier in this entry — failing inside the batch written to apply it. The
reason the fingerprint's walk had that shape was that its early return served
serialization, not depth; reusing the shape without re-deriving that is the whole of
the mistake.

**Also corrected, all of them statements rather than behaviour**, and grouped because
each is the fault §25 rule 19 and its predecessors name — a mechanism described from
the part being looked at:

- §7 said arguments this application constructed are skipped "by the framework's own
  bucket", and implied naming a binding there would bring it in. True of an uploaded
  file or a raw body, which are pipeable and *are* client input. **False of a header,
  a session, a host or a caller's address**, which Nest never offers to any pipe at
  all — so the remedy the sentence prescribed does not work for half the set it
  implied. The `Idempotency-Key` is the header that exists, and it reaches a `uuid`
  cast in SQL rather than a comparison in TypeScript.
- The fingerprint canonicalizes path segments by **shape**, and the comment justified
  it with "no credential is ever a path segment" — an assertion nothing enforces, in
  the batch whose own conclusion is that a boundary cannot tell an identifier from a
  credential by looking at the value. What actually makes it safe is reachability:
  the credentials that travel in a URL-shaped position are the activation and reset
  tokens, those routes are on §7's unauthenticated list, and the interceptor returns
  before a path is canonicalized for any of them. So what would break it is a
  credential added to a path on an *authenticated* route — which is worth knowing and
  is not what was written.
- The identifier walk's docblock said "nothing is mutated — a fresh value is built",
  and this entry first "corrected" it to say the result **aliases** the input wherever
  nothing changed. *That correction was the false half.* Every array and every plain
  object is rebuilt unconditionally; the reason offered for it — that the guard reads
  the raw body first — is a property of non-mutation, which is what the original
  sentence already said. The original stands and the addition is withdrawn.

  *And the withdrawal, as first written, said "nothing aliases but primitives", which
  is also wrong.* A non-plain object — a `Date`, a `Buffer`, a class instance — is
  returned by reference. Nothing pins that: the file's case asserting a live `Date`
  survives checks `instanceof` and `getTime()`, both of which a *cloning*
  implementation would satisfy too, so it pins survival-as-a-`Date` and not identity.
  The docblock scopes the claim correctly ("for any array or plain object"); only this
  log did not. Three statements in sequence on one small fact — four counting the
  overclaim in this sentence's own first draft — which is why it is left visible
  rather than tidied: the code was right throughout and the prose about it was not.
- `api/test/unit/identifiers.spec.ts` justified its own existence with "these are
  pure functions and need no database". The shared harness throws without
  `DATABASE_URL` before any suite loads. They need no database *server*; a dummy URL
  is enough, and the file now says that.

**Three tests were added for rules that had nothing that could fail on them**, which
is the recurring finding rather than a new one.

The fingerprint's canonicalization — justified in three places by one specific,
testable failure — had no case sending one key twice in two spellings, so both the
path and the body canonicalization could be deleted with the suite green. And
removing the old `CanonicalUuidPipe` removed a validation on the argument that the
capability guard already refuses a non-UUID target; the argument is correct and
nothing asserted it, which left the whole API's target validation resting on a branch
no test entered. The guard probe gained an `actor`-target route with a path parameter
so that §7's new obligation — a route the guard does not resolve against must
validate its own — is pinned as a real gap rather than left as a caution.

---

Decision 0102, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — Identifier normalization is global, and a pastoral leader has one field name](0101-identifier-normalization-is-global-and-a-pastoral-leader-has.md) | Next: [2026-08-24 — "Never by layer" is about modules, not about files inside one](0103-never-by-layer-is-about-modules-not-about-files-inside-one.md)
