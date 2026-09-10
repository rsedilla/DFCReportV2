# 2026-09-11 — A development email transport writes to an outbox, and refuses in production

An account is provisioned `PENDING_ACTIVATION` and its holder sets a password from a
token delivered by email (Section 6). With no provider configured, `LoggingEmailAdapter`
delivers nothing and says in terms that "the token is deliberately not logged";
`account_tokens` stores only a SHA-256 hash, so the plaintext cannot be recovered; and
`bootstrap:admin` refuses to run a second time.

**So a provisioned account cannot be signed into at all.** Reproduced on 2026-09-10
against `dfc_demo`: a Senior Pastor account was created, returned `201`, and there was no
path to activate it.

That is not only a demo inconvenience. `web/screen-coverage.json` waives ten Admin routes
from the screens block on the stated ground that "the pilot's accounts are provisioned
before it starts", and the pilot's exit criterion requires a leader to record a month
through the interface. Both rest on provisioning producing an account somebody can use.

## A second adapter, selected in the one file that names a provider

`EmailModule` is where a provider is named, and Section 2 requires that swapping one is a
change to that file and nothing else. This adds `OutboxEmailAdapter` beside
`LoggingEmailAdapter` and selects between them by configuration. No service changes, no
caller learns which is bound, and `EMAIL_PORT` is still the only route by which a token
reaches a person.

It writes the whole message, token and expiry included, as one file per message in a local
directory. A file rather than the application log, because a log is shipped, aggregated
and searched by things that should never hold a credential, while a directory is one
place to read and one place to delete.

## Why writing a token down is admissible here

Section 6 already permits exactly this trade once, and states its terms: `bootstrap:admin`
"prints the activation token rather than relying on delivery", accepted because the token
is single-use, short-lived, and read by the person who typed the command.

**The outbox is the same trade with a narrower blast radius.** The file lands on the
developer's own machine, no address receives anything, and the token it holds expires and
is single-use exactly as the printed one does. What Section 6 forbids is unmoved: a token
still never appears in an API response, so an administrator still cannot learn another
person's.

## The guard is the load-bearing half

**The process refuses to start when the outbox transport is selected and `NODE_ENV` is
`production`.** That refusal, not the adapter, is what makes this safe to have in the
repository at all. It is the idiom Section 6 already uses for `JWT_SECRET`: refuse rather
than fall back to something that would be wrong in production.

**The default does not move.** Absent configuration the logging adapter is bound, so no
existing deployment changes behaviour by taking this change.

## What this does not do

**It is not a provider, and it does not discharge the one the pilot needs.** A real
transport — SES or otherwise — is still owed, and is still a deployment concern alongside
the least-privilege database role and the liveness probe. This ruling makes the activation
*flow* exercisable; it does not make mail deliverable to a leader's phone.

*Three alternatives were rejected. An Admin-visible activation link is refused by Section 6
in terms, which keeps tokens out of every API response so that an administrator cannot
learn another person's. A second `bootstrap`-style command setting a password directly
would be a second credential path and would bypass the very flow a pilot has to exercise.
Logging the token is the narrower-looking option and is worse, for the reason above.*

---

Decision 0236, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-10 — What each engine is tested for, and axe runs in Blink](0235-what-each-engine-is-tested-for.md)
