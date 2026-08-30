# 2026-08-23 — Identifier normalization is global, and a pastoral leader has one field name


Two changes to the API boundary, settled together because both are about an
identifier arriving from a client and neither is worth a review cycle alone.

**The boundary normalizes every route, and every argument a client sends it.**
`CanonicalIdentifierPipe` is registered globally and canonicalizes a string in a
path parameter, a query parameter or a body wherever the field's **name** says it
is an identifier and the value is UUID-shaped — both halves, always; the rule is
stated in full below. A route added later is inside §7's canonical-comparison rule
without its author knowing the rule exists. The first attempt was a pipe wired onto
each `@Param('id')`, which is verbatim the failure §2 gives as the reason the
capability guard is declarative — a convention held per call site is only as
reliable as the least familiar developer writing the newest one. That closes the
open item this log has carried since the identifier work began.

*This sentence first said "canonicalizes every UUID-shaped string", which is the
shape-only rule the entry goes on to describe as the defect that had to be fixed.*
A reader who stopped at the summary — which is what a summary invites — read back
the version that lowercased a password. Corrected in place rather than deleted,
because a false reason here is worse than none, and because an entry contradicting
itself two paragraphs apart is the exact failure this log keeps recording.

**The first version took path parameters alone, and the reason it gave was false.**
It said a query parameter must be protected because the search cursor is
case-sensitive base64url — but the pipe only touches UUID-shaped strings, and a
cursor is not one, so the hazard it named could not be produced by the code naming
it. What the narrow version actually left out was every identifier arriving as a
query filter (§22 documents one on `/cells`) and every body field, each of which
needed a transform somebody had to remember — the same per-site opt-in the change
existed to remove, one layer over.

Found by `architecture-guardian`, and it is the same fault as the five before it: a
mechanism described from the part of it being looked at.

**The second version was wrong in a worse way, and the rule is now name-based
because of it.** Widening the pipe to every argument meant it walked the body of
`POST /auth/login`, and it decided what to touch by *shape* — so a password that
happened to be UUID-shaped was silently lowercased and that account could never
sign in again, with nothing to diagnose. `uuidgen` output is an ordinary ad-hoc
password. A boundary cannot tell an identifier from a credential by looking at the
value, and it does not have to: it can look at the field's name, which this system
chooses.

A value is canonicalized only where **both** hold — the key names an identifier,
and the value is UUID-shaped. Name alone would rewrite a Member ID, which is `M-`
and six digits; shape alone rewrites credentials. §22's naming convention now
carries the other half, and what exactly it says is settled in the ruling below —
the version written here first was narrower than the code it claimed to describe.

**A prototype check silently skipped every object-bound query and path parameter.**
Express 5 builds `req.query` and `req.params` with `Object.create(null)`, so testing
against `Object.prototype` alone excluded exactly the bindings §22's documented
`/cells` leader filter would use — named `leader_id` when this was written, and
`cell_leader_id` since the ruling below. No end-to-end case could see it, because the
*named* bindings receive a bare string and work either way.

**The walk was also unbounded**, which the widening made reachable before
authentication: a nested body well inside the 100 KB limit overflowed the stack and
answered `INTERNAL_ERROR` — a 500 logged as a defect, for input, on the sign-in
route.

*This bounded one of the two walks over a client's body and said so as though it
had bounded the hazard.* The idempotency fingerprint's own walk was left
unbounded, on every authenticated write endpoint, and is closed by the ruling
below — which also replaces the bound's behaviour, because stopping the descent
and returning the container was itself a defect. Left standing as written, because
the claim was true of what it named and the fault was in what it did not look
for.

**The idempotency fingerprint canonicalizes separately**, because interceptors run
before pipes: it would otherwise be taken over the spelling the client used, and one
retry differing only in case would fingerprint differently and be answered
`IDEMPOTENCY_KEY_REUSED` — which §22 makes permanent, turning an ordinary retry into
a dead end. The path is canonicalized **segment by segment**, because a path is
never itself UUID-shaped and handing the whole string to the helper does nothing at
all, quietly. That was caught before it shipped and is recorded because it is the
same mistake in miniature: reusing a helper without checking its shape fits.

It canonicalizes and does not validate. Whether a value is a UUID is decided by the
capability guard for the one target it resolves scope against, and by the DTOs for
what they declare. The previous pipe's throwing branch was unreachable for that
reason — it looked like a second line of defence and was dead code. **A path
parameter the guard does not resolve against is validated by neither**, which §22
already sketches with a second identifier in a route path; §7 now says such a route
must validate it itself, because reaching a `uuid` comparison with a non-UUID
produces a database error rather than an answer.

**`leader_id` becomes `pastoral_leader_id`** on the reassignment endpoint, matching
`POST /people` and the sex correction. The rule is written to §22's Conventions
rather than to §7: a field-naming convention has no authorization consequence, and
§22 is where three client codebases look. §11 makes Cell leadership a first-class
concept, so a bare `leader_id` does not say which kind of leader it means. The
database column keeps its name: `pastoral_assignments.leader_id` is disambiguated
by its table.

**It is a rename inside §22's window rather than a break §22 absorbed.** §22 binds
`/api/v1` to stay behaviourally unchanged "for as long as any client calls it", and
nothing calls it — `web/` is a placeholder and no mobile build exists. The window
closes at the first real client, which is the argument for doing it now rather than
recording it as debt. The eleven authorization cases pinned the old name and their
own header always provided for this: "Stage 2 implements this shape, or changes
these tests deliberately and says why."

**What pins the global boundary is a route that opts into nothing.** Every other
identifier case passes if either the boundary or the defensive comparison is
present, so none of them notices the boundary regressing to per-site opt-in. The
probe route is written the way any new route would be — bare path, query and body
bindings, no pipe, no transform, nobody having remembered anything — and asserts all
three arrive canonical, with the body's identifier nested inside an array inside an
object because that is where a real one turns up. It also asserts that a
**UUID-shaped password** comes back untouched, which is the property that makes
running over a whole request safe and the one a shape-based rule fails.

**The walk itself is pinned by unit tests rather than only by that probe**, because
its three dangerous properties are invisible end to end: a prototype check that
skips `req.query`, a credential quietly rewritten, and a stack overflow on a legal
payload all look identical to a green suite. Two of the three defects above would
have been caught by the tests that now exist and did not.

---

Decision 0101 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-23 — Reusing a shape requires re-deriving why it has that shape](0100-reusing-a-shape-requires-re-deriving-why-it-has-that-shape.md) | Next: [2026-08-23 — What an identifier's field name is, and the second walk over a body](0102-what-an-identifiers-field-name-is-and-the-second-walk-over-a.md)
