# 2026-08-30 — `DateStyle` is pinned by the connection, not inherited

The open list has carried this since the third review pass on the leadership-request
slice, where a cursor was found to render according to a setting this repository does
not control. That cursor was fixed by rendering its key with `to_char` and an explicit
format — one symptom of a fault whose first symptom would be far louder and far
stranger.

**The pool pins `DateStyle` in the connection startup packet, as `ISO, MDY`, and the
application reads it back when it starts and refuses to start unless the pin took
effect.**

**What it prevents is silent.** `node-postgres` parses a `timestamptz` from the text
the server sends and expects the ISO output format. Under `SQL`, `Postgres` or `German`
it does not fail — it returns **null**. Every `timestamptz` and `timestamp` the API
reads then comes back empty: `started_at`, `ended_at`, `requested_at`, every
effective-dated period and every audit entry, with nothing raised anywhere.

**A `date` fails differently, and the first version of this ruling said "every
timestamp" as though there were one failure.** The OID-1082 parser in
`database.module.ts` returns the server's raw text rather than an instant, and raw text
is not null under a non-ISO style — it is `15.06.1985`, a well-formed string of the
wrong shape that satisfies every type in its path and flows into a Section 22 date-only
field. So the pin closes two silent failures with different signatures, and it is what
guarantees that parser's unstated assumption that the text is `YYYY-MM-DD`. Section 5's as-of queries,
Section 4's backdate floor and Section 20's period boundaries are all built on those
columns, so a deployment could pass every test in this repository and still answer "who
led this person in March" with nothing at all.

It is deployment-controlled and demonstrably varies: this project's own development
server runs `ISO, DMY` rather than PostgreSQL's default `ISO, MDY`, which has been
harmless only because both are ISO. A test written for this branch asserted equality
with the pinned value on an unpinned connection and failed here for exactly that
reason, which is a fair demonstration that the variation is real rather than
hypothetical.

**Three answers were open, and the chosen one is the first two together.** Document it
as a deployment requirement and leave it unchecked was refused outright: the failure is
invisible, so a requirement nobody can fail is worth nothing here.

Pinning alone is the fix. Asserting alone would leave a correctly-configured deployment
depending on a server setting it did not have to depend on. Together, the pin makes the
server irrelevant and the assertion makes the pin verifiable — which is the only thing
that stops it being a line somebody removes with nothing noticing.

**The assertion is a check on the pin, not on the server.** Once the pin is in place
the server's configuration no longer reaches the application, so there is nothing left
to assert about it. What the check earns is that the pin cannot be removed, or fail to
arrive, without the application refusing to start.

It has a case of its own that nobody claimed for it: `pg` lets a `DATABASE_URL`
carrying its own `?options=` supersede the pool's, so a connection string can discard
the pin silently, and the startup check is the only thing that would catch it.

***The first version of this ruling justified all of that by an asymmetry with the
isolation level, and the asymmetry does not exist.*** It said isolation must be
asserted rather than set "because a client cannot set another session's default", and
called reusing its shape Section 25 rule 19. `default_transaction_isolation` is
settable in the startup packet by exactly the mechanism used here — verified in one
connection against this project's own database, which is how `architecture-guardian`
refuted it. So the rule 19 invocation was itself rule 19, applied to a distinction that
is not there.

The second half was wrong too: Section 24's isolation check is a **test**, in
`invariants.spec.ts`, against the test database. No deployment runs it. There was no
runtime assertion to part company with.

What actually separates the two is the failure rather than the mechanism. A wrong
`DateStyle` corrupts every date in silence; a wrong isolation level removes an
authorization guarantee that a test asserts and a reviewer can reason about. Whether
isolation should be pinned here too is a real question this raised, and it is on the
open list rather than answered in passing.

**`MDY` is the input half and nothing depends on it** — checked rather than assumed,
across the migrations, the tree import, the rendered cursor key and the two
`::timestamptz` casts. Being a *bound parameter* is not what makes those safe, which
the first version of this claimed: `pg` sends every parameter as text, and it is being
rendered ISO-8601 that makes the server's input order irrelevant. Pinning `MDY` on this
`DMY` development machine therefore changes no behaviour, which was verified rather
than hoped.

It is pinned for determinism, and the check requires both halves because a difference
in either is a sign the option did not arrive as intended.

**What the tests pin, and what they cannot.** The danger is asserted rather than
described: a connection inheriting `German, DMY` is shown returning `null` from a
successful `SELECT now()`. The pin is exercised against a genuinely hostile
database-level default rather than against a server that already agrees, because
otherwise removing the pin leaves the test green. Two mutations were run: removing the
pool's option fails the case that starts the application under a hostile default, and
making the check a no-op fails four cases.

The first attempt at the pin mutation reported a lower test total rather than a
failure, which is a mutant that did not compile rather than one that was caught, and it
was rewritten before being counted. The same happened to a third mutation, for the same
reason — an import left unused — and was corrected the same way.

**What they could not pin, until a review pointed at it: the hook's own call site.**
Four places claimed the check is what stops the pin being a line nobody would notice
being deleted, and the check's own wiring was exactly such a line. Removing
`DatabaseModule.onApplicationBootstrap` left the whole suite green: the case that starts
the application still had a pinned pool, and the case that calls `assertDateStyle`
directly never constructs the module. That is the disjunction-with-a-member-missing
shape this log records three times over. It is pinned now by a case that hands the
module an unpinned pool and requires `init()` to reject, verified red against the
gutted hook.

**Two consequences, neither hidden.** The migration runner opens its own connection and
does not go through this pool, so it inherits the server's style — nothing it writes is
a client-side timestamp, and its one timestamp read raises rather than continuing, so
the gap is narrow and self-announcing. And the application now requires a reachable
database to *finish* starting, where the pool used to be lazy: under an orchestrator a
database that is not yet up becomes a failed boot rather than a process that recovers.

**The cost is one more thing a deployment cannot get wrong quietly, in exchange for a
process that refuses to start.** That is the right direction for this failure: an
application answering every date with null is worse than one that will not boot.

---

Decision 0156, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — The backdate floor gains two Cell terms, one per mechanism](0155-the-backdate-floor-gains-two-cell-terms-one-per-mechanism.md) | Next: [2026-08-31 — A Cell leadership audit entry names the Cell](0157-a-cell-leadership-audit-entry-names-the-cell.md)
