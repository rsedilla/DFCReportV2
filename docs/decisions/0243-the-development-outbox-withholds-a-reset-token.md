# 2026-09-11 — The development outbox writes an activation token and withholds a reset one

Section 6 states, among the password-reset rules: **"Do not let admins know or choose
another user's password."** Decision 0236 shipped a development email transport that writes
every message to a directory, activation and password-reset tokens alike. A reset token is
a credential for an account somebody is already using, so whoever reads that directory can
take that account over without ever knowing a password.

That was recorded as a Stop Condition, because decision 0236 **assumed** an answer rather
than supplying one.

## The ruling

**The outbox writes an `ACTIVATION` token. It refuses to write a `PASSWORD_RESET` one**, and
records the message without it, so a developer learns the flow ran and why the token is
absent.

Section 6's rule is not exempted on a development machine. It binds, and this is what it
binds to.

## The ground, which is the opposite of what a first version of this ruling claimed

That version held that a development machine is exempt because the operator already holds
everything the outbox could give them: the database is theirs, `account_tokens` is one query
away, and the service will mint either token on request. **Both facts are false**, and
`architecture-guardian` established it by reading the code rather than the prose.

`account_tokens` stores a SHA-256 digest, and migration `0001_foundations.sql` says so in a
comment above the column: *the token itself is never stored*. Of the four call sites that
mint one, three hand the plaintext to the email transport and nowhere else, and the fourth is
`bootstrap:admin`, which refuses while any account exists and so can never mint for another
person. No API response carries a token.

**Section 6 already said this, in the subsection that introduces the transport, and the
amendment contradicted it.** Its own words, justifying why the transport exists at all: the
token is stored only as a hash, *so there is no way back*. *Three homes said "twenty-one
lines up"; the sentence is roughly ninety lines **below** the amendment, and twenty-one was
the size of the block the first commit replaced. A number nobody checked, in a ruling whose
subject is a claim stated with confidence and not checked.* The outbox exists **because** the database yields nothing. The
first version argued it was redundant **because** the database yields everything.

So the outbox is not a convenience that saves a query. On a development machine it is the
**only** source of a usable credential for another person's account — which is precisely the
access Section 6 withholds.

## Why activation is different, and it is not a matter of degree

An activation credential belongs to an account **nobody has used**. A reset credential takes
over an account somebody **is** using. Section 6's sentence is about the second.

The transport was justified by the first and never by the second. The reason both homes
give is an **activation** reason: `outbox-email.adapter.ts` says it exists "because without
it a provisioned account cannot be activated at all", and Section 6 says the same where it
introduces the transport. Refusing the reset token therefore costs the transport nothing it
was built for. *A first version of this paragraph added "neither mentions the reset flow",
which is false of Section 6 — the sentence introducing the transport named the reset message
explicitly, and said the token was written. That is the clause this ruling amends, so citing
it as silent was the overshoot of a correction.*

Section 6 makes the same trade for `bootstrap:admin`, which prints its activation token. That
precedent carries to an activation and not to a reset, because there the operator **is** the
holder — the one term that does not transfer.

## Why not the alternatives

**Exempting the development machine outright** was ruled first and is withdrawn, because its
ground was false. It would have left the one reachable route to another person's account open
on the argument that it was already open, when it was not.

**Refusing to write the token at all** removes the only reason the transport exists: a
provisioned account could not be activated, and the demo accounts would be unreachable.

**What this ruling costs, stated rather than left to be found.** On a development machine an
`ACTIVE` account whose password is lost now has no in-product recovery: `resendActivation`
refuses any account that is not `PENDING_ACTIVATION`, and the reset token is withheld. The
only route left is direct database access, which is the first of the two Stop Conditions
below. That is the same recovery argument Section 6 accepts one flow over for
`bootstrap:admin`, and it is what makes that Stop Condition load-bearing rather than
theoretical.

**Re-grounding the exemption on database access** — an operator holding `DATABASE_URL` can
forge a token row from a hash they compute, or overwrite `accounts.password_hash` with an
argon2 hash of their own — is coherent and is not taken. It rests on something Section 6 never
defines: what access a development operator is presumed to hold. That is a Stop Condition in
its own right, recorded in `CLAUDE.md`, and it is materially different from what the ruling
would have used it for: a **write** that fabricates a credential, rather than a **read** of
one the system minted.

## What this does not do

**It does not exempt `test`.** `api/test/setup/env.ts` pins `NODE_ENV=test`, so no end-to-end
case can bind the transport, and a database truncated before every case is no place for a
credential on disk. The adapter's own suite reaches it by constructing the class directly.

**It changes nothing about the API.** Section 6 requires the forgot-password response to be
identical whether or not the address matches an account, and this transport is downstream of
that. The reset caller logs rather than raises, so a refusal here opens no oracle.

**It states no rule about a shared development host.** The `NODE_ENV` guard cannot tell a
laptop from a team server, and nothing here gives it one. `CLAUDE.md` carries that as open.

---

Decision 0243, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — Section 2 argues the shape, and a derived ledger holds the instances](0242-section-2-argues-the-shape-and-a-ledger-holds-the-instances.md)
