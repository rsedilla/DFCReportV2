# 2026-08-30 — `DateStyle` is pinned by the connection, not inherited

The open list has carried this since the third review pass on the leadership-request
slice, where a cursor was found to render according to a setting this repository does
not control. That cursor was fixed by rendering its key with `to_char` and an explicit
format — one symptom of a fault whose first symptom would be far louder and far
stranger.

**The pool pins `DateStyle` in the connection startup packet, as `ISO, MDY`, and the
application reads it back when it starts and refuses to start unless the pin took
effect.**

**What it prevents is silent and total.** `node-postgres` parses a `timestamptz` from
the text the server sends and expects the ISO output format. Under `SQL`, `Postgres` or
`German` it does not fail — it returns **null**. Every timestamp the API reads then
comes back empty: `started_at`, `ended_at`, `requested_at`, every effective-dated
period and every audit entry, with nothing raised anywhere. Section 5's as-of queries,
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

**The assertion is a check on the pin, not on the server, and that is where this parts
company with the isolation level.** Section 24 records `READ COMMITTED` as a dependency
and checks it by reading `SHOW transaction_isolation` from the server, because a client
cannot set another session's default — the application genuinely depends on how the
server is configured, so asserting is all that is available. `DateStyle` is not like
that. Reusing the isolation level's shape would be Section 25 rule 19: the same shape
without the reason that gave it that shape.

**`MDY` is the input half and nothing depends on it.** Section 22 sends date-only
fields as `YYYY-MM-DD`, unambiguous under every input order, and every other value is a
bound parameter rather than a literal the server parses. It is pinned for determinism,
and the check requires both halves because a difference in either means the startup
option did not arrive — and the next thing that option would silently not apply is the
half that does matter.

**What the tests pin, and what they cannot.** The danger is asserted rather than
described: a connection inheriting `German, DMY` is shown returning `null` from a
successful `SELECT now()`. The pin is exercised against a genuinely hostile
database-level default rather than against a server that already agrees, because
otherwise removing the pin leaves the test green. Two mutations were run: removing the
pool's option fails the case that starts the application under a hostile default, and
making the check a no-op fails four cases.

The first attempt at the pin mutation reported a lower test total rather than a
failure, which is a mutant that did not compile rather than one that was caught, and it
was rewritten before being counted.

**The cost is one more thing a deployment cannot get wrong quietly, in exchange for a
process that refuses to start.** That is the right direction for this failure: an
application answering every date with null is worse than one that will not boot.

---

Decision 0156, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — The backdate floor gains two Cell terms, one per mechanism](0155-the-backdate-floor-gains-two-cell-terms-one-per-mechanism.md)
