# 2026-09-11 — A development email transport writes to an outbox, and refuses in production

An account is provisioned `PENDING_ACTIVATION` and its holder sets a password from a
token delivered by email (Section 6). With no provider configured, `LoggingEmailAdapter`
delivers nothing and says in terms that "the token is deliberately not logged";
`account_tokens` stores only a SHA-256 hash, so the plaintext cannot be recovered; and
`bootstrap:admin` refuses to run a second time.

**So a provisioned account cannot be signed into at all.** Reproduced on 2026-09-10
against `dfc_demo`: a Senior Pastor account was created, returned `201`, and there was no
path to activate it.

That is not only a demo inconvenience. `web/screen-coverage.json` waives **two** routes
on the stated ground that "the pilot's accounts are provisioned before it starts" —
`POST /accounts` and, by reference to it, `POST /accounts/{id}/activation-email` — and the
pilot's exit criterion requires a leader to record a month through the interface. Both rest
on provisioning producing an account somebody can use. *A first version of this paragraph
said ten routes, which is the number of waivers in that file and not the number resting on
this ground; the other eight cite §10, §2 or decisions 0133 and 0147. An argument that runs
on two routes was stated as though it ran on ten.*

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

## Why writing a token down is admissible here, and where the precedent stops

Section 6 permits a comparable trade once, and states its terms: `bootstrap:admin` "prints
the activation token rather than relying on delivery", accepted because the token is
single-use, short-lived, and **read by the person who typed the command**.

**Two of those terms transfer and one does not, and a first version of this ruling claimed
all three.** The token written to an outbox is single-use and short-lived exactly as the
printed one is, and it reaches no address, so nothing is delivered to a stranger. What does
not transfer is the term the bootstrap paragraph actually turns on: there, the operator
**is** the holder. Here they are not. With this transport bound, whoever can read the
directory reads tokens minted for **other people's** accounts.

**It also reaches password resets, which the first version did not mention at all.**
`OutboundEmail` is an activation or a reset, so a `PASSWORD_RESET` token is written too, and
Section 6's *Password reset security* says "do not let admins know or choose another user's
password".

**So the claim that "an administrator still cannot learn another person's" is withdrawn.**
It is true of the API surface and false of the configuration this ruling authorises, which
is a conclusion that does not follow placed in the paragraph carrying the security argument.
What remains true, and is the narrower thing this ruling asserts: a token never appears in
an **API response**, so nothing here widens what an administrator can obtain *through the
product*.

**Whether an operator may read another person's activation or reset token on a development
machine is not settled here.** Section 6 does not address it, this ruling assumes it, and it
is recorded in `CLAUDE.md` as a Stop Condition rather than decided in a module.

## The guard is the load-bearing half

**The process refuses to start unless `NODE_ENV` is explicitly `development`.** That
refusal, not the adapter, is what makes this safe to have in the repository at all. It is
the idiom `CLAUDE.md` states under *Running the project* and `configuration.ts` states in
its own opening lines — refuse rather than fall back to something that would be wrong in
production. *A first version attributed that idiom to Section 6 and to `JWT_SECRET`.
`JWT_SECRET` appears once in the specification, in Section 7, and says nothing about
refusing to start; the real precedent inside Section 6 is the bootstrap paragraph above.*

**It reads the raw variable rather than the resolved one, and two earlier versions did
not.** The first refused `production` by name. `NODE_ENV` is optional and resolves to
`development` when absent, `npm run start:prod` sets nothing, and `dotenv` is loaded in
every environment — so a host that never exported `NODE_ENV`, carrying
`EMAIL_TRANSPORT=outbox` in its `.env`, would have bound the outbox.
`architecture-guardian` reproduced it. The second stated the rule positively against the
same resolved value, which reads correctly and leaves the identical hole, because the
default *is* the value being required. **A decision about writing credentials to disk may
not rest on a default.**

*Nothing was leaking: there is no deployment artefact in this repository — no Dockerfile,
and `docker-compose.yml` defines only PostgreSQL — so no host could reach that state today.
What the defect did was make `NODE_ENV` load-bearing for whether a credential lands on disk
before anything existed to guarantee it is set.*

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
